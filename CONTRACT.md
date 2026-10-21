# Contrato interno

<!-- bridge:contract-schema 1 -->

## Status

accepted

Escopo autorizado pelo usuário em “Faça tudo” e nas expansões abaixo.

## Auth

Aplicativo desktop local, sem login ou servidor. Main aceita IPC apenas do
renderer principal, no arquivo de entrada autorizado. Renderer isolado, sandboxed
e sem Node; somente a API preload descrita neste contrato é exposta.

## Mocks policy

Produção usa APIs reais. Substituições ficam nas bordas nativas dos testes
unitários; testes de integração usam perfis temporários e serviços locais reais.
Não apresentar fixtures, dados de exemplo ou respostas simuladas em produção.

## APIs

Transporte local Electron IPC via `window.keyboardTracker`; assinaturas detalhadas
nas seções abaixo, sem endpoints HTTP.

| Operação preload | Resultado |
| --- | --- |
| getState, saveConfig, importConfig, exportConfig | State completo |
| setEnabled, setEditing, setLayer, setTracking | State completo |
| previewBinding | Prévia sem I/O e token efêmero |
| runBinding | State completo com resultado sanitizado |
| chooseDirectory, chooseApplication, chooseActionTarget | Caminho ou cancelamento |
| exportHistory, openDataDirectory, showWindow | Operação nativa sem resultado de dados |
| confirmClose, cancelClose | Conclusão ou cancelamento do fechamento pendente |
| onState, onKey, onCloseRequested | Assinatura com função de cancelamento |

## Expansão aprovada: ações de produtividade (20/10/2026)

Autorização: “Implemente as opções sugeridas”. Configuração permanece versão 1;
ações legadas continuam válidas. Novos tipos:

- `{type:'clipboard', text:'...'}`: copia texto interpolado, sem colar/injetar teclas.
- `{type:'open', kind:'url'|'path'|'application', target:'...'}`: abre HTTP/HTTPS,
  arquivo/pasta absoluto ou aplicativo absoluto; aplicativos sem argumentos ou shell.
- `{type:'notification', title:'...', message:'...'}`: notificação nativa, com
  erro visível quando não suportada ou rejeitada; não promete leitura pelo usuário.
- `{type:'layer', layerId:'...'}`: seleciona a camada existente, equivalente à
  escolha manual; não ativa o motor nem dispara ações da camada de destino.
- `{type:'sequence', steps:[Action, ...]}`: de 1 a 10 etapas, sem sequências
  aninhadas. Executa em ordem e para na primeira falha; efeitos já concluídos não
  são desfeitos. Cada etapa pode usar qualquer tipo simples, inclusive legado.

Prévia resolve todas as etapas sem I/O; token congela valores como nas ações
atuais. Variáveis de todas as etapas usam tecla/camada de origem e o mesmo instante
da preparação. Headers HTTP são mascarados também dentro das sequências.
Referências de camada são validadas na configuração completa, inclusive em
sequências; remover um destino referenciado é rejeitado com mensagem clara.

Eventos de execução ganham `steps` opcional: `[{index,type,status,message,durationMs,
httpStatus?}]`, índices base 1, somente etapas iniciadas. Resultados não incluem
texto copiado, mensagens de notificação, caminhos privados, headers ou corpos.
Uma sequência ocupa uma das quatro execuções concorrentes do motor, não dez vagas.
Histórico exibe etapas e resultado parcial; HTTP usa as mesmas mensagens sanitizadas
mesmo dentro da sequência. O registro automático de execuções permanece ativo.

Novos métodos preload: `chooseActionTarget(kind:'path'|'application') → string|null`
e `exportHistory() → void` (exporta os eventos da sessão por diálogo nativo).
Não expor clipboard, shell ou execução arbitrária ao renderer. Serviços nativos
injetados no motor apenas no main; testes unitários substituem somente essa borda.
O seletor principal prioriza os novos tipos; log legado aparece como opção
avançada/compatível para editar ações existentes e em etapas, sem converter dados.

Aceite: CRUD/preview/teste dos cinco tipos na interface, ordem/falha parcial,
persistência/reload, referências de camada, mascaramento, histórico com detalhes e
exportação, clipboard real no Electron Linux e builds dos três sistemas.

Electron main controla dados, ações e APIs nativas. Renderer sem Node, isolado e
sandboxed. Somente `window.keyboardTracker` é exposto pelo preload. Sem servidor
HTTP, serviços externos, mocks ou dados fictícios em produção.

## Configuração

