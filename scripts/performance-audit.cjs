// Reproducible Linux laboratory audit. Production files and user data stay untouched.
// xvfb-run -a node scripts/performance-audit.cjs [result.json]
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { validateConfig } = require('../app/config.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '..');
const destination = path.resolve(process.argv[2] || 'artifacts/audit/performance.json');

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return { n: values.length, median: percentile(.5), p95: percentile(.95), max: sorted.at(-1), mean: values.reduce((a,b) => a+b,0)/values.length };
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve,reject) => {socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let next = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data); const task = pending.get(result.id);
    if (!task) return;
    pending.delete(result.id); clearTimeout(task.timer);
    result.error ? task.reject(new Error(result.error.message)) : task.resolve(result.result);
  });
  socket.addEventListener('close', () => {for(const task of pending.values()){clearTimeout(task.timer);task.reject(new Error('CDP disconnected'));}pending.clear();});
  const call = (method, params={}) => new Promise((resolve,reject) => {
    const id=++next; const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},15000);
    pending.set(id,{resolve,reject,timer}); socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate',{expression:'(async()=>{'+expression+'})()',awaitPromise:true,returnByValue:true,userGesture:true});
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  return {call,evaluate,close:()=>socket.close()};
}

async function launch(base, index) {
  const directory = path.join(base,'profile-'+index); await fs.mkdir(directory);
  const port=await freePort(); let inspector; let output='';
  const started=performance.now();
  const child=spawn(path.join(root,'dist/linux-unpacked',require('../package.json').build.linux.executableName),['--inspect=127.0.0.1:0','--ozone-platform=x11','--disable-gpu','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{
    env:{...process.env,XDG_CONFIG_HOME:directory,XDG_SESSION_TYPE:'x11',WAYLAND_DISPLAY:''},stdio:['ignore','pipe','pipe']
  });
  let launchError;
  child.once('error', error => { launchError=error; });
  const stopChild=async()=>{
    if(child.exitCode!==null||child.signalCode!==null||!child.pid)return;
    child.kill();
    await new Promise(resolve=>{child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve();},2000).unref();});
  };
  child.stderr.on('data',chunk=>{const combined=output+chunk;inspector??=combined.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];output=combined.slice(-6000);});
  let page, native;
  try {
  for(let i=0;i<600;i++) {
    if(launchError)throw launchError;
    if(child.exitCode!==null)throw new Error('Package exited: '+output);
    try {const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();const target=tabs.find(t=>t.type==='page'&&t.url.includes('index.html'));if(target){page=await connect(target.webSocketDebuggerUrl);break;}}catch{}
    await delay(25);
  }
  if(!page)throw new Error('Renderer unavailable: '+output);
  let ready=false;
  for(let i=0;i<400;i++){if(await page.evaluate('return Boolean(document.querySelector("[data-focus=new-layer]"))')){ready=true;break;}await delay(10);}
  if(!ready)throw new Error('Initial interface did not become ready');
  const interfaceMs=performance.now()-started;
  if(!inspector)throw new Error('Native inspector unavailable: '+output);
  native=await connect(inspector);
  const state=await page.evaluate('return await window.dobra.getState()');
  const startupMs=performance.now()-started;
  if(!state.paths.data.startsWith(directory+path.sep))throw new Error('Refuse non-temporary profile');
  return {page,native,child,startupMs,interfaceMs,state,stop:async()=>{
    page.close();native.close();await stopChild();
  }};
  } catch(error) { page?.close();native?.close();await stopChild();throw error; }
}

const appMetrics = async native => native.evaluate('return process.mainModule.require("electron").app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,cpu:p.cpu.percentCPUUsage,cumulative:p.cpu.cumulativeCPUUsage,rssKiB:p.memory.workingSetSize}));');
async function steady(native, seconds=8) {
  await appMetrics(native); const samples=[];
  for(let i=0;i<seconds;i++){await delay(1000);samples.push(await appMetrics(native));}
  const processes=samples.at(-1);
  const memory=await Promise.all(processes.map(async p=>{
    try {const text=await fs.readFile('/proc/'+p.pid+'/smaps_rollup','utf8');return {pid:p.pid,pssKiB:Number(text.match(/^Pss:\s+(\d+)/m)?.[1]),privateKiB:Number(text.match(/^Private_Clean:\s+(\d+)/m)?.[1])+Number(text.match(/^Private_Dirty:\s+(\d+)/m)?.[1])};}catch{return null;}
  }));
  const valid=memory.every(p=>p&&Number.isFinite(p.pssKiB)&&Number.isFinite(p.privateKiB));
  return {seconds,cpuPercent:distribution(samples.map(sample=>sample.reduce((sum,p)=>sum+p.cpu,0))),summedRssMiB:distribution(samples.map(sample=>sample.reduce((sum,p)=>sum+p.rssKiB,0)/1024)),pssSnapshotMiB:valid?memory.reduce((sum,p)=>sum+p.pssKiB,0)/1024:null,privateSnapshotMiB:valid?memory.reduce((sum,p)=>sum+p.privateKiB,0)/1024:null,processes};
}

