# Arquitetura

[Documentação](docs/README.md) · [Contrato interno](CONTRACT.md)

## Decisão

Um processo desktop Electron, um renderer HTML/CSS/JS sem framework e um worker
nativo de captura. No Wayland, há um serviço Linux opcional autorizado pelo Polkit
e vinculado à sessão pelo logind. Sem servidor HTTP, banco, conta ou dependência de nuvem.
Electron permite distribuir a mesma aplicação em Windows, macOS e Linux. O custo
é um pacote maior; cada instalador precisa ser compilado e validado em seu SO.
O módulo de captura utiliza binários N-API pré-compilados por SO/arquitetura;
`npmRebuild: false` evita recompilar uma dependência com ABI estável. O pacote
inclui os prebuilds e os extrai do ASAR.

## Responsabilidades

- `app/main.cjs`: janela, ciclo de vida, diálogos nativos, autorização IPC.
- `app/preload.cjs`: métodos explícitos, sem expor Node ou IPC arbitrário.
- `app/config.cjs`: limites, esquema, normalização e colisões de atalhos.
- `app/engine.cjs`: camada ativa, pausa, edição, assinaturas de teclas e execuções.
- `app/passive-shortcuts.cjs`: combinações observadas em memória, sem reserva de teclas no SO.
- `app/actions.cjs`: preparação pura e execução das ações simples e sequências.
- `app/desktop-actions.cjs`: borda nativa para clipboard, abertura de destino e
  notificações; injetada pelo main, sem exposição arbitrária no preload.
- `app/storage.cjs`: configuração atômica, backup diferido, cofre, flush de filas e log serializado com rotação.
- `app/shutdown.cjs`: cancela serviços e aguarda execuções e operações aceitas; prazo global de espera.
- `app/state-delivery.cjs`: agrupa progresso visual em até 16 ms e retém um estado enquanto a janela está oculta.
- `app/safe-export.cjs`: identidade de arquivos por caminho canônico/inode, compartilhada
  por exportações e pela proteção de destinos das ações de arquivo.
- `app/key-gestures.cjs`: pressionar/manter/soltar, delays e cancelamento de gestos.
- `app/tracking.cjs`: opt-in de rastreio, permissões e fallback local.
- `app/wayland-input.cjs`: cliente sem privilégios, configuração filtrada e ciclo de vida do backend Linux.
- `app/linux-input/client.py`: ponte GIO/D-Bus e stream privado; Python isolado, sem executar ações.
- `linux/dobra-input/`: serviço do sistema, Polkit, logind, libudev/libevdev e payload do instalador.
- `app/tracker-worker.cjs`: libuiohook em utility process, isolando falha nativa.
- `app/native-keycodes.cjs`: normalização dos códigos físicos, inclusive numpad
  sem NumLock e constantes internacionais conhecidas do libuiohook.
- `app/renderer/`: interface e renderização de códigos físicos do teclado.
- `app/renderer/ui.js`: controles, ícones, campos, diálogos e feedback compartilhados.
- `app/renderer/action-editor.js`: campos de cada tipo de ação e editor de etapas;
  rascunhos de tipos alternados permanecem em DOM desconectado, sem JSON manual.
- `app/renderer/appearance.js`: bootstrap antes do CSS, preferência visual
  claro/escuro/sistema e acompanhamento do esquema de cores do sistema.
- `app/renderer/keyboard.js`: geometrias de referência ANSI/ISO/ABNT2 e tamanhos.
- `app/renderer/keyboard-layouts.mjs`: legendas manuais, resolução do mapa do
  sistema, normalização das preferências e leitura com timeout/fallback.

Contrato de dados e API em `CONTRACT.md`. O processo principal é o único dono
da configuração. Escritas de configuração são serializadas. Configuração é
validada antes de persistir e antes de atualizar o motor; erro de disco preserva
o estado anterior. Camada ativa é estado da sessão; inicia na primeira camada.

## Atalhos

O observador nativo alimenta `PassiveShortcuts` e `KeyGestures`. Não há uso de
`globalShortcut`, supressão ou reinjeção: o aplicativo em foco recebe as teclas.
As assinaturas em memória cobrem a camada ativa e os controles globais. Ao editar,
ações e alternância são retiradas; a pausa permanece. Na primeira abertura o hook
não inicia sem ativação explícita de ações ou rastreio. Depois da primeira ativação,
o controle de pausa/retomada mantém o observador até encerrar o aplicativo.
Sem entrada global, ações por tecla e controles de teclado não executam; a
interface informa a restrição. Capturas usam `keyCode`, inclusive ao pressionar;
combinações antigas/digitadas sem esse campo usam posições de referência US.

