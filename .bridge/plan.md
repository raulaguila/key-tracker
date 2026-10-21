# Bridge plan — Preparação para produção

<!-- bridge:plan-schema 1 -->

## Checklist

- [x] /keel build proteção nativa e recuperação da configuração
- [x] /keel build cancelamento, progresso, diagnóstico e estabilidade
- [x] /impeccable craft controles de execução, proteção e recuperação
- [x] /bridge sync IPC, startup, exportações e compatibilidade
- [x] /bridge preparar CI Intel e distribuição assinada, documentação e gates
- [ ] Commit e envio à main; conferir CI e registrar limitações externas

Contrato aceito pela autorização de implementar todas as melhorias. Assinatura
real requer certificados do distribuidor; QA físico requer máquinas/permissões.
Esses passos serão preparados sem inventar resultados ou publicar release.

Sync sem lacunas confirmadas entre State/API/UI. Revisão cruzada de recuperação,
exportação e IPC sem P0/P1. Dois problemas do novo harness/release foram achados
e corrigidos: perfil empacotado usa usuário CI e tag existente deve apontar ao SHA
construído, incluindo tags anotadas (antes do build e novamente antes do draft).
Provas locais: testes, UI completa, cofre nativo isolado, XTest e integração
Electron Linux passaram; carga de 60 segundos fez 10.088 execuções/1.010 saves.
Pendente: commit/push e CI real dos quatro targets.
