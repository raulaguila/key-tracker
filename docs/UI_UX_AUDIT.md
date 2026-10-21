# Auditoria e melhorias de UI/UX

> **Registro histórico de UI/UX.** Este relatório preserva a evolução anterior
> à interface/identidade atuais. Consulte [Design](../DESIGN.md) e a
> [documentação atual](README.md) para o comportamento do Dobra.

> Histórico da primeira rodada de melhorias. A análise atual do sistema, com
> achados ainda abertos e medições do executável, está na
> [auditoria de UI/UX e performance de 20/10/2026](audits/2026-10-20/report.md).

Data: 20/10/2026.
Escopo: Camadas, editores de camada/ação, Rastreio, Histórico, Configurações,
estados assíncronos, navegação, fechamento e adaptação de layout.

## Método e resultado

Inspeção do código e da interface no Electron real, em Linux com display Xvfb e
perfil temporário. Fluxos reproduzidos com configuração persistida via IPC nativo
e requests HTTP reais para um servidor de teste em loopback. Não foram usados
mocks de captura, persistência ou execução na interface.

A identidade clara e o rosa profundo existentes foram preservados. A melhoria
central é a separação entre **escolher uma camada**, **editar suas ações** e
**usar seus atalhos**. Editar uma camada não altera implicitamente a camada em uso.

Foram tratados 14 achados: 4 P1, 9 P2 e 1 P3. Nenhum P0 foi identificado no escopo
inspecionado. A pontuação abaixo é uma avaliação heurística da implementação,
não uma certificação de acessibilidade ou um estudo com usuários.

| Dimensão técnica | Antes | Depois | Evidência principal |
| --- | ---: | ---: | --- |
| Acessibilidade | 3/4 | 3/4 | Feedback visual e acessível, diálogos, foco e verificações axe; sem teste com leitor de tela real |
| Performance | 3/4 | 3/4 | Sem novas dependências; atualizações locais das listas e descarte de keydown repetido |
| Responsividade | 2/4 | 3/4 | 28 combinações de tela/largura sem overflow da página; teclado tem rolagem própria |
| Tokens e tema | 3/4 | 3/4 | Tema claro preservado, tokens semânticos e contraste medido |
| Hierarquia e padrões visuais | 3/4 | 4/4 | Editor dedicado, ação principal por contexto, controles e ícones consistentes |
| **Total** | **14/20** | **16/20** | Ganhos funcionais de UX detalhados abaixo |

## Achados corrigidos

| Prioridade | Problema e impacto | Correção implementada |
| --- | --- | --- |
| P1 | Camada selecionada e camada ativa pouco distintas; usuário pode esperar que uma tecla já execute outra ação | Rótulos “Em uso” e “Visualizando”, contexto da camada ativa sempre visível e botão explícito “Usar esta camada” |
| P1 | Navegação descartava rascunhos sem aviso | Comparação dos valores do formulário, confirmação ao navegar e proteção no fechamento da janela |
| P1 | Sucesso do IPC podia ser anunciado como sucesso da ação, mesmo quando o motor registrava erro | Resultado interpretado pelo evento de execução retornado; erro e sucesso exibidos na própria ação e no aviso |
| P1 | Confirmações de salvamento disponíveis apenas para leitores de tela | Feedback visível com anúncio acessível, sem apagar o estado do motor |
| P2 | Formulário e lista de ações concorriam por espaço e atenção | Editor substitui o painel de ações, preserva o contexto da camada e oferece retorno explícito |
| P2 | Formulário HTTP exigia escrever JSON mesmo para um parâmetro simples | Pares nome/valor para query e headers, adição/remoção de linhas e validação de nomes duplicados |
| P2 | Complexidade técnica aparecia toda de uma vez | Parâmetros, headers, variáveis e repetição em seções expansíveis; corpo oculto para GET/HEAD |
| P2 | Não havia busca para listas maiores | Busca de ações por nome, tecla ou tipo; histórico pesquisável por mensagem, camada e tecla |
| P2 | Testes não mostravam execução em andamento e permitiam cliques repetidos | Botão de teste temporariamente desativado, estado “Executando…” e resultado inline |
| P2 | Estado e controles importantes saíam da tela ao rolar | Barra de execução persistente e rodapé de salvamento acessível em formulários longos |
| P2 | Rastreio não dava destaque suficiente à origem da captura e não representava numpad | Modo global/local antes do teclado, aviso específico do ambiente, chips de teclas simultâneas e numpad |
| P2 | Configurações apresentavam a pasta Documentos como destino padrão completo | Exibição do caminho real Documentos/Keyboard Tracker; seções para atalhos, backups, caminhos e permissões |
| P2 | Pequenos controles, ações destrutivas concorrentes e ícones heterogêneos prejudicavam leitura e operação | Espaçamentos e alvos consistentes, remoção terciária com confirmação, atalhos legíveis por SO e adaptação dos painéis |
| P3 | CSS comprimido e controles duplicados dificultavam manter consistência | CSS legível e módulos compartilhados para controles, ícones, campos e teclado |

