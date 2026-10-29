const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
module.exports = async ({ cdp, evaluate, click, until, nativeState, nativeEvaluate, shot }) => {
  if ((await nativeState()).platform !== 'linux') return;
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dobra-install-ui-'));
  const filename=path.join(directory,'dobra-test.deb'); await fs.writeFile(filename,'!<arch>\n');
  const modulePath=JSON.stringify(path.resolve(__dirname,'../app/wayland-input.cjs'));
  const help='.linux-install-help:not([hidden])';
  const buttonText = (text,scope=help) => evaluate('const node=[...document.querySelector('+JSON.stringify(scope)+').querySelectorAll("button")].find(node=>node.textContent.trim()==='+JSON.stringify(text)+');if(!node)throw new Error("Missing installation button");node.click();');
  const escape=async()=>{await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});};
  const visibleHelp=()=>until('Boolean(document.querySelector('+JSON.stringify(help)+'))','Installation guidance visible');
  async function accessible(name) {const violations=await evaluate('await Promise.all(document.getAnimations().filter(item=>item.effect?.getTiming().iterations!==Infinity).map(item=>item.finished.catch(()=>{})));return (await axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa","wcag22aa"]}})).violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)}));');assert.deepEqual(violations,[],name);}
  await nativeEvaluate(`globalThis.__installPrototype=process.mainModule.require(${modulePath}).WaylandInput.prototype;
    globalThis.__installEnable=globalThis.__installPrototype.enable;
    globalThis.__installPrototype.enable=async function(){globalThis.__installBackend=this;if(globalThis.__installAllowed){this.connected=true;this.publish('idle');return this.state();}this.publish('not-installed');throw new Error('RAW_BACKEND_STACK dobra: remote');};
    globalThis.__installShell=process.mainModule.require('electron').shell;
    globalThis.__installExternal=globalThis.__installShell.openExternal;globalThis.__installPath=globalThis.__installShell.openPath;
    globalThis.__installShell.openExternal=async url=>{globalThis.__installURL=url;};
    globalThis.__installShell.openPath=async file=>{globalThis.__installFile=file;return globalThis.__installPathError||'';};
    globalThis.__installDialog=process.mainModule.require('electron').dialog.showOpenDialog;
    process.mainModule.require('electron').dialog.showOpenDialog=()=>new Promise(resolve=>globalThis.__installChoose=(cancel=false)=>resolve({canceled:cancel,filePaths:cancel?[]:[${JSON.stringify(filename)}]}));`);
  try {
    await cdp('Runtime.evaluate',{expression:await fs.readFile(require.resolve('axe-core/axe.min.js'),'utf8')});
    await evaluate('await window.dobra.setEnabled(false);await window.dobra.setTracking(false);'); await click('[data-view=settings]'); await click('#linux-input-toggle'); await visibleHelp();
    assert.doesNotMatch(await evaluate('return document.querySelector("#toast").textContent'),/RAW_BACKEND_STACK|Error invoking|dobra:/);
    assert.match(await evaluate('return document.querySelector('+JSON.stringify(help)+').textContent'),/Debian.*Ubuntu/);
    assert.match(await evaluate('return document.querySelector('+JSON.stringify(help)+').textContent'),/bem-sucedida da main.*build de teste/);
    await buttonText('Obter pacote .deb');
    assert.equal(await nativeEvaluate('globalThis.__installURL'),'https://github.com/raulaguila/key-tracker/actions/workflows/desktop.yml');
    await evaluate('await window.dobra.setTracking(true)'); assert.equal((await nativeState()).tracking.enabled,true);
    await buttonText('Abrir .deb baixado'); await until('document.querySelector('+JSON.stringify(help)+').querySelector("button").disabled','Installer picker prevents duplicate requests');
    assert.equal((await nativeState()).tracking.enabled,false,'Tracking pauses before the package picker');
    await nativeEvaluate('globalThis.__installChoose(true)'); await until('!document.querySelector('+JSON.stringify(help)+').querySelector("button").disabled','Cancellation returns controls');
    assert.equal(await evaluate('return [...document.querySelector('+JSON.stringify(help)+').querySelectorAll("[role=status]")].every(node=>node.hidden)'),true,'Cancellation does not claim installation');
    await buttonText('Abrir .deb baixado'); await nativeEvaluate('globalThis.__installChoose(false)');
    await until('document.querySelector('+JSON.stringify(help)+').textContent.includes("Instalador do sistema aberto")','System installer launch acknowledged');
    assert.equal(await nativeEvaluate('globalThis.__installFile'),filename); assert.equal((await nativeState()).linuxInput.status,'not-installed','Opening installer is not treated as installation');
    for(const status of ['version-mismatch','runtime-missing']) {await nativeEvaluate('globalThis.__installBackend.publish('+JSON.stringify(status)+')');await visibleHelp();}
    await nativeEvaluate('globalThis.__installBackend.publish("denied")'); await until('!document.querySelector('+JSON.stringify(help)+')','Authorization denial does not suggest reinstalling');
    await nativeEvaluate('globalThis.__installBackend.publish("not-installed")'); await visibleHelp();
    for(const theme of ['light','dark']) {await evaluate('window.dobraAppearance.set('+JSON.stringify(theme)+');');await accessible('Linux installation settings '+theme);await evaluate('document.querySelector('+JSON.stringify(help)+').scrollIntoView({block:"center"});');await shot('linux-install-settings-'+theme);}
    await evaluate('localStorage.setItem("dobra.setup-progress","0");[...document.querySelectorAll("button")].find(node=>node.textContent.trim()==="Verificar teclado").click();');
    await until('Boolean(document.querySelector(".setup-dialog '+help+'"))','Wizard offers the same installation guidance');
    await buttonText('Habilitar integração Linux','.setup-dialog');
    await until('!document.querySelector(".setup-dialog .form-errors").hidden','Wizard shows contextual component failure');
    assert.doesNotMatch(await evaluate('return document.querySelector(".setup-dialog .form-errors").textContent'),/RAW_BACKEND_STACK|Error invoking|dobra:/);
    await nativeEvaluate('globalThis.__installPathError="No application associated"');
    await buttonText('Abrir .deb baixado','.setup-dialog '+help); await nativeEvaluate('globalThis.__installChoose(false)');
    await until('document.querySelector(".setup-dialog .form-errors").textContent.includes("gerenciador de pacotes")','Missing installer association has an actionable message');
    for(const theme of ['light','dark']) {await evaluate('window.dobraAppearance.set('+JSON.stringify(theme)+');');await accessible('Linux installation wizard '+theme);await shot('linux-install-wizard-'+theme);}
    await nativeEvaluate('globalThis.__installAllowed=true'); await buttonText('Habilitar integração Linux','.setup-dialog');
    await until('(await window.dobra.getState()).linuxInput.status==="idle"&&!document.querySelector(".setup-dialog '+help+'")','Explicit retry clears installation guidance after authorization');
    assert.equal((await nativeState()).enabled,false); await escape();
    console.log('Linux installation UI passed: three component errors, fixed download URL, GitHub artifact guidance, Debian scope, real IPC/archive check with system launcher stub, picker busy/cancel, human errors, settings/wizard, themes/accessibility and explicit retry without enabling actions. No package installed on host.');
  } finally {
    await evaluate('document.querySelector(".setup-dialog")?.close();await window.dobra.setLinuxInputEnabled(false);window.dobraAppearance.set("light");localStorage.removeItem("dobra.setup-progress");');
    await nativeEvaluate('globalThis.__installPrototype.enable=globalThis.__installEnable;globalThis.__installShell.openExternal=globalThis.__installExternal;globalThis.__installShell.openPath=globalThis.__installPath;process.mainModule.require("electron").dialog.showOpenDialog=globalThis.__installDialog;for(const key of Object.keys(globalThis))if(key.startsWith("__install"))delete globalThis[key];');
    await fs.rm(directory,{recursive:true,force:true});await click('[data-view=layers]');
  }
};
