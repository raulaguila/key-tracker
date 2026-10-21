// Electron is injected so configuration persistence stays usable outside Electron.
// Never opt into Electron's basic_text fallback: it provides no OS key protection.
async function createConfigProtection({ safeStorage, platform = process.platform } = {}) {
  const secureBackend = () => platform !== 'linux' || ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage?.getSelectedStorageBackend?.());
  const unavailable = message => Object.freeze({ available: false, message });
  try {
    if (!safeStorage || typeof safeStorage.isAsyncEncryptionAvailable !== 'function' ||
        typeof safeStorage.encryptStringAsync !== 'function' || typeof safeStorage.decryptStringAsync !== 'function' ||
        !await safeStorage.isAsyncEncryptionAvailable() || !secureBackend()) {
      return unavailable('Criptografia segura indisponível. Configure o cofre de senhas do sistema para salvar headers HTTP.');
    }
  } catch {
    return unavailable('Não foi possível acessar o cofre de senhas do sistema. Headers HTTP não serão gravados.');
  }
  return Object.freeze({
    available: true,
    message: 'Headers HTTP protegidos pelo cofre de senhas do sistema.',
    async encrypt(text) {
      try {
        if (!secureBackend()) throw new Error();
        const encrypted = await safeStorage.encryptStringAsync(text);
        if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error();
        return encrypted;
      } catch { throw new Error('Não foi possível criptografar a configuração. Nenhum header foi gravado em texto aberto.'); }
    },
    async decrypt(buffer) {
      try {
        if (!secureBackend()) throw new Error();
        const result = await safeStorage.decryptStringAsync(buffer);
        if (typeof result?.result !== 'string') throw new Error();
        return result.result;
      } catch { throw new Error('Não foi possível descriptografar a configuração com o cofre deste sistema. Arquivo preservado.'); }
    }
  });
}

module.exports = { createConfigProtection };
