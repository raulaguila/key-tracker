const { test } = require('node:test');
const assert = require('node:assert/strict');
const { waitForRendererCondition } = require('../scripts/renderer-readiness.cjs');

const navigation = () => Object.assign(new Error('Inspected target navigated or closed'), { code: -32000, method: 'Runtime.evaluate' });

test('readiness waits for the new renderer after a CDP context replacement without repeating an action', async () => {
  const reads = [];
  await waitForRendererCondition({ expression: 'Boolean(document.querySelector("[data-ready]"))', message: 'Renderer ready', pollMs: 1,
    evaluate: async expression => { reads.push(expression); if (reads.length === 1) throw navigation(); return reads.length >= 3; } });
  assert.equal(reads.length, 3);
  assert.ok(reads.every(expression => expression === 'return Boolean(document.querySelector("[data-ready]"))'));
});

test('readiness propagates app exceptions, disconnection and unrelated protocol errors immediately', async () => {
  for (const error of [
    new Error('Inspected target navigated or closed'),
    new Error('Electron disconnected during UI verification.'),
    Object.assign(new Error('Unknown CDP failure'), { code: -32000, method: 'Runtime.evaluate' }),
    Object.assign(new Error('Inspected target navigated or closed'), { code: -32000, method: 'Input.dispatchMouseEvent' })
  ]) {
    let calls = 0;
    await assert.rejects(waitForRendererCondition({ expression: 'true', message: 'Ready', evaluate: async () => { calls++; throw error; } }), value => value === error);
    assert.equal(calls, 1);
  }
});

test('a renderer stuck navigating still fails the bounded readiness deadline', async () => {
  const error = navigation();
  let calls = 0;
  await assert.rejects(waitForRendererCondition({ expression: 'false', message: 'Renderer never became ready', timeoutMs: 20, pollMs: 1,
    evaluate: async () => { calls++; throw error; } }), value => value.cause === error && value.message.includes('Renderer never became ready'));
  assert.ok(calls >= 2);
});

test('a false readiness condition reports the actual page at timeout', async () => {
  await assert.rejects(waitForRendererCondition({ expression: 'false', message: 'Missing control', timeoutMs: 20, pollMs: 1,
    evaluate: async expression => expression === 'return document.body.innerText' ? 'The page has an error' : false }), /Missing control\nThe page has an error/);
});
