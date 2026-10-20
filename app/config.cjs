const { randomUUID } = require('node:crypto');
const path = require('node:path');

const MAX_CONFIG_BYTES = 256 * 1024;
const MODIFIERS = ['CommandOrControl', 'Control', 'Command', 'Alt', 'Shift', 'Super'];
const KEYS = new Set(['Space', 'Tab', 'Enter', 'Escape', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right', 'Plus', 'Equal', 'Minus', 'Comma', 'Period', 'Slash', 'Backslash', 'Semicolon', 'Quote', 'Backquote', 'BracketLeft', 'BracketRight', ...Array.from({length: 24}, (_, i) => `F${i + 1}`)]);
const ALIASES = { ctrl: 'Control', control: 'Control', cmd: 'Command', command: 'Command', commandorcontrol: 'CommandOrControl', cmdorctrl: 'CommandOrControl', alt: 'Alt', option: 'Alt', shift: 'Shift', super: 'Super', meta: 'Super', return: 'Enter', esc: 'Escape', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right', ' ': 'Space' };
const PUNCTUATION = { '=': 'Equal', '-': 'Minus', ',': 'Comma', '.': 'Period', '/': 'Slash', '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', '`': 'Backquote', '[': 'BracketLeft', ']': 'BracketRight' };
const ELECTRON_KEYS = { Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`', BracketLeft: '[', BracketRight: ']' };

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

function validateAction(action) {
  if (!action || typeof action !== 'object') throw new Error('Configure uma ação.');
  switch (action.type) {
    case 'log': return { type: 'log', message: text(action.message, 'Mensagem', 16000) };
    case 'file': {
      const filename = text(action.filename, 'Nome do arquivo', 200);
      if (/[<>:"/\\|?*\x00-\x1f]/.test(filename) || filename === '.' || filename === '..' || /[. ]$/.test(filename) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(filename)) throw new Error('Use apenas um nome de arquivo válido, sem caminhos ou caracteres reservados.');
      if (!['create', 'append'].includes(action.mode)) throw new Error('Modo de arquivo inválido.');
      return { type: 'file', directory: text(action.directory ?? '', 'Pasta', 4000, true), filename, content: text(action.content ?? '', 'Conteúdo', 64000, true), mode: action.mode };
    }
    case 'http': {
      const url = text(action.url, 'URL', 4000);
      let parsed;
      try { parsed = new URL(url); } catch { throw new Error('Informe uma URL HTTP ou HTTPS completa.'); }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Use HTTP/HTTPS sem credenciais embutidas na URL.');
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

function validateConfig(value, platform = process.platform) {
  if (!value || Buffer.byteLength(JSON.stringify(value)) > MAX_CONFIG_BYTES) throw new Error('Configuração deve ter até 256 KB.');
  if (value.version !== 1) throw new Error('Versão de configuração não suportada.');
  if (!Array.isArray(value.layers) || !value.layers.length || value.layers.length > 30) throw new Error('Cadastre entre 1 e 30 camadas.');
  const settings = value.settings || {};
  const result = {
    version: 1,
    settings: { layerShortcut: normalizeShortcut(settings.layerShortcut), pauseShortcut: normalizeShortcut(settings.pauseShortcut), cooldownMs: settings.cooldownMs,
      autoSwitchLayers: optionalBoolean(settings.autoSwitchLayers, 'Troca por aplicativo', false), closeToTray: optionalBoolean(settings.closeToTray, 'Minimizar na bandeja', false) },
    layers: []
  };
  if (!Number.isInteger(settings.cooldownMs) || settings.cooldownMs < 100 || settings.cooldownMs > 10000) throw new Error('Intervalo entre ações deve ser de 100 a 10000 ms.');
  const reserved = [result.settings.layerShortcut, result.settings.pauseShortcut].map(k => effectiveShortcut(k, platform));
  if (reserved[0] === reserved[1]) throw new Error('Os atalhos de camada e pausa devem ser diferentes.');
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
    const bindings = layer.bindings.map(binding => {
      const key = normalizeShortcut(binding.key);
      const effective = effectiveShortcut(key, platform);
      if (keys.has(effective) || reserved.includes(effective)) throw new Error(`Atalho ${key} duplicado ou reservado na camada ${layer.name}.`);
      keys.add(effective);
      return { id: id(binding.id), key, name: text(binding.name, 'Nome da ação', 100), enabled: optionalBoolean(binding.enabled, 'Estado da ação', true), action: validateAction(binding.action) };
    });
    result.layers.push({ id: id(layer.id), name: text(layer.name, 'Nome da camada', 80), description: text(layer.description ?? '', 'Descrição', 240, true), applications: normalizedApplications, bindings });
  }
  return result;
}

function defaultConfig() {
  return {
    version: 1,
    settings: { layerShortcut: 'F8', pauseShortcut: 'CommandOrControl+Shift+F12', cooldownMs: 400, autoSwitchLayers: false, closeToTray: false },
    layers: [
      { id: randomUUID(), name: 'Camada 1', description: 'Mensagens e automações do dia a dia.', applications: [], bindings: [
        { id: randomUUID(), key: 'A', name: 'Registrar mensagem', enabled: true, action: { type: 'log', message: 'Tecla {{key}} pressionada na {{layer}} em {{timestamp}}.' } }
      ] },
      { id: randomUUID(), name: 'Camada 2', description: 'Criação de arquivos em Documentos.', applications: [], bindings: [
        { id: randomUUID(), key: 'A', name: 'Criar uma nota', enabled: true, action: { type: 'file', directory: '', filename: 'nota-{{timestamp}}.txt', content: 'Criado pela tecla {{key}} na {{layer}}.\n', mode: 'create' } }
      ] }
    ]
  };
}

module.exports = { validateConfig, validateAction, normalizeShortcut, effectiveShortcut, electronShortcut, applicationIdentity, defaultConfig, MAX_CONFIG_BYTES };
