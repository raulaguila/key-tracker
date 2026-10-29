# Auditorias e evidências

[Documentação atual](../README.md) · [QA de produção](../PRODUCTION.md)

Os relatórios abaixo são registros datados de implementações e ambientes
específicos. Preserve seus commits, JSONs e capturas ao interpretar resultados.
Um teste aprovado num relatório não certifica uma versão posterior, instalação
real, assinatura ou todos os teclados/sistemas.

| Registro | Assunto |
| --- | --- |
| [2026-10-29 — Fluxos de cliques e teclas](2026-10-29-macros.md) | Gravação/edição, 319 testes, prova nativa X11 em outro aplicativo e limites reais por sistema |
| [2026-10-29 — Impeccable após alvos de toque](2026-10-29-impeccable/report.json) | 20/20 no escopo verificado: P2 resolvido; captura e expansíveis com pelo menos 44 px, 24 combinações de toque e 31 cenários Orca aprovados |
| [2026-10-28 — Impeccable após Orca](2026-10-28-impeccable/report.json) | Avaliação técnica 19/20: acessibilidade, temas, desempenho e responsividade; 31 cenários Orca aprovados e um P2 de alvos de toque |
| [2026-10-21 — Integração Wayland](2026-10-21-wayland-input/report.md) | Serviço passivo, autorização, sessão, IPC privado, UI e pacote; hardware instalado pendente |
| [2026-10-21 — Performance e lifecycle](2026-10-21-performance-lifecycle/report.md) | Preparação visível, estado mais leve, parada coordenada e gates nativos |
| [2026-10-21 — Correções F01–F05](2026-10-21-remediation/report.md) | Integridade, prazo do cofre, acessibilidade, dependências e patch do Electron |
| [2026-10-21 — Auditoria completa](2026-10-21-full/report.md) | Performance, segurança, funcionamento, UI/UX e duas falhas prioritárias reproduzidas |
| [2026-10-21 — Dobra](2026-10-21-dobra/report.md) | Identidade, integração e CI após a renomeação |
| [2026-10-20 — Produção](2026-10-20-production/report.md) | Recuperação, cofre, cancelamento, estabilidade e distribuição |
| [2026-10-20 — Momentos da tecla](2026-10-20-key-moments/report.md) | Pressionar/manter/soltar e temporização |
| [2026-10-20 — Plataformas](2026-10-20-platforms/report.md) | Compatibilidade, integração e desempenho por destino |
| [2026-10-20 — UI e desempenho](2026-10-20/report.md) | Avaliação da interface e resposta local |

Material complementar de plataformas: [fluxo de ações](2026-10-20-platforms/action-flow-ux.md),
[motor](2026-10-20-platforms/engine-findings.md),
[integração nativa](2026-10-20-platforms/native-review.md) e
[correções](2026-10-20-platforms/remediation.md).

O [registro inicial de UI/UX](../UI_UX_AUDIT.md) e os
[protótipos](../prototypes/README.md) também são históricos. Nomes antigos podem
aparecer nesses materiais porque descrevem o produto no momento da avaliação.
Os guias atuais são a referência para uso e desenvolvimento.
