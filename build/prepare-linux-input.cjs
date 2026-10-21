const fs = require('node:fs/promises');
const path = require('node:path');
// Stage immutable root-service payloads with deterministic non-writable modes.
module.exports = async context => {
  if (context.electronPlatformName !== 'linux') return;
  const root = context.packager.projectDir;
  const directory = path.join(root, 'artifacts', 'linux-input-package');
  await fs.mkdir(directory, { recursive: true });
  for (const file of ['service.py', 'evdev.py', 'dobra-input.service', 'io.dobra.Input1.service', 'io.dobra.Input1.conf', 'io.dobra.input.policy']) {
    const target = path.join(directory, file);
    await fs.copyFile(path.join(root, 'linux', 'dobra-input', file), target);
    await fs.chmod(target, 0o644);
  }
};
