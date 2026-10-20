const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function identity(file) {
  let canonical = path.resolve(file), stat;
  try { canonical = await fs.realpath(file); stat = await fs.stat(file, { bigint: true }); }
  catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
  return { canonical: process.platform === 'win32' ? canonical.toLowerCase() : canonical, stat };
}

// Replacing a directory entry, rather than truncating its inode, also protects
// internal files if the chosen destination becomes a hardlink after validation.
async function writeExport(file, data, protectedPaths = []) {
  const target = await identity(file);
  for (const protectedPath of protectedPaths) {
    const internal = await identity(protectedPath);
    if (target.canonical === internal.canonical || (target.stat && internal.stat &&
      target.stat.ino !== 0n && target.stat.dev === internal.stat.dev && target.stat.ino === internal.stat.ino)) {
      throw new Error('Escolha um destino diferente dos arquivos internos do aplicativo.');
    }
  }
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

module.exports = { writeExport };