O autorepeat não duplica pressionar; repetir exige Enquanto pressionada. Intervalo
mínimo configurável e limite de uma execução por ação em voo evitam disparos excessivos.
Há até quatro ações simultâneas. Nenhuma fila ilimitada ou retry automático.
Uma sequência ocupa uma vaga e executa até dez etapas simples em ordem. Na
primeira falha interrompe as próximas, sem desfazer efeitos anteriores. O motor
congela a prévia completa; headers de etapas HTTP também são mascarados. Eventos
guardam só metadados de resultado por etapa, sem textos privados ou payload HTTP.
Um HTTP lento não bloqueia o comando de pausa. Pausar impede novos disparos;
ações que já começaram continuam, salvo cancelamento explícito.

## Rastreio

Controles independentes do motor. Worker transmite somente down/up e código da
tecla por IPC; eventos de repetição são descartados. Nenhum desses eventos vai
ao histórico ou ao disco. O worker atende à demanda de rastreio e de gestos:
desligar a visualização não o encerra após a ativação das ações, inclusive só de pressionar.
Encerrar o aplicativo termina o worker. Falha nativa oferece
modo local em vez de derrubar a janela. No Wayland, habilitar a integração Linux
solicita autorização explicitamente. Não usa atalhos exclusivos do portal.

O serviço verifica o UID real do proprietário D-Bus, sessão local ativa e seat
antes/depois da autorização Polkit. Entrega um socket Unix privado e limitado,
nunca descritores dos dispositivos. Só abre teclados evdev do seat autorizado,
em leitura e sem grab; sem Rastreio, filtra posições configuradas/modificadores.
Não interpreta Unicode nem persiste eventos. Bloqueio, suspensão, troca de sessão,
perda do cliente/heartbeat e fila cheia revogam a sessão e fecham dispositivos.
Snapshots sincronizam teclas mantidas sem fabricar solturas ou reexecutar ações.
Falha pausa o motor; não reconecta nem autentica silenciosamente. O `.deb` inclui
o componente com arquivos root:root 0644, dependências e ativação D-Bus/systemd;
AppImage precisa do componente instalado. [Decisão](docs/decisions/wayland-input.md)
e [operação/QA](docs/WAYLAND.md).

Legendas automáticas vêm de `navigator.keyboard.getLayoutMap()` no renderer;
não alteram atalhos registrados. A leitura tem timeout de 2 s e proteção contra
respostas atrasadas após uma escolha manual. Ao recuperar foco, a prévia pode ser
atualizada sem reconstruir os formulários nem perder foco ou rolagem. O evento
`layoutchange` é usado somente quando exposto pelo ambiente. A API não identifica
o formato físico nem garante a fonte ativa de outro aplicativo/IME.
Layout, tamanho, geometria e sidebar usam armazenamento visual local; não mudam o
contrato JSON das ações e o mapa do sistema não é persistido. As legendas da
captura global são resolvidas por código físico; a captura local usa o evento do SO.

## I/O e erros

HTTP tem timeout de 10 s e não segue redirects nem faz retries. Headers/corpo não
são registrados. Query/corpo/mensagem/conteúdo aceitam variáveis documentadas.
Arquivos usam `wx` para criar sem sobrescrever; acrescentar recusa symlink
observado antes da escrita. Não é uma sandbox contra alterações concorrentes
por outros processos no diretório escolhido. Nomes são compatíveis com os três
SOs e não aceitam caminhos. A pasta de dados do app e aliases de arquivos internos
são recusados na prévia e na execução, incluindo sequências; a identidade considera
symlinks/junctions e hardlinks. Isso não transforma o diretório externo escolhido
em uma sandbox contra mudanças concorrentes por outros processos. Configurações com headers HTTP são criptografadas por
safeStorage assíncrono, inclusive backups. Consulta de disponibilidade, criptografia
e descriptografia têm limite de 5 s por operação. Respostas tardias não persistem
dados; falha libera a fila e preserva os arquivos. O estado informa indisponibilidade
ou timeout do cofre. Provider seguro ausente recusa novas
gravações sensíveis; legado preservado sinaliza migração. Exportação portátil
redige headers. Campos comuns de corpo/query/URL não substituem o cofre quando
não há headers. Arquivos usam permissões restritas onde o SO as aplica.

