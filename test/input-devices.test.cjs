const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {NativeInput,deviceId,hidCode,windowsCode}=require('../app/input-devices.cjs');
const {defaultConfig}=require('../app/config.cjs');
function fixture(t, platform='win32') {
  const children=[], events=[];let now=1000;
  const input=new NativeInput({platform,now:()=>now,spawnClient:(executable,args,options)=>{
    const child=new EventEmitter();Object.assign(child,{stdout:new PassThrough(),stdin:new PassThrough(),exitCode:null,executable,args,options});
    child.kill=()=>{queueMicrotask(()=>{child.exitCode=0;child.emit('exit');});return true;};
    child.frame=event=>child.stdout.write(JSON.stringify(event)+'\n');children.push(child);return child;
  }});
  input.on('key',event=>events.push(event)); t.after(()=>input.dispose());
  return {input,children,events,advance:ms=>now+=ms,connect(config=defaultConfig()) {
    input.update({config,observe:true});const child=children.at(-1);
    child.frame({type:'devices',devices:[{id:'real-device-a',name:'Keyboard A'},{id:'real-device-b',name:'Keyboard B'}]});
    child.frame({type:'ready',monotonicMs:1000});return child;
  }};
}
const key=(child,device,code,down,extra={})=>child.frame({type:'key',device,code,down,monotonicMs:1000,...extra});

test('physical HID and set-1 mapping preserves sides/international positions/numpad',()=>{
  assert.equal(hidCode(4),'KeyA');assert.equal(hidCode(224),'ControlLeft');assert.equal(hidCode(228),'ControlRight');
  assert.equal(hidCode(135),'IntlRo');assert.equal(hidCode(137),'IntlYen');assert.equal(hidCode(100),'IntlBackslash');
  assert.equal(hidCode(88),'NumpadEnter');assert.equal(hidCode(98),'Numpad0');assert.equal(hidCode(115),'F24');
  assert.equal(windowsCode(30,false,false),'KeyA');assert.equal(windowsCode(28,true,false),'NumpadEnter');
  assert.equal(windowsCode(29,true,false),'ControlRight');assert.equal(windowsCode(86,false,false),'IntlBackslash');
  assert.equal(windowsCode(0x76,false,false),'F24');assert.equal(hidCode(255),undefined);
});

test('no helper starts before explicit input demand; real identities are pseudonymous and stable',t=>{
  const {input,children,connect}=fixture(t);
  input.update({config:defaultConfig(),observe:false});assert.equal(children.length,0);
  connect();assert.equal(children.length,1);assert.deepEqual(children[0].args,[]);assert.equal(children[0].options.shell,undefined);
  assert.equal(input.deviceState().devices[0].id,deviceId('real-device-a','win32'));
  assert.equal(input.deviceState().devices[0].id.includes('real-device'),false);
  assert.ok(input.deviceState().devices.every(device=>device.id.length<=160));
});

test('selected keyboard never mixes events or modifiers from another keyboard',t=>{
  const {input,events,connect}=fixture(t);const config=defaultConfig();config.settings.inputDeviceId=deviceId('real-device-b','win32');const child=connect(config);
  key(child,'real-device-a',29,true);key(child,'real-device-a',30,true);
  key(child,'real-device-b',30,true);key(child,'real-device-b',30,false);
  assert.equal(events.length,2);assert.equal(events[0].ctrlKey,false);assert.equal(events[0].code,'KeyA');
  key(child,'real-device-b',29,true);key(child,'real-device-b',48,true);
  assert.equal(events.at(-1).ctrlKey,true);
});

test('all devices aggregate held keys and modifiers without duplicate/fictitious releases',t=>{
  const {events,connect}=fixture(t);const child=connect();
  key(child,'real-device-a',29,true);key(child,'real-device-b',29,true);key(child,'real-device-a',29,false);
  key(child,'real-device-b',30,true);key(child,'real-device-b',30,true);key(child,'real-device-b',29,false);
  assert.deepEqual(events.map(event=>[event.code,event.direction,event.ctrlKey]),[['ControlLeft','down',true],['KeyA','down',true],['ControlLeft','up',false]]);
});

