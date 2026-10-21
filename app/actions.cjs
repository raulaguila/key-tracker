const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay, setImmediate: yieldLoop } = require('node:timers/promises');
const { validateOpenTarget, validateAction } = require('./config.cjs');
const { assertSafeDestination } = require('./safe-export.cjs');
const { resultReferences, resolveResultTemplates, conditionMatches } = require('./sequence-data.cjs');

function variables(context, now = new Date()) {
  return { key: context.key, layer: context.layer, date: now.toISOString().slice(0, 10), timestamp: now.toISOString().replace(/[:.]/g, '-') };
}

function interpolate(value, vars) {
  return value.replace(/\{\{(key|layer|date|timestamp)\}\}/g, (_, key) => vars[key]);
}

// Preparation is pure: previews and execution share exactly the same expanded values.
function prepareActionBase(action, context, { documents, layers = [], platform = process.platform, literal = false } = {}, now = new Date()) {
  const vars = literal ? Object.fromEntries(['key', 'layer', 'date', 'timestamp'].map(key => [key, '{{' + key + '}}'])) : variables(context, now);
  switch (action.type) {
    case 'log': return { type: 'log', message: interpolate(action.message, vars) };
    case 'clipboard': return { type: 'clipboard', text: interpolate(action.text, vars) };
    case 'open': return { type: 'open', kind: action.kind, target: validateOpenTarget(action.kind, interpolate(action.target, vars), platform) };
    case 'notification': return { type: 'notification', title: interpolate(action.title, vars), message: interpolate(action.message, vars) };
    case 'layer': return { type: 'layer', layerId: action.layerId, layerName: layers.find(layer => layer.id === action.layerId)?.name ?? action.layerId };
    case 'sequence': return { type: 'sequence', stepDelayMs: action.stepDelayMs ?? 0, steps: action.steps.map(step => prepareAction(step, context, { documents, layers, platform }, now)) };
    case 'file': {
      const directory = action.directory || path.join(documents, 'Dobra');
      if (!path.isAbsolute(directory)) throw new Error('Escolha uma pasta absoluta para salvar o arquivo.');
      // Templates never turn layer names or shortcuts into paths on any OS.
      const safeVars = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')]));
      const filename = interpolate(action.filename, safeVars);
      if (Buffer.byteLength(filename) > 240) throw new Error('Nome de arquivo expandido muito longo.');
      return { type: 'file', directory, filename, target: path.join(directory, filename), content: interpolate(action.content, vars), mode: action.mode };
    }
    case 'http': {
      const url = new URL(validateOpenTarget('url', interpolate(action.url, vars), platform));
      const query = Object.fromEntries(Object.entries(action.query).map(([key, value]) => [key, interpolate(value, vars)]));
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      return { type: 'http', method: action.method, url: url.href, query,
        headers: Object.fromEntries(Object.entries(action.headers).map(([key, value]) => [key, interpolate(value, vars)])), body: interpolate(action.body, vars) };
    }
    default: throw new Error('Ação não suportada.');
  }
}

function mapStrings(value, transform) {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map(item => mapStrings(item, transform));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, transform)]));
  return value;
}

function prepareAction(action, context, options = {}, now = new Date()) {
  const { condition, ...content } = action;
  const paths = action.type === 'sequence' || options.literal ? [] : resultReferences(content);
  let prepared;
  if (paths.length) {
    const vars = variables(context, now);
    prepared = mapStrings(action, value => interpolate(value, vars));
    if (action.type === 'file') {
      const safe = Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')]));
      prepared.filename = interpolate(action.filename, safe);
      prepared.directory ||= path.join(options.documents, 'Dobra');
    }
    prepared.dynamic = true;
    prepared.dynamicPaths = paths;
  } else prepared = prepareActionBase(action, context, options, now);
  for (const key of ['delayBeforeMs', 'resultName', 'condition']) if (action[key] !== undefined) prepared[key] = mapStrings(action[key], value => options.literal ? value : interpolate(value, variables(context, now)));
  return prepared;
}

function resolvePreparedStep(prepared, results, context, options) {
  if (!prepared.dynamic) return prepared;
  const concrete = mapStrings(prepared, value => resolveResultTemplates(value, results));
  return { ...prepareAction(validateAction(concrete, options.platform, true), context, { ...options, literal: true }), resultDerived: true };
}

function previewAction(prepared) {
  const result = structuredClone(prepared);
  // Any custom header may contain a secret; retain names, never expose values.
  if (result.type === 'http') result.headers = Object.fromEntries(Object.keys(result.headers).map(key => [key, '••••••']));
  if (result.type === 'sequence') result.steps = prepared.steps.map(previewAction);
  return result;
}

function freezePreparedAction(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezePreparedAction);
    Object.freeze(value);
  }
  return value;
}