Histórico em memória: até 100 resultados/eventos da sessão. Resultados de ações
e mensagens de log legadas são salvos em JSONL; 1 MiB por arquivo, com uma cópia
rotacionada. Falhas de execução e de persistência aparecem separadamente na UI.
Sem telemetria. Configuração inválida no startup oferece recuperação explícita
por backup/importação, com cópia preservada. Writes serializados sincronizam um
arquivo temporário antes do rename e mantêm o último backup válido. Diagnóstico
usa allowlist de versões, capacidades, contagens e tempos, sem copiar State.

Cada execução tem AbortController e metadados de progresso, até quatro vagas.
Cancelamento aborta intervalos/HTTP e impede próxima etapa; mantém a vaga até uma
operação nativa em andamento terminar. Cancelar todas também pausa e cancela
gestos; dispose aborta. Histórico distingue cancelled e efeitos já concluídos
permanecem. Publicação de progresso acontece nas transições, sem timer de polling.

Renderer sandboxed com contextIsolation, CSP self e connect-src none. Somente
janela/frame local esperado pode chamar IPC. Navegação externa é bloqueada.
Fechar a janela encerra captura e registros; uma segunda instância foca a atual.

Rascunhos são estado transitório do renderer. O formulário compara seus valores
com o estado inicial; navegação e fechamento pedem confirmação antes do descarte.
No fechamento, o renderer cancela `beforeunload` e só abre o diálogo na tarefa
seguinte, após o Electron concluir o cancelamento. Confirmar libera o fechamento.
Headers/query em pares são convertidos ao mesmo contrato de objetos de strings.
O teste manual distingue resultado de execução de sucesso no transporte IPC.

Os formulários de ações/camadas ficam em um `<dialog>` modal usado como drawer
na top layer. A largura da tabela não muda. O navegador contém o foco; `cancel`
é interceptado para encaminhar Escape à proteção de rascunhos. O backdrop exige
pointerdown e pointerup fora do drawer para evitar fechamento durante arraste.
Formulários continuam dentro do main para preservar a detecção de alterações.
Ao salvar/fechar, foco e rolagem voltam ao contexto de origem. Avisos assíncronos
compartilham a top layer e são devolvidos ao body antes de remover o drawer.
Tema usa somente armazenamento visual local; não altera o contrato das ações.

## Entrega e prova

Node 24 para scripts/testes. `npm test` verifica esquema, persistência, troca de
camadas, pausa/retomada, conflitos, concorrência, arquivos, log e HTTP real em
loopback. Testes de hook nativo e teclas reais foram exercitados em Linux/X11
com Xvfb; não são substitutos para QA de hardware em Windows/macOS/Wayland.
Workflow `Desktop`: testes nos quatro destinos (Windows x64, Linux x64, macOS
ARM64 e Intel x64) em push/PR; instaladores em push
na main ou `workflow_dispatch`, sem publicação automática. Assinatura/notarização requer
certificados do distribuidor e deve ser configurada antes de uma release pública.

## Produtividade e contexto por aplicativo

Config v1 aceita campos adicionais opcionais: bindings habilitados por padrão,
applications vazio por camada, autoSwitchLayers e closeToTray desligados. Arquivos
legados continuam válidos. Duplicação é rascunho no renderer; novos IDs são gerados
para cada item e associações de aplicativo não são copiadas. A validação central
continua rejeitando atalhos e identificadores de aplicativos conflitantes.

`keyboard-bindings.mjs` converte legendas em atalhos lógicos no editor visual,
sem confundir os códigos físicos usados pelo rastreio. A tabela e o teclado são
visões da mesma configuração. A grade interativa tem foco itinerante e navegação
por setas; campos/teclado em foco suspendem as ações globais. Atualizações de
estado não recriam a tecla entre pointerdown e pointerup.

`prepareAction` é a resolução pura compartilhada entre execução e prévia.
O Engine guarda até dez prévias, por cinco minutos, com valores congelados,
vinculadas à ação e consumidas uma vez. A prévia consulta metadados dos destinos
sem escrever neles; mudança da configuração durante essa consulta recusa o token.
Salvar configuração invalida os tokens;
erro de persistência preserva configuração e tokens anteriores. O renderer recebe
uma cópia com todos os valores de headers mascarados. Não há I/O de ação na
prévia. Os resultados incluem bindingId, duração e status HTTP, sem corpo/header.

