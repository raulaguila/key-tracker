const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { validResultName, parseResultPath, resultReferences } = require('./sequence-data.cjs');
const DEFAULT_PANEL_SHORTCUT = 'CommandOrControl+Shift+Space';
const NUMPAD_KEYS = ['NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal', 'NumpadEnter', 'NumpadEqual', 'NumpadComma', ...Array.from({ length: 10 }, (_, i) => 'Numpad' + i)];

const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_CONFIG_FILE_BYTES = 2 * 1024 * 1024;
const MODIFIERS = ['CommandOrControl', 'Control', 'Command', 'Alt', 'Shift', 'Super'];
const KEYS = new Set(['Space', 'Tab', 'Enter', 'Escape', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right', 'Plus', 'Equal', 'Minus', 'Comma', 'Period', 'Slash', 'Backslash', 'Semicolon', 'Quote', 'Backquote', 'BracketLeft', 'BracketRight', ...Array.from({length: 24}, (_, i) => `F${i + 1}`)]);
const ALIASES = { ctrl: 'Control', control: 'Control', cmd: 'Command', command: 'Command', commandorcontrol: 'CommandOrControl', cmdorctrl: 'CommandOrControl', alt: 'Alt', option: 'Alt', shift: 'Shift', super: 'Super', meta: 'Super', return: 'Enter', esc: 'Escape', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right', ' ': 'Space' };
const PUNCTUATION = { '=': 'Equal', '-': 'Minus', ',': 'Comma', '.': 'Period', '/': 'Slash', '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', '`': 'Backquote', '[': 'BracketLeft', ']': 'BracketRight' };
const ELECTRON_KEYS = { Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`', BracketLeft: '[', BracketRight: ']' };
const PHYSICAL_KEYS = new Set(['Space', 'Tab', 'Enter', 'Escape', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Equal', 'Minus', 'Comma', 'Period', 'Slash', 'Backslash', 'Semicolon', 'Quote', 'Backquote', 'BracketLeft', 'BracketRight', 'IntlBackslash', 'IntlRo', 'IntlYen', ...Array.from({ length: 26 }, (_, i) => 'Key' + String.fromCharCode(65 + i)), ...Array.from({ length: 10 }, (_, i) => 'Digit' + i), ...Array.from({ length: 24 }, (_, i) => 'F' + (i + 1))]);
for (const key of NUMPAD_KEYS) { KEYS.add(key); PHYSICAL_KEYS.add(key); ALIASES[key.toLowerCase().replace('numpad', 'num')] = key; }

function text(value, label, max = 200, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new Error(`${label} inválido (máximo ${max} caracteres).`);
  return value;
}

function normalizeShortcut(input) {
  text(input, 'Atalho', 100);
  const parts = input.split('+').map(p => {
    const trimmed = p.trim();
    return ALIASES[trimmed.toLowerCase()] || PUNCTUATION[trimmed] || [...KEYS].find(k => k.toLowerCase() === trimmed.toLowerCase()) || trimmed.toUpperCase();
  });
  const key = parts.pop();
  if (!KEYS.has(key) && !/^[A-Z0-9]$/.test(key)) throw new Error(`Tecla inválida: ${key || input}. Use uma letra, número, F1–F24 ou nome como Enter.`);
  if (parts.some(p => !MODIFIERS.includes(p)) || new Set(parts).size !== parts.length) throw new Error(`Modificadores inválidos no atalho ${input}.`);
  if (parts.includes('CommandOrControl') && (parts.includes('Control') || parts.includes('Command'))) throw new Error('Use CommandOrControl ou Control/Command no mesmo atalho.');
  return [...MODIFIERS.filter(m => parts.includes(m)), key].join('+');
}

function effectiveShortcut(input, platform = process.platform) {
  return normalizeShortcut(input).split('+').map(p => p === 'CommandOrControl' ? (platform === 'darwin' ? 'Command' : 'Control') : p).join('+');
}

function electronShortcut(input) {
  return normalizeShortcut(input).split('+').map(p => ELECTRON_KEYS[p] || p).join('+');
}

function shortcutPosition(shortcut, keyCode, platform = process.platform) {
  const parts = effectiveShortcut(shortcut, platform).split('+');
  const key = parts.pop();
  const modifiers = new Set(parts.map(value => value === 'Command' || value === 'Super' ? 'Meta' : value));
  if (key === 'Plus') modifiers.add('Shift');
  const code = keyCode || (/^[A-Z]$/.test(key) ? 'Key' + key : /^\d$/.test(key) ? 'Digit' + key : ['Up', 'Down', 'Left', 'Right'].includes(key) ? 'Arrow' + key : key === 'Plus' ? 'Equal' : key);
  return ['Control', 'Alt', 'Shift', 'Meta'].filter(value => modifiers.has(value)).join('+') + ':' + code;
}

function getPanelShortcut(config, platform = process.platform) {
  if (config.settings.panelShortcut !== undefined) return config.settings.panelShortcut;
  const effective = effectiveShortcut(DEFAULT_PANEL_SHORTCUT, platform);
  const position = shortcutPosition(DEFAULT_PANEL_SHORTCUT, undefined, platform);
  const controls = [config.settings.layerShortcut, config.settings.pauseShortcut, config.settings.momentaryShortcut].filter(Boolean);
  if (controls.some(key => shortcutPosition(key, undefined, platform) === position)) return '';
  if (config.layers.some(layer => layer.bindings.some(binding => effectiveShortcut(binding.key, platform) === effective || shortcutPosition(binding.key, binding.keyCode, platform) === position))) return '';
  return DEFAULT_PANEL_SHORTCUT;
}

function stringMap(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 50) throw new Error(`${label} deve ser um objeto com até 50 pares de texto.`);
  const result = {};
  for (const [k, v] of Object.entries(value)) result[text(k, label, 200)] = text(v, label, 4000, true);
  return result;
}

function optionalBoolean(value, label, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${label} deve ser verdadeiro ou falso.`);
  return value;
}

function applicationIdentity(value, platform = process.platform) {
  let identity = text(value, 'Aplicativo', 4000).trim();
  if (/[\x00-\x1f\x7f]/.test(identity)) throw new Error('Identificador de aplicativo inválido.');
  if (platform === 'win32' && /[/\\]/.test(identity)) identity = path.win32.normalize(identity).replace(/\\$/, '');
  else if (identity.includes('/')) identity = path.posix.normalize(identity).replace(/\/$/, '');
  return platform === 'linux' ? identity : identity.toLowerCase();
}

function validateOpenTarget(kind, target, platform = process.platform) {
  text(target, 'Destino', 4000);
  if (/[\x00-\x1f\x7f]/.test(target)) throw new Error('Destino contém caracteres inválidos.');
  if (kind === 'url') {
    let url;
    try { url = new URL(target); } catch { throw new Error('Informe um endereço HTTP ou HTTPS completo.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use HTTP/HTTPS sem credenciais embutidas no endereço.');
  } else if (['path', 'application'].includes(kind)) {
    if (!(platform === 'win32' ? path.win32 : path.posix).isAbsolute(target)) throw new Error('Escolha um caminho absoluto para o destino.');
  } else throw new Error('Tipo de destino inválido.');
  return target;
}

function validateActionBase(action, platform, nested) {
  if (!action || typeof action !== 'object') throw new Error('Configure uma ação.');
  switch (action.type) {
    case 'log': return { type: 'log', message: text(action.message, 'Mensagem', 16000) };
    case 'clipboard': return { type: 'clipboard', text: text(action.text, 'Texto para copiar', 64000) };
    case 'open': return { type: 'open', kind: action.kind, target: nested && resultReferences(action.target).length ? text(action.target, 'Destino', 4000) : validateOpenTarget(action.kind, action.target, platform) };
    case 'notification': return { type: 'notification', title: text(action.title, 'Título da notificação', 120), message: text(action.message ?? '', 'Mensagem da notificação', 4000, true) };
    case 'layer': return { type: 'layer', layerId: text(action.layerId, 'Camada de destino', 100) };
    case 'sequence': {
      if (nested) throw new Error('Sequências não podem conter outras sequências.');
      if (!Array.isArray(action.steps) || !action.steps.length || action.steps.length > 10) throw new Error('Configure entre 1 e 10 etapas na sequência.');
      if (action.stepDelayMs !== undefined && (!Number.isInteger(action.stepDelayMs) || action.stepDelayMs < 0 || action.stepDelayMs > 60000)) throw new Error('Delay entre etapas deve ser um inteiro entre 0 e 60000 ms.');
      const names = new Set();
      const steps = action.steps.map(step => {
        const normalized = validateAction(step, platform, true);
        if (normalized.type === 'log' && resultReferences(normalized.message).length) throw new Error('Resultados HTTP não podem ser gravados no histórico por uma ação de log. Use uma ação de arquivo.');
        const references = [...resultReferences(normalized), ...(normalized.condition ? [normalized.condition.path] : [])];
        for (const reference of references) if (!names.has(parseResultPath(reference)[1])) throw new Error('Use somente resultados de etapas HTTP anteriores.');
        if (normalized.resultName) {
          if (names.has(normalized.resultName)) throw new Error('Nomes de resultado devem ser únicos na sequência.');
          names.add(normalized.resultName);
        }
        return normalized;
      });
      return { type: 'sequence', ...(action.stepDelayMs === undefined ? {} : { stepDelayMs: action.stepDelayMs }), steps };
    }
    case 'file': {
      const filename = text(action.filename, 'Nome do arquivo', 200);
      if (/[<>:"/\\|?*\x00-\x1f]/.test(filename) || filename === '.' || filename === '..' || /[. ]$/.test(filename) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(filename)) throw new Error('Use apenas um nome de arquivo válido, sem caminhos ou caracteres reservados.');
      if (!['create', 'append'].includes(action.mode)) throw new Error('Modo de arquivo inválido.');
      return { type: 'file', directory: text(action.directory ?? '', 'Pasta', 4000, true), filename, content: text(action.content ?? '', 'Conteúdo', 64000, true), mode: action.mode };
    }
    case 'http': {
      const url = text(action.url, 'URL', 4000);
      let parsed;
      if (!(nested && resultReferences(url).length)) {
        try { parsed = new URL(url); } catch { throw new Error('Informe uma URL HTTP ou HTTPS completa.'); }
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Use HTTP/HTTPS sem credenciais embutidas na URL.');
      }
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(action.method)) throw new Error('Método HTTP inválido.');
      const headers = stringMap(action.headers ?? {}, 'Headers');
      try { new Headers(headers); } catch { throw new Error('Headers HTTP inválidos.'); }
      const body = text(action.body ?? '', 'Corpo HTTP', 64000, true);
      if (['GET', 'HEAD'].includes(action.method) && body) throw new Error('GET e HEAD não aceitam corpo. Use parâmetros de query.');
      return { type: 'http', method: action.method, url, headers, query: stringMap(action.query ?? {}, 'Query'), body };
    }
    default: throw new Error('Tipo de ação desconhecido.');
  }
}

function validateAction(action, platform = process.platform, nested = false) {
  const result = validateActionBase(action, platform, nested);
  if (result.type === 'open' && !['url', 'path', 'application'].includes(result.kind)) throw new Error('Tipo de destino inválido.');
  if (!nested) {
    if (result.type !== 'sequence' && resultReferences(result).length) throw new Error('Resultados anteriores só podem ser usados em sequências.');
    return result;
  }
  if (action.delayBeforeMs !== undefined) {
    if (!Number.isInteger(action.delayBeforeMs) || action.delayBeforeMs < 0 || action.delayBeforeMs > 60000) throw new Error('Delay da etapa deve ser um inteiro entre 0 e 60000 ms.');
    result.delayBeforeMs = action.delayBeforeMs;
  }
  if (action.resultName !== undefined) {
    if (action.type !== 'http' || !validResultName(action.resultName)) throw new Error('Nome de resultado HTTP inválido (até 32 caracteres).');
    result.resultName = action.resultName;
  }
  if (action.condition !== undefined) {
    const condition = action.condition;
    if (!condition || typeof condition !== 'object' || !['equals', 'notEquals', 'contains', 'exists'].includes(condition.operator)) throw new Error('Condição da etapa inválida.');
    parseResultPath(condition.path);
    result.condition = { path: condition.path, operator: condition.operator,
      ...(condition.value === undefined && condition.operator === 'exists' ? {} : { value: text(condition.value, 'Valor da condição', 4000, true) }) };
  }
  return result;
}

function validateConfig(value, platform = process.platform) {
  if (!value || Buffer.byteLength(JSON.stringify(value)) > MAX_CONFIG_FILE_BYTES) throw new Error('Configuração de entrada deve ter até 2 MiB.');
  if (value.version !== 1) throw new Error('Versão de configuração não suportada.');
  if (!Array.isArray(value.layers) || !value.layers.length || value.layers.length > 30) throw new Error('Cadastre entre 1 e 30 camadas.');
  const settings = value.settings || {};
  const hasMomentary = settings.momentaryShortcut !== undefined || settings.momentaryLayerId !== undefined;
  const result = {
    version: 1,
    settings: { layerShortcut: normalizeShortcut(settings.layerShortcut), pauseShortcut: normalizeShortcut(settings.pauseShortcut), cooldownMs: settings.cooldownMs,
      autoSwitchLayers: optionalBoolean(settings.autoSwitchLayers, 'Troca por aplicativo', false), closeToTray: optionalBoolean(settings.closeToTray, 'Minimizar na bandeja', false) },
    layers: []
  };
  if (hasMomentary) Object.assign(result.settings, { momentaryShortcut: normalizeShortcut(settings.momentaryShortcut), momentaryLayerId: text(settings.momentaryLayerId, 'Camada temporária', 100) });
  if (settings.panelShortcut !== undefined) result.settings.panelShortcut = settings.panelShortcut === '' ? '' : normalizeShortcut(settings.panelShortcut);
  if (settings.inputDeviceId !== undefined) {
    const deviceId = text(settings.inputDeviceId, 'Teclado', 160);
    if (/[\x00-\x1f\x7f]/.test(deviceId)) throw new Error('Identificador de teclado inválido.');
    result.settings.inputDeviceId = deviceId;
  }
  if (!Number.isInteger(settings.cooldownMs) || settings.cooldownMs < 100 || settings.cooldownMs > 10000) throw new Error('Intervalo entre ações deve ser de 100 a 10000 ms.');
  const reserved = [result.settings.layerShortcut, result.settings.pauseShortcut, result.settings.panelShortcut, ...(hasMomentary ? [result.settings.momentaryShortcut] : [])].filter(Boolean).map(k => effectiveShortcut(k, platform));
  if (new Set(reserved).size !== reserved.length) throw new Error('Os atalhos de camada, pausa, painel e temporária devem ser diferentes.');
  const ids = new Set();
  const associations = new Set();
  const id = value => { text(value, 'ID', 100); if (ids.has(value)) throw new Error('IDs duplicados na configuração.'); ids.add(value); return value; };
  for (const layer of value.layers) {
    if (!Array.isArray(layer.bindings) || layer.bindings.length > 100) throw new Error('Cada camada aceita até 100 ações.');
    const applications = layer.applications ?? [];
    if (!Array.isArray(applications) || applications.length > 30) throw new Error('Cada camada aceita até 30 aplicativos.');
    const normalizedApplications = applications.map(application => {
      const identity = applicationIdentity(application, platform);
      if (associations.has(identity)) throw new Error(`Aplicativo ${application} associado a mais de uma camada ou duplicado.`);
      associations.add(identity);
      return application.trim();
    });
    const keys = new Set();
    const physicalGroups = new Map();
    const groupCodes = new Map();
    const bindings = layer.bindings.map(binding => {
      const key = normalizeShortcut(binding.key);
      const effective = effectiveShortcut(key, platform);
      const trigger = binding.trigger ?? 'press';
      if (!['press', 'hold', 'release'].includes(trigger)) throw new Error('Momento da tecla inválido.');
      const combination = effective + ':' + trigger;
      if (keys.has(combination) || reserved.includes(effective)) throw new Error(`Atalho ${key} duplicado neste momento ou reservado na camada ${layer.name}.`);
      keys.add(combination);
      const keyCode = binding.keyCode;
      if (keyCode !== undefined && !PHYSICAL_KEYS.has(keyCode)) throw new Error('Posição física da tecla inválida. Capture uma tecla suportada.');
      if (trigger !== 'press' && !keyCode) throw new Error('Capture a tecla para configurar os momentos enquanto pressionada ou ao soltar.');
      if (keyCode) {
        if (groupCodes.has(effective) && groupCodes.get(effective) !== keyCode) throw new Error(`Os momentos do atalho ${key} devem usar a mesma posição física. Capture novamente a combinação.`);
        groupCodes.set(effective, keyCode);
        const nativeModifiers = new Set(effective.split('+').slice(0, -1).map(value => value === 'Command' || value === 'Super' ? 'Meta' : value));
        const physical = ['Control', 'Alt', 'Shift', 'Meta'].filter(value => nativeModifiers.has(value)).join('+') + ':' + keyCode;
        if (physicalGroups.has(physical) && physicalGroups.get(physical) !== effective) throw new Error('A mesma posição física e modificadores estão associados a combinações diferentes. Capture novamente a tecla.');
        physicalGroups.set(physical, effective);
      }
      const repeatMs = binding.repeatMs ?? 400;
      if (trigger === 'hold' && (!Number.isInteger(repeatMs) || repeatMs < 100 || repeatMs > 60000)) throw new Error('Intervalo de repetição deve ser de 100 a 60000 ms.');
      if (trigger === 'hold' && binding.holdDelayMs !== undefined && (!Number.isInteger(binding.holdDelayMs) || binding.holdDelayMs < 0 || binding.holdDelayMs > 60000)) throw new Error('Delay inicial deve ser de 0 a 60000 ms.');
      return { id: id(binding.id), key, name: text(binding.name, 'Nome da ação', 100), enabled: optionalBoolean(binding.enabled, 'Estado da ação', true),
        ...(trigger === 'press' ? {} : { trigger }), ...(keyCode ? { keyCode } : {}), ...(trigger === 'hold' ? { repeatMs, ...(binding.holdDelayMs === undefined ? {} : { holdDelayMs: binding.holdDelayMs }) } : {}), action: validateAction(binding.action, platform) };
    });
    result.layers.push({ id: id(layer.id), name: text(layer.name, 'Nome da camada', 80), description: text(layer.description ?? '', 'Descrição', 240, true), applications: normalizedApplications, bindings });
  }
  const layerIds = new Set(result.layers.map(layer => layer.id));
  if (hasMomentary && !layerIds.has(result.settings.momentaryLayerId)) throw new Error('A camada temporária não existe.');
  for (const layer of result.layers) for (const binding of layer.bindings) {
    const actions = binding.action.type === 'sequence' ? binding.action.steps : [binding.action];
    if (actions.some(action => action.type === 'layer' && !layerIds.has(action.layerId))) throw new Error(`A ação “${binding.name}” aponta para uma camada inexistente. Altere ou remova essa referência antes de remover a camada de destino.`);
  }
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_CONFIG_BYTES) throw new Error('Configuração normalizada deve ter até 256 KiB.');
  return result;
}

function encodeConfig(value, platform = process.platform) {
  // No indentation or trailing newline: the full encoded output uses the same cap.
  return JSON.stringify(validateConfig(value, platform));
}

function decodeConfig(source, platform = process.platform) {
  if (!(typeof source === 'string' || Buffer.isBuffer(source))) throw new Error('Conteúdo da configuração inválido.');
  if (Buffer.byteLength(source) > MAX_CONFIG_FILE_BYTES) throw new Error('Arquivo de configuração excede 2 MiB.');
  let parsed;
  try { parsed = JSON.parse(source.toString()); }
  catch { throw new Error('O arquivo não contém um JSON válido.'); }
  return validateConfig(parsed, platform);
}

function defaultConfig() {
  return {
    version: 1,
    settings: { layerShortcut: 'F8', pauseShortcut: 'CommandOrControl+Shift+F12', cooldownMs: 400, autoSwitchLayers: false, closeToTray: false },
    layers: [
      { id: randomUUID(), name: 'Camada 1', description: 'Texto e automações do dia a dia.', applications: [], bindings: [
        { id: randomUUID(), key: 'CommandOrControl+Alt+A', name: 'Copiar texto', enabled: true, action: { type: 'clipboard', text: 'Texto copiado pela tecla {{key}} na {{layer}}.' } }
      ] },
      { id: randomUUID(), name: 'Camada 2', description: 'Criação de arquivos em Documentos.', applications: [], bindings: [
        { id: randomUUID(), key: 'CommandOrControl+Alt+A', name: 'Criar uma nota', enabled: true, action: { type: 'file', directory: '', filename: 'nota-{{timestamp}}.txt', content: 'Criado pela tecla {{key}} na {{layer}}.\n', mode: 'create' } }
      ] }
    ]
  };
}

module.exports = { validateConfig, validateAction, validateOpenTarget, normalizeShortcut, effectiveShortcut, electronShortcut, applicationIdentity, defaultConfig, encodeConfig, decodeConfig, MAX_CONFIG_BYTES, MAX_CONFIG_FILE_BYTES, DEFAULT_PANEL_SHORTCUT, getPanelShortcut, shortcutPosition };
