const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = async context => {
  await require('./prepare-linux-input.cjs')(context);
  const platform = context.electronPlatformName;
  if (!['win32', 'darwin'].includes(platform)) return;
  if (platform !== process.platform) throw new Error('Compile o componente nativo no sistema de destino.');
  const root=context.packager.projectDir, directory=path.join(root,'app','native-input');
  await fs.mkdir(directory,{recursive:true});
  const source=path.join(root,'native','input',platform==='win32'?'windows.cpp':'macos.mm');
  const output=path.join(directory,platform==='win32'?'dobra-input.exe':'dobra-input');
  const arch = typeof context.arch === 'number' ? ['ia32','x64','armv7l','arm64','universal'][context.arch] : context.arch || process.arch;
  const args=platform==='win32'?['/nologo','/std:c++17','/EHsc','/O2','/MT',source,'/Fe:'+output,'/Fo:'+path.join(directory,'dobra-input.obj'),'user32.lib']:
    ['-std=c++17','-O2','-arch',arch==='arm64'?'arm64':'x86_64','-mmacosx-version-min=13.0',source,'-framework','IOKit','-framework','CoreFoundation','-o',output];
  const result=spawnSync(platform==='win32'?'cl.exe':'clang++',args,{encoding:'utf8',timeout:120000});
  if(result.error||result.status!==0)throw new Error('Falha ao compilar componente de entrada: '+(result.error?.message||result.stderr||result.stdout));
  const before = Number(process.hrtime.bigint()) / 1e6;
  const proof=spawnSync(output,['--self-test'],{encoding:'utf8',timeout:5000});
  const after = Number(process.hrtime.bigint()) / 1e6;
  const diagnostic = proof.status === 0 ? JSON.parse(proof.stdout) : {};
  if(proof.status!==0||!diagnostic.selfTest||!Number.isFinite(diagnostic.monotonicMs)||diagnostic.monotonicMs<before-2||diagnostic.monotonicMs>after+2)throw new Error('Componente nativo não passou no self-test de relógio monotônico.');
  if(platform==='darwin')await fs.chmod(output,0o755);
  else await fs.rm(path.join(directory,'dobra-input.obj'),{force:true});
};
