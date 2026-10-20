const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { encodeConfig, decodeConfig, defaultConfig, MAX_CONFIG_FILE_BYTES } = require('./config.cjs');

async function readConfigFile(file, platform = process.platform) {
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
    return decodeConfig(Buffer.concat(chunks, total), platform);
  } finally { await handle.close(); }
}

class Storage {
  constructor(directory) {
    this.directory = directory;
    this.configPath = path.join(directory, 'config.json');
    this.logPath = path.join(directory, 'logs', 'activity.jsonl');
    this.logQueue = Promise.resolve();
  }

  async load() {
    try {
      return await readConfigFile(this.configPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Não foi possível ler ${this.configPath}. Arquivo preservado. ${error.message}`);
      const config = defaultConfig();
      await this.save(config);
      return config;
    }
  }

  async save(config) {
    const serialized = encodeConfig(config);
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, `.config-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, serialized, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.configPath);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return JSON.parse(serialized);
  }

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

module.exports = { Storage, readConfigFile };
