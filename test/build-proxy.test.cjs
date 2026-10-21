const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

test('proxy corrigido mantém bootstrap CommonJS e encaminha downloads HTTP', async t => {
  const requests = [];
  const server = http.createServer((req, res) => { requests.push(req.url); res.end('proxy-fixture'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const script = `
    require('global-agent').bootstrap();
    require('node:http').get('http://127.0.0.1:9/electron-proxy-fixture', response => {
      let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>{if(text!=='proxy-fixture')process.exitCode=1;});
    }).on('error',error=>{console.error(error);process.exitCode=1;});
  `;
  await promisify(execFile)(process.execPath, ['-e', script], { cwd: require('node:path').resolve(__dirname, '..'), timeout: 5000,
    env: { ...process.env, GLOBAL_AGENT_HTTP_PROXY: 'http://127.0.0.1:' + server.address().port,
      GLOBAL_AGENT_NO_PROXY: '', GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE: 'GLOBAL_AGENT_', NODE_USE_ENV_PROXY: '0' } });
  assert.deepEqual(requests, ['http://127.0.0.1:9/electron-proxy-fixture']);
});
