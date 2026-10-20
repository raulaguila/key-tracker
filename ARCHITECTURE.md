# Arquitetura

## Decisão

Um processo desktop Electron, um renderer HTML/CSS/JS sem framework e um worker
nativo de captura. Sem servidor local, banco, conta ou dependência de nuvem.
Electron permite distribuir a mesma aplicação nos três sistemas pedidos. O custo
é um pacote maior; cada instalador precisa ser compilado e validado em seu SO.
O módulo de captura utiliza binários N-API pré-compilados por SO/arquitetura;
`npmRebuild: false` evita recompilar uma dependência com ABI estável. O pacote
inclui os prebuilds e os extrai do ASAR.

## Responsabilidades

- `app/main.cjs`: janela, ciclo de vida, diálogos nativos, autorização IPC.
- `app/preload.cjs`: métodos explícitos, sem expor Node ou IPC arbitrário.
- `app/config.cjs`: limites, esquema, normalização e colisões de atalhos.
- `app/engine.cjs`: camada ativa, pausa, edição, registros globais e execuções.
- `app/actions.cjs`: request HTTP, arquivo e mensagem no log.
- `app/storage.cjs`: configuração atômica e log serializado com rotação.
- `app/tracking.cjs`: opt-in de rastreio, permissões e fallback local.
- `app/tracker-worker.cjs`: libuiohook em utility process, isolando falha nativa.
- `app/native-keycodes.cjs`: normalização dos códigos físicos, inclusive numpad
  sem NumLock e constantes internacionais conhecidas do libuiohook.
- `app/renderer/`: interface e renderização de códigos físicos do teclado.
- `app/renderer/ui.js`: controles, ícones, campos, diálogos e feedback compartilhados.
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

`globalShortcut` registra somente as ações da camada ativa e os controles globais.
O callback consulta a camada corrente. Ao editar, ações e alternância são
retiradas; a pausa permanece. Na primeira abertura nada é registrado. Depois da
primeira ativação, o atalho de pausa permanece disponível para retomar. Falha ao
registrar a pausa impede ativação; outros conflitos são mostrados individualmente.

Não há promessa de bloquear toda repetição de hardware: intervalo mínimo
configurável e limite de uma execução por ação em voo evitam disparos excessivos.
Há até quatro ações simultâneas. Nenhuma fila ilimitada ou retry automático.
Um HTTP lento não bloqueia o comando de pausa. Pausar impede novos disparos;
ações que já começaram terminam normalmente.

## Rastreio

Controles independentes do motor. Worker transmite somente down/up e código da
tecla por IPC; eventos de repetição são descartados. Nenhum desses eventos vai
ao histórico ou ao disco. Encerrar/desligar termina o worker. Falha nativa oferece
modo local em vez de derrubar a janela. No Wayland o hook integral é evitado;
atalhos dependem do portal do compositor e do identificador desktop instalado.

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
SOs e não aceitam caminhos. Configuração pode conter tokens HTTP em texto local;
arquivos usam permissões restritas onde o SO as aplica.

Histórico em memória: até 100 resultados/eventos da sessão. Resultados de ações
e mensagens configuradas são salvos em JSONL; 1 MiB por arquivo, com uma cópia
rotacionada. Falhas de execução e de persistência aparecem separadamente na UI.
Sem telemetria. Configuração inválida no startup é preservada e reportada.

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
Workflow `Desktop`: testes nos três sistemas em push/PR; instaladores em push
na main ou `workflow_dispatch`, sem publicação automática. Assinatura/notarização requer
certificados do distribuidor e deve ser configurada antes de uma release pública.
