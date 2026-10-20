const fs = require('node:fs/promises');
const path = require('node:path');

function variables(context) {
  const now = new Date();
  return { key: context.key, layer: context.layer, date: now.toISOString().slice(0, 10), timestamp: now.toISOString().replace(/[:.]/g, '-') };
}

function interpolate(value, vars) {
  return value.replace(/\{\{(key|layer|date|timestamp)\}\}/g, (_, key) => vars[key]);
}

async function executeAction(action, context, { documents, storage, fetchImpl = fetch }) {
  const vars = variables(context);
  switch (action.type) {
    case 'log': {
      const message = interpolate(action.message, vars);
      await storage.appendLog({ time: new Date().toISOString(), kind: 'message', layer: context.layer, key: context.key, message });
      return 'Mensagem salva no log.';
    }
    case 'file': {
      const directory = action.directory || path.join(documents, 'Keyboard Tracker');
      if (!path.isAbsolute(directory)) throw new Error('Escolha uma pasta absoluta para salvar o arquivo.');
      // Templates never turn layer names or shortcuts into paths on any OS.
      const safeVars = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')]));
      const filename = interpolate(action.filename, safeVars);
      if (Buffer.byteLength(filename) > 240) throw new Error('Nome de arquivo expandido muito longo.');
      await fs.mkdir(directory, { recursive: true });
      const target = path.join(directory, filename);
      try {
        if (action.mode === 'append') {
          // Refuse symbolic links: appending should affect the chosen file only.
          try { if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('O destino não pode ser um link simbólico.'); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        await fs.writeFile(target, interpolate(action.content, vars), { flag: action.mode === 'append' ? 'a' : 'wx', mode: 0o600 });
      } catch (error) {
        if (error.code === 'EEXIST') throw new Error('Arquivo já existe. Use {{timestamp}} no nome ou o modo acrescentar.');
        throw error;
      }
      return action.mode === 'append' ? 'Conteúdo acrescentado ao arquivo.' : 'Arquivo criado.';
    }
    case 'http': {
      const url = new URL(action.url);
      for (const [key, value] of Object.entries(action.query)) url.searchParams.set(key, interpolate(value, vars));
      const headers = Object.fromEntries(Object.entries(action.headers).map(([key, value]) => [key, interpolate(value, vars)]));
      const options = { method: action.method, headers, signal: AbortSignal.timeout(10000), redirect: 'manual' };
      if (action.body && !['GET', 'HEAD'].includes(action.method)) options.body = interpolate(action.body, vars);
      let response;
      try { response = await fetchImpl(url, options); }
      catch (error) {
        throw new Error(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'A requisição excedeu o limite de 10 segundos.' : 'Não foi possível conectar ao destino HTTP.');
      }
      await response.body?.cancel();
      if (!response.ok) throw new Error(`Destino respondeu HTTP ${response.status}${response.status >= 300 && response.status < 400 ? '. Redirecionamentos não são seguidos' : ''}.`);
      return `HTTP ${response.status} · ${url.hostname}`;
    }
    default: throw new Error('Ação não suportada.');
  }
}

module.exports = { executeAction, interpolate };
