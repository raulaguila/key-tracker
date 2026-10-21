# Dobra

<!-- bridge:product-schema 1 -->

## Register

product

## Propósito e usuários

Aplicativo desktop distribuível para Windows, macOS e Linux. Permite cadastrar
camadas de funções por tecla, alterná-las por atalho e executar requests HTTP,
criar arquivos, copiar texto, abrir destinos, mostrar notificações, escolher uma
camada ou executar sequências. Logs automáticos registram resultados; mensagens
em log legadas permanecem compatíveis. Tela adicional mostra teclas sendo
pressionadas e soltas em um teclado visual.

## Critérios de aceite

- A mesma tecla executa ações diferentes nas camadas cadastradas.
- Camadas e ações podem ser criadas, editadas e removidas pela interface.
- Atalhos globais, alternância de camada, pausa e conflitos têm estado visível.
- HTTP aceita método, URL, query, headers e corpo; arquivos aceitam pasta,
  nome e conteúdo; log aceita mensagem. Erros aparecem no histórico.
- Configuração persiste entre sessões. Ações iniciam pausadas.
- Cadastro estruturado dos cinco novos tipos, prévia sem efeitos, execução
  explícita e resultado no Histórico. Sequências de até dez etapas, sem nesting,
  param na primeira falha e preservam resultados anteriores.
- Conteúdo copiado não é colado automaticamente; abrir aplicativos não executa
  shell nem recebe argumentos. Notificações indisponíveis geram erro visível.
- Histórico mostra etapas e exporta os eventos da sessão pelo diálogo nativo.
- Rastreio é opt-in, mostra down/up simultâneos e não grava teclas em disco.
- Ambiente sem suporte global informa a limitação e oferece rastreio local.
- Scripts e workflow preparam instaladores nos três sistemas operacionais.
- Tabela/teclado permitem configurar ações; ativação individual e duplicação
  preservam parâmetros e exigem atalhos únicos.
- Seletor direto de camada e bandeja facilitam o uso fora da janela principal.
- Prévia resolve variáveis sem executar; teste explícito mostra duração/status.
- Associações opcionais por aplicativo trocam camada e retornam à seleção manual;
  indisponibilidade da detecção é explícita e não remove a pausa.

## Decisões desta implementação

Interface em português, de ferramenta utilitária, com aparência clara e controles
familiares. O usuário aprovou o protótipo compacto: menos espaçamento, controles
menores, tabela de ações e sidebar recolhível. Na revisão posterior, pediu tema
escuro e substituição do editor em coluna por drawer sobreposto. Texto legível,
foco visível e movimento reduzido continuam sendo critérios da implementação.

## Fora da primeira versão

Execução de shell, macros que injetam texto, sincronização em nuvem, atualização
automática e substituição de drivers de teclado. Não há promessa de captura
global de todas as teclas no Wayland: depende do compositor/portal para atalhos;
rastreio integral pelo libuiohook requer X11 no Linux.