As alterações de formulário continuam sendo convertidas ao contrato original.
O formato de configuração, o motor de ações e a captura nativa permanecem
compatíveis. O rastreio não passou a gravar eventos de teclas.

## Evidências e verificações

- Detector Impeccable: nenhum achado determinístico, antes e depois. Esse
  resultado foi usado como sinal de implementação, não como prova de qualidade visual.
- Axe-core 4.12.1, tags WCAG A/AA: nenhuma violação detectada em Camadas,
  Rastreio, Histórico, Configurações, editor HTTP expandido e diálogo de descarte.
- O axe não avaliou automaticamente o contraste de oito glifos do teclado
  (setas, menos, backspace e enter numérico). As cores foram conferidas via
  renderização sRGB no Chromium: **15:1** em repouso e **7,16:1** pressionadas.
- Teste real de formulário: cadastro de camada e ação, configuração preservada
  no arquivo, pares HTTP mantidos após alternar o tipo e dados efetivamente
  recebidos pelo servidor de teste.
- Teste HTTP: sucesso 201 e falha 503, feedback correspondente e bloqueio de
  repetição durante uma execução pendente.
- Navegação: continuar editando preserva valores; descartar não os salva.
  Configurações seguem a mesma proteção. O teste de fechamento cancela a saída
  antes de apresentar o diálogo, sem travar o renderer.
- Rastreio: keydown/keyup simultâneos para letra e numpad, chips DOM reais,
  limpeza ao soltar e modo local explicitamente indicado no ambiente Wayland.
- Adaptação: quatro telas em **1440, 1280, 980, 800, 760, 580 e 390 px**.
  Sem overflow horizontal da página. Rolagem horizontal do teclado é intencional.
- Inspeção visual de capturas em larguras de desktop, janela compacta e largura
  exploratória móvel; sem erros não tratados no renderer durante o smoke test.

## Como reproduzir

```bash
npm run check
npm test
xvfb-run -a npm run test:ui
```

O teste de UI usa Linux/X11 para isolar a janela, simula o contexto Wayland para
exercitar o fallback local e cria configuração descartável. Não mede o portal
Wayland ou a captura global do sistema nesse teste.

Capturas geradas em `artifacts/ui-audit/`: camadas, editor HTTP, execução com erro,
rastreio, histórico e configurações em três larguras. O diretório é ignorado pelo
Git. O workflow Desktop executa o smoke de UI no job Linux.

## Limites da avaliação

Não houve pesquisa de usabilidade com pessoas, teste de leitor de tela real,
hardware ABNT2/ISO ou inspeção visual nativa em Windows/macOS. As larguras abaixo
de 760 px são testes exploratórios de CSS: o aplicativo continua sendo desktop.
O tema avaliado é o claro documentado em DESIGN.md. As permissões e limitações de
captura global do sistema operacional continuam conforme README.md.

Nenhum problema bloqueante conhecido ficou aberto no escopo inspecionado.

## Melhorias posteriores à auditoria — concluídas

Solicitadas e implementadas após a auditoria, em 20/10/2026.

