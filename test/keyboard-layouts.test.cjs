const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createKeyMapper } = require('../app/native-keycodes.cjs');
const data = import('../app/renderer/keyboard-layouts.mjs');

test('legendas distinguem posição física, layout e geometria manual', async () => {
  const { resolveKeyboardLayout: resolve, keyboardEventLabel: label } = await data;
  assert.equal(resolve({ layout: 'br' }).keys.Semicolon, 'Ç');
  assert.equal(resolve({ layout: 'br' }).geometry, 'abnt2');
  assert.equal(resolve({ layout: 'fr' }).keys.KeyQ, 'A');
  assert.equal(resolve({ layout: 'de' }).keys.KeyY, 'Z');
  assert.equal(resolve({ layout: 'pt' }).keys.Quote, 'º');
  const map = new Map([['KeyQ', 'a'], ['KeyA', 'q'], ['Semicolon', 'm']]);
  assert.equal(resolve({ layout: 'auto' }, map).geometry, 'iso');
  assert.equal(resolve({ layout: 'auto' }, map).keys.KeyQ, 'A');
  assert.equal(resolve({ layout: 'auto', geometry: 'ansi' }, map).geometry, 'ansi');
  assert.equal(resolve({ layout: 'br', geometry: 'ansi' }, map).keys.Semicolon, 'Ç');
  assert.equal(resolve({ layout: 'us' }, map).keys.KeyQ, 'Q', 'Manual choice overrides system legends');
  assert.equal(resolve({ layout: 'auto' }).name, 'US · referência provisória');
  assert.equal(label(resolve({ layout: 'fr' }), { code: 'KeyQ', key: 'Q', source: 'global' }), 'A');
  assert.equal(label(resolve({ layout: 'fr' }), { code: 'KeyQ', key: 'q', source: 'local' }), 'q');
  assert.equal(label(resolve({ layout: 'auto' }, new Map([['Space', ' ']])), { code: 'Space', key: 'Space', source: 'global' }), 'Espaço');
});

test('preferências inválidas usam padrões sem alterar dados de configuração', async () => {
  const { normalizeKeyboardPreference: normalize } = await data;
  for (const value of [null, {}, 'br', { layout: '__proto__', size: 'huge', geometry: 'unknown' }]) {
    assert.deepEqual(normalize(value), { layout: 'auto', size: 'full', geometry: 'auto' });
  }
  assert.deepEqual(normalize({ layout: 'br', size: 'tkl', geometry: 'iso' }), { layout: 'br', size: 'tkl', geometry: 'iso' });
});

test('leitura de layout trata ausência, bloqueio, mapa vazio e timeout', async () => {
  const { readSystemKeyboardMap: read } = await data;
  assert.equal(await read(undefined), null);
  assert.equal(await read({ getLayoutMap: () => { throw new Error('permission'); } }), null);
  assert.equal(await read({ getLayoutMap: async () => new Map() }), null);
  assert.equal(await read({ getLayoutMap: () => new Promise(() => {}) }, 5), null);
  const source = new Map([['Semicolon', 'ç']]);
  const result = await read({ getLayoutMap: async () => source });
  assert.deepEqual(result, source);
  assert.notEqual(result, source);
});

test('hook normaliza posições internacionais e numpad sem NumLock', () => {
  const map = createKeyMapper({ A: 30, 1: 2, Ctrl: 29, NumpadEnd: 61007 });
  assert.deepEqual(map(30), { code: 'KeyA', key: 'A' });
  assert.equal(map(2).code, 'Digit1');
  assert.equal(map(29).code, 'ControlLeft');
  assert.equal(map(61007).code, 'Numpad1');
  assert.equal(map(0x0E46).code, 'IntlBackslash');
  assert.equal(map(0x0073).code, 'IntlRo');
  assert.equal(map(0x0E5D).code, 'ContextMenu');
  assert.equal(map(0x0E45).code, 'Pause');
  assert.equal(map(-1), null);
});
