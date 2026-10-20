# Correções da auditoria de plataformas

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
