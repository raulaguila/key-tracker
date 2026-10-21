const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
async function main() {
  const file = path.resolve(process.argv[2] || 'dist/Dobra-' + require('../package.json').version + '-linux-amd64.deb');
  const entries = execFileSync('dpkg-deb', ['--contents', file], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).split('\n');
  const payloads = ['usr/libexec/dobra-input/service.py', 'usr/libexec/dobra-input/evdev.py', 'lib/systemd/system/dobra-input.service',
    'usr/share/dbus-1/system-services/io.dobra.Input1.service', 'usr/share/dbus-1/system.d/io.dobra.Input1.conf', 'usr/share/polkit-1/actions/io.dobra.input.policy'];
  for (const payload of payloads) {
    const entry = entries.find(line => line.trim().endsWith('./' + payload));
    assert.ok(entry, 'Missing ' + payload);
    assert.match(entry, /^-rw-r--r--\s+0\/0\s/, 'Protected root-owned payload: ' + payload);
  }
  const depends = execFileSync('dpkg-deb', ['--field', file, 'Depends'], { encoding: 'utf8' });
  for (const name of ['python3', 'python3-gi', 'gir1.2-glib-2.0', 'libevdev2', 'libudev1', 'polkitd', 'dbus', 'systemd']) assert.ok(depends.split(',').some(item => item.trim() === name), name);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dobra-deb-control-'));
  try {
    execFileSync('dpkg-deb', ['--control', file, directory]);
    const postinstall = await fs.readFile(path.join(directory, 'postinst'), 'utf8');
    assert.ok(postinstall.includes('daemon-reload'));
    assert.doesNotMatch(postinstall, /(?:^|\s)(?:start|enable)\s+['"]?dobra-input(?:\.service)?['"]?(?:\s|$)/m, 'No automatic service start or enable');
    const preremove = await fs.readFile(path.join(directory, 'prerm'), 'utf8');
    assert.ok(preremove.includes('dobra-input'));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
  console.log('Linux input package passed: six protected root-owned payloads, runtime dependencies, D-Bus activation, no automatic start/enable, removal lifecycle.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
