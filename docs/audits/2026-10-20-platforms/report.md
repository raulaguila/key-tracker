# Auditoria de performance, compatibilidade e integração por sistema

> **Registro histórico.** Resultados e nomes refletem o commit/ambiente desta
> avaliação. Consulte a [documentação atual](../../README.md) para usar ou desenvolver o Dobra.

Registro da versão auditada. As correções posteriores e suas provas estão em
[remediation.md](remediation.md).

Data: 20/10/2026. Código do produto: `77a360d`.
Diagnósticos: `8a6c78d` / `a6be5d4`; essas revisões alteram apenas o controlador
e o workflow de auditoria. O comportamento do aplicativo não foi modificado.

## Conclusão

A base compartilhada funciona nos caminhos exercitados, mas **não há evidência
para certificar compatibilidade integral em todos os ambientes desktop**.
Build, carregamento de uma integração, registro de um atalho e entrega de um
evento físico são provas diferentes. Esta auditoria mantém essas distinções.

Foram confirmados **8 achados: 1 P1 e 7 P2**, sem P0 demonstrado. A persistência
continua sendo a prioridade: sequências válidas podem gerar um arquivo que o
próprio aplicativo recusa ao reabrir. Há quatro problemas de integração nativa
reproduzidos em Linux: subprocessos órfãos, disponibilidade antiga da bandeja,
dependência ausente no `.deb` e proteção de exportação contornável por hardlink.
Os dois problemas de cooldown e o custo de estados grandes completam os achados.

O aplicativo empacotado iniciou em **277 ms de mediana** no desktop Linux de
laboratório, com baixo consumo de CPU em repouso. Com 2.500 ações, o IPC de edição
teve p95 de **15 ms** e o salvamento **46 ms**. O consumo base observado foi
aproximadamente **219 MiB de PSS**, não a soma RSS de 521 MiB.

## O que foi efetivamente executado

- **Linux local:** executável empacotado em Xvfb/X11, perfis temporários, cinco
  inicializações, CPU/memória, IPC/DOM, três tamanhos de configuração e ciclos de
  navegação. Sondas de integração em Electron e reproduções controladas com
  filesystem e D-Bus próprios; nenhum dado real do usuário foi usado.
- **Três runners nativos:** workflow `Platform audit` constrói o pacote, inspeciona
  seu ASAR e abre o Electron com o código de produção em modo de desenvolvimento
  e perfil temporário. Mede inicialização/IPC e exercita APIs reais de clipboard,
  abertura, notificação, atalhos, rastreio e monitor de aplicativos.
