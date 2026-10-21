# Produto: Dobra

<!-- bridge:product-schema 1 -->

## Register

product

## Propósito

Dobra permite transformar o teclado em uma ferramenta de automação local por
camadas. A mesma tecla pode executar tarefas distintas conforme a camada em uso.
Pessoas que repetem tarefas no computador podem configurar ações pela interface,
sem escrever scripts ou editar JSON. A interface é em português.

[Guia de uso](docs/USAGE.md) · [Design](DESIGN.md) · [Contrato](CONTRACT.md)

## Comportamento esperado

- Criar, editar, duplicar e remover camadas/ações pela tabela ou teclado visual.
- Alternar camadas manualmente, por atalho, por ação ou por aplicativo associado.
- Oferecer clipboard, abertura de destino, notificação, troca de camada,
  sequência, HTTP e arquivo; manter leitura de log legado sem oferecê-lo no editor.
- Configurar pressionar, manter e soltar, com delays explícitos e limites de repetição.
- Apresentar prévia sem efeitos antes do teste manual, que é uma execução real.
- Executar sequências ordenadas, com até dez etapas, interrompendo na primeira falha.
- Mostrar resultados/erros, progresso e cancelamento no Histórico, sem ocultar falhas.
- Mostrar a janela durante a preparação, com ações indisponíveis; permitir sair sem ativar serviços tardiamente.
- Iniciar pausado, suspender ações durante edição e manter um controle de pausa disponível.
- Mostrar a conclusão real de “Parar todas”, bloqueando reativação enquanto houver efeitos/registros pendentes.
- Persistir configuração, preservar backup e permitir importação/exportação explícitas.
- Proteger headers com o cofre do sistema, limitar suas operações e recusar gravação desprotegida quando indisponível.
- Impedir que ações de arquivo alterem o perfil interno, configuração ou backup.
- Oferecer rastreio opt-in sem registrar a digitação e informar o modo global/local.
- Suportar temas claro/escuro/sistema, sidebar recolhível e formulários sobrepostos.
- Informar conflitos, falta de permissões e limitações de plataforma no contexto de uso.

## Distribuição e qualidade

O projeto prepara pacotes para Windows x64, Linux x64, macOS Apple Silicon e Intel.
O CI cobre os quatro destinos. Instalação, assinatura/notarização e hardware real
exigem evidência própria; o status público continua em desenvolvimento.
Wayland possui integração Linux opcional com autorização Polkit, leitura passiva
de teclados evdev e vínculo à sessão local ativa. Validação de GNOME/KDE instalados
e hardware real é separada das provas automatizadas. [Integração Linux](docs/WAYLAND.md).

Uma tarefa deve ser testável sem ativar todo o motor. Pausar, cancelar e encerrar
têm funções distintas e não prometem desfazer efeitos externos já realizados.
Configurações de terceiros precisam ser revisadas antes de ativar.

## Fora do escopo atual

Execução de shell, injeção de texto/macros, drivers de teclado, conta, sincronização
em nuvem, telemetria e atualização automática. Não há promessa de suporte global
integral em todo compositor, layout, IME ou hardware. [Limitações por SO](docs/INSTALLATION.md).
