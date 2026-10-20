// Runs inside ui-smoke's isolated Electron profile/display. Native effects stay
// within its clipboard and temporary directory; no external app or URL is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');

module.exports = async function productivityUI({ cdp, evaluate, click, fill, select, until, nativeState, save, shot, nativeEvaluate, data }) {
  const before = await nativeState();
  const clipboardExpression = 'process.mainModule.require("electron").clipboard';
  const clipboardBefore = await nativeEvaluate(clipboardExpression + '.readText()');
  const directory = path.join(data, 'productivity');
  await fs.mkdir(directory, { recursive: true });
  const launched = path.join(directory, 'application-started.txt');
  const executable = path.join(directory, 'test-application');
  await fs.writeFile(executable, '#!' + process.execPath + '\nrequire("node:fs").writeFileSync(' + JSON.stringify(launched) + ', "started");\n', { mode: 0o700 });
  let request;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    request = { body, authorization: req.headers.authorization };
    res.writeHead(503); res.end('temporary failure');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/sequence';
  const config = { ...structuredClone(before.config), layers: [
    { id: 'productivity-origin', name: 'Produtividade QA', description: '', applications: [], bindings: [] },
    { id: 'productivity-target', name: 'Destino QA', description: '', applications: [], bindings: [] }
  ] };
  const origin = config.layers[0].id;
  const target = config.layers[1].id;
  const bindingByName = async name => (await nativeState()).config.layers[0].bindings.find(item => item.name === name);
  async function create(name, key, type, values) {
    await click('[data-focus="new-binding"]');
    await fill('#field-name', name);
    await fill('#field-key', key);
    await select('#field-type', type);
    for (const [field, value] of Object.entries(values)) {
      const selector = '#field-' + field;
      const tag = await evaluate('return document.querySelector(' + JSON.stringify(selector) + ').tagName');
      await (tag === 'SELECT' ? select : fill)(selector, value);
    }
    await save();
    await until('!document.querySelector("#editor-drawer")', 'Saved ' + name);
    const binding = await bindingByName(name);
    assert.ok(binding, 'Configuration contains ' + name);
    return binding;
  }
  async function preview(binding) {
    await click('[data-focus="test-' + binding.id + '"]');
    await until('Boolean(document.querySelector("[data-focus=execute-preview]")) && !document.querySelector("[data-focus=execute-preview]").disabled', 'Ready preview ' + binding.name);
    await evaluate('await Promise.all(document.querySelector("#editor-drawer").getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));');
  }
  async function run(binding) {
    const oldIds = new Set((await nativeState()).events.map(event => event.id));
    await click('[data-focus="execute-preview"]');
    await until('!document.querySelector("[data-focus=execute-preview]").getAttribute("aria-busy") || document.querySelector("[data-focus=execute-preview]").getAttribute("aria-busy") === "false"', 'Finished test ' + binding.name);
    const event = (await nativeState()).events.find(item => !oldIds.has(item.id) && item.kind === 'action' && item.bindingId === binding.id);
    assert.ok(event, 'Execution produced a result for ' + binding.name);
    return event;
  }
  const close = () => click('[data-drawer-close]');
  async function reload(label) {
    await evaluate('window.__qaProductivityReload=true;');
    await cdp('Page.reload');
    await until('!window.__qaProductivityReload && Boolean(document.querySelector("[data-focus=new-binding]"))', label);
  }
  async function stepField(index, name, value) {
    const actual = await evaluate('const step=document.querySelectorAll("[data-sequence-step]")[' + index + '];const node=step.querySelector("[name$=\\"-' + name + '\\"]");return "#"+node.id;');
    const tag = await evaluate('return document.querySelector(' + JSON.stringify(actual) + ').tagName');
    await (tag === 'SELECT' ? select : fill)(actual, value);
  }
  try {
    await evaluate('await window.keyboardTracker.setEnabled(false);await window.keyboardTracker.saveConfig(' + JSON.stringify(config) + ');await window.keyboardTracker.setLayer(' + JSON.stringify(origin) + ');localStorage.setItem("keyboard-tracker.binding-view","table");');
    await reload('Productivity editor ready');

    const clipboard = await create('Copiar QA', 'B', 'clipboard', { text: 'Olá {{key}} / {{layer}} — área de transferência' });
    await preview(clipboard);
    assert.match(await evaluate('return document.querySelector(".preview-values").textContent'), /Olá B \/ Produtividade QA/);
    assert.equal(await nativeEvaluate(clipboardExpression + '.readText()'), clipboardBefore, 'Preview does not change clipboard');
    assert.equal((await run(clipboard)).status, 'success');
    assert.equal(await nativeEvaluate(clipboardExpression + '.readText()'), 'Olá B / Produtividade QA — área de transferência');
    await close();

    const open = await create('Abrir QA', 'C', 'open', { kind: 'url', target: 'https://example.com/painel' });
    await preview(open);
    assert.match(await evaluate('return document.querySelector(".preview-values").textContent'), /https:\/\/example.com\/painel/);
    await close(); // A preview must not open the browser.
    await click('[data-focus="edit-' + open.id + '"]');
    await select('#field-kind', 'application');
    await fill('#field-target', executable);
    await save();
    await until('!document.querySelector("#editor-drawer")', 'Application target saved');
    await preview(open);
    await assert.rejects(fs.access(launched));
    assert.equal((await run(open)).status, 'success');
    for (let i = 0; i < 100; i++) { try { await fs.access(launched); break; } catch { await new Promise(resolve => setTimeout(resolve, 20)); } }
    assert.equal(await fs.readFile(launched, 'utf8'), 'started', 'Native application service started only the disposable executable');
    await close();

    const notification = await create('Aviso QA', 'D', 'notification', { title: 'Aviso {{key}}', message: 'Mensagem de {{layer}}' });
    await preview(notification);
    assert.match(await evaluate('return document.querySelector(".preview-values").textContent'), /Aviso D/);
    assert.match(await evaluate('return document.querySelector(".preview-values").textContent'), /Mensagem de Produtividade QA/);
    await close(); // OS notification success/failure is proved at its native boundary by unit tests.

    const layer = await create('Mudar camada QA', 'E', 'layer', { layerId: target });
    await preview(layer);
    assert.equal((await nativeState()).activeLayerId, origin, 'Preview does not switch layers');
    assert.equal((await run(layer)).status, 'success');
    assert.equal((await nativeState()).activeLayerId, target);
    assert.equal((await nativeState()).enabled, false, 'Switching layer never activates the engine');
    await close();
    await evaluate('await window.keyboardTracker.setLayer(' + JSON.stringify(origin) + ');document.activeElement.blur();');
    await click('[data-view="settings"]'); await click('[data-view="layers"]');

    await click('[data-focus="new-binding"]');
    await fill('#field-name', 'Sequência QA'); await fill('#field-key', 'F'); await select('#field-type', 'sequence');
    await stepField(0, 'text', 'Primeira etapa {{key}}');
    await click('[data-step-add]');
    await stepField(1, 'type', 'file');
    await stepField(1, 'directory', directory); await stepField(1, 'filename', 'sequence.txt'); await stepField(1, 'content', '{{layer}} / {{key}}');
    await click('[data-step-add]'); await stepField(2, 'type', 'http');
    await stepField(2, 'url', endpoint);
    await stepField(2, 'method', 'POST');
    await stepField(2, 'body', 'body-secret-qa');
    // Parameter rows have accessible labels but no fixed UUIDs; drive their observed inputs.
    await evaluate('const step=document.querySelectorAll("[data-sequence-step]")[2];const map=[...step.querySelectorAll("[data-map]")].find(el=>el.dataset.map.endsWith("headers"));const inputs=map.querySelectorAll("input");inputs[0].value="Authorization";inputs[1].value="Bearer sequence-secret-qa";for(const input of inputs)input.dispatchEvent(new Event("input",{bubbles:true}));');
    await click('[data-step-add]'); await stepField(3, 'text', 'NÃO EXECUTAR');
    // Reordering and removing steps must preserve their live drafts.
    await click('[data-sequence-step]:last-of-type [data-step-up]');
    assert.equal(await evaluate('return document.querySelectorAll("[data-sequence-step]")[2].querySelector("[name$=\\"-text\\"]").value'), 'NÃO EXECUTAR');
    await click('[data-sequence-step]:nth-of-type(3) [data-step-down]');
    await click('[data-step-add]'); await click('[data-sequence-step]:last-of-type [data-step-remove]');
    await save(); await until('!document.querySelector("#editor-drawer")', 'Sequence saved');
    const sequence = await bindingByName('Sequência QA');
    assert.deepEqual(sequence.action.steps.map(step => step.type), ['clipboard', 'file', 'http', 'clipboard']);
    await preview(sequence);
    const previewText = await evaluate('return document.querySelector("#test-preview-content").textContent');
    assert.ok(!previewText.includes('sequence-secret-qa'), 'Nested HTTP header is masked in the preview');
    await assert.rejects(fs.access(path.join(directory, 'sequence.txt')));
    assert.equal(request, undefined, 'Sequence preview sends no request');
    await shot('productivity-sequence-preview');
    const result = await run(sequence);
    assert.equal(result.status, 'error');
    assert.deepEqual(result.steps.map(step => step.status), ['success', 'success', 'error']);
    assert.equal(result.steps[2].httpStatus, 503);
    assert.equal(await fs.readFile(path.join(directory, 'sequence.txt'), 'utf8'), 'Produtividade QA / F');
    assert.equal(await nativeEvaluate(clipboardExpression + '.readText()'), 'Primeira etapa F', 'First step runs; step after failure does not run');
    assert.deepEqual(request, { body: 'body-secret-qa', authorization: 'Bearer sequence-secret-qa' });
    const events = JSON.stringify((await nativeState()).events);
    assert.ok(!events.includes('sequence-secret-qa') && !events.includes('body-secret-qa'), 'History keeps nested HTTP secrets private');
    await shot('productivity-sequence-result'); await close();
    await click('[data-view="history"]');
    assert.ok(await evaluate('return Boolean([...document.querySelectorAll("#events details")].length)'), 'History provides execution details');
    assert.ok(await evaluate('return Boolean(document.querySelector("[data-focus=export-history]"))'), 'History offers native export');
    await shot('productivity-history');

    const persisted = (await nativeState()).config;
    assert.deepEqual(persisted.layers[0].bindings.map(item => item.action.type), ['clipboard', 'open', 'notification', 'layer', 'sequence']);
    await reload('Productivity reload');
    assert.deepEqual((await nativeState()).config, persisted, 'All new action types survive a real reload');
    await click('[data-focus="edit-' + sequence.id + '"]');
    assert.equal(await evaluate('return document.querySelectorAll("[data-sequence-step]").length'), 4, 'Saved sequence reopens as structured steps');
    await close();
  } finally {
    await nativeEvaluate(clipboardExpression + '.writeText(' + JSON.stringify(clipboardBefore) + ')').catch(() => {});
    await evaluate('await window.keyboardTracker.saveConfig(' + JSON.stringify(before.config) + ');await window.keyboardTracker.setLayer(' + JSON.stringify(before.activeLayerId) + ');').catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }
  console.log('Productivity UI passed: five action types, real clipboard/application launch, preview isolation, sequence ordering/drafts, partial failure, private history and persistence.');
};
