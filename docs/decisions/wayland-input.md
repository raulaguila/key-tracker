# ADR: observação passiva no Wayland

Status: accepted — proposta autorizada pelo usuário em 21/10/2026.
Mode: Control / Integrate
Date: 2026-10-21

## Decisão

Reutilizar Engine/Tracker e adicionar um serviço Linux de leitura evdev, com
processo Electron sem privilégios. Serviço Python isolado (-I), GIO/D-Bus,
libevdev e libudev do sistema; sem dependências Python baixadas em execução.
Polkit autoriza uma conexão do usuário local ativo. A sessão é vinculada ao
nome único D-Bus do cliente e à sessão/seat verificados pelo logind.
O PID real deve pertencer à sessão informada; processos iniciados pelo gerenciador
do usuário sem sessão própria usam somente o Display gráfico desse UID no logind.

A interface oferece habilitar/desabilitar, confirma o alcance da autorização,
informa falta do componente e não abre autenticação automaticamente ao iniciar.
O backend só entrega teclas configuradas/modificadores; rastreio visual completo
é uma opção explícita na mesma sessão. Não há Unicode, conteúdo digitado,
rede, comandos arbitrários, dispositivos enviados pelo cliente ou EVIOCGRAB.

## Contratos e falhas

Uma sessão por usuário, até 256 posições filtradas e até 32 teclados no seat.
Eventos direcionados ao cliente autenticado, não broadcast. Perda do cliente,
bloqueio, suspensão ou troca de sessão fecha dispositivos e a autorização;
reativação é explícita. Falha de sincronização/hotplug cancela gestos, sem
fabricar solturas. Sem logind/Polkit, falha fechada e rastreio local disponível.
O transporte inclui relógio monotônico para interromper entrada retida por mais
de 1 s no cliente. Esse é um limite de segurança funcional, não um SLO de latência.

O instalador integra serviço, política D-Bus e Polkit. O AppImage usa o mesmo
componente instalado no sistema. Windows/macOS/X11 mantêm o backend atual.

## Alternativas

- GlobalShortcuts: não oferece observação passiva geral para o Rastreio.
- InputCapture: captura direcionada pelo compositor, não escuta passiva contínua.
- Grupo input ou Electron root: acesso amplo e persistente rejeitado.
- Novo motor de ações/banco: desnecessário; eventos normalizados usam o contrato atual.

## Verificação

Autorização/negação e proprietário no D-Bus privado, sessão e lock simulados,
processamento evdev e múltiplos teclados, SYN_DROPPED/hotplug/desconexão, UI e
pacote. Teste em GNOME/KDE instalados com hardware real é evidência separada;
não presumir que um teste em Xvfb ou CI certifica compositor ou lock de produção.
