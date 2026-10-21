const assert = require('node:assert/strict');
module.exports = async ({ evaluate, click, until, nativeState, nativeEvaluate, shot }) => {
  const before = await nativeState();
  if (!before.linuxInput?.supported) return;
  const modulePath = JSON.stringify(require('node:path').resolve(__dirname, '../app/wayland-input.cjs'));
  // Only this owned test process gets a simulated permission dialog. The real
  // daemon/Polkit/FD protocol is exercised separately on a private D-Bus.
  await nativeEvaluate(`
    globalThis.__waylandPrototype=process.mainModule.require(${modulePath}).WaylandInput.prototype;
    globalThis.__waylandOriginal=globalThis.__waylandPrototype.enable;
    globalThis.__waylandPrototype.enable=async function(){
      globalThis.__waylandBackend=this;
      this.publish('authorizing');
      const allowed=await new Promise(resolve=>globalThis.__waylandAnswer=resolve);
      if(!allowed){this.publish('denied');throw new Error('Autorização cancelada ou negada.');}
      this.connected=true;this.publish('idle');return this.state();
    };
  `);
  try {
    await click('[data-view="settings"]');
    await until('Boolean(document.querySelector("#linux-input-toggle"))', 'Wayland setup visible');
    assert.match(await evaluate('return document.querySelector("#linux-input-status").textContent'), /desabilitada/);
    await click('#linux-input-toggle');
    await until('document.querySelector("#linux-input-toggle").disabled', 'Permission progress prevents duplicate requests');
    await nativeEvaluate('globalThis.__waylandAnswer(false)');
    await until('document.querySelector("#linux-input-status").dataset.status==="denied" && !document.querySelector("#linux-input-toggle").disabled', 'Permission denial stays actionable');
    assert.doesNotMatch(await evaluate('return document.querySelector("#toast").textContent'), /Error invoking|dobra:/);
    assert.equal(await evaluate('return document.querySelector("#linux-input-toggle").disabled'), false);
    await evaluate('document.querySelector("#linux-input-toggle").scrollIntoView({block:"center"});');
    await shot('wayland-permission-denied');
    await click('#linux-input-toggle');
    await until('document.querySelector("#linux-input-toggle").disabled', 'Explicit retry requests permission');
    await nativeEvaluate('globalThis.__waylandAnswer(true)');
    await until('document.querySelector("#linux-input-status").dataset.status==="idle" && !document.querySelector("#linux-input-toggle").disabled', 'Authorization does not activate actions');
    assert.equal(await evaluate('return document.querySelector("#toast").hidden'), true);
    assert.equal((await nativeState()).enabled, false);
    assert.match(await evaluate('return document.querySelector("#linux-input-toggle").textContent'), /Desabilitar/);
    for (const theme of ['light','dark']) {
      await evaluate('window.dobraAppearance.set('+JSON.stringify(theme)+');');
      await evaluate('await new Promise(resolve=>setTimeout(resolve,200));');
      await shot('wayland-authorized-'+theme);
    }
    await click('[data-view="layers"]');
    await evaluate('document.activeElement.blur();await window.dobra.setEnabled(true);');
    await nativeEvaluate("globalThis.__waylandBackend.publish('global')");
    await until('document.querySelector(".engine-status").dataset.status==="active"', 'Authorized Wayland backend activates real engine state');
    await click('[data-view="tracking"]');
    await evaluate('await window.dobra.setTracking(true);');
    await nativeEvaluate("globalThis.__waylandBackend.emit('reset',['KeyA'])");
    await until('Boolean(document.querySelector(".keycap[data-code=KeyA].pressed"))', 'Held-key snapshot renders without replaying keydown');
    await nativeEvaluate("globalThis.__waylandBackend.emit('key',{code:'KeyA',key:'A',direction:'up',ctrlKey:false,altKey:false,shiftKey:false,metaKey:false,source:'global'})");
    await until('!document.querySelector(".keycap[data-code=KeyA].pressed")', 'Native release clears snapshot');
    await nativeEvaluate("globalThis.__waylandBackend.fail('session-suspended')");
    await until('!(await window.dobra.getState()).enabled', 'Losing the session pauses actions');
    assert.equal((await nativeState()).linuxInput.status, 'session-suspended');
    await evaluate('await window.dobra.setTracking(false);');
    await click('[data-view="settings"]');
    assert.match(await evaluate('return document.querySelector("#linux-input-status").textContent'), /bloquear|suspender|sessão/);
    await evaluate('await window.dobra.setLinuxInputEnabled(false);');
    await until('document.querySelector("#linux-input-status").dataset.status==="disabled"', 'Integration can be disabled');
    console.log('Wayland UI passed: explicit authorization, pending/denied/retry/idle states, themes, engine activation, held-key snapshot, session loss pauses and revocation. Permission dialog simulated in test process.');
  } finally {
    await nativeEvaluate('globalThis.__waylandPrototype.enable=globalThis.__waylandOriginal;delete globalThis.__waylandPrototype;delete globalThis.__waylandOriginal;delete globalThis.__waylandAnswer;delete globalThis.__waylandBackend;');
    await evaluate('await window.dobra.setEnabled(false);window.dobraAppearance.set("light");');
    await click('[data-view="layers"]');
  }
};
