# Surface: Wayland input

## Mode
Control / Integrate

## Job to be done
Observar teclas sem bloqueá-las, usando o motor atual de ações e Rastreio.

## Non-goals
Injetar/remapear entrada, executar ações no serviço privilegiado, observar outras
sessões, persistir digitação, certificar hardware/compositores sem prova instalada.

## Boundary / ownership
Electron mantém configuração e efeitos. Serviço Linux é dono apenas dos FDs de
teclados evdev autorizados; ponte Python sem privilégios transporta códigos.
D-Bus Start usa UID real, logind e Polkit. Stream privado SOCK_SEQPACKET limitado,
sem descritores dos dispositivos ou sinais de teclado broadcast.

## Contracts
Input1 v1: Version, Start(session, keys, visual, observe)->FD; Configure, Ping, Stop.
Até 16 sessões globais/uma por UID, 256 posições, 32 teclados/seat. Heartbeat em
2 s e revogação após 6 s sem renovação. API GUI: setLinuxInputEnabled(boolean).
Configuração exportada não contém autorização. Snapshot cancela gesto e bloqueia
teclas mantidas até soltura; não sintetiza ações. Sem reconexão automática.
Eventos em trânsito há mais de 1 s encerram a sessão antes de executar ações.

## Failure / observability
Negação, serviço ausente, espera por teclado e sessão perdida têm estado explícito.
Lock, troca de sessão, suspensão, owner perdido ou fila cheia fecham dispositivos.
Sem logs de teclas/conteúdo, rede, ações ou caminhos de dispositivo no cliente.

## Delivery
.deb instala payload root:root 0644, unit systemd ativada por D-Bus e políticas.
AppImage usa o mesmo componente já instalado. Testes: npm run test:wayland,
npm test, test:ui, inspeção real do .deb e CI nos quatro destinos.

## ADR / Status
[Decisão aceita](../../docs/decisions/wayland-input.md). Implementado; QA de GNOME/
KDE instalado e hardware real permanece uma evidência separada e necessária.