- [x] **Sidebar recolhível:** permitir recolher e expandir a navegação por um
  controle explícito, acessível pelo teclado, e lembrar a preferência. No modo
  recolhido, manter ícones identificáveis com nomes acessíveis e dicas ao passar
  o mouse ou receber foco, destacar a tela atual e liberar espaço para o conteúdo.
- [x] **Interface mais minimalista:** reduzir textos auxiliares permanentes,
  bordas e elementos concorrentes; priorizar o conteúdo e a ação principal de
  cada tela. Apresentar opções secundárias sob demanda e simplificar a disposição
  das informações, mantendo visíveis o estado de execução e a camada em uso,
  além de preservar contraste, foco e feedback das ações.

O painel de ações perdeu o cartão externo e a numeração redundante de camadas.
Ajuda de uso e privacidade, caminhos de arquivos e permissões usam seções
expansíveis. A captura local/global, avisos e resultados continuam explícitos.

Validação: os 23 testes passaram. O smoke em Electron real no Linux verificou
recolher por Enter, persistência após recarregar, dicas por foco e fechamento com
Escape, preservação de rascunhos, acesso aos detalhes e **56 combinações** das
quatro telas, sete larguras e dois estados de sidebar, sem overflow da página.
Capturas adicionais: `artifacts/ui-audit/<tela>-<largura>-collapsed.png` e
`<tela>-<largura>-expanded.png` (1280, 800 e 390 px). Abaixo de 580 px, ambos os
estados mantêm a navegação horizontal com rótulos. As limitações da avaliação
original continuam aplicáveis.

## Adoção do protótipo compacto — concluída

A proposta em `docs/prototypes/compact/` foi aprovada e aplicada ao aplicativo.
Barra superior de 48 px, navegação recolhida de 52 px, títulos de 18 px, controles
de 30–32 px e ações/histórico em tabelas com linhas a partir de 44 px. O editor
abre lateralmente em janelas largas; em janelas menores ocupa o espaço da tabela.
O contexto de camada, pausa, conflitos e resultados permanece explícito. As
confirmações de descarte e os formulários completos foram preservados. Ao contrário
da versão anterior, a navegação continua lateral nas larguras exploratórias pequenas.

Rastreio integra legendas automáticas quando fornecidas pelo Chromium, cinco
layouts manuais, três tamanhos e correção de geometria ANSI/ISO/ABNT2. As escolhas
visuais persistem localmente e não alteram a configuração exportada das ações.
Falha ou timeout da leitura automática usam US como referência explícita; respostas
atrasadas não sobrescrevem uma seleção manual. O formato físico não é detectado
como hardware. Variantes/IMEs e emissão de teclas internacionais pelo hook nativo
continuam sujeitos às limitações do sistema.

Provas desta integração:

- 27 testes passaram, incluindo leitura ausente/bloqueada/vazia/timeout,
  normalização de preferências, legendas e códigos físicos do hook.
- Electron real: CRUD, HTTP local 201/503, preservação dos parâmetros, proteção
  de rascunhos no fechamento/navegação e persistência das configurações.
- Cinco layouts, três formatos, geometria manual, persistência após recarregar,
  fallback automático e resposta atrasada após seleção manual.
- Down/up simultâneos de `Ç` e `IntlRo` com destaque visual em ABNT2, além de numpad.
- 56 combinações de quatro telas, sete larguras e sidebar aberta/recolhida,
  sem overflow horizontal da página; capturas em 1280, 800 e 390 px.
- X11 isolado: evento real via XTest chegou pelo hook global como `KeyQ`,
  apareceu como `A` no layout AZERTY e foi limpo no keyup.
- axe-core 4.12.1: zero violações WCAG A/AA em Camadas e Rastreio. Os símbolos
  que exigiram revisão manual mantêm as cores de texto e tecla já contrastadas.
- Build local Linux gerou AppImage e DEB. A inspeção visual e o teste de hook
  desta etapa ocorreram em Linux; builds Windows/macOS são verificados pelo CI.

Capturas desta fase permanecem em `artifacts/ui-audit/` (ignorado pelo Git), incluindo
`tracking-abnt2.png`, `native-azerty.png` e as quatro telas em três larguras.

