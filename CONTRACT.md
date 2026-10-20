# Contrato interno

Status: accepted — escopo autorizado pelo usuário em “Faça tudo”.

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
