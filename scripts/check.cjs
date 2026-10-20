const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');
function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? collect(path.join(directory, entry.name)) : /\.(cjs|mjs|js)$/.test(entry.name) ? [path.join(directory, entry.name)] : []);
}
let failed = false;
for (const file of [...collect('app'), ...collect('scripts'), ...collect('test')]) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { failed = true; console.error(result.stderr); }
}
if (failed) process.exitCode = 1;
else console.log('Sintaxe verificada.');
