const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');

// Test packages are currently published as Actions artifacts, not public releases.
const LINUX_DOWNLOAD_URL = 'https://github.com/raulaguila/key-tracker/actions/workflows/desktop.yml';
const ARCHIVE_MAGIC = Buffer.from('!<arch>\n');

function createLinuxInstall({ shell, dialog, getWindow, beforeInstaller = () => {}, platform = process.platform }) {
  const requireLinux = () => { if (platform !== 'linux') throw new Error('Instalação .deb disponível somente no Linux.'); };
  return {
    async openDownload() {
      requireLinux();
      try { await shell.openExternal(LINUX_DOWNLOAD_URL); }
      catch { throw new Error('Não foi possível abrir a página de download. Tente novamente.'); }
    },
    async openInstaller() {
      requireLinux();
      await beforeInstaller();
      const selected = await dialog.showOpenDialog(getWindow(), { title: 'Abrir pacote .deb do Dobra', properties: ['openFile'], filters: [{ name: 'Pacote Debian (.deb)', extensions: ['deb'] }] });
      if (selected.canceled || !selected.filePaths?.length) return { opened: false };
      const filename = selected.filePaths[0];
      if (path.extname(filename).toLowerCase() !== '.deb') throw new Error('Selecione o pacote .deb do Dobra que você baixou.');
      let file;
      try {
        file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = await file.stat();
        if (!stat.isFile() || stat.size < ARCHIVE_MAGIC.length) throw new Error('invalid');
        const magic = Buffer.alloc(ARCHIVE_MAGIC.length);
        const { bytesRead } = await file.read(magic, 0, magic.length, 0);
        if (bytesRead !== magic.length || !magic.equals(ARCHIVE_MAGIC)) throw new Error('invalid');
      } catch { throw new Error('O arquivo selecionado não é um pacote .deb válido ou não está acessível. Baixe novamente o pacote do Dobra.'); }
      finally { await file?.close(); }
      let error;
      try { error = await shell.openPath(filename); }
      catch { error = 'unavailable'; }
      if (error) throw new Error('Não foi possível abrir o instalador. Abra o .deb pelo gerenciador de arquivos ou instale-o pelo gerenciador de pacotes da sua distribuição.');
      return { opened: true };
    }
  };
}
module.exports = { createLinuxInstall, LINUX_DOWNLOAD_URL };
