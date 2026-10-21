# Contrato interno do Dobra

<!-- bridge:contract-schema 1 -->

Status: accepted. Este documento descreve a integração interna atual; não é uma
API pública de plugins. A validação executável fica em `app/config.cjs` e o
preload em `app/preload.cjs`. [Índice da documentação](docs/README.md).

## Configuração v1

```json
{
  "version": 1,
  "settings": {
    "layerShortcut": "F8",
    "pauseShortcut": "CommandOrControl+Shift+F12",
    "cooldownMs": 400,
    "autoSwitchLayers": false,
    "closeToTray": false
  },
  "layers": [
    {
      "id": "principal",
      "name": "Principal",
      "description": "Atalhos de trabalho",
      "applications": [],
      "bindings": [
        {
          "id": "copiar",
          "key": "A",
          "name": "Copiar texto",
          "enabled": true,
          "action": { "type": "clipboard", "text": "Texto da {{layer}}" }
        }
      ]
    }
  ]
}
```

O JSON portátil tem `version: 1`, de 1 a 30 camadas e até 100 bindings por camada.
IDs são únicos em toda a configuração. Cada camada aceita nome de até 80
caracteres, descrição de até 240 e até 30 identidades de aplicativo. O nome da
binding aceita até 100 caracteres. `cooldownMs` vai de 100 a 10.000 ms.
A configuração normalizada deve ter até 256 KiB; a entrada formatada aceita até
2 MiB, desde que normalize dentro do limite. O arquivo criptografado é um
envelope de armazenamento, não outro formato de configuração para o renderer.

`enabled` omitido equivale a `true`; `applications` omitido equivale a `[]`;
`autoSwitchLayers` e `closeToTray` omitidos equivalem a `false`. Esses valores
são normalizados pelo processo principal. Configurações inválidas não são
parcialmente aplicadas. Salvar persiste antes de atualizar o motor.

### Atalhos e momentos

`key` usa um acelerador normalizado do Electron. `CommandOrControl` é resolvido
conforme o SO. Controles de pausa/camada não podem colidir entre si nem com ações.
Uma combinação só pode aparecer uma vez por momento na mesma camada.

| Campo da binding | Contrato |
| --- | --- |
| `trigger` | `press`, `hold` ou `release`; ausente equivale a `press` |
| `keyCode` | Código físico capturado; obrigatório para `hold`/`release` |
| `repeatMs` | Para `hold`, inteiro de 100 a 60.000; padrão 400 |
| `holdDelayMs` | Para `hold`, inteiro de 0 a 60.000; ausente usa `repeatMs` |

A representação física deve ser coerente entre os momentos de uma mesma
combinação. Alterar manualmente um atalho de manter/soltar exige nova captura.
A normalização não acrescenta campos de momento desnecessários a bindings
legadas de pressionar. [Semântica de gestos](docs/KEY_MOMENTS.md).

### Ações

| `type` | Campos |
| --- | --- |
| `clipboard` | `text` |
| `open` | `kind`: `url`, `path` ou `application`; `target` |
| `notification` | `title`, `message` |
| `layer` | `layerId` de uma camada existente |
| `sequence` | `steps`: 1–10 ações simples; `stepDelayMs` opcional, inteiro 0–60.000 |
| `http` | `method`, `url`, `headers`, `query`, `body` |
| `file` | `directory`, `filename`, `content`, `mode`: `create` ou `append` |
| `log` | `message`; compatibilidade com arquivos existentes/importados |

A UI oferece os sete primeiros tipos. `log` não é opção de criação/substituição
nem de nova etapa. O editor mantém uma ação legada sem editar sua mensagem e
permite substituí-la por um tipo atual. Não confundir esse tipo com o histórico
automático de execuções.

`clipboard.text`, `file.content` e `http.body` aceitam até 64.000 caracteres;
`notification.title`, até 120; `notification.message`, até 4.000; `log.message`, até 16.000.
Veja limites adicionais em `validateAction`, inclusive headers/query e nomes de
arquivo. HTTP aceita GET/POST/PUT/PATCH/DELETE/HEAD. URL HTTP(S) não aceita usuário
ou senha embutidos; GET/HEAD não aceitam corpo. Headers/query são objetos de strings.
Não há redirecionamentos ou retry, e o timeout é dez segundos.

