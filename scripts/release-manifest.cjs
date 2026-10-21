const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createReadStream, constants } = require('node:fs');
const { execFileSync } = require('node:child_process');

async function writeManifest(directory, { version, commit }) {
  const names = (await fs.readdir(directory)).filter(name => /\.(exe|dmg|zip|AppImage|deb)$/.test(name)).sort();
  if (!names.length) throw new Error('Nenhum instalador encontrado.');
  const files = [];
  for (const name of names) {
    const file = path.join(directory, name);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Instalador deve ser um arquivo regular.');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const sha256 = hash.digest('hex');
    files.push({ name, bytes: stat.size, sha256 });
  }
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), files.map(file => file.sha256 + '  ' + file.name).join('\n') + '\n');
  await fs.writeFile(path.join(directory, 'release-manifest.json'), JSON.stringify({ version, commit, files }, null, 2) + '\n');
  return files;
}
async function assembleInstallers(source, target) {
  await fs.mkdir(target);
  for (const name of ['signed-Linux-X64', 'signed-Windows-X64', 'signed-macOS-ARM64', 'signed-macOS-X64']) {
    const directory = path.join(source, name);
    const installers = (await fs.readdir(directory)).filter(file => /\.(exe|dmg|zip|AppImage|deb)$/.test(file));
    if (!installers.length) throw new Error('Instalador ausente: ' + name);
    for (const file of installers) await fs.copyFile(path.join(directory, file), path.join(target, file), constants.COPYFILE_EXCL);
  }
}
if (require.main === module) {
  const assemble = process.argv[2] === '--assemble';
  const directory = path.resolve(assemble ? process.argv[4] || 'dist' : process.argv[2] || 'dist');
  const ready = assemble ? assembleInstallers(path.resolve(process.argv[3] || 'release-artifacts'), directory) : Promise.resolve();
  ready.then(() => writeManifest(directory, { version: require('../package.json').version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }))
    .then(files => console.log(files.length + ' instaladores incluídos no manifesto SHA-256.')).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { writeManifest, assembleInstallers };