function actionErrorMessage(type, error, httpStatus) {
  if (type === 'http') {
    if (/^(A requisição excedeu o limite de 10 segundos\.|Não foi possível conectar ao destino HTTP\.|A resposta HTTP excedeu o limite de 64 KiB\.)$/.test(error.message)) return error.message;
    const status = Number.isInteger(error.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599 ? error.httpStatus : httpStatus;
    if (status >= 300) return `Destino respondeu HTTP ${status}${status < 400 ? '. Redirecionamentos não são seguidos' : ''}.`;
    return 'Não foi possível concluir a requisição HTTP.';
  }
  if (type === 'notification') return error.code === 'NOTIFICATION_UNSUPPORTED' ? 'As notificações não são suportadas neste sistema.'
    : error.code === 'NOTIFICATION_REJECTED' ? 'O sistema não confirmou a exibição da notificação.' : 'Não foi possível exibir a notificação.';
  if (type === 'clipboard') return 'Não foi possível copiar o texto.';
  if (type === 'open') return 'Não foi possível abrir o destino.';
  if (type === 'layer') return 'A camada de destino não está mais disponível.';
  if (['EACCES', 'EPERM'].includes(error.code)) return 'Sem permissão para acessar o arquivo.';
  if (error.message === 'Escolha um destino diferente dos arquivos internos do aplicativo.') return error.message;
  // Native I/O errors can include paths or user content; only known messages survive.
  if (/^(Arquivo já existe\.(?: Use \{\{timestamp\}\} no nome ou o modo acrescentar\.)?|O destino não pode ser um link simbólico\.|Escolha uma pasta absoluta para salvar o arquivo\.|Nome de arquivo expandido muito longo\.)$/.test(error.message)) return error.message;
  return type === 'log' ? 'Não foi possível salvar a mensagem no log.' : 'Não foi possível gravar o arquivo.';
}

function checkCancellation(signal) {
  if (signal?.aborted) throw Object.assign(new Error('Execução cancelada.'), { code: 'EXECUTION_CANCELLED' });
}

async function validateFileTargets(prepared, storage) {
  const files = (prepared.type === 'sequence' ? prepared.steps : [prepared]).filter(step => step.type === 'file' && !step.dynamic);
  if (!files.length || !storage?.protectedPaths) return;
  const protectedPaths = await storage.protectedPaths();
  for (const file of files) await assertSafeDestination(file.target, protectedPaths, storage.directory);
}

async function executeAction(action, context, options = {}) {
  const { documents, storage, fetchImpl = fetch, preparedAction, onHttpStatus, onResult, desktopActions = {}, setLayer, now = Date.now, onStep, onProgress, signal } = options;
  checkCancellation(signal);
  const prepared = preparedAction ?? prepareAction(action, context, options);
  switch (prepared.type) {
    case 'clipboard': {
      if (typeof desktopActions.clipboard !== 'function') throw new Error('Área de transferência indisponível.');
      await desktopActions.clipboard(prepared.text);
      return 'Texto copiado para a área de transferência.';
    }
    case 'open': {
      if (typeof desktopActions.open !== 'function') throw new Error('Abertura de destinos indisponível.');
      await desktopActions.open(prepared.kind, prepared.target);
      return prepared.kind === 'url' ? 'Endereço aberto no navegador.' : prepared.kind === 'application' ? 'Aplicativo aberto.' : 'Arquivo ou pasta aberto.';
    }
    case 'notification': {
      if (typeof desktopActions.notify !== 'function') throw Object.assign(new Error('Notificações indisponíveis.'), { code: 'NOTIFICATION_UNSUPPORTED' });
      await desktopActions.notify({ title: prepared.title, message: prepared.message });
      return 'Notificação exibida pelo sistema.';
    }
    case 'layer': {
      if (typeof setLayer !== 'function') throw new Error('Camada de destino indisponível.');
      await setLayer(prepared.layerId);
      return 'Camada selecionada.';
    }
    case 'sequence': {
      const results = Object.create(null);
      let lastCompleted = 0;
      for (let index = 0; index < prepared.steps.length; index++) {
        checkCancellation(signal);
        const step = prepared.steps[index];
        let matches;
        try { matches = conditionMatches(step.condition, results); }
        catch {
          onStep?.({ index: index + 1, type: step.type, status: 'error', message: 'Não foi possível avaliar a condição da etapa.', durationMs: 0 });
          throw new Error('Não foi possível avaliar a condição da etapa.');
        }
        if (!matches) {
          onStep?.({ index: index + 1, type: step.type, status: 'skipped', message: 'Etapa ignorada pela condição.', durationMs: 0 });
          continue;
        }
        if (lastCompleted && prepared.stepDelayMs > 0) {
          onProgress?.({ stepIndex: lastCompleted, stepCount: prepared.steps.length, phase: 'waiting' });
          await delay(prepared.stepDelayMs, undefined, { signal });
        }
        if (step.delayBeforeMs > 0) {
          onProgress?.({ stepIndex: index + 1, stepCount: prepared.steps.length, phase: 'waiting' });
          await delay(step.delayBeforeMs, undefined, { signal });
        }
        onProgress?.({ stepIndex: index + 1, stepCount: prepared.steps.length, phase: 'running' });
        checkCancellation(signal);
        const started = now();
        let httpStatus;
        const details = (status, message) => ({ index: index + 1, type: step.type, status, message, durationMs: Math.max(0, now() - started), ...(httpStatus === undefined ? {} : { httpStatus }) });
        try {
          const resolved = resolvePreparedStep(step, results, context, options);
          const message = await executeAction(action.steps[index], context, { ...options, preparedAction: resolved, onStep: undefined, onProgress: undefined,
            onResult: result => { if (step.resultName) results[step.resultName] = result; }, onHttpStatus: value => { if (Number.isInteger(value) && value >= 100 && value <= 599) httpStatus = value; } });
          onStep?.(details('success', message));
          lastCompleted = index + 1;
        } catch (error) {
          if (signal?.aborted) {
            onStep?.(details('cancelled', 'Execução cancelada.'));
            checkCancellation(signal);
          }
          if (Number.isInteger(error.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599) httpStatus = error.httpStatus;
          const message = actionErrorMessage(step.type, error, httpStatus);
          onStep?.(details('error', message));
          throw new Error(`Sequência interrompida na etapa ${index + 1} de ${prepared.steps.length}: ${message}`);
        }
        checkCancellation(signal);
      }
      return `Sequência concluída: ${prepared.steps.length} ${prepared.steps.length === 1 ? 'etapa' : 'etapas'}.`;
    }
    case 'log': {
      await storage.appendLog({ time: new Date().toISOString(), kind: 'message', layer: context.layer, key: context.key, message: prepared.message });
      return 'Mensagem salva no log.';
    }
    case 'file': {
      const { directory, target } = prepared;
      await validateFileTargets(prepared, storage);
      checkCancellation(signal);
      await fs.mkdir(directory, { recursive: true });
      checkCancellation(signal);
      try {
        if (prepared.mode === 'append') {
          // Refuse symbolic links: appending should affect the chosen file only.
          try { if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('O destino não pode ser um link simbólico.'); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        await fs.writeFile(target, prepared.content, { flag: prepared.mode === 'append' ? 'a' : 'wx', mode: 0o600 });
      } catch (error) {
        if (error.code === 'EEXIST') throw new Error('Arquivo já existe. Use {{timestamp}} no nome ou o modo acrescentar.');
        throw error;
      }
      return prepared.mode === 'append' ? 'Conteúdo acrescentado ao arquivo.' : 'Arquivo criado.';
    }
    case 'http': {
      const url = new URL(prepared.url);
      const timeout = AbortSignal.timeout(10000);
      const options = { method: prepared.method, headers: prepared.headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'manual' };
      if (prepared.body && !['GET', 'HEAD'].includes(prepared.method)) options.body = prepared.body;
      let response;
      let captured;
      try {
        response = await fetchImpl(url, options);
        onHttpStatus?.(response.status);
        if (prepared.resultName && response.ok) captured = await captureResponse(response, options.signal);
        else await response.body?.cancel();
      }
      catch (error) {
        checkCancellation(signal);
        if (error.code === 'HTTP_RESULT_TOO_LARGE') throw error;
        if (options.signal.aborted) throw new Error('A requisição excedeu o limite de 10 segundos.');
        throw new Error(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'A requisição excedeu o limite de 10 segundos.' : 'Não foi possível conectar ao destino HTTP.');
      }
      if (!response.ok) {
        const error = new Error(`Destino respondeu HTTP ${response.status}${response.status >= 300 && response.status < 400 ? '. Redirecionamentos não são seguidos' : ''}.`);
        error.httpStatus = response.status;
        throw error;
      }
      if (captured) onResult?.({ status: response.status, ...captured });
      return prepared.resultDerived ? `HTTP ${response.status}.` : `HTTP ${response.status} · ${url.hostname}`;
    }
    default: throw new Error('Ação não suportada.');
  }
}

async function captureResponse(response, signal) {
  if (!response.body) return { body: '', json: null };
  const reader = response.body.getReader();
  const bytes = Buffer.allocUnsafe(64 * 1024);
  let total = 0, chunksRead = 0;
  try {
    if (signal.aborted) throw new Error('A requisição excedeu o limite de 10 segundos.');
    while (true) {
      const { done, value } = await readChunk(reader, signal);
      if (done) break;
      total += value.byteLength;
      if (total > 64 * 1024) throw Object.assign(new Error('A resposta HTTP excedeu o limite de 64 KiB.'), { code: 'HTTP_RESULT_TOO_LARGE' });
      bytes.set(value, total - value.byteLength);
      if (++chunksRead % 256 === 0) await yieldLoop();
    }
    const body = bytes.subarray(0, total).toString('utf8');
    let json = null;
    try { json = JSON.parse(body); } catch { /* A body may be plain text. */ }
    return { body, json };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function readChunk(reader, signal) {
  if (signal.aborted) return Promise.reject(new Error('A requisição excedeu o limite de 10 segundos.'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('A requisição excedeu o limite de 10 segundos.'));
    signal.addEventListener('abort', abort, { once: true });
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

module.exports = { executeAction, prepareAction, previewAction, freezePreparedAction, actionErrorMessage, interpolate, validateFileTargets };
