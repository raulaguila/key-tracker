# Correções da auditoria — F01 a F05

Registro de 21/10/2026. Os cinco achados da
[auditoria completa](../2026-10-21-full/report.md) foram corrigidos e passaram
nas verificações locais. A validação CI do commit publicado é registrada após
o envio. [Resumo verificável](summary.json) · [Índice](../README.md).

## Alterações e regressões

| Achado | Correção | Prova |
| --- | --- | --- |
| F01 — integridade de arquivos | Ações recusam o perfil interno e arquivos protegidos, incluindo identidade por hardlink e caminhos por symlink/junction. Validam prévia e execução. Uma alteração de configuração durante a consulta invalida a prévia. | [Regressões](../../../test/action-file-protection.test.cjs): configuração, backup, logs atuais/rotacionados, alias criado depois da prévia, novo destino sob alias e pasta externa com prefixo parecido. Bytes preservados e erro explícito. |
| F02 — cofre sem resposta | Disponibilidade, encrypt e decrypt limitados a cinco segundos por chamada; respostas tardias descartadas e backend seguro revalidado. Estado de indisponibilidade informa desbloqueio/reabertura. | [Regressões](../../../test/config-protection.test.cjs): arranque com provedor pendente, falha de gravação sem alteração em disco, fila liberada, recuperação e resultado tardio sem gravação. [Prazo real padrão](keyring-deadline.json): 5.005 ms, indisponibilidade explícita. |
| F03 — ARIA | Removido o nome ARIA proibido do contêiner genérico da marca. Axe integrado ao smoke real. | [Gate de UI](../../../scripts/accessibility-ui.cjs): quatro telas e três drawers nos dois temas, 14 estados sem violações WCAG A/AA reportadas. |
| F04 — dependência vulnerável | Override de global-agent 4.1.3 remove a cadeia roarr/sprintf-js, preservando o downloader existente. CI e release bloqueiam a partir de moderado. | [Audit npm](npm-audit.json): zero alertas na data; [teste de proxy](../../../test/build-proxy.test.cjs) confirma bootstrap CommonJS e encaminhamento HTTP em loopback. Instalação e empacotamento passaram. |
| F05 — runtime | Electron atualizado de 44.9.1 para 44.9.3, inclusive no pacote gerado. | [Entrada nativa](native-input.json), [performance](performance.json) e [segurança do executável](security-runtime.json). |

Não houve alteração do formato v1 nem das assinaturas públicas do preload.
A prévia interna do motor passou a aguardar a validação dos destinos. A pasta
interna protegida não é destino válido para arquivos de automação; escolha uma
pasta de documentos ou outra pasta externa.

## Verificações locais

- `npm run check` e **179 testes**, sem falhas ou skips, incluindo proxy e
  regressões de F01/F02. O fixture que antes gravava no perfil passou a usar uma
  pasta de efeitos separada, preservando o exercício real de criação e append.
- Smoke Electron completo: CRUD, persistência, HTTP, temas, foco/drawers,
  proteção de rascunhos, 112 combinações responsivas, 90 de teclado e gate axe.
  Axe não substitui avaliação humana; seus apontamentos incompletos de contraste
  para símbolos do teclado foram conferidos por razão calculada, 14,14/14,66.
- `npm run pack`: executável Linux x64 com Electron 44.9.3. Os 25 módulos
  comparados pelo [harness](../../../scripts/platform-audit.cjs), além do HTML da
  marca, correspondem ao source. Axe não está no ASAR.
- [Sonda nativa](platform-linux-x64.json): persistência, clipboard, sequência,
  cancelamento, lançamento, registro e rastreio aprovados. Bandeja, identificação
  de aplicativo e confirmação de notificação indisponíveis no Xvfb são reportadas
  como limitação, sem sucesso falso.
- [Segurança do executável](security-runtime.json): sandbox/context isolation,
  Node ausente no renderer, CSP bloqueando conexão, URL inválida recusada,
  IPC de outra janela recusado e round-trip com GNOME libsecret descartável.
- [XTest](native-input.json): pressionar/manter/soltar, modificadores,
  pausa/edição/cancelamento e ciclo do worker, em display isolado.
- [Estabilidade por 120 segundos](stability.json): 20.068 execuções, 16.052
  conclusões, 4.016 cancelamentos e 2.008 gravações, concorrência máxima quatro.

## Performance e limites

O [laboratório](performance.json) usa Linux x64, Xvfb e GPU desabilitada,
na mesma máquina compartilhada da auditoria anterior. Inicialização mediana:
**233,5 ms** em cinco amostras (antes: 246,5 ms). IPC de tecla até DOM:
**p95 1,47 ms** em 240 amostras (antes: 1,64 ms). Esses números não medem a
latência física do teclado nem demonstram ganho causal; caches e carga variam.

Com 2.500 ações, busca síncrona p95 de 1,7 ms e abertura de drawer p95 de
23,1 ms. Após os ciclos de navegação/edição, documentos, nós e listeners mantiveram
as contagens; nenhum long task capturado. Isso é uma observação limitada, não
prova de ausência de vazamento em uso prolongado. O footprint do Electron continua
relevante: PSS amostrado de 226,5 MiB pausado e 566,2 MiB com configuração grande.

As medições foram feitas no worktree corrigido sobre a base `01f63d8`; por isso
os campos `commit` dos harnesses indicam essa base. O CI associa os resultados
ao SHA versionado. Perfis, cofre, arquivos e HTTP de teste são descartáveis e
isolados; não foram usadas credenciais pessoais.

O prazo limita a espera JavaScript, não cancela uma operação nativa sem API de
cancelamento. Respostas tardias não autorizam persistência. A proteção de destinos
não pretende ser sandbox contra alteração maliciosa concorrente do filesystem.
Audit npm não cobre vulnerabilidades desconhecidas ou todos os componentes
binários do Chromium. Assinatura, notarização, instalador em máquina limpa,
permissões e teclado físico/Wayland continuam nos gates de
[produção](../../PRODUCTION.md).
