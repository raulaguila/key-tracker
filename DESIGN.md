# Design do Dobra

[Documentação](docs/README.md) · [Marca](docs/BRAND.md) · [Produto](PRODUCT.md)

## Cena e direção

Uma pessoa configura seus atalhos na mesa de trabalho, durante o dia, alternando
entre o aplicativo e seus programas usuais. Temas claro e escuro permitem conferir
nomes, teclas e resultados conforme a iluminação. Interface de ferramenta, em pt-BR,
com uma família de fontes do sistema e hierarquia compacta.

Direção inspirada na interface do HabboAssets: superfícies azul-escuras, destaque
ciano e painéis compactos com contornos discretos. O tema claro usa branco e
neutros frios com ciano mais escuro para contraste. A preferência claro/escuro/sistema
permanece local; a nova direção não força outro tema. A marca mantém o D construído
como uma superfície dobrada e o wordmark em minúsculas.

A interface usa tokens OKLCH: ação principal `oklch(.43 .085 225)` no claro e
`oklch(.78 .12 225)` no escuro. Superfícies escuras usam luminosidades .16/.195/.225
e hue 230; `--on-primary` define texto de botões e teclas pressionadas. Verde
comunica sucesso; vermelho, erro; âmbar, pausa/conflito; azul, suspensão.
Estado nunca depende da cor da marca. Ícone nativo e logos compartilham a paleta
azul/ciano da interface, com variantes adequadas para fundos claros e escuros.
O símbolo no menu usa `currentColor`, acompanhando o tema; ícone nativo e SVG
compartilham a geometria da dobra. Densidade, drawer e navegação seguem os mesmos tokens nos dois temas.

## Estrutura

- Navegação lateral recolhível: Camadas, Rastreio, Histórico e Configurações.
  O controle no rodapé mantém o foco e lembra a preferência local entre sessões;
  a preferência visual não faz parte da configuração exportada. Recolhida, usa
  52 px, mantém nomes acessíveis, seleção e dicas por hover/foco (Escape as fecha).
  Instalações novas começam recolhidas; preferências existentes são preservadas.
- Barra superior de 48 px com estado e pausa. Camada em uso, atalhos e plataforma
  ficam na barra inferior compacta. Durante edição, o rodapé informa a suspensão.
  Indicadores combinam texto, cor e formato: ativo em verde com círculo cheio,
  pausado em âmbar com duas barras e suspenso em azul com losango. Rastreio
  desligado usa círculo vazio neutro; captura local ou atalhos com restrições
  usam círculo vazio âmbar. Inicialização usa contorno pontilhado azul.
- Camadas usam navegação própria e painel de ações. “Em uso” identifica a camada
  dos atalhos; “Visualizando” identifica outra camada aberta para configuração.
  Escolher uma camada para editar não muda a camada em uso.
- Ações usam tabela com linhas de 52 px, controles de 30–32 px e título
  de 20 px. Criação/edição de ações e camadas abre um drawer modal sobreposto de
  até 480 px. A tabela mantém a largura e a rolagem; o fundo fica inerte e escurecido.
  Cabeçalho e salvamento permanecem visíveis durante a rolagem do formulário.
  Nome/tecla precedem a ação. Parâmetros e headers HTTP usam pares nome/valor em
  uma seção expansível; rascunhos são preservados ao alternar o tipo de ação.
- Ações destrutivas e descarte de alterações usam um diálogo nativo HTML com foco
  inicial na opção de continuar/cancelar. Navegação e fechamento protegem rascunhos.
  Confirmações compartilham as superfícies de cabeçalho/corpo/rodapé dos demais
  diálogos. Remoção usa ícone e ação vermelhos, inclusive no hover do menu.
- Escape, botão de fechar e clique no fundo fecham o drawer, com confirmação se
  houver alterações. Escape durante a captura de atalho cancela primeiro a captura.
  O foco começa no nome, fica contido no drawer e retorna ao controle de origem.
- Configurações → Aparência oferece Claro, Escuro e Seguir o sistema. A seleção
  aplica na hora, persiste localmente e não faz parte da configuração exportada.
  O tema salvo é lido antes do CSS; mudanças do sistema só afetam a opção Sistema.
  O botão de sol/lua no rodapé do menu alterna claro/escuro, acompanha o tema
  aplicado e sincroniza o seletor sem recriar formulários ou descartar rascunhos.
- Carregamento inicial mantém skeleton e mensagem de preparação, com navegação e ativação indisponíveis. “Parando…” usa o indicador azul de transição e bloqueia reativação até concluir.
- Testes têm estado de execução, resultado inline e confirmação visível. Falhas
  retornadas pelo motor são exibidas como erro, mesmo quando a chamada IPC resolve.
- Novas ações começam em Copiar texto; log legado permanece identificável.
  Sequências usam etapas expansíveis com ordem, adicionar/remover e mover, sem
  exigir JSON. Alternar o tipo preserva rascunhos e parâmetros incompletos.
