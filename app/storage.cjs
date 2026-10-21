const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { constants } = require('node:fs');
const { encodeConfig, decodeConfig, defaultConfig, MAX_CONFIG_FILE_BYTES } = require('./config.cjs');

async function readBoundedFile(file) {
  const handle = await fs.open(file, 'r');
  try {
    if ((await handle.stat()).size > MAX_CONFIG_FILE_BYTES) throw new Error('Arquivo de configuração excede 2 MiB.');
    const chunks = [];
    let total = 0;
    // Keep reading after short reads; cap + 1 also detects growth after stat().
    while (total <= MAX_CONFIG_FILE_BYTES) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_CONFIG_FILE_BYTES + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    if (total > MAX_CONFIG_FILE_BYTES) throw new Error('Arquivo de configuração excede 2 MiB.');
    return Buffer.concat(chunks, total);
  } finally { await handle.close(); }
}

const ENVELOPE_FORMAT = 'dobra.safeStorage';

async function readConfigFile(file, platform = process.platform) {
  return decodeConfig(await readBoundedFile(file), platform);
}

function hasHeaders(config) {
  return config.layers.some(layer => layer.bindings.some(binding => {
    const actions = binding.action.type === 'sequence' ? binding.action.steps : [binding.action];
    return actions.some(action => action.type === 'http' && Object.keys(action.headers).length);
  }));
}

function exportConfigSafe(config, platform = process.platform) {
  const portable = JSON.parse(encodeConfig(config, platform));
  for (const layer of portable.layers) for (const binding of layer.bindings) {
    for (const action of binding.action.type === 'sequence' ? binding.action.steps : [binding.action]) {
      if (action.type === 'http') action.headers = {};
    }
  }
  return portable;
}

class Storage {
  constructor(directory, { protection, platform = process.platform } = {}) {
    this.directory = directory;
    this.configPath = path.join(directory, 'config.json');
    this.backupPath = path.join(directory, 'config.backup.json');
    this.logPath = path.join(directory, 'logs', 'activity.jsonl');
    this.protection = protection;
    this.platform = platform;
    this.logQueue = Promise.resolve();
    this.writeQueue = Promise.resolve();
    this.storageStatus = { encryptionAvailable: Boolean(protection?.available), protection: 'plain', backupAvailable: false, message: '' };
  }

  status() { return { ...this.storageStatus }; }