```js
{
  version: 1,
  settings: { layerShortcut: 'F8', pauseShortcut: 'CommandOrControl+Shift+F12', cooldownMs: 400 },
  layers: [{ id: 'layer-1', name: 'Camada 1', description: '', bindings: [
    { id: 'binding-1', key: 'A', name: 'Registrar mensagem', action: { type: 'log', message: 'Tecla {{key}} na {{layer}}' } }
  ] }]
}
```

Action HTTP: `{type:'http', method:'POST', url:'https://...', headers:{}, query:{}, body:'{"value":1}'}`.
Action arquivo: `{type:'file', directory:'', filename:'nota-{{timestamp}}.txt', content:'...', mode:'create'|'append'}`.
Directory vazio usa Documentos/Keyboard Tracker. Create não sobrescreve existente.
Log: `{type:'log', message:'...'}`. Templates: `{{key}}`, `{{layer}}`, `{{date}}`, `{{timestamp}}`.

## API preload (todos métodos async, exceto assinaturas)

- `getState()` → State.
- `saveConfig(config)` → State; valida e persiste, atualiza registros globais.
- `setEnabled(boolean)` → State; ativa/pausa motor.
- `setLayer(layerId)` → State.
- `setEditing(boolean)` → State; suspende teclas de ação durante edição.
- `runBinding(layerId, bindingId)` → State; teste manual executa ação real mesmo pausado.
- `setTracking(boolean)` → State.
- `chooseDirectory()` → string|null.
- `openDataDirectory()` → void.
- `exportConfig()` e `importConfig()` → State (cancelar preserva estado).
- `onState(callback)` → unsubscribe; recebe State inteiro.
- `onKey(callback)` → unsubscribe; `{code:'KeyA',key:'A',direction:'down'|'up',source:'global'}`.

```js
State = {
 config, activeLayerId, enabled: false, editing: false,
 platform: 'linux'|'darwin'|'win32', session: 'wayland'|'x11'|'native',
 paths: { data: '...', documents: '...', log: '...' },
 shortcuts: { registered: [], failed: [{key, message}] },
 tracking: { enabled: false, mode: 'off'|'starting'|'global'|'local', message: '' },
 events: [{id,time,kind:'action'|'system',status:'success'|'error'|'info',message,layer,key}]
}
```

Métodos rejeitam com Error e mensagem em português. Interface deve mostrar erro.
Config tem limites e IDs únicos; nomes e conteúdo renderizados como texto.
Histórico limitado a 100 entradas, sem corpo/headers HTTP nem teclas rastreadas.
Atalhos são globais e podem substituir a digitação enquanto ativos. Nada inicia
automaticamente. Após primeira ativação, o controle global de pausa permanece
para permitir retomar. Rastreio e execução de ações têm controles independentes.

## Expansão aprovada: produtividade e contexto por aplicativo

Escopo: editor visual alternável com tabela; habilitar/desabilitar ação; duplicar
sem colisões; seletor direto da camada ativa; tray; prévia antes do teste; perfis
por aplicativo. A direção visual compacta e os drawers existentes são preservados.

Compatibilidade: configuração continua versão 1. Campos ausentes são normalizados:
`binding.enabled = true`, `layer.applications = []`,
`settings.autoSwitchLayers = false`, `settings.closeToTray = false`.
`applications` contém identificadores exatos de aplicativo (nome, executável,
caminho completo ou bundleId); não contém títulos de janelas ou URLs. IDs de todas
as cópias são novos. Duplicar ação abre rascunho exigindo outro atalho; duplicar
camada copia ações com novos IDs e não copia associações de aplicativos.
Ações desabilitadas não registram atalhos; teste manual explícito continua possível.

Novos métodos preload:
- `previewBinding(layerId, bindingId)` → prévia resolvida, sem I/O de ação;
  `{previewId, expiresAt, action}`. Action inclui valores interpolados e destino;
  headers sensíveis são mascarados na apresentação. Token efêmero congela os
  valores até a execução, expira após 5 minutos, invalida ao salvar configuração.
- `runBinding(layerId, bindingId, previewId?)` → State. Token fornecido é validado,
  vinculado à ação e consumido uma vez. Chamada antiga sem token é preservada.
- `chooseApplication()` → string|null, seleção nativa de executável/.app.
- `showWindow()` → void, restaura janela pelo renderer quando necessário.
- `onCloseRequested(callback)` → unsubscribe, recebe `{toTray:boolean}` quando
  fechar/ocultar/sair requer verificar rascunhos; `confirmClose()` conclui a
  solicitação pendente, `cancelClose()` mantém janela e rascunho.

