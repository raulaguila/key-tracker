# Design do Keyboard Tracker

## Cena e direção

Uma pessoa configura seus atalhos na mesa de trabalho, durante o dia, alternando
entre o aplicativo e seus programas usuais. Superfícies claras permitem conferir
nomes, teclas e resultados com pouco esforço. Interface de ferramenta, em pt-BR,
com uma família de fontes do sistema e hierarquia compacta.

Estratégia **restrained**: branco puro no conteúdo, neutros de baixa saturação na
navegação e um único rosa profundo nos controles principais e na seleção.
Âncora fornecida pelo script Impeccable: `oklch(0.570 0.158 353.3)`; a cor de ação
foi escurecida para `oklch(0.48 0.16 353.3)` para texto branco legível. Todas as cores
estão em tokens OKLCH. Verde comunica sucesso; vermelho, erro; amarelo, conflito.

## Estrutura

- Navegação lateral persistente: Camadas, Rastreio, Histórico e Configurações.
- Estado de execução e controle de pausa ficam sempre na barra superior.
- Camadas usam navegação própria e painel de ações. “Em uso” identifica a camada
  dos atalhos; “Visualizando” identifica outra camada aberta para configuração.
  Escolher uma camada para editar não muda a camada em uso.
- O editor substitui o conteúdo do painel, com contexto e retorno explícitos.
  Nome/tecla precedem a ação. Parâmetros e headers HTTP usam pares nome/valor em
  uma seção expansível; rascunhos são preservados ao alternar o tipo de ação.
- Ações destrutivas e descarte de alterações usam um diálogo nativo HTML com foco
  inicial na opção de continuar/cancelar. Navegação e fechamento protegem rascunhos.
- Testes têm estado de execução, resultado inline e confirmação visível. Falhas
  retornadas pelo motor são exibidas como erro, mesmo quando a chamada IPC resolve.
- Busca de ações por nome/tecla/tipo e busca de eventos reduzem a necessidade de
  percorrer listas. A ação principal do painel é criar uma ação; remover é terciário.
- Rastreio é opt-in e independente do motor de ações. Teclas simultâneas são
  destacadas por código físico e chips textuais. O modo global/local aparece antes
  do teclado, que inclui numpad; rótulos QWERTY são uma referência visual.
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

Em larguras intermediárias, camadas ficam em uma faixa acima do painel. O teclado
preserva o tamanho legível das teclas em uma região com rolagem horizontal própria.
Abaixo de 580 px, a navegação vira uma barra horizontal. Botões, formulários e textos
longos quebram linhas. Avisos ficam afastados da área principal de salvamento. Não há
dependência de fontes externas, bibliotecas ou scripts inline.

## Limites

A visualização física usa referência QWERTY, navegação e numpad; teclados ABNT2
e ISO podem ter legendas e posições diferentes. Os códigos recebidos
continuam aparecendo no indicador textual de teclas pressionadas. Captura global
e execução dependem da integração nativa e das permissões do sistema, informadas
pelo estado vindo do processo principal.
