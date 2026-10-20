# Auditoria e melhorias de UI/UX

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