Resultado de execução em events ganha `bindingId`, `durationMs`, `httpStatus`
quando aplicável, preservando campos existentes. Nunca grava prévia, headers,
corpos HTTP ou eventos de aplicativo em disco. UI mostra detalhes no drawer de
prévia/teste e execução só ocorre pelo botão explícito “Executar teste”.

State ganha `application: {status:'off'|'ready'|'unavailable'|'error', message,
current:null|{name,path,bundleId?}}` e `desktop:{trayAvailable:boolean}`.
Monitor recebe somente dono do aplicativo em foco; dispensa título e URL,
ignora o próprio processo. Ativado apenas com autoSwitchLayers. Camada associada
vence durante o foco; ao sair para app sem regra, retorna à última camada manual.
Troca manual dura até próxima mudança de aplicativo. Durante edição não troca a
camada, aplicando contexto pendente ao sair. Pausa nunca é removida pela automação.
Conflitos de associação são rejeitados na validação. Falha de detecção mantém
controle manual e fica explícita na UI. Wayland informa indisponibilidade.

Tray oferece abrir janela, ativar/pausar, camada direta, desligar rastreio e sair.
Fechar continua encerrando por padrão; closeToTray é opt-in e só oculta janela
quando há tray funcional, preservando a proteção de rascunhos. Sair sempre encerra
monitor, hooks e atalhos. Menu/tooltip refletem alterações do motor.

Aceite: fluxos reais Electron, persistência legada, conflitos e defaults, nenhuma
execução durante prévia, token/TTL, camadas automáticas e retorno manual, tray e
fechamento com rascunhos; builds nos três OS e inspeção visual Linux claro/escuro.
Mocks somente nas bordas nativas dos testes unitários; produção usa APIs reais.

## Correções autorizadas: auditoria de plataformas (20/10/2026)

Autorização: “Corrija tudo”. Escopo: A01–A08 do relatório de plataformas.
Configuração normalizada usa limite de 256 KiB em JSON compacto; leitura/importação
aceitam JSON formatado legado até 2 MiB, validando depois o limite canônico.
Persistência e exportação usam a mesma representação canônica. Exportações são
atômicas e não truncam arquivos protegidos por aliases ou hardlinks.
Cooldown pertence à ação e à camada de origem, permanece após trocas de camada;
pausar nunca é bloqueado pelo cooldown das ações. Retomar pelo atalho usa debounce
próprio de 400 ms após a última alternância do controle. Detectores nativos têm prazo e
cancelamento dos processos auxiliares. Ocultar exige tray disponível no momento
do fechamento, inclusive após confirmar rascunhos; perda do host restaura a janela.

State ganha `configRevision` e `stateRevision` monotônicos por sessão. A primeira
avança após salvar com sucesso um conteúdo normalizado diferente; a segunda
avança em cada publicação do motor. Salvar conteúdo idêntico continua persistindo.
APIs preload continuam entregando
State completo. Main pode omitir config em notificações/respostas quando a revisão
não mudou; preload recompõe o estado usando a configuração da mesma revisão.
Revisões antigas não substituem configurações recentes. Engine mantém snapshots
independentes da configuração interna. Renderer usa revisão em vez de serializar a
configuração e só constrói menus de ações quando abertos.

Aceite: regressões dos oito achados, testes e build locais, comparação de performance
no mesmo host e CI Windows/macOS/Linux. Limitações de assinatura, hardware e eventos
físicos permanecem explícitas. Cadastro de fluxo recebe recomendação de UX; redesign
completo não integra estas correções.

## Expansão autorizada: momentos da tecla e editor compacto

Autorização: “Quero poder configurar também ação para quando pressionar a tecla,
quando a tecla estiver pressionada e quando soltar a tecla ... E siga com a proposta”.

Binding v1 ganha `trigger: 'press'|'hold'|'release'` (ausente = press),
`repeatMs` somente em hold, inteiro de 100 a 60000 ms, padrão 400.
`keyCode` opcional em press e obrigatório em hold/release contém o código físico
DOM capturado pelo formulário (ex.: KeyA); não é texto digitado. O atalho mantém
seu rótulo lógico e modificadores. Na mesma camada, a mesma combinação pode ter
uma ação por momento, com códigos físicos consistentes. Duplicatas do mesmo
momento e atalhos reservados continuam rejeitados. Press legado permanece válido.