`open` não executa shell nem aceita argumentos para aplicações. Arquivos/pastas e
aplicativos usam caminhos absolutos. Arquivo com `directory: ""` usa
`Documentos/Dobra`; `filename` não pode conter caminhos. `create` é exclusivo e
não sobrescreve; a pasta de dados do app e aliases de arquivos internos são recusados
na prévia e na execução. `append` recusa symlink observado antes da escrita, sem prometer
isolamento contra outro processo alterando a pasta concorrentemente.

`{{key}}`, `{{layer}}`, `{{date}}` e `{{timestamp}}` são resolvidas em campos de
conteúdo compatíveis. Datas usam UTC. A URL HTTP e a pasta de arquivos não são
templates. `prepareAction` é a mesma preparação pura usada por prévia/execução.
Sequências não aninham; param na primeira falha; o delay ocorre entre etapas
concluídas, sem espera inicial/final. Efeitos concluídos não são revertidos.

## API do preload

`window.dobra` expõe apenas métodos explícitos, via canais `dobra:*`. As chamadas
são assíncronas. Configuração, origem IPC e argumentos são validados no main.
Não há Node, `ipcRenderer` arbitrário ou acesso genérico a arquivos no renderer.

| Métodos | Retorno/efeito |
| --- | --- |
| `getState()` | `State` completo |
| `saveConfig(config)` | `State`, após validação e persistência serializada |
| `setEnabled(boolean)`, `setLayer(id)`, `setEditing(boolean)` | `State` |
| `setTracking(boolean)` | `State`; disponibilidade e modo são informados pelo motor |
| `previewBinding(layerId, bindingId)` | `{previewId, expiresAt, action}`; sem efeitos da ação |
| `runBinding(layerId, bindingId, previewId?)` | `State` após a execução; a UI envia o token da prévia |
| `cancelExecution(bindingId)`, `cancelAllExecutions()` | `State`; cancelar todas também pausa |
| `chooseDirectory()`, `chooseApplication()` | Caminho escolhido ou `null` |
| `chooseActionTarget(kind)` | Destino escolhido ou `null` |
| `importConfig()`, `exportConfig()`, `restoreBackup()` | `State`; diálogos nativos e confirmação quando aplicável |
| `exportHistory()`, `exportDiagnostics()` | Diálogo de salvar; sem envio automático |
| `openDataDirectory()` | Abre a pasta de dados pelo sistema |
| `showWindow()`, `confirmClose()`, `cancelClose()` | Controle explícito do ciclo de vida |
| `onState(callback)`, `onKey(callback)`, `onCloseRequested(callback)` | Retornam função de unsubscribe |

Tokens de prévia guardam valores congelados por até cinco minutos; no máximo
dez ficam retidos. Um token é vinculado à binding/camada, consumido uma vez e
invalidado ao salvar. Headers são mascarados na cópia entregue ao renderer.
Erro de persistência preserva configuração e prévias anteriores. O teste manual
pode executar mesmo pausado e ignora o gesto/delay inicial de manter; respeita o
delay da sequência. Uma chamada IPC resolvida não significa que a ação teve sucesso:
a UI deve consultar o evento de resultado correspondente.

### State

`app/engine.cjs` produz um clone serializável com:

- `config`, `configRevision`, `stateRevision`, `activeLayerId`, `enabled`, `stopping`, `editing`;
- `platform`, `session`, `paths: {data, documents, log}`;
- `shortcuts: {registered, failed}`, `tracking`, `input`, `application`, `desktop`;
- `storage: {encryptionAvailable, protection, backupAvailable, backupChecking?, message}`;
- `running`: até quatro execuções com `bindingId`, `layerId`, `name`, `key`,
  `startedAt`, `stepIndex`, `stepCount`, `phase`;
- `events`: últimos 100 eventos da sessão, mais recentes primeiro.