- O resultado do teste aparece antes da prévia, com detalhes das etapas e falha
  parcial. O Histórico oferece os mesmos detalhes e exportação da sessão.
  Novos resultados reutilizam as linhas por evento, preservando foco e detalhes
  abertos. Se o evento focado sair do limite de 100 registros, o foco volta à busca.
- Busca de ações por nome/tecla/tipo e busca de eventos reduzem a necessidade de
  percorrer listas. A ação principal do painel é criar uma ação; remover é terciário.
- O painel de ações é aberto, sem cartão externo ou numeração decorativa de
  camadas. Títulos e espaços organizam a informação; divisores separam ações.
  A navegação das camadas usa superfície própria, seleção com contorno ciano e
  o seletor Tabela/Teclado tem formato segmentado. A tabela tem cabeçalho em
  superfície distinta e linhas de 52 px; os controles permanecem compactos.
  Ajuda de uso, privacidade, locais de arquivos e permissões ficam em seções
  expansíveis. Estado, camada em uso, avisos e resultados continuam visíveis.
- Rastreio é opt-in e independente do motor de ações. Teclas simultâneas são
  destacadas por código físico e chips com contorno. A combinação textual fica
  disponível para leitores de tela, sem duplicação visual. O modo global/local aparece antes
  do teclado. Layout automático usa as legendas disponíveis no Chromium; BR ABNT2,
  US ANSI, PT ISO, FR AZERTY e DE QWERTZ também podem ser escolhidos manualmente.
  Formato completo, TKL e compacto, além de correção do padrão físico, são
  preferências locais separadas das ações. Indisponibilidade automática é explícita.
- As quatro telas compartilham títulos, espaçamento e superfícies azul/ciano.
  Rastreio reúne as teclas pressionadas e o teclado na mesma moldura; layout,
  formato e ativação ficam na barra de controles. Histórico usa o mesmo seletor
  segmentado de Camadas, cabeçalho de tabela e rótulos com ícone para resultado;
  execuções em andamento e estados vazios têm painéis próprios.
  Em janelas estreitas, cada evento passa a ocupar uma linha completa com horário
  e resultado acima da mensagem, mantendo contexto e detalhes acessíveis.
- Configurações agrupa controles, permissões, aparência e dados em painéis,
  com duas colunas em janelas largas e uma em janelas menores. O salvamento tem
  rodapé em superfície distinta, e exportação/backup/diagnóstico têm divisores
  e ações explícitas. Expansíveis e rascunhos preservam os comportamentos existentes.
- A página aberta fora do Electron explica que o aplicativo desktop é necessário;
  não simula captura, persistência ou execução.

## Acessibilidade e adaptação

HTML semântico, nomes acessíveis, labels explícitas, estados e feedback textual,
foco visível, link para pular a navegação e respeito a movimento reduzido.
Inputs usam controles nativos. Texto de usuário é inserido como texto, nunca HTML.
Trocar de tela direciona o foco ao título, e o conteúdo principal tem o nome da
tela. Erros de formulário são associados ao campo sem remover sua dica original;
ao editar, somente a associação do erro é retirada. Diálogos de produtividade têm
títulos e descrições com identificadores únicos; fluxos encadeados retornam ao
controle que iniciou a sequência, inclusive após fechar biblioteca/importação.
O foco em campos de texto suspende ações por `setEditing`; a edição de uma
camada/ação mantém a suspensão enquanto o formulário está aberto. A barra de estado
permanece visível ao rolar e distingue pausa, edição e digitação. A interface usa uma
família única de ícones SVG e representação de teclas adaptada ao SO.

Camadas usam uma coluna de 176 px (144 px em janelas intermediárias); abaixo de
580 px ficam em uma faixa acima da tabela. A navegação continua lateral e
recolhível. O teclado usa teclas de 32 px em uma região com rolagem própria.
As linhas de digitação compartilham uma grade de 15 unidades, subdividida em
quartos, com intervalos de 4 px. O recorte do Enter ISO/ABNT2 acompanha essa
medida e mantém contorno completo junto à tecla `]`.
Em ponteiros de toque, controles e teclas interativas crescem para pelo menos
44 × 44 px. Botões de captura e todos os expansíveis têm altura mínima de 44 px;
permissões e detalhes de execução centralizam o texto nessa área. O teclado amplia
a grade e mantém sua rolagem própria; Enter ISO/ABNT2
e teclas altas do numérico acompanham a altura das linhas. Botões, formulários e textos
longos quebram linhas. Avisos ficam afastados da área principal de salvamento. Não há
dependência de fontes externas, bibliotecas ou scripts inline.

Em janelas estreitas, as ações usam nome em linha completa e combinação/controles
abaixo, evitando comprimir atalhos extensos em uma coluna. Checkboxes e radios
nativos usam o mesmo ciano das seleções. Superfícies de painel usam o token
`--radius-panel`. Texto e fundo de botões/teclas mudam juntos, sem interpolar
cores durante a troca de tema; bordas, drawers e controles de alternância mantêm
suas transições e respeitam movimento reduzido.
O painel rápido mantém a lista rolável na altura habitual. Com pouca altura,
inclusive na ampliação de 200%, o documento passa a rolar por inteiro, mantendo
atalhos e retorno ao aplicativo acessíveis sem comprimir a lista até zero.
O cabeçalho reorganiza seus controles em linhas sem comprimir o indicador do
motor, inclusive com a navegação expandida em janelas estreitas.

