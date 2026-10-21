const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLinuxInstall, LINUX_DOWNLOAD_URL } = require('../app/linux-install.cjs');

test('download abre apenas origem fixa e somente no Linux', async () => {
  const opened = [];
  const make = platform => createLinuxInstall({ platform, shell: { openExternal: async url => opened.push(url) } });
  await make('linux').openDownload();
  assert.deepEqual(opened, [LINUX_DOWNLOAD_URL]);
  for (const platform of ['win32', 'darwin']) await assert.rejects(make(platform).openDownload(), /somente no Linux/);
});

test('instalador usa seleção nativa, trata cancelamento e não executa instalação', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dobra-deb-dialog-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'Dobra-teste.deb');
  await fs.writeFile(filename, '!<arch>\nfixture: not a real installer');
  let selected = { canceled: true, filePaths: [] }; const opened = []; let paused = false;
  const install = createLinuxInstall({ platform: 'linux', getWindow: () => 'owned-window',
    beforeInstaller: async () => { paused = true; },
    dialog: { showOpenDialog: async (window, options) => { assert.equal(paused, true); assert.equal(window, 'owned-window'); assert.deepEqual(options.filters[0].extensions, ['deb']); return selected; } },
    shell: { openPath: async target => { opened.push(target); return ''; } }
  });
  assert.deepEqual(await install.openInstaller(), { opened: false }); assert.deepEqual(opened, []);
  selected = { canceled: false, filePaths: [filename] };
  assert.deepEqual(await install.openInstaller(), { opened: true }); assert.deepEqual(opened, [filename]);
  await fs.writeFile(filename, 'not a Debian archive');
  await assert.rejects(install.openInstaller(), /não é um pacote/); assert.equal(opened.length, 1);
  selected.filePaths = [path.join(directory, 'absent.deb')];
  await assert.rejects(install.openInstaller(), /não é um pacote/);
  selected.filePaths = [path.join(directory, 'program.desktop')];
  await assert.rejects(install.openInstaller(), /Selecione o pacote/);
});

test('erro de associação do sistema é explicado sem vazar erro nativo', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dobra-deb-error-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'Dobra.deb'); await fs.writeFile(filename, '!<arch>\nfixture');
  const install = createLinuxInstall({ platform: 'linux', getWindow: () => null,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [filename] }) }, shell: { openPath: async () => 'private-native-error' } });
  await assert.rejects(install.openInstaller(), error => /gerenciador de pacotes/.test(error.message) && !error.message.includes('private-native-error'));
});