## Tema escuro e drawer sobreposto — concluídos

Configurações oferece Claro, Escuro e Seguir o sistema, aplicados imediatamente
e salvos como preferência visual local. O tema é carregado antes do CSS. A paleta
escura usa superfícies graduais, rosa mais claro e cores semânticas contrastadas;
formulários, teclado, confirmações, estados e feedback usam os mesmos tokens.

O editor em coluna foi substituído por drawer modal de até 480 px, sobre a página.
A tabela não encolhe. O foco fica contido no formulário, com restauração ao fechar;
o cabeçalho e o salvamento são sticky. Escape, X e backdrop passam pela mesma
proteção de rascunhos. Escape durante a captura de atalho cancela só a captura.
Confirmações podem aparecer sobre o drawer; feedback assíncrono continua visível.

Provas:

- 27 testes passaram; cadastro/edição/exclusão, HTTP 201/503, configurações e
  proteção de rascunhos continuam passando no Electron real.
- Preferência de tema após recarregar, resposta a mudanças do sistema e prioridade
  de escolha manual; alternar o tema preserva os campos ainda não salvos.
- Escape, X, backdrop, confirmação de descarte, Tab/Shift+Tab contidos e retorno
  de foco. Lista real de 30 ações comprovou preservação da rolagem ao abrir/fechar.
- 112 combinações: quatro telas × sete larguras × dois estados de sidebar ×
  dois temas. Sem overflow horizontal da página.
- 14 verificações adicionais do drawer: sete larguras × dois temas, conferindo
  encaixe na janela e largura idêntica da tabela antes/depois de abrir.
- axe-core 4.12.1 no formulário escuro: zero violações WCAG A/AA e nenhum item
  incompleto. Configurações escuras: zero violações, com um rótulo marcado para
  revisão manual de contraste (texto e marcador obrigatório usam tokens legíveis).
- Capturas inspecionadas de desktop e janela compacta em ambos os temas.

Evidências em `artifacts/ui-audit/`: `dark-drawer-final.png`, `drawer-<largura>-<tema>.png`
e `<tela>-<largura>-<sidebar>-<tema>.png`. A avaliação visual segue limitada a Linux;
as verificações de Windows/macOS permanecem de build/testes pelo CI.

## Indicadores e encaixe do Enter ISO/ABNT2 — concluídos

Os estados agora combinam cor, símbolo e texto. Ativo usa verde/círculo cheio;
pausado, âmbar/duas barras; suspensão por edição ou digitação, azul/losango.
No Rastreio, desligado é neutro/vazio, inicialização é azul/pontilhada, captura
global é verde e captura local é âmbar/vazia. Atalhos parcialmente indisponíveis
recebem “Ativo · com restrições”, acompanhando o aviso existente.

As linhas de digitação calculavam suas larguras separadamente com flex, bordas e
paddings diferentes. O teste reproduziu 19 px entre `]` e a parte inferior do
Enter, em vez dos 4 px do restante do teclado. Uma grade compartilhada em quartos
de unidade uniformiza as teclas, e o recorte do Enter usa a mesma geometria.
O contorno interno do Enter também foi completado para deixar seu limite claro.

Provas desta correção:

- 27 testes de lógica passaram e a sintaxe foi verificada.
- Electron real: ativação, pausa, suspensão por campo e por drawer e retomada,
  com cores distintas nos temas claro/escuro; captura local difere de desligado.
- 90 combinações do teclado: cinco layouts × três formatos × três larguras
  (1440, 980 e 390 px) × dois temas. Medições conferem unidades iguais,
  superfícies visíveis sem cobertura por outras teclas e intervalo de 4 px
  entre a tecla vizinha e a parte inferior do Enter ISO/ABNT2.
- `]` e Enter pressionados simultaneamente continuam separados e visíveis,
  com destaque e liberação corretos nos dois temas.
- Os fluxos anteriores e as 112 combinações de telas/tema/sidebar, além das
  14 verificações do drawer, continuam passando.