function fixture(layerCount, bindingsPerLayer) {
  const bases=[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',...Array.from({length:24},(_,i)=>'F'+(i+1))].filter(k=>k!=='F8');
  const keys=[...bases,...bases.map(k=>'Control+'+k)].slice(0,bindingsPerLayer);
  return validateConfig({version:1,settings:{layerShortcut:'F8',pauseShortcut:'CommandOrControl+Shift+F12',cooldownMs:400},layers:Array.from({length:layerCount},(_,i)=>({id:'L'+i,name:'Camada '+i,description:'',bindings:keys.map((key,j)=>({id:'B'+i+'-'+j,key,name:'Ação '+j,action:{type:'log',message:'x'}}))}))});
}

async function interactions(page) {
  return page.evaluate(`
    const stats=values=>{values.sort((a,b)=>a-b);return {n:values.length,median:values[Math.ceil(values.length*.5)-1],p95:values[Math.ceil(values.length*.95)-1],max:values.at(-1)}};
    const wait=()=>new Promise(r=>requestAnimationFrame(r));
    const searches=[];const nav=[];const drawers=[];
    for(let i=0;i<20;i++){
      const input=document.querySelector('#field-action-search');input.value=i%2?'':'Ação';const t=performance.now();input.dispatchEvent(new Event('input',{bubbles:true}));searches.push(performance.now()-t);await wait();
    }
    const search=document.querySelector('#field-action-search');search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));
    for(let i=0;i<12;i++){
      for(const view of ['history','settings','tracking','layers']){const t=performance.now();document.querySelector('[data-view='+view+']').click();nav.push(performance.now()-t);await wait();}
    }
    for(let i=0;i<12;i++){
      const t=performance.now();document.querySelector('[data-focus=new-binding]').click();drawers.push(performance.now()-t);await wait();document.querySelector('[data-drawer-close]').click();await wait();
    }
    return {searchSynchronousMs:stats(searches),navigationSynchronousMs:stats(nav),drawerOpenSynchronousMs:stats(drawers),domElements:document.querySelectorAll('*').length};
  `);
}

async function configurationIpc(page) {
  const measurements = await page.evaluate(`
    const editing=[];const saving=[];
    const config=(await window.dobra.getState()).config;
    for(let i=0;i<40;i++){const start=performance.now();await window.dobra.setEditing(i%2===0);editing.push(performance.now()-start);}
    for(let i=0;i<5;i++){const start=performance.now();await window.dobra.saveConfig(config);saving.push(performance.now()-start);}
    return {editing,saving};
  `);
  return {editingRoundTripMs:distribution(measurements.editing),saveRoundTripMs:distribution(measurements.saving)};
}

async function main() {
  if(process.platform!=='linux'||!process.env.DISPLAY)throw new Error('Use an isolated Xvfb display on Linux.');
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'keyboard-performance-'));
  const report={version:1,date:new Date().toISOString(),commit:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),environment:{cpu:os.cpus()[0].model,logicalCpus:os.availableParallelism(),ramGiB:os.totalmem()/2**30,node:process.version,electron:require('electron/package.json').version,platform:process.platform,release:os.release(),display:'Xvfb',gpu:'disabled',package:'linux-unpacked',notes:['Lab on a fast desktop; shared machine and OS file caches are not isolated.','CDP instrumentation has overhead. Synchronous DOM costs are not INP or physical-key latency.','Summed RSS includes shared pages; not unique physical memory.']},startups:[],interfaces:[],steady:{},interactions:{}};
  let instance;
  try {
    for(let i=0;i<5;i++) {instance=await launch(base,i);report.startups.push(instance.startupMs);report.interfaces.push(instance.interfaceMs);console.log('startup',i,Math.round(instance.startupMs));if(i<4){await instance.stop();instance=null;}}
    report.startupMs=distribution(report.startups);
    const {page,native}=instance;
    await page.call('Performance.enable');
    await page.evaluate('window.__auditLongTasks=[];new PerformanceObserver(list=>window.__auditLongTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:"longtask",buffered:true});');
    report.steady.defaultPaused=await steady(native);console.log('idle sampled');
    const standard=await page.evaluate('return (await window.dobra.getState()).config');
    report.interactions.default=await interactions(page);
    report.interactions.default.ipc=await configurationIpc(page);
    await page.evaluate('await window.dobra.setTracking(true);document.querySelector("[data-view=tracking]").click();');
    for(let i=0;i<100;i++){const mode=await page.evaluate('return (await window.dobra.getState()).tracking.mode');if(mode!=='starting'){report.trackingMode=mode;break;}await delay(50);}
    report.steady.tracking=await steady(native);
    await page.evaluate('window.__auditKeyLatency=[];window.__auditUnsubscribe=window.dobra.onKey(e=>{if(e.__auditAt)window.__auditKeyLatency.push(performance.timeOrigin+performance.now()-e.__auditAt)});');
    await native.evaluate('const contents=process.mainModule.require("electron").BrowserWindow.getAllWindows()[0].webContents;await new Promise(resolve=>{let i=0;const timer=setInterval(()=>{contents.send("dobra:key",{code:"KeyA",key:"A",direction:i%2?"up":"down",source:"global",__auditAt:performance.timeOrigin+performance.now()});if(++i===240){clearInterval(timer);resolve();}},8);});');
    await delay(100);
    report.keyIpcToDomMs=distribution(await page.evaluate('return window.__auditKeyLatency'));
    await page.evaluate('window.__auditUnsubscribe();await window.dobra.setTracking(false);');
    const auto=structuredClone(standard);auto.settings.autoSwitchLayers=true;
    await page.evaluate('await window.dobra.saveConfig('+JSON.stringify(auto)+');');
    await delay(1500);report.steady.applicationMonitor=await steady(native);
    report.applicationStatus=await page.evaluate('return (await window.dobra.getState()).application');
    await page.evaluate('await window.dobra.saveConfig('+JSON.stringify(standard)+');document.querySelector("[data-view=layers]").click();');
    const hundred=fixture(1,100);
    await page.evaluate('await window.dobra.saveConfig('+JSON.stringify(hundred)+');');await delay(200);
    report.interactions.hundredActions=await interactions(page);
    report.interactions.hundredActions.ipc=await configurationIpc(page);
    let largest;
    for(let n=1;n<=30;n++){try{const value=fixture(n,100);validateConfig(value);largest=value;}catch{break;}}
    await page.evaluate('await window.dobra.saveConfig('+JSON.stringify(largest)+');');await delay(200);
    report.largeConfig={layers:largest.layers.length,actions:largest.layers.reduce((n,l)=>n+l.bindings.length,0),compactBytes:Buffer.byteLength(JSON.stringify(largest)),persistedBytes:(await fs.stat(path.join(instance.state.paths.data, 'config.json'))).size};
    report.interactions.largeConfig=await interactions(page);
    report.interactions.largeConfig.ipc=await configurationIpc(page);
    report.steady.largeConfigPaused=await steady(native,5);
    await page.call('HeapProfiler.collectGarbage');await delay(100);
    report.beforeCycles={heap:await page.call('Runtime.getHeapUsage'),dom:await page.call('Memory.getDOMCounters')};
    for(let i=0;i<5;i++)await interactions(page);
    await delay(200);await page.call('HeapProfiler.collectGarbage');await delay(100);
    report.afterCycles={heap:await page.call('Runtime.getHeapUsage'),dom:await page.call('Memory.getDOMCounters')};
    report.longTasks=await page.evaluate('return window.__auditLongTasks');
    report.rendererPerformance=await page.call('Performance.getMetrics');
    await page.evaluate('await window.dobra.saveConfig('+JSON.stringify(standard)+');');
    await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,JSON.stringify(report,null,2)+'\n');
    console.log('Audit recorded:',destination);console.log(JSON.stringify({startup:report.startupMs,large:report.largeConfig,interactions:report.interactions,keyIpc:report.keyIpcToDomMs},null,2));
  } finally {await instance?.stop();await fs.rm(base,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