test('selection change and unplug interrupt/reset, missing device does not fall back to others',t=>{
  const {input,events,connect}=fixture(t);const child=connect();let interrupted=0;input.on('interrupted',()=>interrupted++);
  const config=defaultConfig();config.settings.inputDeviceId=deviceId('real-device-b','win32');input.update({config,observe:true});
  assert.equal(interrupted,1);child.frame({type:'devices',devices:[{id:'real-device-a',name:'Keyboard A'}]});
  assert.equal(interrupted,2);assert.equal(input.deviceState().status,'missing');key(child,'real-device-a',30,true);assert.equal(events.length,0);
  child.frame({type:'devices',devices:[{id:'real-device-a',name:'Keyboard A'},{id:'real-device-b',name:'Keyboard B'}]});
  assert.equal(interrupted,3,'reconnection does not manufacture a new down or resume action state');
});

test('stale messages and worker crash fail closed without automatic restart',t=>{
  const {input,children,events,connect,advance}=fixture(t);const child=connect();advance(1200);key(child,'real-device-a',30,true);
  assert.equal(input.state().status,'unavailable');assert.equal(events.length,0);
  input.update({config:defaultConfig(),observe:true});assert.equal(children.length,1);
  input.retry();assert.equal(children.length,2);
  children[1].emit('error',new Error('fixture'));assert.equal(input.state().status,'unavailable');assert.equal(children.length,2);
});

test('keys held before listener start are suppressed until release, including typematic',t=>{
 for(const platform of ['win32','darwin']){
  const {events,connect}=fixture(t,platform);const child=connect();
  child.frame({type:'baseline',...(platform==='darwin'?{device:'real-device-a'}:{}),keys:[{code:platform==='win32'?30:4}]});
  for(let i=0;i<4;i++)key(child,'real-device-a',platform==='win32'?30:4,true);
  key(child,'real-device-a',platform==='win32'?30:4,false);
  assert.equal(events.length,0,'initial held state is never emitted as a gesture');
  key(child,'real-device-a',platform==='win32'?30:4,true);assert.equal(events.length,1);
 }
});

test('changing selection blocks a key already observed down on the newly selected keyboard',t=>{
 const {input,events,connect}=fixture(t);const config=defaultConfig();config.settings.inputDeviceId=deviceId('real-device-a','win32');const child=connect(config);
 key(child,'real-device-b',30,true);assert.equal(events.length,0);
 const next=structuredClone(config);next.settings.inputDeviceId=deviceId('real-device-b','win32');input.update({config:next,observe:true});
 key(child,'real-device-b',30,true);key(child,'real-device-b',30,false);assert.equal(events.length,0);
 key(child,'real-device-b',30,true);assert.equal(events.length,1);
});

test('Tracker integrates native selection, pauses on loss and keeps panel observer after visual off',async t=>{
 const {Engine}=require('../app/engine.cjs');const {Tracker}=require('../app/tracking.cjs');
 const {input,children,events}=fixture(t);const config=defaultConfig();config.layers[0].bindings[0].keyCode='KeyA';
 const calls=[];const engine=new Engine({config,platform:'win32',session:'native',documents:'C:\\Documents',storage:{directory:'/tmp/data',logPath:'/tmp/log',save:async value=>value,appendLog:async()=>{}},execute:async()=>{calls.push('run');return 'OK';}});
 const tracker=new Tracker({engine,nativeInput:input,fork:()=>{throw new Error('RawInput has its own native process');}});t.after(async()=>{await tracker.dispose();engine.dispose();});
 tracker.set(true);assert.equal(engine.panelArmed,true);assert.equal(engine.enabled,false);assert.equal(children.length,1);
 const child=children[0];child.frame({type:'devices',devices:[{id:'real-device-a',name:'Keyboard A'}]});child.frame({type:'ready',monotonicMs:1000});
 assert.equal(engine.input.mode,'global');tracker.set(false);assert.equal(engine.input.mode,'global');assert.equal(children.length,1);
 engine.setEnabled(true);key(child,'real-device-a',30,true);key(child,'real-device-a',30,false);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);
 child.frame({type:'devices',devices:[]});assert.equal(engine.enabled,false);assert.equal(engine.inputDevices.status,'waiting');
 assert.equal(events.length,2);
});

test('UTF-8 device identity/name survive a multibyte character split across native pipe buffers',t=>{
 const {input,connect}=fixture(t);const child=connect();
 const rawId='teclado-ação-日本';const name='Teclado 日本 — ação';
 const frame=Buffer.from(JSON.stringify({type:'devices',devices:[{id:rawId,name}]})+'\n');
 const split=frame.indexOf(Buffer.from('ç'))+1;
 child.stdout.write(frame.subarray(0,split));child.stdout.write(frame.subarray(split));
 assert.deepEqual(input.deviceState().devices,[{id:deviceId(rawId,'win32'),name}]);
 assert.equal(input.state().status,'global');
});
