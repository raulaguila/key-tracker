// Run from any directory: node <path>/reproduce.cjs
// Uses only a profile created by mkdtemp; never loads an existing user profile.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const { Storage } = require(path.join(root, 'app/storage.cjs'));
const { Engine } = require(path.join(root, 'app/engine.cjs'));
const { defaultConfig } = require(path.join(root, 'app/config.cjs'));
const { createConfigProtection } = require(path.join(root, 'app/config-protection.cjs'));

async function run() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dobra-audit-integrity-'));
  let engine;
  let integrity;
  try {
    const storage = new Storage(directory);
    const config = defaultConfig();
    await storage.save(config);
    config.layers[0].bindings = [{ id: 'integrity', key: 'A', name: 'Synthetic integrity probe', action: {
      type: 'sequence', stepDelayMs: 0,
      steps: ['config.json', 'config.backup.json'].map(filename => ({
        type: 'file', directory, filename, mode: 'append', content: 'AUDIT_CORRUPTION_PROBE'
      }))
    } }];
    await storage.save(config);
    engine = new Engine({ config, storage, documents: directory, shortcuts: {
      register: () => true, unregister() {}, unregisterAll() {}
    } });
    await engine.runBinding(config.layers[0].id, 'integrity');
    const files = [];
    for (const filename of ['config.json', 'config.backup.json']) {
      let readable = true;
      try { JSON.parse(await fs.readFile(path.join(directory, filename), 'utf8')); }
      catch { readable = false; }
      files.push({ filename, readable });
    }
    let reloadAccepted = true, backupAccepted = true;
    try { await storage.load(); } catch { reloadAccepted = false; }
    try { await storage.readBackup(); } catch { backupAccepted = false; }
    integrity = { scope: 'Owned temporary profile only', actionReported: engine.events[0].status,
      files, reloadAccepted, backupAccepted };
  } finally {
    engine?.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
  const began = performance.now();
  const availability = await Promise.race([
    createConfigProtection({ platform: 'linux', safeStorage: {
      isAsyncEncryptionAvailable: () => new Promise(() => {}),
      encryptStringAsync: async () => Buffer.from('fixture'),
      decryptStringAsync: async () => ({ result: 'fixture' }),
      getSelectedStorageBackend: () => 'gnome_libsecret'
    } }).then(() => 'completed'),
    new Promise(resolve => setTimeout(() => resolve('still-pending'), 150))
  ]);
  console.log(JSON.stringify({ integrity, keyring: { probe: 'Unresponsive provider fixture',
    availability, observedMs: Math.round(performance.now() - began) } }, null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
