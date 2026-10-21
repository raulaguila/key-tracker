# Correções da auditoria de plataformas

> **Registro histórico.** Resultados e nomes refletem o commit/ambiente desta
> avaliação. Consulte a [documentação atual](../../README.md) para usar ou desenvolver o Dobra.

Escopo autorizado: A01–A08 de [report.md](report.md). A auditoria original é
preservada como registro da versão anterior. Os limites de validação por hardware,
permissões, assinatura e ambientes Wayland continuam aplicáveis.

## Comportamento corrigido

| Achado | Correção | Evidência |
| --- | --- | --- |
| A01 | JSON canônico de até 256 KiB para salvar e exportar; leitor compartilhado aceita legado formatado até 2 MiB, com leitura limitada mesmo após crescimento do arquivo | Testes de limite exato, defaults normalizados, sequências grandes, short reads e crescimento durante leitura; rodada nativa abaixo |
| A02 | O worker possui os processos auxiliares, limita tempo/buffer e cancela com AbortSignal/SIGKILL; desligamento aguarda close/ACK antes de terminar a thread | [Timeout, desligar e sair](native-cancellation-fixed.json); regressão com get-windows e helper real controlado |
| A03 | Revalidação do host antes de ocultar e depois da confirmação; monitoramento de perda do host e restauração da janela | [Electron e D-Bus privados](native-tray-host-loss-fixed.json), testes de corridas de cancelamento/saída |
| A04 | DEB declara `libxt6 \| libxt6t64`, preservando as nove dependências padrão do empacotador | [Depends do DEB gerado e ELF do addon](package-dependencies-fixed.json) conferidos localmente |
| A05 | Exportações rejeitam aliases por caminho e identidade de inode; escrita temporária e rename evitam truncar o inode original | Regressões com hardlinks reais e conteúdo interno preservado; mesma proteção no backup de configuração |
| A06 | Cooldown usa camada e ação de origem, preservado ao trocar de camada manualmente ou por sequência/contexto | Regressões para mesma camada, camada diferente, retorno e limpeza de IDs removidos |
| A07 | Pausa tem prioridade e nunca aguarda o intervalo das ações; retomada tem debounce próprio de 400 ms | Regressão com cooldown de 10 segundos, retomada e pausa imediata |
| A08 | Snapshot único por publicação, revisões de conteúdo/estado, config omitida no transporte quando já enviada, recomposição e descarte de respostas antigas no preload; linhas e teclado reutilizados e menus construídos ao abrir | Regressões de IPC e DOM; comparação de desempenho abaixo |

A limpeza de subprocessos foi demonstrada no Linux. Windows/macOS exercitam o
wrapper e seus processos reais nos testes de CI; o teste específico de xprop é
exclusivo de Linux. Não há promessa de cancelar uma chamada N-API arbitrária
travada nem de desfazer efeitos de ações já concluídas.

O encerramento do main aguarda a limpeza e retoma a saída no próximo ciclo de
evento do Electron. [A prova real de saída](native-main-shutdown-fixed.json)
confirma exit code 0 com o monitor desligado e com um auxiliar bloqueado, sem
filhos restantes. O diagnóstico contínuo também exige saída limpa das três
instâncias abertas, sem contar SIGKILL como sucesso.

## Interface: custo e recomendação

Na sonda de renderer com 100 ações e 40 buscas, no mesmo host e fixture:

| Medida | Antes | Depois |
| --- | ---: | ---: |
| Elementos no documento | 4.092 | 2.892 |
| Controles dos menus fechados | 300 | 0 |
| Elementos adicionados durante 40 buscas | 158.320 | 0 |
| Busca mediana, incluindo layout forçado | 14,8 ms | 0,6 ms |
| Busca p95 | 20,6 ms | 4,4 ms |

Dados: [antes](renderer-before.json), [depois](renderer-after.json). São medições
locais, sem limiar artificial de aprovação. Não equivalem a latência de tecla
física nem ao round-trip de IPC. O teste da UI verifica identidade dos nós,
feedback por ação, menus, foco e atualização de handlers após editar dados.

A proposta para o cadastro de sequências está em [action-flow-ux.md](action-flow-ux.md).
Estas correções preservam a interface atual; o documento descreve a próxima
alteração de produto, sem introduzir novos tipos de execução.

## Pacote final Linux: comparação no mesmo host

