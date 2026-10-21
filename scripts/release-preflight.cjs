const { execFileSync } = require('node:child_process');

function validateRelease({ tag, version, platform = process.platform, env = process.env, qaApproved = env.RELEASE_QA_APPROVED }) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(tag || '') || tag !== 'v' + version) throw new Error('RELEASE_TAG deve corresponder exatamente à versão do package.json (vX.Y.Z).');
  if (qaApproved !== 'true') throw new Error('Conclua e confirme o roteiro de QA do aplicativo instalado antes de preparar uma release.');
  const required = platform === 'win32' ? ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']
    : platform === 'darwin' ? ['MAC_CSC_LINK', 'MAC_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'] : [];
  if (!['win32', 'darwin', 'linux'].includes(platform)) throw new Error('Sistema de release não suportado.');
  const missing = required.filter(key => typeof env[key] !== 'string' || !env[key].trim());
  if (missing.length) throw new Error('Configure os secrets de assinatura/notarização: ' + missing.join(', ') + '.');
  return { tag, platform };
}
function validateTagTarget({ tag, commit, refs }) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit || '')) throw new Error('Commit de release inválido.');
  const entries = new Map(refs.trim().split('\n').filter(Boolean).map(line => line.trim().split(/\s+/).reverse()));
  const target = entries.get('refs/tags/' + tag + '^{}') || entries.get('refs/tags/' + tag);
  if (target && target !== commit) throw new Error('A tag existente aponta para outro commit. Use uma nova versão; não mova tags publicadas.');
  return { exists: Boolean(target), commit };
}
if (require.main === module) {
  try {
    validateRelease({ tag: process.env.RELEASE_TAG, version: require('../package.json').version });
    const tag = process.env.RELEASE_TAG;
    const commit = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const refs = execFileSync('git', ['ls-remote', '--tags', 'origin', 'refs/tags/' + tag, 'refs/tags/' + tag + '^{}'], { encoding: 'utf8', timeout: 30000 });
    validateTagTarget({ tag, commit, refs });
    console.log('Versão, commit/tag, confirmação de QA e presença de credenciais verificadas. A assinatura real será validada após o build.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { validateRelease, validateTagTarget };
