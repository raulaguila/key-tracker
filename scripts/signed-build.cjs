const { execFileSync } = require('node:child_process');
const { validateRelease } = require('./release-preflight.cjs');
validateRelease({ tag: process.env.RELEASE_TAG, version: require('../package.json').version });
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'true' };
if (process.platform === 'darwin') {
  env.CSC_LINK = env.MAC_CSC_LINK;
  env.CSC_KEY_PASSWORD = env.MAC_CSC_KEY_PASSWORD;
} else if (process.platform === 'win32') {
  env.CSC_LINK = env.WIN_CSC_LINK;
  env.CSC_KEY_PASSWORD = env.WIN_CSC_KEY_PASSWORD;
}
execFileSync(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), '--config', 'build/release.cjs', '--publish', 'never', '--' + process.arch], { stdio: 'inherit', env });