- Inspeção X11 isolada confirmou “Captura global” com indicador ativo.
- axe-core 4.12.1: zero violações WCAG A/AA no estado ativo claro, suspenso escuro
  e Rastreio ABNT2 escuro. O último marcou oito símbolos de teclas para revisão
  manual; eles usam os mesmos tokens de texto/superfície das demais teclas.

Capturas: `status-<estado>-<tema>.png`, `tracking-abnt2-enter-<tema>.png` e
`tracking-abnt2-dark-final.png` em `artifacts/ui-audit/` (ignorado pelo Git).
A inspeção visual foi feita no Linux; Windows/macOS seguem verificados pelo CI.

## Produtividade e camadas por aplicativo — concluídos

Foram implementados os sete itens aprovados: visualização editável por teclado,
ativação individual, duplicação de ações/camadas, seleção direta da camada ativa,
bandeja, prévia com teste explícito e troca opcional de camada por aplicativo.
A tabela continua inicial; menus de opções e seções expansíveis evitam aumentar
os controles visíveis. A mesma geometria ABNT2/ISO é usada no editor e no Rastreio.

O teclado distingue mapeamento ativo/desativado, oferece combinações, nomes
acessíveis e navegação por setas. Um clique real revelou uma corrida de foco:
atualizar o estado recriava a tecla entre pointerdown e pointerup. O refresh
foi limitado às mudanças necessárias; há regressão por ponteiro nativo.

Prévia resolve os valores sem I/O e mascara headers. O token congela a execução,
expira e é invalidado ao salvar. O drawer mantém os valores após o resultado,
mostra duração/status HTTP e permite revisar uma nova prévia antes de repetir.
Cópias usam novos IDs; ação duplicada pede atalho e camada duplicada não herda
associações. Contexto automático permanece opt-in, adiado durante edição, com
retorno à camada manual e indisponibilidade explícita no Wayland.

A bandeja consulta suporte da sessão antes de permitir ocultação. A confirmação
nativa de fechamento preserva rascunhos e libera edição antes de ocultar. A prova
usa BrowserWindow.close no processo main real: window.close do renderer segue
outro caminho do Chromium e não representa o botão nativo da janela.

Provas:

- Testes de defaults legados, booleanos, conflitos, ações desativadas, prévias
  puras/congeladas/expiradas/uso único, HTTP real e resultados sanitizados.
- Monitor: opt-in, owner sem título/URL, respostas atrasadas, timeout, ausência
  de ferramentas, reativação após desligar, nomes/caminhos/bundles e fallback.
- Bandeja: menus/ícones, falha e recuperação, host Linux e ciclo de encerramento.
- Electron real: criação por teclado e clique nativo, setas, persistência da
  visualização, ativação individual, cópia de parâmetros/IDs, isolamento das
  associações, seletor direto, prévia sem request até execução, sucesso/erro HTTP,
  resultado durante outro drawer e confirmação de fechamento nativo.
- 112 combinações anteriores de telas/tema/sidebar e 14 tamanhos de drawer;
  90 combinações de geometria e seis de editor por teclado, sem overflow da página.
- Inspeção manual em 390, 800 e 1280 px, nos dois temas, incluindo popovers e
  drawer estreito. Axe: zero violações WCAG A/AA nas superfícies novas; símbolos
  de teclas usam tokens legíveis e foram revisados manualmente quando sinalizados.
- Pacote Linux com ASAR executou a detecção nativa em Xvfb próprio: ContextProof
  selecionou a camada associada; desligar restaurou a manual e religar detectou
  novamente, mantendo o motor pausado. A identidade não continha título/URL.
- AppImage/DEB gerados. Auditoria de dependências de runtime: zero alertas após
  corrigir tar transitivo; alertas moderados existentes do empacotador permanecem.

Capturas em `artifacts/ui-audit/`: `productivity-keyboard-<largura>-<tema>.png`,
`keyboard-editor-<largura>-<tema>.png`, `http-test-preview.png`,
`productivity-preview-390-light.png` e `productivity-result-390-light.png`.
A avaliação visual/nativa foi Linux; Windows/macOS seguem como testes/build no CI,
com QA de hardware/sessão real ainda necessário antes de uma release pública.
