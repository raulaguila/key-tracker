const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {panelState,QuickPanel}=require('../app/quick-panel.cjs');
function fixture(t){
 const engine=new EventEmitter();Object.assign(engine,{platform:'darwin',enabled:false,input:{mode:'global',message:'OK'},activeLayer:{id:'x',name:'Camada',description:'private-description',bindings:[{id:'b',name:'Ação',key:'A',enabled:true,action:{type:'http',url:'https://private.test',headers:{Authorization:'secret'}}}]}});
 const handlers=new Map(),nativeTheme=new EventEmitter();nativeTheme.shouldUseDarkColors=false;
 class Window extends EventEmitter {
  constructor(options){super();this.options=options;this.visible=false;this.destroyed=false;this.webContents=new EventEmitter();this.webContents.mainFrame={url:''};this.sent=[];this.webContents.send=(...args)=>this.sent.push(args);this.webContents.setWindowOpenHandler=f=>this.openHandler=f;}
  loadFile(file){this.file=file;this.webContents.mainFrame.url=require('node:url').pathToFileURL(file).href;return Promise.resolve();}
  isDestroyed(){return this.destroyed;}isVisible(){return this.visible;}setMenu(){}show(){this.visible=true;}hide(){this.visible=false;}focus(){}destroy(){this.destroyed=true;this.emit('closed');}
 }
 let shown=0;const panel=new QuickPanel({engine,BrowserWindow:Window,nativeTheme,showMain:()=>shown++,ipcMain:{handle:(key,value)=>handlers.set(key,value),removeHandler:key=>handlers.delete(key)}});t.after(()=>panel.dispose());
 return {panel,engine,handlers,nativeTheme,shown:()=>shown};
}
test('projection contains only display names/shortcuts/status/theme, never action/config/description',()=>{
 const engine={platform:'darwin',enabled:true,input:{mode:'global',message:'OK'},activeLayer:{name:'Camada',description:'private',bindings:[{id:'x',name:'Ação',key:'A',action:{headers:{Secret:'private'}}}]}};
 const state=panelState(engine,'dark');assert.equal(JSON.stringify(state).includes('private'),false);assert.equal(state.bindings[0].key,'A');assert.equal(state.theme,'dark');assert.equal(state.platform,'darwin');
});
test('panel has isolated preload/origin, Escape hides; main bridge is never granted to panel',t=>{
 const {panel,handlers,shown}=fixture(t);panel.show();const window=panel.window;window.emit('ready-to-show');
 assert.equal(window.options.webPreferences.sandbox,true);assert.ok(window.options.webPreferences.preload.endsWith('quick-panel-preload.cjs'));
 const event={sender:window.webContents,senderFrame:window.webContents.mainFrame};
 assert.equal(handlers.get('dobra-panel:get-state')(event).layer.name,'Camada');
 assert.throws(()=>handlers.get('dobra-panel:get-state')({sender:{},senderFrame:event.senderFrame}),/Origem/);
 let prevented=false;window.webContents.emit('before-input-event',{preventDefault:()=>prevented=true},{type:'keyDown',key:'Escape'});assert.equal(prevented,true);assert.equal(window.visible,false);
 handlers.get('dobra-panel:show-main')(event);assert.equal(shown(),1);
});
test('theme follows OS or explicit override and disposing removes every handler/listener',t=>{
 const {panel,engine,handlers,nativeTheme}=fixture(t);panel.show();panel.window.emit('ready-to-show');panel.setTheme('dark');assert.equal(panel.state().theme,'dark');
 panel.setTheme('system');nativeTheme.shouldUseDarkColors=true;nativeTheme.emit('updated');assert.equal(panel.state().theme,'dark');
 assert.throws(()=>panel.setTheme('invalid'),/Tema/);panel.dispose();assert.equal(handlers.size,0);assert.equal(engine.listenerCount('quick-panel'),0);assert.equal(nativeTheme.listenerCount('updated'),0);
});

test('hide requested before panel readiness remains hidden after its document loads',t=>{
 const {panel}=fixture(t);panel.show();const window=panel.window;panel.hide();window.emit('ready-to-show');assert.equal(window.visible,false);
 panel.show();assert.equal(window.visible,true);
});

test('unchanged high-volume execution states do not reproject bindings or resend panel DOM data',t=>{
 const {panel,engine}=fixture(t);const bindings=engine.activeLayer.bindings;let projections=0;
 Object.defineProperty(engine.activeLayer,'bindings',{get:()=>{projections++;return bindings;}});
 panel.show();panel.window.emit('ready-to-show');const before=projections;const sent=panel.window.sent.length;
 for(let i=0;i<1000;i++)engine.emit('state');
 assert.equal(panel.window.sent.length,sent);assert.equal(projections,before);
 engine.editing=true;engine.emit('state');assert.equal(panel.window.sent.at(-1)[1].editing,true);assert.equal(panel.window.sent.length,sent+1);
});

test('panel snapshots/events have monotonic projection revisions for out-of-order bootstrap',t=>{
 const {panel,engine}=fixture(t);const initial=panel.state();const repeated=panel.state();assert.equal(initial.revision,repeated.revision);
 panel.setTheme('dark');const updated=panel.state();assert.equal(updated.revision,initial.revision+1);
 engine.stopping=true;const stopping=panel.state();assert.equal(stopping.revision,updated.revision+1);
 assert.equal(stopping.stopping,true);engine.configRevision=99;
 assert.equal(panel.state().revision,stopping.revision,'private config changes without projection changes do not advance revision');
});
