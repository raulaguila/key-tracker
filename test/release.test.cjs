const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { validateRelease, validateTagTarget } = require('../scripts/release-preflight.cjs');
const { writeManifest, assembleInstallers } = require('../scripts/release-manifest.cjs');

test('release recusa versão divergente, QA pendente e credenciais ausentes sem revelar segredos', () => {
  const base = { version: '0.1.0', tag: 'v0.1.0', platform: 'linux', qaApproved: 'true', env: {} };
  assert.equal(validateRelease(base).tag, base.tag);
  for (const tag of ['v0.2.0', 'v0.1.0;echo secret', '0.1.0', undefined]) assert.throws(() => validateRelease({ ...base, tag }), /RELEASE_TAG/);
  assert.throws(() => validateRelease({ ...base, qaApproved: 'false' }), /QA/);
  for (const platform of ['win32', 'darwin']) assert.throws(() => validateRelease({ ...base, platform }), /secrets/);
  const env = Object.fromEntries(['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'MAC_CSC_LINK', 'MAC_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].map(key => [key, 'private-value']));
  for (const platform of ['win32', 'darwin']) assert.equal(validateRelease({ ...base, platform, env }).platform, platform);
});

test('tag nova, leve e anotada devem identificar exatamente o commit dos binários', () => {
  const commit = 'a'.repeat(40), other = 'b'.repeat(40), object = 'c'.repeat(40), tag = 'v0.1.0';
  assert.equal(validateTagTarget({ tag, commit, refs: '' }).exists, false);
  assert.equal(validateTagTarget({ tag, commit, refs: commit + '\trefs/tags/' + tag }).exists, true);
  assert.equal(validateTagTarget({ tag, commit, refs: object + '\trefs/tags/' + tag + '\n' + commit + '\trefs/tags/' + tag + '^{}' }).exists, true);
  assert.throws(() => validateTagTarget({ tag, commit, refs: other + '\trefs/tags/' + tag }), /outro commit/);
  assert.throws(() => validateTagTarget({ tag, commit, refs: commit + '\trefs/tags/' + tag + '\n' + other + '\trefs/tags/' + tag + '^{}' }), /outro commit/);
  assert.throws(() => validateTagTarget({ tag, commit: 'invalid', refs: '' }), /inválido/);
});

test('montagem exige quatro targets e recusa instaladores com nomes duplicados', async t => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'key-assemble-'));
  t.after(() => fs.rm(source, { recursive: true, force: true }));
  const names = ['signed-Linux-X64', 'signed-Windows-X64', 'signed-macOS-ARM64', 'signed-macOS-X64'];
  for (const name of names) {
    await fs.mkdir(path.join(source, name));
    await fs.writeFile(path.join(source, name, name + '.zip'), 'installer');
  }
  const target = path.join(source, 'out');
  await assembleInstallers(source, target);
  assert.equal((await fs.readdir(target)).length, 4);
  await fs.writeFile(path.join(source, names[0], 'duplicate.zip'), 'one');
  await fs.writeFile(path.join(source, names[1], 'duplicate.zip'), 'two');
  await assert.rejects(assembleInstallers(source, path.join(source, 'duplicates')), { code: 'EEXIST' });
  for (const name of names.slice(0, 2)) await fs.rm(path.join(source, name, 'duplicate.zip'));
  await fs.rm(path.join(source, names[3]), { recursive: true });
  await assert.rejects(assembleInstallers(source, path.join(source, 'missing')), { code: 'ENOENT' });
});

test('manifesto calcula hashes dos instaladores, preserva arquitetura e ignora arquivos internos', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'key-release-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const names = ['Keyboard Tracker-0.1.0-mac-x64.dmg', 'Keyboard Tracker-0.1.0-mac-arm64.dmg', 'Keyboard Tracker-0.1.0-win-x64.exe'];
  for (const name of names) await fs.writeFile(path.join(directory, name), name);
  await fs.writeFile(path.join(directory, 'builder-effective-config.yaml'), 'not a release asset');
  const files = await writeManifest(directory, { version: '0.1.0', commit: 'test-sha' });
  assert.equal(files.length, 3);
  for (const file of files) assert.equal(file.sha256, createHash('sha256').update(file.name).digest('hex'));
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'release-manifest.json'), 'utf8'));
  assert.equal(manifest.commit, 'test-sha');
  assert.equal(manifest.files.length, 3);
  assert.equal((await fs.readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n').length, 3);
});
