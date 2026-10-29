# Fluxos de mouse e teclado no Wayland

O botão de autorização abre o portal do ambiente gráfico para pedir controle
de mouse, teclado e seleção de monitores. O fluxo continua no editor quando
a autorização é cancelada, negada ou encerrada. Autorizar não ativa as ações.

A reprodução usa `org.freedesktop.portal.RemoteDesktop`, combinada com
`ScreenCast` para obter as coordenadas dos monitores escolhidos. O Dobra não
abre uma conexão PipeWire e não lê, armazena ou transmite imagens da tela.
A autorização vale para a sessão do processo auxiliar e é encerrada ao sair,
suspender a integração, cancelar a reprodução ou revogar o compartilhamento.
Após cancelamento ou revogação, autorize novamente antes de executar.

As coordenadas são globais no espaço lógico do compositor. Só é possível clicar
dentro de um monitor autorizado cujo portal informe posição e tamanho. Se o
compositor omitir esses dados, a aplicação explica a limitação e recusa o fluxo.
Alterações na disposição ou escala dos monitores exigem nova autorização e
revisão das coordenadas. Não se usa a entrada de XWayland para fingir controle
de aplicativos Wayland nativos.

Textos são inseridos com colagem: a etapa substitui o clipboard e envia
`Control+V` ao aplicativo em foco. Revise o destino antes de executar.
Voltar à janela do Dobra impede a próxima etapa e permite cancelar a execução.
O compartilhamento também pode ser revogado pelo controle do ambiente gráfico.
Uma operação já enviada ao sistema não pode ser desfeita.

## Gravação

A gravação global de cliques e teclas permanece indisponível neste backend.
É possível criar e editar as mesmas etapas manualmente e reproduzi-las após
autorizar. O editor informa essa capacidade separadamente da reprodução.

O portal `InputCapture` redireciona a entrada para a aplicação após uma
ativação pelo compositor; ele não fornece observação passiva do uso de outros
aplicativos. O serviço Linux opcional do Dobra observa apenas teclados e não
fornece coordenadas do ponteiro. Habilitar esse serviço não concede gravação
de mouse ou controle do desktop.

Referências oficiais: [RemoteDesktop](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html),
[ScreenCast](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html)
e [InputCapture](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.InputCapture.html).

## Dependências e prova

O auxiliar usa `/usr/bin/python3`, PyGObject/GIO e um portal compatível com o
ambiente gráfico. O pacote `.deb` já declara as dependências Python/GIO; o
AppImage precisa delas no sistema. Um portal instalado pode não implementar
controle remoto ou pode recusar dispositivos/monitores; isso aparece como erro
recuperável, sem descartar o fluxo.

`node --test test/wayland-macro.test.cjs` verifica protocolo limitado, negativa,
revogação, cancelamento que aguarda o encerramento nativo, coordenadas e liberação
de teclas/botões após falha. O contrato GIO/D-Bus é exercitado em um barramento
privado por:

```sh
dbus-run-session -- /usr/bin/python3 -I -B scripts/wayland-macro-portal-smoke.py
```

Esse teste usa um portal de teste isolado e não injeta entrada no desktop.
Não comprova integração com GNOME/KDE, escala fracionária, sessão bloqueada,
hardware ou compositor real. A validação nativa dessas combinações permanece
separada das provas automatizadas.
