# Momentos da tecla e cadastro compacto

Escopo: implementar ações ao pressionar, enquanto mantém e ao soltar; adotar a
proposta de UX aprovada pelo usuário. Configuração permanece versão 1.

## Entrega

- Uma ação por momento para a mesma combinação na camada, incluindo duplicação,
  importação/exportação, tabela, teclado visual, prévia e histórico.
- Enquanto pressionada tem intervalo próprio de 100 a 60.000 ms; só agenda outra
  execução depois da anterior terminar. Teste manual executa uma vez.
- Hook compartilhado entre momentos e visualização, com controles independentes.
  Após ativação explícita, observa solturas também durante pausa/edição; não
  executa ações nesses estados. Falhas não reservam combinações sem efeito.
- Gestos cancelados ao editar, pausar, trocar camada/configuração, perder o hook
  ou bloquear/suspender o SO. Não geram soltura artificial. Bloquear/suspender
  pausa as ações até o usuário ativar novamente.
- Drawer com resumo fixo do gatilho, controles de momento/intervalo e rodapé
  acessível. Sequências com uma etapa aberta e resumos sem conteúdo privado.
  Campos, ordem e foco são preservados; erro abre a etapa correspondente.
- Captura separa letra lógica e posição física. Alterar o atalho manualmente
  invalida a posição capturada. Alias de modificadores não permite duas ações
  ambíguas sobre a mesma posição.

Configurações legadas de até 256 KiB continuam cabendo: o normalizador omite
`trigger: press` quando é o padrão, em vez de adicionar bytes a todas as ações.
Leitura de JSON legado formatado, limite canônico, snapshots e proteção de
exportações da auditoria anterior continuam cobertos pelos testes.

## Provas locais

**127 testes unitários passaram**, incluindo persistência, limites, gestos com
timers reais, saturação, falta de permissão, cancelamentos, observação durante
pausa/edição e compartilhamento de worker. Sintaxe e diff verificados.

[Prova Linux/X11](native-linux.json): Electron real, Engine/Tracker de produção,
perfil temporário e eventos XTest em display Xvfb pertencente ao teste. Nenhum
teclado ou perfil real do usuário foi manipulado. O teste usa atalhos globais
simultaneamente ao hook, sem substituir esses componentes por mocks.

- A: um press, dez repetições hold e um release na amostra.
- Ligar/desligar Rastreio reutilizou o worker e manteve momentos disponíveis.
- Pausa/retomada e edição durante a tecla mantida não criaram outro gesto.
- Control+B recebeu modificador real; soltar Control interrompeu a repetição sem
  executar release da tecla principal.
- Encerrar o processo do hook cancelou os gestos, liberou os registros e não
  reiniciou o processo em loop.

[Prova AZERTY independente](native-azerty-independent.json): fonte francesa em
Xvfb próprio; DOM capturou A lógico/KeyQ físico. Atalho global registrado e hook
ativo produziram press1/hold4/release1 com a posição correta. Não é certificado
para todos os layouts, IMEs ou mudanças de fonte depois da captura.

## Limites de uso e de evidência

- Wayland não oferece esses momentos pelo hook atual. A indisponibilidade fica
  explícita e não é simulada por timers ou eventos locais.
- No macOS, entrada global depende de Acessibilidade. A visualização pode usar
  modo local; os momentos de ação não recebem esse fallback.
- Atalhos legados só de press preservam autorepeat do sistema com cooldown.
  Grupos com hold/release usam gestos reais e não duplicam press no autorepeat.
- Em combinações, soltar o modificador cancela o gesto; solte a tecla principal
  antes dos modificadores para acionar release. Trocar camada cancela o gesto.
- Ao trocar o layout real do SO, recapture as combinações para manter o atalho e
  a posição coerentes. A prova AZERTY usa a fonte vigente durante a captura.
- XTest é entrada sintética pelo SO em display próprio. Não comprova teclado USB,
  toda permissão de usuário, todos os compositores ou um instalador assinado.
- Ações já iniciadas podem terminar após soltar/pausar; efeitos não são desfeitos.

Guia de uso: [KEY_MOMENTS.md](../../KEY_MOMENTS.md).

## Editor e integração nos três sistemas

O smoke completo em Electron passou: fluxos existentes, produtividade, HTTP real,
rascunhos, prévias, temas, tamanhos e geometria de teclado, mais o novo cadastro.
A nova sonda verificou os três momentos com a mesma tecla, captura lógica/física,
invalidação ao editar manualmente, teclado visual por momento, duplicação e
remoção sem afetar os outros momentos. Testou accordion, resumos, valores e ordem
preservados, foco na primeira etapa inválida e limpeza de mensagens corrigidas.
Header e rodapé continuaram visíveis em 760×580, nos dois temas, a 100% e 125%.
A busca continua reutilizando as linhas: a sonda não adicionou nós nas 40 buscas.

Código de produto **a73f67a** aprovado em:

