# Bridge plan — Delay entre etapas de sequência

<!-- bridge:plan-schema 1 -->

## Checklist

- [x] /keel build intervalo entre etapas e prévia congelada
- [x] /impeccable craft campo de sequência e apresentação dos tempos
- [x] /bridge sync histórico, persistência, documentação e regressões
- [ ] /bridge ship testes, builds e commit

Sync sem lacunas: configuração opcional preserva legado; prévia e evento usam
`stepDelayMs` efetivo; renderer e exportação consomem o mesmo campo. Provas locais:
139 testes passaram; sintaxe, UI completa, XTest Linux e pacote/sonda Electron
passaram. Sonda mediu 82 ms para intervalo de 80 ms e confirmou clipboard final.
Quatro capturas do novo campo conferidas em light/dark, zoom 100%/125%.
Pendente: commit e CI dos três sistemas.
