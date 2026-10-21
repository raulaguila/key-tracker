# Performance, inicialização e parada — 21/10/2026

Implementação no commit
[`fd8db50`](https://github.com/raulaguila/key-tracker/commit/fd8db503de87c15750f398fdff9fd3d79d0910fa).
As sete melhorias aprovadas foram implementadas e verificadas localmente.
O CI do mesmo SHA também concluiu com sucesso; evidências abaixo.

## Mudanças

| Item | Comportamento e evidência |
| --- | --- |
| Parada coordenada | Para novos disparos, cancela ações, aguarda worker de entrada, operações IPC aceitas e filas de configuração/histórico. Após 10 s de espera, oferece continuar aguardando ou sair explicitamente com pendências. “Parar todas” informa `stopping` e bloqueia reativação até finalizar. |
| Estado mais leve | Publicações reutilizam configuração profundamente imutável por revisão; leituras explícitas mantêm cópia independente. [Regressões](../../../test/performance-lifecycle.test.cjs) e [microbenchmark](state-benchmark.json). |
| Preparação visível | Janela com skeleton/texto e controles indisponíveis durante o preparo. Cofre mantém seu prazo de 5 s por chamada. Fechar durante a preparação não cria serviços depois. |
| Backup diferido | A configuração principal é carregada antes da checagem preventiva do backup. A UI informa `backupChecking`; recuperação de falha ainda valida backup antes de oferecê-lo. |
| Gravação idêntica | Conteúdo canônico idêntico preserva inode/backup; continua validando o arquivo atual. Legado indentado e migração de headers ainda são normalizados e gravados com proteção. |
| Segundo plano | Progresso visual agrupado por 16 ms; controles e resultados têm prioridade. Uma janela oculta conserva só o último State. Teclas permanecem sincronizadas em memória, com redesenho do teclado ao mostrar. Input/cancelamento do motor não dependem desse agendamento. |
| Gates de lifecycle | Novo `test:lifecycle` nos quatro destinos; prova nativa Linux ampliada com tecla mantida durante parar/encerrar e confirmação de saída do worker. |

## Provas locais

- Sintaxe e **187 testes passaram**, sem skips/falhas. Incluem isolamento do cache,
  revisão, conclusão da parada, deadline, flush após cancelamento, backup diferido,
  ausência de gravações idênticas e entrega do fechamento recebido durante preparo.
- Smoke completo de UI passou: 112 combinações responsivas, 90 de teclado,
  cancelamento, persistência, foco/rascunhos/temas. Axe em 14 estados nos dois
  temas: zero violações WCAG A/AA reportadas.
- [Lifecycle real](lifecycle-linux-x64.json): janela visível com provedor do cofre
  pendente, fechar antes da carga, 50 publicações ocultas entregues como uma ao
  mostrar, HTTP em voo cancelado, próxima etapa bloqueada, configuração aceita
  antes de sair concluída, backup legível, registro final e reabertura preservada.
  A saída sob carga levou cerca de 0,7 s, incluindo delays artificiais de escrita.
- [XTest real](native-input.json): parada/encerramento com tecla mantida não geram
  repetição ou release tardios; worker saiu e não restou execução.
- [Pacote/integração](platform-linux-x64.json): 28 arquivos de produção no ASAR
  coincidem com o source; núcleo e saídas normais aprovados. Limitações do desktop
  virtual, como confirmação de notificação e bandeja, continuam explícitas.
- [Carga por 120 s](stability.json): workload com concorrência limitada, arquivos
  temporários e HTTP em loopback, sem execuções residuais.

## Medições e limites

[Microbenchmark reproduzível](benchmark-state.cjs), sobre a base `7e8a938`, com
2.500 ações, 100 eventos e cinco rodadas de 100 publicações:

| Custo do produtor Node | Antes | Depois |
| --- | --- | --- |
| Mediana por 100 publicações | 187,78 ms | 5,51 ms |

Redução de aproximadamente 97% nesse trecho isolado. Não inclui Electron IPC,
contextBridge, DOM ou execução de efeitos; não é aceleração de 34 vezes do app.
Reprodução: `node docs/audits/2026-10-21-performance-lifecycle/benchmark-state.cjs`.
É necessário que o histórico contenha o commit base.

O [laboratório do executável final](performance.json) registrou:

- Interface utilizável mediana de 280,7 ms; inicialização incluindo conexão ao
  inspector e leitura explícita de State mediana de 282,5 ms, cinco amostras.
- Com 2.500 ações, salvar sem alteração: mediana de 46,2 ms e p95 de 47,5 ms.
  O teste unitário confirma zero trocas atômicas nesse caso.
- IPC de tecla até DOM: mediana de 0,48 ms e p95 de 0,69 ms, 240 amostras;
  não é a latência física do teclado.
- PSS amostrado: 224,1 MiB pausado e 531,8 MiB com configuração grande.
- Um long task de 112 ms foi registrado no início. Merece acompanhamento de
  startup em hardware mais lento; não foi atribuída uma causa por esse registro.

Máquina compartilhada, Linux x64, Xvfb, GPU desabilitada e cofre GNOME descartável.
A leitura explícita de State foi acrescentada ao marco `startupMs`; `interfaces`
registra o marco anterior de interface utilizável, não o primeiro paint. As
condições do cofre e o marco de cálculo diferem do relatório anterior, por isso
não se afirma redução causal do tempo total de startup. O benefício comprovado
na inicialização é a interface de preparo visível com cofre ainda pendente.

Os JSONs medidos antes do commit carregam a base `7e8a938`; o worktree de produção
corresponde a `fd8db50`, confirmado pelo ASAR e pelo CI. Perfis, dados e endpoints
são descartáveis. A fixture do lifecycle injeta indisponibilidade/esperas apenas
na entrada de teste, excluída do pacote. Não há bypass de cofre no produto.

O encerramento tem espera limitada e não desfaz efeitos externos. Sair com
pendências pode interromper gravações ainda não concluídas. Nem esses testes,
nem o CI substituem instalação em máquina limpa, assinatura/notarização, disco
cheio, logout/desligamento do SO ou teclado físico. [QA de produção](../../PRODUCTION.md).


## CI do código publicado

- [Desktop](https://github.com/raulaguila/key-tracker/actions/runs/39627134958):
  Windows x64, Linux x64, macOS ARM64 e macOS Intel x64. Lifecycle e testes
  aprovados nos quatro; UI/axe e XTest no Linux; instaladores e execução
  empacotada nos quatro destinos.
- [Platform audit](https://github.com/raulaguila/key-tracker/actions/runs/39627135006):
  integração e comparação do ASAR nos quatro destinos.
- [Dependency security](https://github.com/raulaguila/key-tracker/actions/runs/39627134926):
  aprovado com bloqueio a partir de moderado.

Os três workflows têm conclusão `success`. Todas as etapas dos nove jobs,
inclusive `Complete job`, estão concluídas com sucesso ou puladas pela condição
prevista. A API consultada ainda retorna `in_progress`/conclusão nula no cabeçalho
de três jobs, apesar das etapas finais aprovadas e dos workflows concluídos.
Esses campos originais foram preservados no [JSON de CI](ci.json), com a
verificação das etapas em campo separado; não foram substituídos por estados
inventados. Os artifacts são builds de desenvolvimento, sem validação de assinatura.
