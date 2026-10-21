# Teclado global no Wayland

[Instalação](INSTALLATION.md) · [Privacidade](PRIVACY.md)

O Dobra possui uma integração opcional para observar teclados locais em sessões
Wayland. Ela atende ações ao pressionar, manter e soltar e o Rastreio visual.
As teclas continuam chegando ao aplicativo em foco: o componente não reserva,
não bloqueia e não reinjeta eventos.

## Habilitar

1. Instale o pacote `.deb` desta versão pelo gerenciador de pacotes, para instalar
   também o componente e suas dependências. Exemplo: `sudo apt install ./Dobra-0.1.0-linux-amd64.deb`.
2. Abra **Configurações → Captura e permissões** e habilite a integração Linux.
3. Confira e autorize a solicitação do Polkit. As ações continuam pausadas.
4. Ative as ações ou o Rastreio. O status mostra quando a entrada está global.

Se aparecer **Componente Linux não instalado** ou incompatível, Configurações e
o assistente mostram um guia com **Obter pacote .deb** e **Abrir .deb baixado**.
Enquanto não há release pública, o primeiro abre Actions → Desktop: escolha uma
execução bem-sucedida da main, entre no GitHub e baixe `dobra-Linux-X64`. Extraia
o artifact para obter o `.deb`. O segundo botão permite selecionar esse arquivo
e abri-lo no instalador associado do sistema; as ações e rastreio são pausados antes do seletor.

O Linux solicita a autorização de instalação. Conclua, reabra o Dobra e tente
habilitar a integração novamente. Cancelar o seletor não instala nem ativa nada.
Se não houver um instalador gráfico associado a `.deb`, use o gerenciador de
pacotes da distribuição. Esse fluxo é para Debian/Ubuntu e compatíveis; não
instala pacotes silenciosamente e não executa o aplicativo como root.

O Electron continua executando como usuário comum. O serviço é ativado pelo
D-Bus quando solicitado e não é habilitado no boot. Somente abre os dispositivos
quando ações ou Rastreio precisam de entrada. Não execute o Dobra com `sudo`.

O AppImage contém o cliente, mas precisa do componente instalado no sistema;
instalar o `.deb` do Dobra também fornece esse componente. Não copie políticas
ou conceda acesso geral ao grupo `input`. A instalação empacotada atual é Debian/
Ubuntu; outras distribuições precisam de empacotamento equivalente.

A mesma integração pode ser habilitada no X11 para selecionar um teclado físico.
O X11 mantém o observador legado como padrão quando ela está desligada. Na
expansão de dispositivos o protocolo passou à versão 2: atualize também o `.deb`
instalado ao usar um cliente novo. Cliente/serviço incompatíveis recusam a captura.
Em Configurações, **Todos os teclados** agrega o seat ou escolha um dispositivo;
modificadores de outro teclado não entram nas ações do teclado selecionado.

## Sessão e privacidade

A autorização é ligada à conexão do cliente e ao usuário local ativo, com seat
validado pelo logind. Bloquear, suspender, trocar de sessão ou fechar o Dobra
revoga a sessão e fecha os dispositivos. Depois, habilite a integração novamente
e ative as ações explicitamente. Não há reconexão ou autorização silenciosa.

Sem Rastreio, o componente encaminha somente posições configuradas e modificadores.
Com Rastreio, encaminha os códigos físicos das teclas. Não converte para texto,
não persiste teclas e não transmite eventos pela rede. A observação global não
identifica campos de senha de outros aplicativos; escolha combinações apropriadas.

Hotplug, perda de sincronização e snapshots de teclas mantidas cancelam gestos
sem fabricar solturas. A fila é limitada: consumidor parado perde a sessão em
vez de acumular eventos ou perder silenciosamente keyups. Vários teclados têm
estado agregado, para uma soltura não liberar uma tecla mantida em outro.
Eventos com mais de um segundo em trânsito também encerram a integração, para
uma pausa no cliente não reproduzir ações antigas ao destravar. Esse limite é
uma proteção de funcionamento, não uma medição de latência.

## Resolver problemas

- **Componente não instalado/incompatível:** instale ou atualize o `.deb` correspondente.
- **Autorização negada:** tente novamente pelo botão; verifique o agente Polkit do desktop.
- **Aguardando teclado:** confira a conexão e se o dispositivo pertence ao seat ativo.
- **Sessão indisponível:** precisa de logind, sessão gráfica local ativa e desbloqueada.
- **Após bloqueio/suspensão:** habilite novamente. Gestos anteriores não são retomados.

Os controles de interface e testes manuais continuam disponíveis sem a integração.
Detecção de aplicativo em foco no Wayland é uma funcionalidade distinta e mantém
suas limitações atuais. Entrada remota/virtual que não chega a evdev não é coberta.

## Verificação antes de produção

`npm run test:wayland` usa D-Bus/GIO reais em barramento privado, autoridade e
teclados simulados; não acessa dispositivos do usuário. `npm run test:input`
continua provando a passagem das teclas em X11. Esses testes não certificam
hardware nem o bloqueio de tela de um compositor real.

Registrar separadamente em GNOME e KDE instalados: digitar em outro aplicativo
com ações ativas, manter/soltar, dois teclados, hotplug, lock/unlock, troca de
usuário/VT, suspensão, autorização negada, encerramento durante autorização e
atualização/desinstalação. Não publicar compatibilidade certificada sem essa prova.