Press dispara uma vez por gesto nos grupos que usam eventos de tecla; hold
começa após repeatMs e repete sem sobrepor execuções; release dispara uma vez
na soltura real do gesto iniciado nessa camada. Modificadores precisam continuar
pressionados; soltá-los encerra o gesto. Pausa, edição, troca de camada/config,
perda do hook, bloqueio/suspensão da sessão e saída cancelam todos os gestos e
repetições, sem gerar ações de soltura artificiais. Não aplicar ações ao sair da
edição se a tecla já estava pressionada. Execuções iniciadas não são desfeitas.

Um worker de entrada compartilhado atende rastreio e gatilhos de tecla de forma
independente. Começa somente por ativação explícita de ações que precisem dele
ou do rastreio. Desligar o rastreio não desliga os gatilhos ativos, e ativar gatilhos
não liga a visualização. Worker encaminha somente posições, direção e modificadores;
nenhum texto/tecla capturada é salvo em histórico. Registro global continua
verificando conflitos e preservando pausa. Gatilhos hold/release só executam com
hook global disponível: Wayland e falta de permissão exibem indisponibilidade,
sem fingir suporte local nem executar por temporizador sem keyup real.
Grupos dependentes do hook não tomam o atalho de outros aplicativos enquanto
a entrada global estiver indisponível; os controles globais de pausa continuam.
Após a primeira ativação, o hook observa solturas também durante pausa/edição
enquanto existirem gatilhos habilitados desse tipo, para não reinterpretar uma
tecla mantida como um gesto novo ao retomar. Bloquear/suspender o SO também pausa
as ações; retomar exige ativação explícita. O intervalo hold é próprio e a próxima
execução só é agendada depois da anterior terminar. Soltar um modificador encerra
o gesto sem disparar a ação de soltura da tecla principal.

State ganha `input: {mode:'off'|'starting'|'global'|'unavailable', message:string}`
para informar a disponibilidade desses gatilhos. Novos campos passam por backup,
prévia, duplicação, histórico e exportação; teste manual continua uma execução
explícita, independente do momento, sem iniciar repetição.

UI adota a proposta action-flow-ux.md: drawer compacto, gatilho resumido no topo,
momento e intervalo em controles claros, lista numerada com resumos e uma etapa
aberta, rodapé fixo Salvar/Cancelar, validação abre a etapa afetada e preserva foco.
Prévia/teste continuam após salvar, com execução explícita e resultados por etapa.
Aceite: CRUD e persistência dos três momentos, combinações e mesma tecla em
momentos diferentes, repetição/soltura reais e cancelamentos, regressões de
rascunho/ordem/foco/temas/responsividade, hook real Linux e CI/build nos três OS.

## Expansão autorizada: delay inicial de Enquanto pressionada

Autorização: “Também configurar o delay de enquanto a tecla pressionada”.
Binding hold ganha `holdDelayMs`, inteiro de 0 a 60000 ms, opcional. Define somente
quanto esperar desde o keydown até a primeira execução. `repeatMs` continua sendo
o intervalo entre a conclusão de uma execução e a próxima tentativa. Ausência de
holdDelayMs usa repeatMs (padrão 400), preservando arquivos e comportamento antigos;
não materializar esse campo ausente na normalização. Press/release não usam o campo.
Soltar/cancelar antes do delay impede a execução pendente, inclusive delay zero
agendado. Não há catch-up nem sobreposição. O formulário separa “Delay inicial
(ms)” e “Repetir a cada (ms)”, mostra ambos no resumo, mantém zero e preserva valores
na edição/duplicação/backup/reload. Histórico/exportação levam holdDelayMs efetivo;
teste manual continua uma execução sem aguardar delay ou iniciar loop.
Aceite: validação dos limites e legado, delay diferente do intervalo, zero,
cancelamento antes da primeira execução, persistência/duplicação na UI e gates
existentes de eventos nativos/temas/sistemas operacionais.

## Expansão autorizada: intervalo entre etapas da sequência

Autorização: “Adicione também a opção de configurar um delay entre as etapas de
uma sequência de ações”. Action sequence ganha `stepDelayMs`, opcional, inteiro
entre 0 e 60000 ms. Ausente equivale a zero e permanece ausente ao normalizar,
preservando arquivos e limites antigos. O intervalo é único para a sequência.
Aplica-se depois da conclusão bem-sucedida de uma etapa e antes de iniciar a
próxima, sem espera antes da primeira, após a última ou após falha. Uma sequência
com uma etapa não espera. Zero não acrescenta espera. Não bloqueia o event loop.

