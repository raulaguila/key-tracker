const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConfigProtection } = require('../app/config-protection.cjs');

function native(backend = 'gnome_libsecret') {
  return {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => backend,
    encryptStringAsync: async text => Buffer.from('native:' + text),
    decryptStringAsync: async buffer => ({ result: buffer.toString().slice(7), shouldReEncrypt: false })
  };
}

test('safeStorage adapter uses asynchronous native API and unwraps decrypt result', async () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const protection = await createConfigProtection({ safeStorage: native(), platform });
    assert.equal(protection.available, true);
    assert.equal(await protection.decrypt(await protection.encrypt('config v1')), 'config v1');
  }
});

test('Linux basic_text/unknown, unavailable native service and initialization error refuse protection', async () => {
  for (const backend of ['basic_text', 'unknown', 'future_backend']) {
    assert.equal((await createConfigProtection({ safeStorage: native(backend), platform: 'linux' })).available, false);
  }
  assert.equal((await createConfigProtection()).available, false);
  assert.equal((await createConfigProtection({ safeStorage: { ...native(), isAsyncEncryptionAvailable: async () => false }, platform: 'win32' })).available, false);
  assert.equal((await createConfigProtection({ safeStorage: { ...native(), isAsyncEncryptionAvailable: async () => { throw new Error('private'); } }, platform: 'darwin' })).available, false);
});

test('backend downgrade and native errors never fall back to plaintext or disclose error contents', async () => {
  let backend = 'kwallet6';
  const service = { ...native(), getSelectedStorageBackend: () => backend };
  const protection = await createConfigProtection({ safeStorage: service, platform: 'linux' });
  backend = 'basic_text';
  await assert.rejects(protection.encrypt('private'), /criptografar/);
  await assert.rejects(protection.decrypt(Buffer.from('x')), /descriptografar/);
  backend = 'kwallet6';
  service.encryptStringAsync = async () => { throw new Error('private key path'); };
  await assert.rejects(protection.encrypt('private'), error => !error.message.includes('private'));
});
