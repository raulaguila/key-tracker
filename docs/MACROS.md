# Fluxos de cliques e teclas

[Guia de uso](USAGE.md) · [Permissões](INSTALLATION.md) · [Privacidade](PRIVACY.md)

Uma tecla pode executar um fluxo com até 200 etapas: clique simples/duplo com
posição e botão, texto, combinação de teclas e espera. O fluxo também pode ser
uma etapa de uma Sequência. Não há execução de comandos de shell.

1. Crie uma ação em Camadas e escolha **Fluxo de cliques e teclas**.
2. Use **Gravar cliques e teclas**, mude para o aplicativo de destino e realize
   as operações. A gravação está limitada a cinco minutos/200 etapas.
3. Pare, revise e escolha **Acrescentar ao fluxo** ou **Substituir etapas**.
   Também é possível adicionar e editar todas as etapas diretamente no editor.
4. Configure o tempo inicial para selecionar outra janela, salve e abra **Testar**.
   A prévia é sem efeitos; **Executar teste** controla o mouse e o teclado.
5. Ative as ações e use o atalho no aplicativo de destino.

Em Windows, macOS e X11, o Dobra escolhe um atalho de parada livre, preferindo
`Control+Shift+F10`. A combinação efetiva aparece no editor e durante a execução;
atalhos já configurados e teclas do fluxo são preservados.
Também é possível voltar à janela e parar pela interface. O atalho de pausa do
Dobra interrompe um fluxo quando a entrada global das ações está disponível.
**Parar todas** cancela as próximas etapas e aguarda a liberação dos recursos.
Efeitos já concluídos não são desfeitos. Retornar ao Dobra impede novas injeções
nele; um fluxo não deve editar sua própria interface.

Texto é inserido por colagem (`Control+V` ou `Command+V`) e substitui a área de
transferência. Combinações gravadas representam teclas físicas normalizadas;
layout, IME e atalhos do aplicativo podem mudar o resultado. Para texto com
acentos, use uma etapa **Inserir texto**. Arraste, rolagem e movimento contínuo
do ponteiro não são etapas de gravação nesta versão.
Cada etapa de tecla pressiona e solta a combinação; não representa uma tecla
mantida durante um clique.

Coordenadas dependem da posição das janelas e da disposição/escala dos monitores.
Mantenha a organização usada ao gravar e revise posições ao trocar de computador.
Uma janela ou monitor removido pode invalidar um clique. O fluxo não procura
elementos por imagem nem aguarda o carregamento de páginas; ajuste as esperas.

| Ambiente | Reprodução | Gravação |
| --- | --- | --- |
| Windows | Entrada nativa, sujeita ao nível de privilégio do destino | Hook nativo enquanto a gravação está ativa |
| macOS | Exige Acessibilidade para controlar mouse/teclado | Exige permissão de entrada do sistema |
| Linux/X11 | Exige X11/XTest e Python 3 | Hook nativo na sessão X11 |
| Linux/Wayland | Portal RemoteDesktop/ScreenCast com autorização explícita e suporte do compositor | Captura global passiva de cliques indisponível; use o editor manual ou uma sessão X11 |

O portal pode recusar teclado, ponteiro ou geometria de monitor. Nesse caso o
editor informa a indisponibilidade e preserva o fluxo. O serviço opcional de
teclado/Polkit do Dobra não concede controle do mouse nem substitui a autorização
do portal. Não se usa um fallback XWayland para alegar controle de aplicativos
Wayland. Veja os contratos oficiais de [RemoteDesktop](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html)
e [InputCapture](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.InputCapture.html).

O código prepara os quatro destinos do projeto. Provas automatizadas em X11
não certificam permissões, instaladores ou hardware de Windows/macOS/Wayland.
Para testar sem interferir no desktop em uso, execute os testes nativos num
display Xvfb isolado.

Execute `npm run test:macros` para criar esse display automaticamente e verificar
editor, gravação, revisão e efeitos em um aplicativo receptor independente.
