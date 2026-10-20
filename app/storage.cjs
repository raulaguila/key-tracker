const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validateConfig, defaultConfig, MAX_CONFIG_BYTES } = require('./config.cjs');

class Storage {
  constructor(directory) {
    this.directory = directory;
    this.configPath = path.join(directory, 'config.json');
    this.logPath = path.join(directory, 'logs', 'activity.jsonl');
    this.logQueue = Promise.resolve();
  }

  async load() {
    try {
      if ((await fs.stat(this.configPath)).size > MAX_CONFIG_BYTES) throw new Error('Arquivo de configuração excede 256 KB.');
      return validateConfig(JSON.parse(await fs.readFile(this.configPath, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Não foi possível ler ${this.configPath}. Arquivo preservado. ${error.message}`);
      const config = defaultConfig();
      await this.save(config);
      return config;
    }
  }

  async save(config) {
    const valid = validateConfig(config);
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, `.config-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, JSON.stringify(valid, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.configPath);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return valid;
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

module.exports = { Storage };
