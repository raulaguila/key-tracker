const { test } = require('node:test');
const assert = require('node:assert/strict');
const { executeAction } = require('../app/actions.cjs');
const { validateAction } = require('../app/config.cjs');
const { resultValue, resolveResultTemplates } = require('../app/sequence-data.cjs');
const context = { key: 'A', layer: 'Audit' };

test('captura limitada em muitos chunks cede event loop e remove listeners por leitura', async () => {
  let chunks = 0, yielded = false;
  const turn = new Promise(resolve => setImmediate(() => { yielded = true; resolve(); }));
  const response = new Response(new ReadableStream({ pull(controller) {
    if (chunks++ === 65536) controller.close();
    else controller.enqueue(new Uint8Array([120]));
  } }));
  let captured;
  await executeAction({ type: 'http', method: 'GET', url: 'https://example.test', headers: {}, query: {}, body: '', resultName: 'reply' }, context,
    { fetchImpl: async () => response, onResult: result => { captured = result; } });
  assert.equal(yielded, true, 'controle de cancelamento e UI devem obter turno antes do término');
  await turn;
  assert.equal(Buffer.byteLength(captured.body), 65536);
});

test('templates limitam amplificação e só acessam campos próprios sem protótipos', () => {
  const inherited = Object.create({ hidden: 'não acessar' });
  inherited.visible = 'x';
  const results = { reply: { body: 'x'.repeat(64000), json: inherited } };
  assert.equal(resultValue(results, 'steps.reply.json.hidden'), undefined);
  assert.equal(resultValue(results, 'steps.reply.json.visible'), 'x');
  assert.throws(() => resultValue(results, 'steps.reply.json.constructor'), /Referência/);
  assert.throws(() => resolveResultTemplates('{{steps.reply.body}}'.repeat(1000), results), /limite/);
  assert.equal(resolveResultTemplates('{{steps.reply.json.visible}}', results), 'x');
});

test('URL e headers derivados são revalidados antes do segundo efeito HTTP sem revelar dados', async () => {
  for (const payload of [{ target: 'file:///PRIVATE_RESPONSE' }, { target: 'https://user:PRIVATE_RESPONSE@example.test' }, { token: 'PRIVATE_RESPONSE\r\nX-Forged: yes' }]) {
    let calls = 0;
    const steps = [];
    const action = validateAction({ type: 'sequence', steps: [
      { type: 'http', method: 'GET', url: 'https://example.test/source', resultName: 'reply', headers: {}, query: {}, body: '' },
      { type: 'http', method: 'GET', url: payload.target ? '{{steps.reply.json.target}}' : 'https://example.test/next',
        headers: payload.token ? { 'X-Token': '{{steps.reply.json.token}}' } : {}, query: {}, body: '' }
    ] });
    await assert.rejects(executeAction(action, context, { onStep: step => steps.push(step), fetchImpl: async () => { calls++; return new Response(JSON.stringify(payload)); } }), /etapa 2/);
    assert.equal(calls, 1);
    assert.deepEqual(steps.map(step => step.status), ['success', 'error']);
    assert.doesNotMatch(JSON.stringify(steps), /PRIVATE_RESPONSE|user:|X-Forged/);
  }
});
