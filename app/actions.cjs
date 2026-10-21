const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { validateOpenTarget } = require('./config.cjs');
const { assertSafeDestination } = require('./safe-export.cjs');

function variables(context, now = new Date()) {
  return { key: context.key, layer: context.layer, date: now.toISOString().slice(0, 10), timestamp: now.toISOString().replace(/[:.]/g, '-') };
}

function interpolate(value, vars) {
  return value.replace(/\{\{(key|layer|date|timestamp)\}\}/g, (_, key) => vars[key]);
}

// Preparation is pure: previews and execution share exactly the same expanded values.
function prepareAction(action, context, { documents, layers = [], platform = process.platform } = {}, now = new Date()) {
  const vars = variables(context, now);
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
      const url = new URL(action.url);
      const query = Object.fromEntries(Object.entries(action.query).map(([key, value]) => [key, interpolate(value, vars)]));
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      return { type: 'http', method: action.method, url: url.href, query,
        headers: Object.fromEntries(Object.entries(action.headers).map(([key, value]) => [key, interpolate(value, vars)])), body: interpolate(action.body, vars) };
    }
    default: throw new Error('Ação não suportada.');
  }
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
    const status = Number.isInteger(error.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599 ? error.httpStatus : httpStatus;
    if (status) return `Destino respondeu HTTP ${status}${status >= 300 && status < 400 ? '. Redirecionamentos não são seguidos' : ''}.`;
    return /^(A requisição excedeu o limite de 10 segundos\.|Não foi possível conectar ao destino HTTP\.)$/.test(error.message) ? error.message : 'Não foi possível concluir a requisição HTTP.';
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
  const files = (prepared.type === 'sequence' ? prepared.steps : [prepared]).filter(step => step.type === 'file');
  if (!files.length || !storage?.protectedPaths) return;
  const protectedPaths = await storage.protectedPaths();
  for (const file of files) await assertSafeDestination(file.target, protectedPaths, storage.directory);
}

async function executeAction(action, context, options = {}) {
  const { documents, storage, fetchImpl = fetch, preparedAction, onHttpStatus, desktopActions = {}, setLayer, now = Date.now, onStep, onProgress, signal } = options;
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
      for (let index = 0; index < prepared.steps.length; index++) {
        checkCancellation(signal);
        onProgress?.({ stepIndex: index + 1, stepCount: prepared.steps.length, phase: 'running' });
        checkCancellation(signal);
        const step = prepared.steps[index];
        const started = now();
        let httpStatus;
        const details = (status, message) => ({ index: index + 1, type: step.type, status, message, durationMs: Math.max(0, now() - started), ...(httpStatus === undefined ? {} : { httpStatus }) });
        try {
          const message = await executeAction(action.steps[index], context, { ...options, preparedAction: step, onStep: undefined, onProgress: undefined, onHttpStatus: value => { if (Number.isInteger(value) && value >= 100 && value <= 599) httpStatus = value; } });
          onStep?.(details('success', message));
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
        if (index < prepared.steps.length - 1 && prepared.stepDelayMs > 0) {
          onProgress?.({ stepIndex: index + 1, stepCount: prepared.steps.length, phase: 'waiting' });
          await delay(prepared.stepDelayMs, undefined, { signal });
        }
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
      try { response = await fetchImpl(url, options); }
      catch (error) {
        checkCancellation(signal);
        throw new Error(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'A requisição excedeu o limite de 10 segundos.' : 'Não foi possível conectar ao destino HTTP.');
      }
      onHttpStatus?.(response.status);
      await response.body?.cancel();
      if (!response.ok) {
        const error = new Error(`Destino respondeu HTTP ${response.status}${response.status >= 300 && response.status < 400 ? '. Redirecionamentos não são seguidos' : ''}.`);
        error.httpStatus = response.status;
        throw error;
      }
      return `HTTP ${response.status} · ${url.hostname}`;
    }
    default: throw new Error('Ação não suportada.');
  }
}

module.exports = { executeAction, prepareAction, previewAction, freezePreparedAction, actionErrorMessage, interpolate, validateFileTargets };
