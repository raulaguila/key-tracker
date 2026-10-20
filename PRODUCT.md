# Keyboard Tracker

## Register

product

## Propósito e usuários

Aplicativo desktop distribuível para Windows, macOS e Linux. Permite cadastrar
camadas de funções por tecla, alterná-las por atalho e executar requests HTTP,
criar arquivos ou salvar mensagens em log. Tela adicional mostra teclas sendo
pressionadas e soltas em um teclado visual.

## Critérios de aceite

- A mesma tecla executa ações diferentes nas camadas cadastradas.
- Camadas e ações podem ser criadas, editadas e removidas pela interface.
- Atalhos globais, alternância de camada, pausa e conflitos têm estado visível.
- HTTP aceita método, URL, query, headers e corpo; arquivos aceitam pasta,
  nome e conteúdo; log aceita mensagem. Erros aparecem no histórico.
- Configuração persiste entre sessões. Ações iniciam pausadas.
- Rastreio é opt-in, mostra down/up simultâneos e não grava teclas em disco.
- Ambiente sem suporte global informa a limitação e oferece rastreio local.
- Scripts e workflow preparam instaladores nos três sistemas operacionais.

## Decisões desta implementação

Interface em português, de ferramenta utilitária, com aparência clara e controles
familiares. Texto legível, foco visível e movimento reduzido. Preferências visuais
não foram especificadas; estas são escolhas de implementação, não preferências
confirmadas do usuário.

## Fora da primeira versão

Execução de shell, macros que injetam texto, sincronização em nuvem, atualização
automática e substituição de drivers de teclado. Não há promessa de captura
global de todas as teclas no Wayland: depende do compositor/portal para atalhos;
rastreio integral pelo libuiohook requer X11 no Linux.