- [Desktop 39483201312](https://github.com/raulaguila/key-tracker/actions/runs/39483201312):
  testes/sintaxe Windows, macOS e Linux; smoke de UI e nova prova XTest em Linux;
  instaladores NSIS, DMG/ZIP e AppImage/DEB gerados. Artifacts disponíveis nesse run.
- [Platform audit 39483201189](https://github.com/raulaguila/key-tracker/actions/runs/39483201189):
  três runtimes Electron reais, perfis temporários, integridade de 21 arquivos no
  pacote ASAR e saída limpa das três instâncias de cada sistema.

| Sonda | Windows x64 | macOS ARM64 | Linux x64/X11 |
| --- | --- | --- | --- |
| Persistir os três momentos para a mesma tecla | Passou | Passou | Passou |
| Hook pronto e combinação global registrada | Passou | Passou | Passou |
| Ligar visualização reaproveita entrada global | Passou | Passou | Passou |
| Desligar visualização mantém momentos disponíveis | Passou | Passou | Passou |
| Pausar mantém observação de solturas, sem ativar ações | Passou | Passou | Passou |
| Configuração canônica/legado e preload após reload | Passou | Passou | Passou |
| Saída sem encerramento forçado, três instâncias | Passou | Passou | Passou |

Dados: [Windows](platform-win32-x64.json), [macOS](platform-darwin-arm64.json),
[Linux](platform-linux-x64.json). O runtime dessa sonda carrega o source de produção
em Electron; o ASAR é conferido separadamente. A prova XTest exercita eventos reais
da sessão virtual somente em Linux. Não confundir worker pronto/atalho registrado
em Windows/macOS com certificação da entrega de cada tecla física nesses sistemas.
Notificações, aplicativos externos em foco, permissões e instalação assinada
mantêm os limites descritos na auditoria anterior.

## Delay inicial independente — 12804c6

O cadastro de Enquanto pressionada agora separa **Delay inicial (ms)**, de 0 a
60.000, de **Repetir a cada (ms)**, de 100 a 60.000. Delay zero é preservado;
configurações sem esse campo mantêm o intervalo anterior na primeira execução.
A primeira tentativa pendente é cancelada ao soltar, inclusive quando agendada
com zero. Repetições continuam aguardando a conclusão anterior, sem catch-up.

**134 testes locais passaram**, com regressões de tempos diferentes, zero,
cancelamento, ação lenta, limites, codec, leitura e exportação. O smoke completo
passou com edição, reload e duplicação de delay 900/intervalo 250, validação dos
limites e dos campos ocultos, e ambos os temas a 760×580 com zoom 100%/125%.

[Platform audit 39484477174](https://github.com/raulaguila/key-tracker/actions/runs/39484477174)
passou em Windows/macOS/Linux com delay 500 e repetição 125 persistidos de forma
independente, hook compartilhado e saída limpa. O
[Desktop 39484477197](https://github.com/raulaguila/key-tracker/actions/runs/39484477197)
também passou: testes dos três sistemas, UI/eventos XTest no Linux e geração dos
respectivos instaladores. Os limites de evidência e compatibilidade acima permanecem aplicáveis.

## Delay entre etapas — e9d0889

Sequências têm **Delay entre etapas (ms)**, opcional no arquivo, de 0 a 60.000.
Ausência mantém zero sem inflar configurações legadas. A espera assíncrona ocorre
após uma etapa terminar e antes da próxima; não ocorre antes da primeira, após a
última ou após falha. A sequência mantém uma vaga de execução durante a espera.
Prévia congela o intervalo; teste manual o respeita. Duração total inclui esperas,
enquanto a duração de cada etapa mede apenas sua execução. Histórico e exportação
incluem o intervalo efetivo, sem conteúdo privado.

**139 testes locais passaram**, incluindo tempos reais, zero/legado/limites,
falha parcial, persistência, token congelado e concorrência durante a espera.
Sintaxe, UI completa, XTest Linux e pacote/integração Electron passaram. UI cobre
edição, duplicação, reload, troca de tipo, reordenação e os dois temas a 760×580
com zoom 100%/125%; quatro capturas do novo campo foram inspecionadas.

- [Desktop 39502962038](https://github.com/raulaguila/key-tracker/actions/runs/39502962038):
  testes e builds nos três sistemas, UI/XTest no Linux e instaladores gerados.
- [Platform audit 39502962353](https://github.com/raulaguila/key-tracker/actions/runs/39502962353):
  os três relatórios JSON do SHA e9d088991123422addd89e95e3e6896024a992fc foram
  conferidos. Persistência, prévia, duas etapas bem-sucedidas, clipboard final,
  integridade do ASAR e três saídas limpas por sistema passaram. Para intervalo
  configurado de 80 ms, duração total observada foi 82 ms em Windows/Linux e
  84 ms no macOS. São sondas funcionais, sem comparação controlada de performance.

Essa prova usa o source de produção no Electron e inspeciona o pacote; não
substitui testes do instalador assinado, permissões e teclados físicos em cada SO.