  async protectedPaths() {
    const paths = [this.configPath, this.backupPath, this.logPath, this.logPath + '.1'];
    try {
      for (const name of await fs.readdir(this.directory)) {
        if (/^config\.invalid-[a-f0-9-]+\.json$/.test(name) || /^\.config-[a-f0-9-]+\.tmp$/.test(name)) paths.push(path.join(this.directory, name));
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return paths;
  }

  _queue(callback) {
    const operation = this.writeQueue.catch(() => {}).then(callback);
    this.writeQueue = operation;
    return operation;
  }

  _setProtection(mode, message = '') {
    this.storageStatus.protection = mode;
    this.storageStatus.message = message || (mode === 'encrypted' ? 'Configuração protegida pelo cofre do sistema.' :
      mode === 'legacy' ? 'Configuração legada com headers em texto aberto preservada. Ative o cofre do sistema para migrar antes de salvar.' :
      mode === 'unavailable' ? 'Proteção da configuração indisponível. Arquivo preservado.' :
      this.protection?.available === false ? this.protection.message : 'Configuração sem headers HTTP.');
  }

  async _read(file) {
    const source = await readBoundedFile(file);
    let document;
    try { document = JSON.parse(source.toString('utf8')); }
    catch { throw new Error('Configuração inválida.'); }
    if (document?.format === ENVELOPE_FORMAT) {
      if (document.version !== 1 || typeof document.data !== 'string' || !document.data.length ||
          document.data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(document.data)) throw new Error('Envelope de configuração inválido.');
      if (!this.protection?.available) {
        const error = new Error('O cofre seguro deste sistema é necessário para abrir a configuração.');
        error.code = 'CONFIG_PROTECTION_UNAVAILABLE';
        throw error;
      }
      const decrypted = await this.protection.decrypt(Buffer.from(document.data, 'base64'));
      const config = decodeConfig(decrypted, this.platform);
      return { config, mode: 'encrypted', canonical: decrypted === encodeConfig(config, this.platform) };
    }
    const config = decodeConfig(source, this.platform);
    return { config, mode: hasHeaders(config) ? 'legacy' : 'plain', canonical: source.equals(Buffer.from(encodeConfig(config, this.platform))) };
  }

  async _serialize(config) {
    const plain = encodeConfig(config, this.platform);
    if (!hasHeaders(config)) return { data: plain, mode: 'plain' };
    if (!this.protection?.available) throw new Error('Cofre seguro indisponível. Remova os headers HTTP ou configure a criptografia do sistema antes de salvar.');
    const encrypted = await this.protection.encrypt(plain);
    return { data: JSON.stringify({ format: ENVELOPE_FORMAT, version: 1, data: encrypted.toString('base64') }) + '\n', mode: 'encrypted' };
  }

  async _atomic(file, data) {
    const temporary = path.join(this.directory, `.config-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(data);
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temporary, file);
    } finally {
      if (handle) await handle.close();
      await fs.rm(temporary, { force: true });
    }
  }

  async _refreshBackup() {
    try { await this._read(this.backupPath); this.storageStatus.backupAvailable = true; }
    catch { this.storageStatus.backupAvailable = false; }
  }

  async load({ deferBackup = false } = {}) {
    return this._queue(async () => {
      this.storageStatus.backupChecking = deferBackup;
      if (!deferBackup) await this._refreshBackup();
      let current;
      try { current = await this._read(this.configPath); }
      catch (error) {
        if (error.code === 'ENOENT') return this._save(defaultConfig(this.platform));
        this._setProtection('unavailable');
        throw new Error(`Não foi possível ler ${this.configPath}. Arquivo preservado. ${/2 MiB/.test(error.message) ? 'Arquivo excede 2 MiB.' : 'Configuração inválida ou cofre indisponível.'}`);
      }
      this._setProtection(current.mode);
      if (current.mode === 'legacy' && this.protection?.available) {
        try { return await this._save(current.config); }
        catch { this._setProtection('legacy', 'Migração segura não concluída. Arquivo legado preservado; tente novamente após verificar o cofre e o diretório.'); }
      }
      return current.config;
    });
  }

  async _save(config, { recover = false } = {}) {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    let previous;
    let invalid = false;
    try { previous = await this._read(this.configPath); }
    catch (error) {
      if (error.code !== 'ENOENT') {
        if (!recover) throw new Error('Configuração atual inválida ou protegida por outro cofre. Arquivo preservado; use a recuperação explícita.');
        invalid = true;
      }
    }
    const desiredMode = hasHeaders(config) ? 'encrypted' : 'plain';
    if (previous?.canonical && previous.mode === desiredMode && encodeConfig(previous.config, this.platform) === encodeConfig(config, this.platform)) {
      this._setProtection(previous.mode);
      return config;
    }
    const serialized = await this._serialize(config);
    // Encrypt the previous valid configuration too; never copy legacy headers into a plaintext backup.
    if (previous) {
      const backup = await this._serialize(previous.config);
      await this._atomic(this.backupPath, backup.data);
      this.storageStatus.backupAvailable = true;
    }
    if (invalid) {
      const preserved = path.join(this.directory, `config.invalid-${randomUUID()}.json`);
      await fs.copyFile(this.configPath, preserved, constants.COPYFILE_EXCL);
      await fs.chmod(preserved, 0o600);
    }
    await this._atomic(this.configPath, serialized.data);
    this._setProtection(serialized.mode);
    return config;
  }

  async save(config) {
    const snapshot = JSON.parse(encodeConfig(config, this.platform));
    return this._queue(() => this._save(snapshot));
  }

  async recover(config) {
    const snapshot = JSON.parse(encodeConfig(config, this.platform));
    return this._queue(() => this._save(snapshot, { recover: true }));
  }

  async readBackup() {
    return this._queue(async () => {
      try {
        const backup = await this._read(this.backupPath);
        this.storageStatus.backupAvailable = true;
        return backup.config;
      } catch (error) {
        this.storageStatus.backupAvailable = false;
        if (error.code === 'ENOENT') return null;
        throw new Error('Backup inválido ou cofre indisponível. Arquivo preservado.');
      }
    });
  }

  async restoreBackup() {
    return this._queue(async () => {
      let backup;
      try { backup = await this._read(this.backupPath); }
      catch {
        this.storageStatus.backupAvailable = false;
        throw new Error('Backup inválido, ausente ou cofre indisponível. Arquivo preservado.');
      }
      this.storageStatus.backupAvailable = true;
      return this._save(backup.config, { recover: true });
    });
  }

  refreshBackup() {
    return this._queue(async () => {
      this.storageStatus.backupChecking = true;
      try { await this._refreshBackup(); }
      finally { this.storageStatus.backupChecking = false; }
    });
  }

  flush() { return Promise.allSettled([this.writeQueue, this.logQueue]); }

  appendLog(event) {
    const operation = this.logQueue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.logPath), { recursive: true, mode: 0o700 });
      try {
        if ((await fs.stat(this.logPath)).size >= 1024 * 1024) {
          await fs.rm(this.logPath + '.1', { force: true });
          await fs.rename(this.logPath, this.logPath + '.1');
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.appendFile(this.logPath, JSON.stringify(event) + '\n', { mode: 0o600 });
    });
    this.logQueue = operation;
    return operation;
  }
}

module.exports = { Storage, readConfigFile, exportConfigSafe };
