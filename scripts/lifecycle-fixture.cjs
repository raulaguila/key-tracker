// Test entry only; excluded from app.asar. No test flags exist in the product.
const { safeStorage } = require('electron');
const { setTimeout: delay } = require('node:timers/promises');
const context = global.lifecycleFixture = { pending: true, atomicPending: false, delayWrites: false };
safeStorage.isAsyncEncryptionAvailable = () => new Promise(resolve => {
  context.releaseVault = () => { context.pending = false; resolve(false); };
});
const protectionModule = require('../app/config-protection.cjs');
const createProtection = protectionModule.createConfigProtection;
protectionModule.createConfigProtection = options => createProtection({ ...options, timeoutMs: 30000 });
const engineModule = require('../app/engine.cjs');
const BaseEngine = engineModule.Engine;
engineModule.Engine = class extends BaseEngine { constructor(...args) { super(...args); context.engine = this; context.initialDesktop = this.desktop; } };
const storageModule = require('../app/storage.cjs');
const BaseStorage = storageModule.Storage;
storageModule.Storage = class extends BaseStorage {
  constructor(...args) { super(...args); context.storage = this; }
  async _atomic(...args) {
    if (context.delayWrites) { context.atomicPending = true; await delay(350); }
    try { return await super._atomic(...args); }
    finally { context.atomicPending = false; }
  }
  async appendLog(event) { if (event.kind === 'action') await delay(250); return super.appendLog(event); }
};
require('../app/main.cjs');
