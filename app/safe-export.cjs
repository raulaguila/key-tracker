const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function identity(file) {
  let canonical = path.resolve(file), stat;
  let ancestor = canonical;
  const tail = [];
  // Resolve existing parents too: a new file can be in a symlinked profile.
  while (true) {
    try { canonical = path.join(await fs.realpath(ancestor), ...tail); break; }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      if (path.dirname(ancestor) === ancestor) break;
      tail.unshift(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }
  try { stat = await fs.stat(file, { bigint: true }); }
  catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
  return { canonical: process.platform === 'win32' ? canonical.toLowerCase() : canonical, stat };
}

async function assertSafeDestination(file, protectedPaths = [], protectedDirectory) {
  const target = await identity(file);
  if (protectedDirectory) {
    const directory = await identity(protectedDirectory);
    const relative = path.relative(directory.canonical, target.canonical);
    if (!relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
      throw new Error('Escolha um destino diferente dos arquivos internos do aplicativo.');
    }
  }
  for (const protectedPath of protectedPaths) {
    const internal = await identity(protectedPath);
    if (target.canonical === internal.canonical || (target.stat && internal.stat &&
      target.stat.ino !== 0n && target.stat.dev === internal.stat.dev && target.stat.ino === internal.stat.ino)) {
      throw new Error('Escolha um destino diferente dos arquivos internos do aplicativo.');
    }
  }
}

// Replacing a directory entry also protects against late hardlink replacement.
async function writeExport(file, data, protectedPaths = []) {
  await assertSafeDestination(file, protectedPaths);
  const temporary = path.join(path.dirname(path.resolve(file)), '.keyboard-export-' + randomUUID() + '.tmp');
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(data, 'utf8');
    await handle.close();
    await fs.rename(temporary, file);
  } finally {
    if (handle) { await handle.close().catch(() => {}); await fs.rm(temporary, { force: true }); }
  }
}

module.exports = { writeExport, assertSafeDestination };
