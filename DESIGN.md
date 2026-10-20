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
- Camadas usam lista e painel de ações; o indicador “Atual” diferencia a camada
  ativa da camada selecionada para edição.
- Editores inline preservam o contexto. Uma ação expõe somente os campos do tipo
  escolhido, com validação e erros junto ao formulário.
- Ações destrutivas recebem confirmação inline. Testar informa explicitamente que
  executa uma ação real mesmo com a execução global pausada.
- Rastreio é opt-in e independente do motor de ações. Teclas simultâneas são
  destacadas por código físico; rótulos QWERTY são uma referência visual. A lista
  de teclas pressionadas cobre também códigos de teclados não representados.
- A página aberta fora do Electron explica que o aplicativo desktop é necessário;
  não simula captura, persistência ou execução.

## Acessibilidade e adaptação

HTML semântico, nomes acessíveis, labels explícitas, estados e feedback textual,
foco visível, link para pular a navegação e respeito a movimento reduzido.
Inputs usam controles nativos. Texto de usuário é inserido como texto, nunca HTML.
O foco em campos suspende ações por `setEditing`; a edição de uma camada/ação
mantém a suspensão enquanto o formulário está aberto.

Em larguras intermediárias, camadas ficam em uma faixa acima do painel. A área de
navegação do teclado passa para baixo da área principal. Abaixo de 580 px, a
navegação vira uma barra horizontal. Botões, formulários e textos longos quebram
linhas. Não há dependência de fontes externas, bibliotecas ou scripts inline.

## Limites

A visualização física usa referência QWERTY com teclas de navegação; teclados ABNT2,
ISO e numéricos podem ter legendas e posições diferentes. Os códigos recebidos
continuam aparecendo no indicador textual de teclas pressionadas. Captura global
e execução dependem da integração nativa e das permissões do sistema, informadas
pelo estado vindo do processo principal.
