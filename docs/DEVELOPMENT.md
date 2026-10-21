# Desenvolvimento

[Documentação](README.md) · [Contribuição](../CONTRIBUTING.md)

## Ambiente

Use Node.js 24, npm e uma sessão gráfica no sistema de destino. O aplicativo
usa Electron e dependências nativas; um servidor sem ambiente gráfico não
substitui a validação desktop. No Linux, instale as bibliotecas declaradas em
`build.deb.depends` no [package.json](../package.json), além das ferramentas do
teste que você for executar. Os runners do CI documentam os pacotes usados.

```bash
npm ci
npm start
```

Para desenvolvimento sem alterar seu perfil pessoal, defina `DOBRA_DATA_DIR`
para uma pasta temporária antes de iniciar. No Bash:

```bash
DOBRA_DATA_DIR="$(mktemp -d)" npm start
```

No PowerShell:

```powershell
$env:DOBRA_DATA_DIR = Join-Path $env:TEMP ("dobra-dev-" + [guid]::NewGuid())
npm start
Remove-Item Env:DOBRA_DATA_DIR
```

Essa variável é ignorada no aplicativo empacotado. Os testes usam diretórios
isolados e não devem ser apontados para um perfil pessoal.

## Verificações

| Comando | Objetivo |
| --- | --- |
| `npm run check` | Sintaxe e verificações estáticas do projeto |
| `npm test` | Configuração, motor, ações, armazenamento e integrações controladas |
| `npm run test:soak` | Carga limitada com arquivos temporários e HTTP em loopback |
| `npm run test:ui` | Smoke da interface Electron com CDP e axe |
| `npm run test:lifecycle` | Electron real: cofre pendente, fechar durante carga, gravação/HTTP na saída, ocultação e reabertura; Xvfb no Linux |
| `npm run test:input` | Teclas sintéticas XTest no Electron/Linux X11 |
| `npm run pack` | Empacota para o sistema atual sem gerar instalador |
| `node scripts/platform-audit.cjs` | Sonda de integração nativa no source |

Os smokes de UI/entrada exigem ambiente gráfico. O teste de entrada também
depende de `xdotool` e X11; no CI Linux, ambos rodam via Xvfb. Consulte os comandos
e bibliotecas exatos em [desktop.yml](../.github/workflows/desktop.yml).
A opção `--packaged` da auditoria é usada pelo CI em usuário descartável, pois o
executável empacotado usa o perfil real da conta, não `DOBRA_DATA_DIR`.

Para observar estabilidade por mais tempo:

```bash
npm run test:soak -- --duration-seconds 1800
```

O limite é 3.600 segundos. Tempos/heap observados não comprovam ausência de
vazamento, desempenho de hardware ou entrega de teclas físicas por horas.

O smoke de UI executa axe-core em 14 estados, aguardando transições de tema
antes de avaliar WCAG A/AA. O axe é dependência de desenvolvimento e não integra
o renderer distribuído. As sondas separam a pasta de efeitos da pasta de perfil.

## Gerar instaladores de desenvolvimento

Execute no SO de destino, preferencialmente na mesma arquitetura:

```bash
npm run dist:linux
npm run dist:win
npm run dist:mac -- --arm64
npm run dist:mac -- --x64
```

Escolha somente o comando apropriado ao ambiente; não execute os quatro como
um único procedimento no mesmo computador. Os pacotes ficam em `dist/`, com
versão, SO e arquitetura no nome. `npm run dist` gera os destinos padrão do host.
Os comandos comuns não publicam releases nem configuram assinatura pública.
Para assinaturas e distribuição, siga [PRODUCTION.md](PRODUCTION.md).

`npmRebuild: false` preserva o uso de prebuilds N-API; os módulos nativos e helpers
necessários são extraídos do ASAR. Alterações nessas dependências exigem validar
os quatro destinos, inclusive o executável empacotado.

## CI

| Workflow | Cobertura |
| --- | --- |
| [Desktop](../.github/workflows/desktop.yml) | Push/PR/manual; testes em Windows x64, Linux x64, macOS ARM64 e Intel x64; pacotes em execuções que não são PR |
| [Platform audit](../.github/workflows/platform-audit.yml) | Push em arquivos relevantes/manual; sonda source e comparação do ASAR nos quatro destinos |
| [Dependency security](../.github/workflows/security.yml) | Mudanças relevantes, agenda e manual; auditoria npm com bloqueio em moderado/alto/crítico |
| [Signed release candidate](../.github/workflows/release.yml) | Manual, com QA e credenciais; rascunho após validação dos quatro destinos |

Dependabot propõe atualizações semanais de npm e GitHub Actions. Não há merge
automático. O status atual está no GitHub; [relatórios](audits/README.md) são
evidências de commits específicos, não resultados de uma execução futura.

## Onde alterar

O [mapa de arquitetura](../ARCHITECTURE.md) identifica os módulos. O
[contrato interno](../CONTRACT.md) define a configuração v1 e o preload. Preserve
a validação no processo principal, a suspensão durante edição e a política de
pausa/cancelamento ao alterar fluxos da interface.

O override de `global-agent` 4.1.3 mantém o `bootstrap` CommonJS usado pelo
downloader do Electron e remove a cadeia de logger com `sprintf-js`. O teste
`test/build-proxy.test.cjs` valida o encaminhamento por proxy HTTP em loopback;
instalação e empacotamento são conferidos na matriz nativa.

O CI Desktop executa lifecycle nos quatro destinos e publica JSONs como artifacts.
A fixture altera provedores apenas na entrada de teste, fora do pacote; não há
flags de bypass de cofre no produto. `platform-audit`/`performance-audit` distinguem
a interface utilizável (`interfaceMs`) da medição que inclui a leitura explícita
de State (`startupMs`); nenhuma das duas é tempo físico de primeiro paint.