`application-monitor.cjs` inicia `application-reader.cjs` somente após opt-in.
O worker consulta get-windows e publica apenas owner (nome/caminho/bundleId).
O polling de 1 s não sobrepõe chamadas e tem deadline de 2,5 s; falha encerra o
worker e resultados atrasados são descartados. Não há histórico de aplicativos.
O próprio processo é ignorado, preservando o contexto anterior durante edição.
Windows/macOS usam integração nativa; macOS desativa solicitações de acesso a
URL/título e executa o helper Swift do diretório físico app.asar.unpacked.
Linux/X11 usa xprop/xwininfo; Wayland retorna indisponibilidade explícita.

O Engine escolhe primeiro identidade de caminho/bundle/executável, depois nome
exato. Preserva a última camada manual como fallback e adia contexto durante
edição. Troca manual só cede ao próximo aplicativo, sem reativar o motor.

`desktop-tray.cjs` mantém menus, ícone PNG e tooltip sincronizados com o motor.
No Linux, `trayHostAvailable` consulta DBus com deadline de 1,5 s; ausência de
host StatusNotifier/utility impede ocultação. `window-lifecycle.cjs` intercepta
fechar/sair e pede ao renderer a mesma confirmação de rascunhos antes de concluir.
Confirmar ocultação encerra edição e mantém a janela recuperável; sair encerra
monitor, worker de rastreio, tray e atalhos. Falha de render libera encerramento.

Dependência get-windows é fixada em 9.3.0 e extraída do ASAR junto aos helpers.
O lockfile e o override de tar são verificados pelo workflow de segurança.
Resultados de vulnerabilidades são datados; consulte a execução atual e não
interprete um relatório antigo como garantia do estado das dependências.
Não há shell arbitrário ou serviço remoto próprio.


## Inicialização, estado e parada

A janela local abre com skeleton, texto de carregamento e ações/navegação
indisponíveis antes de consultar o cofre. `getState` aguarda a preparação;
nenhuma ação é habilitada nesse intervalo. Falhas mantêm a recuperação explícita.
É possível fechar durante a preparação; verificações após awaits impedem que
serviços sejam criados depois da solicitação de saída. Pedidos de fechamento
recebidos pelo preload antes da assinatura da UI são entregues posteriormente.

O caminho normal carrega a configuração principal antes da checagem de backup.
`storage.backupChecking` informa a verificação diferida, serializada com writes;
restauração fica indisponível até terminar. A recuperação de configuração inválida
continua consultando o backup antes de oferecer a escolha.

`Engine.state()` mantém cópia independente. Publicações internas reutilizam uma
cópia profundamente imutável da configuração por `configRevision`, clonando só o
estado transitório. O preload continua entregando State completo ao renderer.
Progresso visual é agrupado pelo transporte; mudanças de ativação/edição/parada,
camada, configuração, início/fim de execução e novos eventos são enviadas de
imediato quando a janela está visível. Oculta, conserva-se apenas o último estado,
sincronizado ao mostrar/restaurar. Eventos de tecla seguem imediatos: o renderer
mantém o mapa transitório, mas só redesenha realces quando visível. Input, pausa e
cancelamento do motor não dependem do agendamento visual.

`requestStop` bloqueia novos disparos e reativação até `whenIdle`, inclusive os
registros finais das ações. O State usa `stopping` e a UI mostra “Parando…”. Pausar
continua imediato e não implica cancelar efeitos já iniciados.

Na saída, o coordenador cancela ações/hook/serviços, aguarda configuração e
exportações já aceitas pelo IPC, execuções e suas filas de histórico/configuração.
Novas operações e enfileiramentos posteriores à saída são recusados. Há um prazo
global de espera de 10 s; ao expirar, o diálogo oferece continuar aguardando ou
sair explicitamente com pendências. Não há promessa de rollback de efeitos
externos nem cancelamento de uma escrita nativa já iniciada.

Salvar configuração canônica idêntica não troca o inode nem gira o backup. O
arquivo atual continua sendo validado; formatos antigos/indentados e migração de
headers ainda passam pela gravação segura, sem atalhos de criptografia.