## Limites

A leitura de layout informa legendas, não identifica o teclado conectado. Os
formatos físicos são referências ajustáveis. Variantes de fabricantes, Shift/AltGr
e IMEs não são integralmente representados. Teclas internacionais podem não ser
emitidas pelo hook em todos os sistemas. Os códigos recebidos continuam aparecendo
no indicador textual de teclas pressionadas. Captura global
e execução dependem da integração nativa e das permissões do sistema, informadas
pelo estado vindo do processo principal.

## Produtividade

A tabela é a visão inicial. O seletor Tabela/Teclado reutiliza a geometria do
Rastreio como editor: clicar abre o mesmo drawer; combinações são escolhidas em
um seletor compacto. Teclas reservadas/sem acelerador compatível ficam indisponíveis,
e todas as ações continuam acessíveis na lista abaixo. Destaque na cor de ação do tema identifica
mapeamento ativo; contorno tracejado e texto identificam ação desativada.

Cada linha mantém Testar, Editar e Mais opções. O popover agrupa ativar/desativar,
duplicar e remover. Duplicação abre rascunho; ações pedem uma nova tecla e camadas
não herdam associações de aplicativo. O seletor de camada fica junto a “Em uso”
no rodapé; mudanças mostram feedback textual discreto.

Testar abre drawer de prévia, sem execução automática. Destino e conteúdo
resolvidos precedem o botão explícito Executar teste; resultado inclui duração,
status e erro. Headers ficam mascarados. O painel pode fechar durante execução,
e o resultado continua acessível no Histórico.

Associações de aplicativos ficam em seção expansível no drawer da camada.
Configurações concentra opt-in de troca automática e comportamento da bandeja,
com disponibilidade real e texto explicando o fallback manual. Mantêm a direção
visual, temas e densidade do aplicativo; não criam outra tela de administração.

## Produtividade progressiva

O primeiro uso tem um guia inline destacado em Camadas: Criar → Testar → Ativar → Confirmar,
com uma ação principal por etapa. As quatro etapas têm contornos e rótulos;
o passo atual usa ciano e os concluídos usam verde. O teclado e as combinações
usam relevo interno discreto, sem alterar as posições físicas nem depender de
imagens externas. O drawer distingue cabeçalho/atalho, formulário e rodapé de
salvamento por superfícies. A criação reutiliza o drawer, sugere um atalho
livre com modificadores e abre a prévia ao salvar, sem executar automaticamente.
Um teste bem-sucedido troca os controles de teste por Continuar para ativação.
A ativação seleciona a camada. A conclusão exige execução bem-sucedida pelo atalho
enquanto nenhuma janela do Dobra tem foco; teste manual não serve como confirmação.
Permissões, instalação e teclado desconectado têm recuperação dentro do guia,
sem perder a ação ou o teste ao reabrir. Autorizar mantém ações pausadas até ativar.
Agora não dispensa; Configurações permite retomar. O diagnóstico Verificar teclado
permanece disponível como apoio às permissões, sem substituir o teste da ação.

A barra principal mantém busca e biblioteca compactas. O painel rápido é uma
janela separada, com camada/status/atalhos e ação de voltar ao Dobra. Seu preload
não oferece execução. Paleta e assistente usam diálogo sobreposto, foco contido,
Escape e retorno ao invocador. O assistente é retomável, sem exigir um cadastro.

Biblioteca, busca, importação e assistente compartilham cabeçalho em superfície
distinta com ícone, contornos discretos e corpo em painel. Os modelos aparecem em
lista com ícones de finalidade e revisão explícita. A busca reúne nome/contexto e
combinação em cada resultado; hover/foco usam seleção ciano e o rodapé informa
setas, Enter e Escape. A lista continua limitada a 40 resultados por consulta.
O painel rápido reutiliza as teclas com relevo e os mesmos indicadores de estado
(texto, cor e formato). Cabeçalho, estado e rodapé ficam visíveis enquanto a lista
rola separadamente; o botão Abrir Dobra usa o destaque principal. Temas e foco
continuam sincronizados sem reconstruir linhas a cada atualização.

Importação separa origem, seleção/mescla e confirmação dos totais/conflitos. Nenhuma
prévia ativa ações. Selecionar a nova camada para editar não muda a camada em execução.
Condições, variáveis e espera por etapa ficam em opções avançadas do editor;
a lista principal continua legível para sequências simples. Estados de ignorada,
pendente, falha e cancelada têm texto explícito nos dois temas.

Desfazer/refazer afeta configuração e deixa isso expresso; campos de texto mantêm
seu histórico nativo. Escolha de teclado informa suporte real, origem ausente e
permissões sem sugerir que um layout visual identifica o dispositivo físico.
