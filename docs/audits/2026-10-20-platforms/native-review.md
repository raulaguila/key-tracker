# Auditoria nativa — base 77a360d

Somente leitura de código e testes. Ao concluir, HEAD era 8a6c78d; o diff adicionou apenas workflow/script de diagnóstico, sem alterar os arquivos auditados. Nenhum aplicativo, teste ou configuração real foi editado. Os 19 testes focados dos serviços passaram.

## Achados confirmados

### P2 — Worker encerrado deixa subprocesso nativo vivo

- **Local:** `app/application-monitor.cjs:30`, `:112`; `app/application-reader.cjs:32`.
- **SO:** Linux/X11 confirmado; adaptador macOS também utiliza `execFile`, sem reprodução no macOS.
- **Prova:** worker importou get-windows real, com PATH controlado contendo xprop temporário que executava sleep. Após `worker.terminate()` concluir, o filho continuava vivo; limpeza o encerrou explicitamente. Evidência: [native-worker-child-lifetime.json](native-worker-child-lifetime.json).
- **Impacto:** leitura bloqueada sobrevive a timeout/desligamento; tentativas seguintes podem acumular subprocessos.
- **Recomendação:** a borda que cria execFile precisa possuir timeout/AbortSignal e encerramento explícito, ou processo/grupo com limpeza de todos os filhos.
- **Limite:** bloqueio simulado de dependência; nenhum travamento espontâneo de xprop/Swift saudável foi observado.

### P2 — Perda do host da bandeja mantém ocultação permitida

- **Local:** `app/desktop-tray.cjs:4`, `:75`, `:106`; `app/main.cjs:72`, `:159`.
- **SO:** Linux, com StatusNotifier em X11 ou Wayland.
- **Prova:** Electron 44.9.1 real em D-Bus/Xvfb privados; host existia na criação e foi encerrado depois. A consulta passou para false, mas refresh nativo não lançou erro: `tray.available` e `desktop.trayAvailable` continuaram true. Evidência: [native-tray-host-loss.json](native-tray-host-loss.json).
- **Impacto:** closeToTray ainda permite ocultar quando o host desapareceu; usuário perde o caminho normal de reabertura pela bandeja até iniciar outra instância ou o host retornar.
- **Recomendação:** revalidar antes de ocultar e acompanhar NameOwnerChanged para restaurar a janela ao perder o host.
- **Limite:** host/protocolo controlado, sem painel GNOME/KDE gráfico real. Propriedade D-Bus e comportamento do Tray foram reais.

### P2 — libXt requerida pelo hook não está no Depends do .deb

- **Local:** `package.json:22`, `:30`, `:33`; `app/tracker-worker.cjs:3`.
- **SO:** Linux com instalação mínima sem libXt previamente instalada.
- **Prova:** ELF de uiohook-napi 1.5.5 requer libXt.so.6; Electron não a exige diretamente. Controle do .deb lista libxtst6, mas não libxt6. Simulação isolada de ausência de libXt via LD_AUDIT causou ERR_DLOPEN_FAILED antes de iniciar a captura. Evidência: [native-libxt-package.json](native-libxt-package.json).
- **Impacto:** aplicativo abre, mas captura global cai no modo local apesar de usar X11.
- **Recomendação:** adicionar dependência libxt6 compatível com as distribuições suportadas, preservando defaults. Avaliar também requisitos/bundling do AppImage.
- **Limite:** biblioteca ausente foi simulada, sem remover pacotes; não houve instalação limpa de distro.
- **Fontes:** [libxtst6 Debian](https://packages.debian.org/bookworm/libxtst6), [GTK3 Debian](https://packages.debian.org/bookworm/libgtk-3-0), [libXt Debian](https://packages.debian.org/bookworm/libxt6). GTK3/libxtst6 não garantem libXt.

### P2 — Hardlink contorna proteção da configuração ao exportar histórico

- **Local:** `app/desktop-actions.cjs:178`, `:186`.
- **SO:** Linux confirmado; hardlinks NTFS/macOS ainda precisam de confirmação nativa.
- **Prova:** configuração temporária e alias compartilhavam inode, mas tinham realpaths diferentes. Save retornou o alias e exportSessionHistory com protectedPaths apontando à configuração a sobrescreveu por histórico. Evidência: [native-history-hardlink.json](native-history-hardlink.json).
- **Impacto:** alias existente pode corromper configuração e impedir startup seguinte.
- **Recomendação:** comparar stat dev/ino dos arquivos protegidos existentes, ou escrever temporário e renomear o destino sem truncar o inode compartilhado.
- **Limite:** caso de alias preexistente; somente arquivos temporários foram usados.

## Limitações declaradas, sem classificação como bugs

- Wayland: rastreio local e monitor de aplicativo indisponível aparecem explicitamente. GlobalShortcutsPortal está habilitado por padrão no Electron atual; ausência de feature flag não é defeito. [Electron globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut).
- Notificações macOS dependem de assinatura; Windows depende de instalação/atalho/identidade. Falhas são reportadas e não há promessa de leitura pelo usuário. [Requisitos Electron](https://www.electronjs.org/docs/latest/tutorial/notifications#platform-considerations).
- Prebuilds uiohook incluem x64/arm64 nos três OS; Swift de get-windows é universal Intel/ARM no pacote inspecionado. N-API e ASAR unpack são coerentes; inspeção não substitui execução do instalador.
- Tray GTK clássico sem StatusNotifier é recusado conservadoramente conforme README, embora Electron tenha fallback GTK. [Electron Tray](https://www.electronjs.org/docs/latest/api/tray).
- Este agente não exercitou desktop instalado, TCC, assinatura, hooks de hardware ou instaladores Windows/macOS. Runtime e ASAR nos três OS ficam com o CI coordenado pelo agente principal.
