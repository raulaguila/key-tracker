const fs = require('node:fs/promises');
const path = require('node:path');

function variables(context, now = new Date()) {
  return { key: context.key, layer: context.layer, date: now.toISOString().slice(0, 10), timestamp: now.toISOString().replace(/[:.]/g, '-') };
}

function interpolate(value, vars) {
  return value.replace(/\{\{(key|layer|date|timestamp)\}\}/g, (_, key) => vars[key]);
}

// Preparation is pure: previews and execution share exactly the same expanded values.
function prepareAction(action, context, { documents }, now = new Date()) {
  const vars = variables(context, now);
  switch (action.type) {
    case 'log': return { type: 'log', message: interpolate(action.message, vars) };
    case 'file': {
      const directory = action.directory || path.join(documents, 'Keyboard Tracker');
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
  return result;
}

async function executeAction(action, context, { documents, storage, fetchImpl = fetch, preparedAction, onHttpStatus } = {}) {
  const prepared = preparedAction ?? prepareAction(action, context, { documents });
  switch (prepared.type) {
    case 'log': {
      await storage.appendLog({ time: new Date().toISOString(), kind: 'message', layer: context.layer, key: context.key, message: prepared.message });
      return 'Mensagem salva no log.';
    }
    case 'file': {
      const { directory, target } = prepared;
      await fs.mkdir(directory, { recursive: true });
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
      const options = { method: prepared.method, headers: prepared.headers, signal: AbortSignal.timeout(10000), redirect: 'manual' };
      if (prepared.body && !['GET', 'HEAD'].includes(prepared.method)) options.body = prepared.body;
      let response;
      try { response = await fetchImpl(url, options); }
      catch (error) {
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

module.exports = { executeAction, prepareAction, previewAction, interpolate };
