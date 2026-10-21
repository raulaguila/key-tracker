const path = require('node:path');
const prepare = require('../build/prepare-native-input.cjs');
prepare({ electronPlatformName: process.platform, arch: process.arch, packager: { projectDir: path.resolve(__dirname, '..') } })
  .then(() => console.log(process.platform === 'linux' ? 'Componente Linux preparado para o pacote; nenhuma instalação ou autorização foi realizada.' : 'Componente nativo de entrada compilado e self-test concluído.'))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
