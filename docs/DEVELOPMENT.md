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
| `npm run test:orca` | Orca real, anúncios e árvore AT-SPI; navegação, erros e diálogos nos dois temas, em sessão isolada |
| `npm run test:lifecycle` | Electron real: cofre pendente, fechar durante carga, gravação/HTTP na saída, ocultação e reabertura; Xvfb no Linux |
| `npm run test:input` | Teclas sintéticas XTest no Electron/Linux X11 |
| `npm run test:macros` | Cria Xvfb isolado; editor, gravação e reprodução real em outro aplicativo, claro/escuro e axe |
| `npm run pack` | Empacota para o sistema atual sem gerar instalador |
| `node scripts/platform-audit.cjs` | Sonda de integração nativa no source |

Os smokes de UI/entrada exigem ambiente gráfico. O teste de entrada também
depende de `xdotool` e X11; no CI Linux, ambos rodam via Xvfb. Consulte os comandos
e bibliotecas exatos em [desktop.yml](../.github/workflows/desktop.yml).
A opção `--packaged` da auditoria é usada pelo CI em usuário descartável, pois o
executável empacotado usa o perfil real da conta, não `DOBRA_DATA_DIR`.

O contrato do portal de reprodução Wayland também tem prova GIO/D-Bus isolada:
`dbus-run-session -- /usr/bin/python3 -I -B scripts/wayland-macro-portal-smoke.py`.
Ela não injeta entrada num compositor real. Win/mac compilam os sidecars de
ponteiro em `npm run native:build`/`beforePack`; o self-test de build não concede
permissões nem certifica efeitos em aplicativos instalados.

Para observar estabilidade por mais tempo:

```bash
npm run test:soak -- --duration-seconds 1800
```

O limite é 3.600 segundos. Tempos/heap observados não comprovam ausência de
vazamento, desempenho de hardware ou entrega de teclas físicas por horas.

O smoke de UI executa axe-core em 24 estados, além de 44 verificações de regressão,
aguardando transições de tema
antes de avaliar WCAG A/AA. O axe é dependência de desenvolvimento e não integra
o renderer distribuído. As sondas separam a pasta de efeitos da pasta de perfil.

O teste com Orca requer Linux, `orca`, `speech-dispatcher`, `xvfb-run`,
`dbus-run-session`, `/usr/bin/python3` com `gi.repository.Atspi`, libX11 e libXtst.
O comando cria o próprio display, barramento D-Bus e preferências temporárias;
não substitui um Orca aberto na sessão de trabalho. Os anúncios gerados pelo
leitor e as árvores nativas ficam em `artifacts/screen-reader/`. A captura usa o
log do Orca; não representa uma avaliação humana da inteligibilidade do áudio
nem valida NVDA, JAWS, VoiceOver ou uma linha Braille física.

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

## Serviço de entrada Wayland

Em Linux, `npm run test:wayland` requer `/usr/bin/python3`, `python3-gi`,
`gir1.2-glib-2.0`, `libevdev2`, `libudev1` e `dbus`. Usa barramento privado com
login1/Polkit/dispositivos simulados; não requer root nem altera o sistema.
O bridge de produção e a passagem de descritor privado são exercitados realmente.

`npm run dist:linux` prepara o payload protegido e inclui os arquivos na lista do
`.deb`; `node scripts/check-linux-input-package.cjs` inspeciona propriedade, modos,
dependências e scripts de instalação/remoção sem instalar o pacote. O hook
`build/prepare-linux-input.cjs` gera staging em `artifacts/`, fora dos fontes.
Não adicionar modos de teste, barramentos alternativos ou caminhos de dispositivos
controlados pelo cliente ao serviço instalado. [Contrato](../.keel/surfaces/wayland-input.md).

## Recursos de produtividade e helpers por dispositivo

`beforePack` usa `build/prepare-native-input.cjs`: prepara o serviço Linux ou
compila o helper passivo no Windows/macOS e executa seu self-test sem abrir teclado.
Windows requer Visual Studio Build Tools com C++ e ambiente `cl.exe`; CI configura
MSVC antes de pack/dist. macOS requer Xcode Command Line Tools. Os binários gerados
ficam em `app/native-input/`, ignorados pelo Git e desempacotados do ASAR.
O helper macOS acompanha o mínimo macOS 13 exigido pelo Electron 44.
Para desenvolvimento nesses dois sistemas, execute `npm run native:build` antes
de `npm start`. Instaladores já incluem o helper compilado; o comando não instala
serviços ou altera permissões no sistema.

Provas de catálogo/importação ficam em `test/layer-library.test.cjs` e
`test/product-services.test.cjs`. Testes de sequência, undo e controles cobrem
invariantes no motor; o smoke de produtividade verifica a integração real no
Electron. Nenhuma prova sintética certifica teclados físicos ou permissões do SO.

A auditoria acrescenta regressões `*-productivity-audit`, `layer-library-audit` e
`scripts/productivity-audit-ui.cjs`, executado pela suíte UI. Para iterar somente
essa superfície, use `DOBRA_UI_PRODUCTIVITY_ONLY=1 DOBRA_UI_AUDIT_ONLY=1 npm run test:ui`
em sessão gráfica isolada. `node scripts/productivity-performance.cjs` mede cinco
amostras de mescla/replace de 1.960 ações válidas; não define um SLA nem compara SOs.
O self-test dos helpers também verifica a origem do relógio sem capturar entrada.