Código `1336247`, executável `linux-unpacked` reconstruído. Mesma máquina,
controlador, flags e tamanhos de fixture da auditoria anterior. Perfis temporários
novos e Xvfb; caches do SO e concorrência da máquina não são controlados.
Dados: [antes](linux-performance.json), [depois](linux-performance-fixed.json).

| Medida | Antes | Depois |
| --- | ---: | ---: |
| Edição IPC p95, 2.500 ações, 40 chamadas | 15,0 ms | 10,8 ms |
| Salvar conteúdo idêntico p95, 2.500 ações, 5 chamadas | 46,0 ms | 37,3 ms |
| Tamanho persistido, 2.500 ações | 548.895 bytes | 254.920 bytes |
| Elementos após interações, 100 ações visíveis | 4.033 | 2.833 |
| Nós após GC, antes/depois de cinco ciclos | 5.498 / 5.498 | 3.998 / 3.998 |
| Listeners antes/depois dos mesmos ciclos | 653 / 653 | 553 / 553 |
| PSS base pausado | 219,1 MiB | 218,5 MiB |
| Inicialização mediana, cinco processos | 277,3 ms | 286,3 ms |

As melhorias não são uniformes nem constituem uma garantia de latência. Com 100
ações, o p95 de saves idênticos variou de 4,4 para 5,4 ms; a mediana caiu de 3,6
para 2,6 ms. Com apenas cinco saves, p95 corresponde ao maior valor. A rodada
final observou duas long tasks de 103 e 50 ms; não certifica ausência de pausas.
A memória após muitas interações caiu na amostra, mas PSS antes de GC não prova
um vazamento nem sua correção. Após GC, nós/listeners ficaram estáveis nos ciclos
exercitados e o heap usado não cresceu nessa amostra. O IPC de teclas medido é
sintético e não equivale à latência de um teclado físico.

## Validação e distribuição

- **102 testes locais passaram**, incluindo limites de configuração, processos
  reais, aliases de arquivo, cooldown, pausa, ordem de estados e fechamento.
  Sintaxe e `git diff --check` passaram.
- Smoke completo em Electron Linux passou: CRUD, produtividade, HTTP real,
  rascunhos, foco, temas, 90 geometrias de teclado, 14 tamanhos de drawer,
  112 combinações responsivas e regressões de reutilização de DOM.
- [Platform audit 39479659479](https://github.com/raulaguila/key-tracker/actions/runs/39479659479)
  aprovou o código `1336247` em **Windows x64, macOS ARM64 e Linux x64**.
  Cada job construiu o pacote, conferiu 15 arquivos ASAR e executou Electron real
  a partir do mesmo source, em perfil temporário.
- O diagnóstico exigiu configuração canônica de 254.920 bytes, leitura do backup
  legado de 548.895 bytes, reload do renderer/preload, estados completos/ordenados
  e saída limpa com código 0 das três instâncias de cada sistema.
- [Desktop 39479659642](https://github.com/raulaguila/key-tracker/actions/runs/39479659642)
  também passou nos três sistemas: testes e sintaxe, smoke de UI em Linux e
  geração dos instaladores Windows NSIS, macOS DMG/ZIP e Linux AppImage/DEB.
  Os instaladores estão nos artifacts desse run; não foram publicados em release.

| Evidência | Windows x64 | macOS ARM64 | Linux x64 |
| --- | --- | --- | --- |
| Abertura/IPC/persistência/clipboard/lançamento/ASAR (`corePassed`) | Passou | Passou | Passou |
| Backup canônico e legado formatado | Passou | Passou | Passou |
| Estado completo e revisões ordenadas | Passou | Passou | Passou |
| Saída limpa, três instâncias | Passou | Passou | Passou |
| Worker de rastreio | Global/ready | Global/ready | Global/ready |
| Notificação | API confirmou exibição | Exibição não confirmada | Indisponível no runner |
| Bandeja | Disponível | Disponível | Sem host no display |
| Aplicativo externo em foco | Não identificado nesta sonda | Não identificado nesta sonda | Ferramentas X11 ausentes |

JSONs: [Windows](platform-win32-x64-fixed.json),
[macOS](platform-darwin-arm64-fixed.json), [Linux](platform-linux-x64-fixed.json).
O build instalado/assinado, permissões concedidas por usuário, entrega de tecla
física, IMEs, todos os layouts e compositores Wayland continuam exigindo hardware
e ambientes de distribuição. A aprovação acima não transforma essas pendências
em suporte integral certificado.