- **CI Desktop:** testes unitários nos três sistemas, smoke de UI em Linux e
  instaladores `.exe`, `.dmg`/`.zip`, `.AppImage`/`.deb`. A revisão do produto
  passou no [run 39469695567](https://github.com/raulaguila/key-tracker/actions/runs/39469695567).
  Os 74 testes cobrem também falhas de serviços nativos com substituições apenas
  nas bordas dos testes unitários; esses casos não são confundidos com SO real.

O diagnóstico em runners **não inicia o aplicativo empacotado/instalado**. O
ASAR contém os mesmos seis arquivos de produção verificados, mas identidade do
bundle, assinatura, caminhos físicos e permissões de um app instalado exigem
outra prova. O executável empacotado foi medido diretamente somente em Linux.

Na primeira rodada, o controlador usava `/` ao extrair caminhos ASAR no Windows.
O pacote foi construído, mas a inspeção abortou antes de abrir o runtime. Isso
foi corrigido no controlador; não é um defeito do aplicativo Windows. Os dados
finais abaixo são da repetição, não dessa execução incompleta.

## Matriz de execução nativa

Rodada final: [Platform audit 39472743901](https://github.com/raulaguila/key-tracker/actions/runs/39472743901),
diagnóstico `a6be5d4`, três jobs concluídos. JSONs:
[Windows x64](platform-win32-x64.json), [macOS ARM64](platform-darwin-arm64.json),
[Linux x64](platform-linux-x64.json).

| Sonda real | Windows x64 | macOS ARM64 | Linux x64/X11 |
| --- | --- | --- | --- |
| UI inicial / preload / IPC | Passou | Passou | Passou |
| Início pausado e rastreio desligado | Passou | Passou | Passou |
| Gravar e ler configuração de teste | Passou | Passou | Passou |
| Copiar e ler texto nativo | Conteúdo conferido | Conteúdo conferido | Conteúdo conferido |
| Iniciar executável de teste | Passou | Passou | Passou |
| Registrar pausa, F8, A, B e C | Cinco registrados | Cinco registrados | Cinco registrados |
| Iniciar worker de captura | `global`/ready | `global`/ready, Accessibility já autorizada | `global`/ready |
| Notificação nativa | API confirmou `show` | Sistema não confirmou exibição | API informou sem suporte |
| Bandeja segundo o aplicativo | Disponível | Disponível | Indisponível no display sem host |
| Monitor de aplicativo | Pronto, nenhum externo identificado | Pronto, nenhum externo identificado | Falta de ferramentas X11 informada |
| ASAR: seis arquivos iguais ao source | Passou | Passou | Passou |

`corePassed=true` nos três JSONs significa abertura, IPC, persistência, clipboard,
lançamento e integridade do ASAR aprovados. Não transforma as limitações das
outras sondas em sucesso. Não houve instalação NSIS/DMG/DEB nesses exercícios.

**Interpretação das sondas:**

- Clipboard: comparação do texto resolvido com uma leitura nativa aguardada;
  restauração do clipboard do display/runner de teste ao terminar. O conteúdo
  anterior não é registrado. Electron 44 usa APIs assíncronas, respeitadas tanto
  pelo serviço quanto pela sonda. [API oficial](https://www.electronjs.org/docs/latest/api/clipboard).
- Abertura: `/usr/bin/true` no Linux/macOS e `whoami.exe` no Windows, sem argumentos
  ou shell. Sucesso confirma início do processo; não testa programas comerciais,
  `.app` instalado ou associação de todos os tipos de arquivo/URL.
- Rastreio global: worker nativo iniciou e publicou `ready`. Não foi usado teclado
  USB/físico nos runners; não certifica entrega de todas as teclas, IMEs ou layouts.
- Monitor: `ready` sem aplicativo identificado pode significar que a própria
  janela foi ignorada. Não comprova transições entre aplicativos externos. Uma
  ferramenta X11 ausente ou falta de gerenciador de janelas aparece como limitação.
- Notificação: somente evento nativo `show` conta como confirmação da API.
  `failed`, indisponibilidade ou timeout ficam como erro observado, sem inferir
  que uma pessoa recebeu ou leu a mensagem.
- Bandeja: `trayAvailable` é o estado observado pelo aplicativo. A prova de perda
  de host abaixo mostra por que isso não basta para garantir recuperação contínua.

## Compatibilidade e limites de distribuição

| Ambiente | Evidência disponível | Pendência antes de declarar suporte completo |
| --- | --- | --- |
| Windows x64 | Runner Windows, testes e NSIS; identidade `io.keyboardtracker.app` configurada no main e atalho do instalador | Instalar em Windows desktop real, validar notificações, conflitos globais, escala/DPI e permissões/políticas |
| macOS ARM64 | Runner Apple Silicon, testes e DMG/ZIP; source runtime e binário Swift inspecionado | App instalado com assinatura/notarização apropriadas, autorização de entrada, notificações e troca real de aplicativo |
| Linux x64/X11 | Runtime e pacote local, runner Ubuntu, hook e clipboard reais | Instalação limpa com dependências mínimas; painéis GNOME/KDE, reinício/perda da bandeja e associação de arquivos |
| Linux/Wayland | Fallback e regras revistos; testes automatizados simulam a classificação da sessão | Sessão Wayland real com portal GNOME/KDE, consentimento e identidade `.desktop` instalada |
| macOS Intel; Windows/Linux ARM64 | Há prebuilds relevantes, mas a matriz atual não gera/valida todos esses instaladores | Jobs por arquitetura, compilação, instalação e sondas nativas correspondentes |

Os artefatos da revisão são **Windows-X64, macOS-ARM64 e Linux-X64**; isso não
equivale a todos os processadores/versões desses sistemas. O Electron 44.9.1 tem
como base Windows 10+, macOS 13+ e distribuições Linux compatíveis com o Chromium
atual, com binários x64/ARM64. Não há suporte a Windows de 32 bits ou ARM Linux
de 32 bits nessa versão. Esses são limites do runtime, não uma certificação do
Keyboard Tracker para cada versão mínima. [Matriz oficial da versão](https://raw.githubusercontent.com/electron/electron/v44.9.1/README.md),
[mudanças do Electron 44](https://www.electronjs.org/docs/latest/breaking-changes#breaking-api-changes-440).

No Wayland, o Rastreio integral e a identificação de aplicativo estão
explicitamente indisponíveis nesta solução. Atalhos usam o portal do compositor;
no Electron atual ele é habilitado por padrão. Não foi classificada como defeito
a ausência de uma feature flag. A identidade do aplicativo corresponde ao
`.desktop` verificado no `.deb`. Ainda é necessário testar a instalação e o
consentimento no compositor real. [Regras do portal no Electron](https://www.electronjs.org/docs/latest/api/global-shortcut#usage-on-linux).

Notificações dependem dos requisitos do SO, inclusive assinatura no macOS e
identidade/atalho no Windows. O erro observado no runtime de CI não autoriza
concluir que um pacote corretamente instalado e assinado também falhará, nem
permite declarar entrega funcionando. Os builds atuais não comprovam o fluxo
assinado/notarizado de distribuição. [Requisitos oficiais](https://www.electronjs.org/docs/latest/tutorial/notifications#platform-considerations).

## Performance

### Linux empacotado — laboratório local

Intel i9-12900K, 24 CPUs lógicas, 61,6 GiB RAM, Linux 7.0.0-38-generic,
Electron 44.9.1, Xvfb e GPU desligada. Máquina compartilhada e caches do SO não
isolados. [Amostras completas](linux-performance.json).

| Operação, p95 | Padrão: 2 ações | 100 ações | 2.500 ações / 25 camadas |
| --- | ---: | ---: | ---: |
| Busca síncrona, n=20 | 1,0 ms | 11,2 ms | 6,6 ms |
| Navegação síncrona, n=48 | 8,5 ms | 21,2 ms | 17,2 ms |
| Abrir drawer, n=12 | 18,6 ms | 35,0 ms | 30,5 ms |
| Estado de edição via IPC, n=40 | 5,5 ms | 3,9 ms | 15,0 ms |
| Salvar via IPC, n=5 | 1,7 ms | 4,4 ms | 46,0 ms |

Busca/navegação/drawer medem trabalho síncrono de JavaScript/DOM, sem pintura
final ou INP. IPC inclui ida/volta, validação e trabalho acionado pela chamada.
Pequenas diferenças entre cenários não provam que uma configuração maior seja
mais rápida. Com cinco amostras, o p95 equivale ao máximo; não é um SLO.

Inicialização: mediana **277,3 ms**, máximo **311,2 ms**, cinco perfis novos.
Caminho sintético main → IPC → callback do renderer: p95 **1,29 ms**, máximo
**3,50 ms**, 240 eventos. Não inclui teclado físico, hook completo, compositor ou
pintura da tela. A mediana anterior de 292 ms foi medida em outra rodada e versão;
essa diferença não comprova otimização nem regressão.

| Estado sequencial | CPU média reportada | Soma RSS média | Snapshot soma PSS |
| --- | ---: | ---: | ---: |
| Padrão pausado, 8 s | 0,052% | 521,0 MiB | 219,1 MiB |
| Hook global ligado, sem digitação, 8 s | 0,016% | 705,6 MiB | 309,1 MiB |
| Monitor ligado, 8 s | 0,062% | 608,9 MiB | 301,8 MiB |
| Configuração grande após interações, 5 s | 0,025% | 974,3 MiB | 654,3 MiB |

RSS soma páginas compartilhadas mais de uma vez; PSS reparte essas páginas. São
os processos informados pelo Electron, não toda a árvore do SO. As etapas
ocorrem na mesma sessão; o cenário grande é posterior a alocações e anterior à
coleta forçada. Não representa memória de uma configuração recém-aberta nem prova
vazamento. Percentuais de CPU muito próximos de zero variam entre rodadas.

Depois de 240 navegações e 60 ciclos de drawer adicionais, com GC antes/depois,
documentos (2), nós (5.498) e listeners (653) permaneceram iguais. Heap JS usado
cresceu aproximadamente 127 KiB. Nenhuma tarefa longa acima de 50 ms foi registrada
pelo observador nessa rodada. O ensaio curto não exclui vazamentos de longa duração.

### Runners de cada sistema

| Medida | Windows x64 | macOS ARM64 | Linux x64/X11 |
| --- | ---: | ---: | ---: |
| Runner: kernel/build | 10.0.26100 | Darwin 25.6.0 | 6.17.0-1022-azure |
| CPU / CPUs lógicas | EPYC 7763 / 4 | M1 Virtual / 3 | EPYC 7763 / 4 |
| RAM | 16 GiB | 7 GiB | 15,6 GiB |
| Startup mediano, n=3 | 2.020 ms | 542 ms | 333 ms |
| Startup máximo | 3.591 ms | 3.112 ms | 2.824 ms |
| IPC edição p95: 2 → 2.500 ações, n=20 | 4,0 → 33,2 ms | 7,1 → 18,0 ms | 1,4 → 28,7 ms |
| Salvar p95: 2 → 2.500 ações, n=4 | 2,8 → 77,6 ms | 24,2 → 50,3 ms | 6,2 → 67,2 ms |
| CPU média reportada em repouso | 0,080% | 0,296% | 0,050% |
| Soma RSS média em repouso | 332,6 MiB | 411,3 MiB | 450,1 MiB |

Node do controlador: 24.22.0 no Windows e 24.21.0 no Linux/macOS. Electron 44.9.1
nos três. O campo de kernel/build identifica o runner usado, sem pressupor que
ele represente todas as edições de Windows desktop ou todas as distribuições.
Com três/quatro amostras, p95 é o máximo observado e tem baixa confiança de cauda.

As VMs têm CPUs, RAM, antivírus, cache e tempos de agendamento diferentes. Esses
dados servem para identificar custos e falhas em cada ambiente; não estabelecem
um ranking de sistemas operacionais. O benchmark usa Electron com source; não
deve ser comparado diretamente ao tempo do executável Linux empacotado.
Inicialização inclui conexão CDP e verificação da UI. CPU/RSS são amostras curtas
de cinco segundos após os exercícios de integração.

## Achados confirmados e recomendações

### A01 · P1 — Persistência aceita arquivo que impede a próxima abertura

**Local:** [config.cjs:107](../../../app/config.cjs#L107),
[storage.cjs:16](../../../app/storage.cjs#L16),
[storage.cjs:31](../../../app/storage.cjs#L31),
[main.cjs:135](../../../app/main.cjs#L135).
O limite de 256 KiB mede JSON compacto, mas a gravação e a exportação usam
indentação; leitura/importação medem bytes físicos.

**Prova atual:** 3 camadas × 100 ações × 10 etapas são aceitas com **129.054 B**
compactos; o arquivo tem **366.275 B** e é recusado ao recarregar. A validação
aceitou a fixture para os três sistemas; o ciclo real de filesystem foi Linux.
O arquivo é preservado. A exportação também excede o limite da própria importação.
**Correção recomendada:** unificar serialização e critério de tamanho, validar
antes de substituir dados e testar salvar/reabrir/exportar/importar perto do limite.
[Provas](engine-results.json). É a revalidação do problema anterior, agravado pela
quantidade de estrutura em sequências; não foi corrigido nesta auditoria.

### A02 · P2 — Timeout do monitor não encerra todos os subprocessos

**Local:** [application-monitor.cjs:30](../../../app/application-monitor.cjs#L30),
[application-monitor.cjs:112](../../../app/application-monitor.cjs#L112),
[application-reader.cjs:32](../../../app/application-reader.cjs#L32).
`worker.terminate()` encerra a thread, mas não garante encerrar filhos de
`execFile` iniciados pelo adaptador. **Prova:** dependência real com `PATH`
controlado apontou `xprop` para um processo temporário bloqueado; o filho
sobreviveu à thread. Pode haver acúmulo em timeouts repetidos.
**SO:** Linux confirmado; mecanismo macOS requer prova nativa específica.
**Recomendação:** timeout/cancelamento na borda que cria o processo e limpeza
explícita dos filhos, ou isolamento com grupo de processos controlável.
Nenhum travamento espontâneo de um `xprop` saudável foi observado.
[Evidência](native-worker-child-lifetime.json).

### A03 · P2 — Perda do host da bandeja mantém a ocultação habilitada

**Local:** [desktop-tray.cjs:75](../../../app/desktop-tray.cjs#L75),
[desktop-tray.cjs:106](../../../app/desktop-tray.cjs#L106),
[main.cjs:72](../../../app/main.cjs#L72).
Com Electron e host StatusNotifier reais em D-Bus/Xvfb privados, encerrar o host
mudou a consulta de disponibilidade para `false`, mas `trayAvailable` permaneceu
`true`, inclusive após refresh. **Impacto:** fechar com `closeToTray` pode ocultar
a janela sem ícone para restaurá-la. Uma segunda abertura pode recuperá-la.
**SO:** Linux com StatusNotifier; não houve teste de painel GNOME/KDE completo.
**Recomendação:** revalidar antes de ocultar e observar a perda do host, restaurando
a janela. [Evidência](native-tray-host-loss.json).

### A04 · P2 — `.deb` omite biblioteca requerida pelo capturador

**Local:** [package.json:33](../../../package.json#L33),
[tracker-worker.cjs:3](../../../app/tracker-worker.cjs#L3).
O addon ELF requer `libXt.so.6`, mas o Depends do `.deb` não declara `libxt6`.
`libxtst6` e GTK3 não garantem essa biblioteca. Ausência simulada de libXt por
`LD_AUDIT` produziu `ERR_DLOPEN_FAILED`: o app pode abrir e cair no rastreio local
apesar de X11. **Recomendação:** declarar dependência compatível com as distros
suportadas, preservando defaults; revisar também o AppImage. Não houve remoção de
pacotes do host ou instalação limpa de distro. [Prova](native-libxt-package.json),
[dependências Debian](https://packages.debian.org/bookworm/libxtst6),
[biblioteca libXt](https://packages.debian.org/bookworm/libxt6).

### A05 · P2 — Exportar para hardlink pode sobrescrever a configuração

**Local:** [desktop-actions.cjs:178](../../../app/desktop-actions.cjs#L178),
[desktop-actions.cjs:186](../../../app/desktop-actions.cjs#L186).
A proteção compara caminhos/realpaths, mas hardlinks podem ter caminhos distintos
e compartilhar o mesmo arquivo. Em fixture Linux, exportar para o alias escolhido
sobrescreveu a configuração protegida com JSON de histórico.
**Recomendação:** comparar identidade de arquivos existentes (`dev`/`ino`) ou
escrever em temporário e renomear o destino, sem truncar o inode compartilhado.
**Limite:** alias preexistente e arquivos temporários; comportamento em NTFS/APFS
não foi confirmado. [Evidência](native-history-hardlink.json).

### A06 · P2 — Etapa de camada remove o cooldown da sequência de origem

**Local:** [actions.cjs:97](../../../app/actions.cjs#L97),
[engine.cjs:86](../../../app/engine.cjs#L86),
[engine.cjs:190](../../../app/engine.cjs#L190).
Uma sequência `[ativar camada atual, copiar]` limpa `lastRun` via `setLayer`.
Com intervalo configurado em 10.000 ms, dois disparos concluídos produziram dois
efeitos em menos de 1 ms no diagnóstico do motor. **Impacto:** repetição pode
gerar requests/arquivos/cópias acima do intervalo esperado.
**Recomendação:** preservar o cooldown do binding de origem ao trocar camadas,
cobrindo alvo igual/diferente. Código compartilhado; serviço nativo substituído
na prova controlada, sem inferência de latência de teclado. [Dados](engine-results.json).

### A07 · P2 — Intervalo das ações impede pausar logo após retomar

**Local:** [engine.cjs:190](../../../app/engine.cjs#L190).
A verificação do cooldown ocorre antes do ramo de pausa. Retomar pelo atalho e
pressioná-lo imediatamente para pausar mantém o motor ativo até acabar o
intervalo, que pode chegar a 10 s. O botão da UI continua funcionando.
**Recomendação:** permitir pausa imediata e tratar repetição/retomada separadamente
do intervalo das ações. Problema anterior revalidado no motor compartilhado.
[Dados](engine-results.json).

### A08 · P2 — Custo de snapshots completos cresce com a configuração

**Local:** [engine.cjs:38](../../../app/engine.cjs#L38),
[engine.cjs:42](../../../app/engine.cjs#L42),
[app.js](../../../app/renderer/app.js).
Publicações clonam o estado completo, IPC também o devolve, e o renderer compara
configurações serializadas. Listas ainda recriam linhas e menus ocultos. No
laboratório, a mediana de salvar subiu de 3,6 ms com 100 ações para 30,1 ms com
2.500, mantendo 100 ações visíveis. São 4.033 elementos DOM para a lista de 100.
**Recomendação:** revisão de configuração, respostas pequenas, menos cópias e
atualização das linhas/menus afetados. Medir antes/depois. Não há evidência que
justifique trocar de framework. A contribuição exata de cada função não foi
isolada por perfil de CPU; a escala do custo foi medida. [Amostras](linux-performance.json).

## Pontos preservados e próximos passos

Limites de quatro execuções, dez etapas e 100 eventos funcionaram nas provas.
Quatro sequências executaram 40 etapas com pico de quatro vagas e nenhuma vaga
restante ao final. Quatro sequências de log geraram 44 linhas reais com pico de
quatro escritas aguardando a fila. A duração Node de 6,11 ms é só uma amostra,
sem Electron, e não um SLO. Pausar permite terminar ações em voo conforme o
contrato; isso não foi classificado como falha.

Cabeçalhos HTTP são mascarados recursivamente, payloads não entram no Histórico,
e a abertura usa caminho inteiro sem separação de argumentos/shell. Caminhos
específicos de um sistema não são remapeados automaticamente ao importar em outro.
Os prebuilds e o ASAR unpack são coerentes com o desenho, mas precisam dos testes
de instalação e permissões listados na matriz.

Achados de UI/layout internacionais e de sincronização de tela da
[auditoria anterior](../2026-10-20/report.md) não foram encerrados por este trabalho;
não foram novamente executados nem contabilizados como novos achados aqui.

Ordem recomendada:

1. **`/keel harden persistência e execução`** — A01, A05, A06 e A07: garantir o
   ciclo de dados e o comportamento dos controles antes de uma release pública.
2. **`/keel adapt integrações desktop`** — A02–A04 e matriz: processos, perda de
   host, dependências mínimas, instalação e permissões nas arquiteturas alvo.
3. **`/keel optimize publicação de estado`** — A08: reduzir cópias/serialização
   integral e repetir as medidas nos mesmos ambientes.

Essas correções são recomendações; não foram aplicadas na auditoria.

## Reproduzir

Linux empacotado, após gerar o pacote da revisão desejada:

```bash
npm run pack
xvfb-run -a node scripts/performance-audit.cjs artifacts/os-audit/linux-performance.json
```

Sondas portáteis, com pacote já gerado para inspeção:

```bash
# Linux
xvfb-run -a node scripts/platform-audit.cjs
# Windows/macOS
node scripts/platform-audit.cjs
```

O workflow **Platform audit** pode ser executado manualmente no GitHub. Por push,
roda somente quando o controlador ou o próprio workflow mudam. Não adiciona
benchmark a cada mudança do produto. Relatórios ficam em `artifacts/os-audit/`
e são enviados como artefatos separados por SO/arquitetura. Falha de sonda é
preservada no JSON; limitações nativas não são convertidas em falso sucesso.

Fontes complementares: [revisão nativa](native-review.md),
[revisão do motor](engine-findings.md), [CPU Electron](https://www.electronjs.org/docs/latest/api/structures/cpu-usage),
[memória Linux/PSS](https://www.kernel.org/doc/html/latest/filesystems/proc.html).