Preparação/prévia congela esse valor junto das etapas, sem I/O. Execução por token
usa o valor congelado. Sequência mantém a vaga de execução durante as esperas;
duração total inclui o tempo de espera, duração de cada etapa mede só a etapa.
Histórico/exportação incluem stepDelayMs efetivo; logs não recebem dados privados.
Pausa mantém a política existente: impede novos disparos, sem desfazer/cancelar
uma sequência já iniciada. Sair encerra o aplicativo e seus temporizadores.

UI: campo “Delay entre etapas (ms)” na configuração da sequência, de 0 a 60000,
com ajuda “Após cada etapa terminar, antes da próxima. Zero executa sem espera.”
A edição, duplicação, mudança de tipo, reordenação, salvamento/importação e reload
preservam o valor. Resumo/prévia informam o intervalo. Teste manual respeita o
delay da sequência; ignora somente o delay inicial do momento da tecla.
Aceite: legado/limites/zero, ordem e tempos reais sem espera extra, falha parcial,
prévia congelada, persistência/rascunhos/duplicação/UI em ambos os temas e gates
existentes dos três sistemas.

## Expansão autorizada: preparação para produção

Autorização: implementar todas as melhorias recomendadas, adicionar Mac Intel,
fazer commit e enviar à main. Status accepted; política de mocks acima mantida.

- Persistência: último backup válido local, protegido como a configuração atual;
  gravações atômicas e serializadas preservam a versão anterior. Configuração
  inválida nunca é sobrescrita silenciosamente. Startup oferece restauração ou
  importação por diálogo nativo, preservando o arquivo com problema. Restaurar
  pela interface exige confirmação e deixa ações pausadas. Backup automático
  não contém credenciais em texto aberto.
- Credenciais: proteção nativa do SO via safeStorage para configuração com
  headers HTTP, incluindo etapas de sequência. Envelope criptografado local
  mantém config v1 em memória. Sem provedor seguro, nenhuma nova gravação de
  headers sensíveis em texto aberto é permitida. Legado existente é preservado,
  com condição de migração explícita; migração somente após criptografia segura
  disponível. Não usar fallback basic_text nem chave fixa. Exportação portátil
  remove headers HTTP por padrão, inclusive nas sequências; importação exige
  reinserir credenciais. Runtime/previews mantêm semântica atual.
- State.storage: {encryptionAvailable:boolean, protection:'encrypted'|'plain'|
  'legacy'|'unavailable', backupAvailable:boolean, message:string}; sem segredos.
- Execuções: state.running array, máximo quatro, com bindingId, layerId, name,
  key, startedAt (ISO), stepIndex, stepCount e phase:'running'|'waiting'|
  'cancelling'. Sem conteúdo de etapas. cancelExecution(bindingId) e
  cancelAllExecutions() retornam State. Cancelamento aborta espera/HTTP e impede
  próximas etapas; não desfaz efeitos concluídos nem fecha aplicativos abertos.
  Pausar conserva política existente; cancelAll também pausa e cancela gestos
  para não reagendar hold. Encerrar aborta execuções pendentes. Resultado
  cancelado usa status 'cancelled', distinto de erro e sucesso, sanitizado.
- restoreBackup() retorna State após confirmação nativa; exportDiagnostics()
  salva JSON somente por escolha explícita e retorna void. Sem telemetria.
  Diagnóstico contém versões, SO/arquitetura, capacidades, contagens e tempos;
  nunca config, headers, corpo HTTP, URL, caminhos pessoais, nomes de camadas,
  ações/aplicativos, mensagens livres ou teclas rastreadas. Exportação usa a
  proteção de arquivos internos existente. UI mostra proteção, recuperação,
  execuções atuais/cancelar e diagnóstico em Configurações/Histórico.
- Distribuição: CI nativo Windows x64, Linux x64, macOS ARM64 e macOS x64;
  pacotes com arquitetura no nome. Workflow de release manual gera artefatos,
  checksums e release em rascunho somente após validação de versão e assinatura.
  Windows exige certificado; macOS assinatura Developer ID, hardened runtime e
  notarização. Segredos externos ausentes bloqueiam release pública, não testes
  e artifacts de desenvolvimento. Não publicar release nem comprar certificados.
- Provas: regressões de criptografia/indisponibilidade/legado/exportação,
  backup/restauração/falha parcial, cancelamento em espera/HTTP/encerramento,
  diagnóstico sem dados privados, UI completa e sondas reais dos quatro jobs.
  Adicionar teste de estabilidade limitado e reproduzível e roteiro de QA do
  app instalado, atualização/retorno, permissões e hardware por SO. Não declarar
  hardware, assinatura ou longa duração certificados sem execução/evidência.
