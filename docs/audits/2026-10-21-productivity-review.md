# Auditoria das novas funcionalidades — 21/10/2026

Escopo: oito funcionalidades da expansão de produtividade, com revisão de
funcionamento, concorrência, performance, UI/UX e integração. Autorização: corrigir
os problemas encontrados. Base: commit `69466ef`. As provas usam perfis, servidores,
barramentos e displays temporários; não observam teclados físicos do usuário.

## Problemas reproduzidos e corrigidos

| Prioridade | Problema e impacto | Correção / prova |
| --- | --- | --- |
| P1 | Padrão do painel invalidava configuração v1 que já usava a combinação | Resolver padrão somente sem conflito, manter a configuração e informar motivo; testes de binding e controle legado |
| P2 | Campo vazio prometia desabilitar painel, mas era rejeitado e não sobrevivia à exportação por camada | Aceitar/preservar vazio, expor atalho resolvido e encerrar observação desnecessária no uso apenas de Rastreio |
| P2 | Ação capturada em posição física de controle parecia disponível; importação protegia só o nome lógico | Detectar/reportar conflito físico no motor e preservar controles físicos na importação, incluindo aliases Plus/Equal e Command/Super |
| P2 | Revisão de importação normalizava os mesmos atalhos milhares de vezes, bloqueando main | Cache de assinaturas por plano, compartilhando regras de posição; resultado e conflitos preservados |
| P2 | Captura HTTP em muitos chunks acumulava reações e impedia event loop de atender cancelamento/UI | Buffer fixo 64 KiB, listener removido por leitura e yield periódico; limites/timeout preservados |
| P1 | Modificador inicial mantido podia produzir ação como se estivesse solto | Suprimir novas combinações até liberar modificador cuja origem inicial não é conhecida |
| P1 | Soltura de outro teclado liberava baseline inicial global do Windows | Consultar estado global e preservar bloqueio enquanto a tecla continua mantida |
| P1 | Recalibrar timestamp na entrega de ready podia tratar backlog antigo como fresco | Usar relógio monotônico comum ao runtime e validar origem no self-test de build |
| P1 | Ativar com dispositivo ausente/em espera deixava motor habilitado para retomada no hotplug | Impedir ativação; chegada do teclado mantém ações pausadas até comando explícito |
| P2 | Ocultar painel antes de ready fazia a janela reaparecer | Preservar última intenção de visibilidade e testar show/hide durante carga |
| P1 | Painel reconstruía DOM em cada evento, perdendo foco; também podia sobrescrever estado novo no bootstrap | Cache/dedup no main, linhas estáveis no renderer, assinatura antes do snapshot e revision monotônica |
| P2 | Painel indicava ações ativas durante edição/parada | Projeção mínima inclui editing/stopping e estados distintos nos dois temas |
| P1 | Catálogo Linux válido acima 4 KiB era truncado no socket, encerrando captura | Frame até 64 KiB, buffer limitado compatível e detecção explícita de truncamento; prova FD com 32 nomes Unicode |
| P2 | Limites de nome divergiam entre Python (codepoints) e JS (UTF16 | Contagem consistente por codepoints, com regressão para caracteres fora do BMP |
| P1 | Fechar assistente durante ativação deixava o rastreio ligado após resposta tardia | Guard de ciclo de vida e término ordenado do teste, incluindo fechamento antes doACK |
| P1 | Revisão assíncrona podia reabilitar plano antigo após mudar seleção/destino | Versão local de seleção, invalidação de plano e proteção durante aplicação |
| P2 | ArrowUp na busca escolhia penúltimo resultado | Navegação corrigida para último resultado a partir do campo |
| P2 | Importador criava todos os atalhos de todas as camadas de imediato | Resumo limitado por camada e expansão sob demanda, sem ocultar contagem/dependências |
| P1 | Formulários recebiam digitação antes de confirmar suspensão do motor | Campos inert até ACK; progresso/erro explícitos e fechamento disponível |
| P2 | Aviso descartava motivos concretos do backend, mostrando recomendação genérica | Mensagens de falha contextualizadas e limitadas para listas grandes |

As regras de segurança existentes foram preservadas: prévia sem efeitos, resposta
HTTP efêmera, revalidação de destinos/headers, proteção de arquivos internos, IPC
por origem, exportação sem headers e undo/redo limitado à configuração da sessão.

## Medições

| Ensaio | Antes | Depois | Escopo |
| --- | --- | --- | --- |
| Planejar mescla de 1960 ações válidas,185215 B | Mediana 923,4 ms (5 amostras) | Cerca 54 ms (5 amostras; varia com carga) | ProcessoNode local; mesmo cenário/host, sem hardware de teclado |
| HTTP 64 KiB em 65536 chunks de 1 B |61,6 MB de heap adicional;121,9 ms até 1ª volta do loop |5,2 MB;26,8 ms até 1ª volta | WebStream real com fronteiraHTTP injetada; nãoTCP em produção |
| Importador com 1960 ações válidas |6775 nós/1960 atalhos |Cerca 1721 nós/120 atalhos iniciais | Electron, conteúdo expandível; reduziuDOM em cerca 75% |
| Painel,1000 eventos idênticos |1000 novosIPCs |0 novosIPCs/projeções de bindings | Somente fronteira de projeção do main |
| Painel,10000 eventos idênticos após correção |— |2,374 ms;0 novasprojeções/IPCs | Medição isolada do main; não mede teclado/SO/DOM |
| Renderer do painel,25 estados repetidos |25 mutações e perda de foco |0 mutações, foco preservado | Electron real, botão focado |

As amostras não definem SLA nem permitem comparar SOs. Reprodução da mescla:
`node scripts/productivity-performance.cjs`. Regressões de HTTP incluem fairness,
limites exatos, cancelamento, timeout de leitura, amplificação e destinos privados.
O teste UI cobre buscas com/sem resultados, importação grande, corridas e painel.

## Matriz funcional e evidência

| Recurso | Caminhos cobertos |
| --- | --- |
| Camada temporária | Pressionar/manter/soltar, modificadores, retorno, pausa/edição/aplicativo/perda de entrada |
| Painel | Projeção privada/origemIPC, foco/teclado/temas, estado/snapshot/visibilidade e atualizações repetidas |
| Assistente | Teste local/global pausado, retomada, encerramento durante ativação, suspensão antes da edição |
| Modelos/importação/exportação |Catálogo 3 modelos, seleção/dependências/ciclos, mescla/replace/skip, controles físicos, headers, revisão/expiração e erro de persistência |
| Busca |Ctrl/Cmd+K, navegação, editar/usar camada sem disparar efeito, listas grandes e estado vazio |
| Teclados |Seleção/agregação, modificadores isolados, baseline, ausência/hotplug, Unicode, backlog e encerramento |
| Sequências |Resultados/condições/skipped, delays, prévia congelada, leitura 64 KiB/10 s, privacidade e cancelamento |
| Undo/redo |10 versões, falha de gravação/refazer, nova edição, parada e ausência de rollback externo |

Gates locais: rodada integrada Node 264/264; regressões de dispositivos/painel 42/42;
Linux 22/22 com D-Bus/GIO/FD privados; soak 300 execuções; lifecycle e XTest com receptor
externo aprovados. A suíte visual completa e o guia Linux focado passaram: 24 estados axe sem
violações detectadas, 112 combinações responsivas mais quatro do importador e
90 geometrias. O pacote passou com 45 fontes correspondentes ao ASAR. Prontidão
local mediana: 198,9 ms (três amostras); encerramento limpo: 45,1–74,5 ms. São
medidas de Electron em desenvolvimento/perfil temporário com caches aquecidos,
não garantia de startup frio ou de outros computadores. O CI é acompanhado no
fechamento da entrega. Ver execução do commit em
[Desktop](https://github.com/raulaguila/key-tracker/actions/workflows/desktop.yml) e
[Platform audit](https://github.com/raulaguila/key-tracker/actions/workflows/platform-audit.yml).

## Limites de prova

Durante a auditoria, o usuário encontrou o componente Linux ausente. O fluxo agora
oferece download na origem disponível e abertura assistida do .deb já baixado,
com ações e rastreio pausados antes do diálogo. Não há releases públicas na consulta feita
nesta entrega; o link aponta honestamente para os builds de teste em Actions.
O seletor é nativo e o instalador do SO pede a autorização. Foram testados
cancelamento, arquivos inválidos, ausência de associação, plataformas incompatíveis
e recuperação na interface; não foi instalado nenhum pacote no host.

SDK e self-test dos helpers Windows/macOS são validados no CI, sem ler teclados.
Captura física com dois teclados, Monitoramento de Entrada, permissões instaladas,
GNOME/KDE reais, assinatura e notarização continuam exigindo QA/credenciais próprios.
Nenhum serviço foi instalado no host e nenhuma release pública foi criada.

## Avaliação de interface

Pontuação heurística desktop: 13/20 → 19/20. Acessibilidade 2→3/4; performance
2→4/4; responsividade 3→4/4; temas 3→4/4; interação/clareza 3→4/4. A melhoria
se baseia nas regressões reproduzidas acima, no foco preservado, na redução de
nós e nas validações nos dois temas. Não equivale a certificação WCAG: leitores
de tela e hardware físico não foram validados manualmente nesta auditoria.
