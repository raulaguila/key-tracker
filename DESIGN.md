# Design do Keyboard Tracker

## Cena e direção

Uma pessoa configura seus atalhos na mesa de trabalho, durante o dia, alternando
entre o aplicativo e seus programas usuais. Temas claro e escuro permitem conferir
nomes, teclas e resultados conforme a iluminação. Interface de ferramenta, em pt-BR,
com uma família de fontes do sistema e hierarquia compacta.

Estratégia **restrained**: branco puro no conteúdo, neutros de baixa saturação na
navegação e rosa nos controles principais e na seleção. No tema escuro, superfícies
ganham níveis de luminosidade e o rosa fica mais claro para manter contraste.
Âncora fornecida pelo script Impeccable: `oklch(0.570 0.158 353.3)`; a cor de ação
foi escurecida para `oklch(0.48 0.16 353.3)` para texto branco legível. Todas as cores
estão em tokens OKLCH. Verde comunica sucesso; vermelho, erro; amarelo, conflito.

## Estrutura

- Navegação lateral recolhível: Camadas, Rastreio, Histórico e Configurações.
  O controle no rodapé mantém o foco e lembra a preferência local entre sessões;
  a preferência visual não faz parte da configuração exportada. Recolhida, usa
  52 px, mantém nomes acessíveis, seleção e dicas por hover/foco (Escape as fecha).
  Instalações novas começam recolhidas; preferências existentes são preservadas.
- Barra superior de 48 px com estado e pausa. Camada em uso, atalhos e plataforma
  ficam na barra inferior compacta. Durante edição, o rodapé informa a suspensão.
- Camadas usam navegação própria e painel de ações. “Em uso” identifica a camada
  dos atalhos; “Visualizando” identifica outra camada aberta para configuração.
  Escolher uma camada para editar não muda a camada em uso.
- Ações usam tabela com linhas a partir de 44 px, controles de 30–32 px e título
  de 18 px. Criação/edição de ações e camadas abre um drawer modal sobreposto de
  até 480 px. A tabela mantém a largura e a rolagem; o fundo fica inerte e escurecido.
  Cabeçalho e salvamento permanecem visíveis durante a rolagem do formulário.
  Nome/tecla precedem a ação. Parâmetros e headers HTTP usam pares nome/valor em
  uma seção expansível; rascunhos são preservados ao alternar o tipo de ação.
- Ações destrutivas e descarte de alterações usam um diálogo nativo HTML com foco
  inicial na opção de continuar/cancelar. Navegação e fechamento protegem rascunhos.
- Escape, botão de fechar e clique no fundo fecham o drawer, com confirmação se
  houver alterações. Escape durante a captura de atalho cancela primeiro a captura.
  O foco começa no nome, fica contido no drawer e retorna ao controle de origem.
- Configurações → Aparência oferece Claro, Escuro e Seguir o sistema. A seleção
  aplica na hora, persiste localmente e não faz parte da configuração exportada.
  O tema salvo é lido antes do CSS; mudanças do sistema só afetam a opção Sistema.
- Testes têm estado de execução, resultado inline e confirmação visível. Falhas
  retornadas pelo motor são exibidas como erro, mesmo quando a chamada IPC resolve.
- Busca de ações por nome/tecla/tipo e busca de eventos reduzem a necessidade de
  percorrer listas. A ação principal do painel é criar uma ação; remover é terciário.
- O painel de ações é aberto, sem cartão externo ou numeração decorativa de
  camadas. Títulos e espaços organizam a informação; divisores separam ações.
  Ajuda de uso, privacidade, locais de arquivos e permissões ficam em seções
  expansíveis. Estado, camada em uso, avisos e resultados continuam visíveis.
- Rastreio é opt-in e independente do motor de ações. Teclas simultâneas são
  destacadas por código físico e chips textuais. O modo global/local aparece antes
  do teclado. Layout automático usa as legendas disponíveis no Chromium; BR ABNT2,
  US ANSI, PT ISO, FR AZERTY e DE QWERTZ também podem ser escolhidos manualmente.
  Formato completo, TKL e compacto, além de correção do padrão físico, são
  preferências locais separadas das ações. Indisponibilidade automática é explícita.
- A página aberta fora do Electron explica que o aplicativo desktop é necessário;
  não simula captura, persistência ou execução.

## Acessibilidade e adaptação

HTML semântico, nomes acessíveis, labels explícitas, estados e feedback textual,
foco visível, link para pular a navegação e respeito a movimento reduzido.
Inputs usam controles nativos. Texto de usuário é inserido como texto, nunca HTML.
O foco em campos de texto suspende ações por `setEditing`; a edição de uma
camada/ação mantém a suspensão enquanto o formulário está aberto. A barra de estado
permanece visível ao rolar e distingue pausa, edição e digitação. A interface usa uma
família única de ícones SVG e representação de teclas adaptada ao SO.

Camadas usam uma coluna de 176 px (144 px em janelas intermediárias); abaixo de
580 px ficam em uma faixa acima da tabela. A navegação continua lateral e
recolhível. O teclado usa teclas de 32 px em uma região com rolagem própria.
Em ponteiros de toque, controles crescem para 44 px. Botões, formulários e textos
longos quebram linhas. Avisos ficam afastados da área principal de salvamento. Não há
dependência de fontes externas, bibliotecas ou scripts inline.

## Limites

A leitura de layout informa legendas, não identifica o teclado conectado. Os
formatos físicos são referências ajustáveis. Variantes de fabricantes, Shift/AltGr
e IMEs não são integralmente representados. Teclas internacionais podem não ser
emitidas pelo hook em todos os sistemas. Os códigos recebidos continuam aparecendo
no indicador textual de teclas pressionadas. Captura global
e execução dependem da integração nativa e das permissões do sistema, informadas
pelo estado vindo do processo principal.
