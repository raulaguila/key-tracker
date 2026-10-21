# Produtividade — 2026-10-21

Aceite: CONTRACT.md e docs/decisions/productivity.md. Oito itens aceitos pelo usuário.

Donos: Engine (controles/gestos/histórico), actions+sequence-data (dados efêmeros),
layer-library (transformações puras), product-services (IPC/plano com revisão),
quick-panel (projeção isolada), tracking+input-devices (origem nativa).

Limites:10 snapshots/planos,5min por plano,64KiB por resposta,10s incluindo leitura,
condições somente em resultados anteriores,sem eval/protótipos,mesmos limites de
camadas/ações/arquivo existentes. Importação remove headers/associações na cópia;
persistência precede troca; falha preserva estado; revisão invalida planos e prévias.

Prova: testes Node de biblioteca/serviços/motor/ações/dispositivos; teste Python
DBus/evdev; Electron UI e acessibilidade; lifecycle; X11 receiver; pacote Linux e
ASAR; CI Windows x64/macOS Intel/ARM/Linux. Hardware físico e certificados reais
são roteiro externo obrigatório, não conclusão inferida de mocks ou self-test.