`storage.protection` é `encrypted`, `plain`, `legacy` ou `unavailable`.
`running.phase` é `running`, `waiting` ou `cancelling`. Capacidade nativa deve ser
lida do estado, não presumida pelo SO. O estado inclui a configuração em memória;
não deve ser copiado para logs, diagnósticos ou serviços externos.

No transporte, atualizações podem omitir `config` quando a revisão é a mesma.
O preload reidrata e descarta respostas antigas; consumidores de `window.dobra`
recebem `State` completo, não patches. Atualizações de progresso são por transição,
sem polling periódico da interface. O transporte pode agrupar progresso visual
por 16 ms e sincroniza apenas o último estado ao mostrar uma janela oculta.
Controle de entrada e cancelamento não são agrupados. `getState` durante o início
aguarda a preparação; a janela exibe carregamento e não habilita ações.

### Eventos e resultados

`onKey` transporta down/up normalizados para a visualização; não é uma API de
texto digitado e não persiste os eventos. Layout/legendas são preferências do
renderer e não mudam os aceleradores da configuração.

Eventos do motor incluem `id`, `time`, `kind`, `status`, `message` e metadados
pertinentes à execução. Resultados incluem binding, atalho configurado, camada,
duração, momento e status HTTP quando aplicável; sequências incluem metadados
por etapa e delay efetivo. Cancelamento é `cancelled`, distinto de erro/sucesso.
Headers, corpo HTTP e conteúdos privados não entram nos resultados automáticos.
Mensagens explícitas de ações `log` legadas seguem sua compatibilidade própria.

## Execução, contexto e encerramento

O motor inicia pausado na primeira camada. Após a primeira ativação explícita,
o atalho de pausa permanece disponível para retomar; falhar em registrar a pausa
impede ativar. A edição suspende ações e alternância, mantendo a pausa.
Há no máximo quatro bindings em execução e uma execução por binding, sem fila
ilimitada. Ticks ocupados são descartados.

Pausar não cancela trabalho iniciado. Cancelar aborta esperas/HTTP e impede
etapas futuras; operações nativas em andamento podem terminar. Encerrar cancela
trabalho pendente e remove hooks, monitores e atalhos. Parar todas informa
`stopping` até as ações e seus registros terminarem, bloqueando novos disparos e
reativação. Encerramento aguarda operações aceitas e filas; após 10 s, continuar
aguardando ou sair com pendências é escolha explícita do usuário. Gestos interrompidos não
produzem uma soltura fictícia. Bloquear/suspender deixa o motor pausado.

Perfis por aplicativo são opt-in, com identidade exata de processo, sem títulos
ou URLs. Caminho/bundle/executável tem precedência sobre nome. A última camada
manual é fallback; mudanças durante edição são adiadas. Bandeja é opcional e
não permite ocultar uma janela sem caminho de recuperação.

## Persistência e distribuição

A identidade é Dobra: `io.dobra.app`, perfil `Dobra`, `dobra:*`, preferências
`dobra.*` e envelope `dobra.safeStorage` v1. `DOBRA_DATA_DIR` isola desenvolvimento
e é ignorado no executável empacotado. Não há aliases de identidade anteriores.

Gravações são atômicas e serializadas; backup preserva a configuração válida
anterior. Salvar conteúdo canônico idêntico preserva arquivo e backup;
normalização de legado e migração segura continuam sendo realizadas. Verificação
de backup pode ocorrer depois da carga principal, com `backupChecking` explícito.
Havendo headers HTTP, config e backup usam cofre seguro assíncrono,
sem fallback desprotegido. Disponibilidade, encrypt e decrypt têm timeout de 5 s
por operação; resultados tardios não escrevem e o arquivo anterior é preservado.
Exportação portátil remove todos os headers; recuperação
preserva o arquivo inválido. O diagnóstico usa uma allowlist independente de State.
[Privacidade](docs/PRIVACY.md) e [produção](docs/PRODUCTION.md) detalham as limitações.

O CI cobre Windows x64, Linux x64, macOS ARM64 e macOS Intel x64. Builds de teste,
candidatos assinados e releases públicas são etapas diferentes. Contratos de
assinatura e QA instalado estão no guia de produção; não há atualização automática.
