const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadWithRecovery } = require('../app/recovery.cjs');
const { defaultConfig, encodeConfig } = require('../app/config.cjs');

test('startup normal não abre diálogo; recuperação exige escolha explícita e pode sair sem escrever', async () => {
  const config = defaultConfig();
  assert.equal(await loadWithRecovery({ storage: { load: async () => config }, dialog: {} }), config);
  let writes = 0;
  const storage = { load: async () => { throw new Error('Configuração inválida.'); }, readBackup: async () => null, recover: async () => { writes++; } };
  const result = await loadWithRecovery({ storage, dialog: { showMessageBox: async options => { assert.equal(options.cancelId, 1); return { response: 1 }; } } });
  assert.equal(result, null);
  assert.equal(writes, 0);
});

test('startup restaura backup autorizado; erro de restauração mantém recuperação disponível', async () => {
  const config = defaultConfig();
  let attempts = 0, dialogs = 0;
  const storage = { load: async () => { throw new Error('Configuração inválida.'); }, readBackup: async () => config,
    restoreBackup: async () => { if (++attempts === 1) throw new Error('Falha de disco.'); return config; } };
  const restored = await loadWithRecovery({ storage, dialog: { showMessageBox: async options => {
    assert.equal(options.buttons[0], 'Restaurar último backup');
    if (++dialogs === 2) assert.match(options.detail, /Falha de disco/);
    return { response: 0 };
  } } });
  assert.equal(restored, config);
  assert.equal(attempts, 2);
});

test('startup com backup ilegível oferece importação validada sem reset silencioso', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'key-recover-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const imported = defaultConfig();
  imported.layers[0].name = 'Importada';
  const file = path.join(directory, 'portable.json');
  await fs.writeFile(file, encodeConfig(imported));
  let recovered;
  const storage = { load: async () => { throw new Error('Configuração inválida.'); }, readBackup: async () => { throw new Error('Backup inválido.'); }, recover: async config => { recovered = config; return config; } };
  const result = await loadWithRecovery({ storage, dialog: {
    showMessageBox: async options => { assert.deepEqual(options.buttons, ['Importar configuração', 'Sair']); return { response: 0 }; },
    showOpenDialog: async () => ({ canceled: false, filePaths: [file] })
  } });
  assert.equal(recovered.layers[0].name, 'Importada');
  assert.equal(result, recovered);
});
