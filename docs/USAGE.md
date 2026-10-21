# Guia de uso

[Documentação](README.md) · [Instalação](INSTALLATION.md)

## Camadas e ativação

Cada camada reúne ações associadas a teclas. A camada **Em uso** recebe os
atalhos; abrir outra camada para edição não a ativa. Use o seletor da barra
inferior, `F8` ou uma ação **Trocar camada** para escolher a camada em uso.
Mudar de camada não ativa ações que estavam pausadas.

O aplicativo inicia pausado. A ativação é explícita; o atalho padrão de pausa
é `Ctrl+Shift+F12` no Windows/Linux e `⌘+Shift+F12` no macOS. Se esse controle
não puder ser observado, a interface informa a indisponibilidade. A observação
é passiva: as teclas continuam funcionando no programa em foco. Durante a
edição de formulários, as ações ficam suspensas.

Você pode usar a tabela ou o teclado visual para cadastrar uma ação. Criar e
editar abre um drawer sobre o conteúdo. Salvar aplica a configuração; Cancelar
protege alterações pendentes com confirmação. Duplicar abre um rascunho e exige
uma combinação livre; duplicar uma camada não copia associações de aplicativos.

## Tipos de ação

| Tipo | Configuração e resultado |
| --- | --- |
| Copiar texto | Copia o texto para a área de transferência; não cola automaticamente |
| Abrir destino | Abre URL HTTP(S), arquivo/pasta ou aplicativo pelo sistema |
| Notificação | Solicita uma notificação com título e mensagem ao sistema |
| Trocar camada | Seleciona uma camada existente |
| Sequência | Executa de uma a dez etapas simples na ordem escolhida |
| Requisição HTTP | Método, URL, parâmetros de query, headers e corpo |
| Arquivo | Cria um arquivo novo ou acrescenta conteúdo a um existente |

**Registro em Log** não aparece entre as opções de criação/edição. Configurações
antigas/importadas desse tipo continuam legíveis e podem ser mantidas ou
substituídas. O histórico automático de execução continua disponível para todas
as ações; não é necessário cadastrar uma ação para conferir resultados.

URLs não aceitam credenciais embutidas. Aplicativos usam um caminho absoluto,
sem argumentos ou execução de shell. Arquivos e pastas também usam caminhos
absolutos. HTTP aceita GET, POST, PUT, PATCH, DELETE e HEAD, com limite de dez
segundos, sem redirecionamentos nem repetição automática. GET/HEAD não aceitam corpo.

Para arquivos, a pasta vazia usa `Documentos/Dobra` do usuário. **Criar** recusa
sobrescrever um arquivo existente; **Acrescentar** adiciona conteúdo. O nome não
aceita separadores de caminho e deve ser compatível com os sistemas suportados.
A pasta de dados do Dobra e aliases de seus arquivos internos são protegidos:
a prévia e a execução recusam esses destinos.

### Variáveis

Campos de conteúdo compatíveis aceitam `{{key}}`, `{{layer}}`, `{{date}}` e
`{{timestamp}}`. A prévia mostra os valores resolvidos. A URL HTTP
não é um template; parâmetros de query, headers e corpo podem conter variáveis.
Nomes de arquivos são normalizados para não transformar variáveis em caminhos.

### Sequências e delays

Adicione etapas, escolha seus tipos e ajuste a ordem pelos controles de mover.
Não há sequências dentro de sequências. **Delay entre etapas** aceita de 0 a
60.000 ms e começa depois da conclusão de cada etapa, antes da próxima. Não há
espera antes da primeira ou depois da última. A primeira falha interrompe o fluxo;
efeitos anteriores não são desfeitos. O histórico informa a etapa e o resultado.

### Pressionar, manter e soltar

Uma combinação pode ter uma ação por momento em cada camada. **Enquanto
pressionada** tem um delay inicial (0–60.000 ms) e um intervalo entre repetições
(100–60.000 ms), contado após o término da execução anterior. **Ao soltar**
depende de um gesto real iniciado na mesma camada. Use **Capturar tecla** para
esses dois momentos. [Semântica completa e interrupções](KEY_MOMENTS.md).

## Conferir antes de executar

Salve a ação e abra **Testar**. A prévia resolve o destino e conteúdo sem executar
a ação. Headers ficam mascarados. **Executar teste** realiza uma execução real,
inclusive quando o aplicativo está pausado; não simula manter uma tecla nem inicia
repetição. O teste respeita o delay entre etapas.

A prévia expira após cinco minutos, é consumida uma vez e é invalidada quando
uma configuração é salva. Se necessário, abra uma nova prévia para repetir.

## Histórico e cancelamento

O Histórico mostra os últimos 100 eventos da sessão, resultados por etapa,
duração, status HTTP e execuções atuais. Até quatro ações distintas podem executar
simultaneamente; uma mesma ação não se sobrepõe a si mesma e não existe fila ilimitada.

**Pausar** impede novos disparos. **Cancelar** aborta esperas/HTTP e impede as
próximas etapas; uma operação nativa já iniciada pode precisar terminar.
**Parar todas** também pausa e interrompe gestos mantidos. Nenhuma dessas opções
desfaz arquivos, requisições ou outros efeitos já concluídos.

Exportar o histórico salva os eventos da sessão por diálogo nativo. O arquivo
pode conter nomes e atalhos configurados. Para suporte, prefira o diagnóstico
sanitizado em Configurações. [Dados locais e privacidade](PRIVACY.md).

## Rastreio e layout

O rastreio é opt-in e independente das ações. A tela mostra teclas pressionadas
por chips com contorno e destaque no teclado, sem duplicar a combinação em texto
visível. Leitores de tela recebem o anúncio textual. Os eventos não são gravados.

O layout automático consulta as legendas disponíveis no sistema. Também há
BR ABNT2, US ANSI, PT ISO, FR AZERTY e DE QWERTZ, formatos completo/TKL/compacto e
correção manual da geometria física. O mapa não identifica o modelo do teclado;
IME, Shift/AltGr e variantes de fabricantes não são integralmente representados.
Se a leitura falhar, US é uma referência provisória acompanhada de aviso.

A tela informa captura global ou local. No Wayland, a captura global exige o
[componente Linux autorizado](WAYLAND.md); sem ele funciona nesta janela.
Desligar a visualização não desliga a entrada nativa quando
ela é necessária para ações de manter/soltar; isso não passa a gravar as teclas.

## Aplicativos, aparência e bandeja

Associações por aplicativo são opcionais, no editor da camada. Ative a troca
automática em Configurações. A detecção usa identidade exata de nome, caminho ou
bundle, sem títulos de janelas, URLs ou histórico. Sem correspondência, retorna
à última camada manual. No Linux exige X11, `xprop` e `xwininfo`.

Claro, Escuro e Seguir o sistema estão em **Aparência**. O controle de sol/lua no
menu alterna claro/escuro. Tema, sidebar e layout do teclado são preferências
locais e não acompanham a exportação de ações.

Fechar a janela encerra o aplicativo por padrão. A opção de manter na bandeja
depende da disponibilidade real da bandeja do sistema; **Sair** encerra os
processos e atalhos. Se a bandeja não puder ser usada, a janela permanece acessível.

## Configuração e recuperação

Use Importar/Exportar configuração para transportar camadas. A exportação remove
todos os headers HTTP, inclusive de sequências; reinforme-os no destino. Outros
conteúdos são preservados e devem ser revisados antes de compartilhar.

O backup guarda a última configuração válida anterior ao salvamento. **Restaurar
backup** pede confirmação, pausa e cancela execuções. Se a configuração não puder
ser lida ao abrir, um diálogo oferece recuperar/importar ou sair e preserva o
arquivo problemático. Não edite um envelope criptografado como se fosse JSON comum.

Para experimentar a estrutura de importação, baixe o
[exemplo sem credenciais](examples/quick-start.json). Ele usa duas camadas com `A`
e inicia pausado, como toda configuração importada.

Ao abrir, o Dobra mostra a preparação das camadas e mantém as ações indisponíveis
até terminar. O backup pode aparecer como “Verificando” por um breve período.
“Parar todas” bloqueia novos disparos e mostra “Parando…” até as ações e o
histórico terminarem. Ao sair, o aplicativo aguarda gravações pendentes; se a
espera exceder dez segundos, você pode continuar aguardando ou sair com o aviso
de que operações ainda não concluídas podem não ser persistidas.

## Primeiros passos, busca e painel

Abra **Primeiros passos** para conferir permissões e testar uma tecla com ações
pausadas. O assistente pode ser retomado em Configurações. Use um modelo local
para criar sua primeira camada; revise o conteúdo e só ative quando estiver pronto.

**Ctrl+K** (Windows/Linux) ou **⌘+K** (macOS) abre a busca de ações e camadas dentro
do Dobra. A busca abre editores ou troca a camada em uso; não dispara ações.
O **Painel rápido** mostra a camada ativa e os atalhos em uma janela compacta.
Também pode ser aberto por seu controle configurável; o padrão é
`Ctrl+Shift+Espaço` / `⌘+Shift+Espaço`, observado após ativar a entrada.
Escape oculta o painel. Abrir o painel não ativa o motor.
Deixe o atalho do painel vazio para usar somente o botão. Em configurações antigas
que já usam sua combinação padrão, o Dobra preserva os atalhos existentes e informa
que o controle do painel está desabilitado por conflito. Escolha outra combinação
em Configurações se quiser habilitá-lo. O painel distingue edição, pausa e parada.

## Camada temporária e teclado de entrada

Em Configurações, escolha uma combinação e a camada temporária. Enquanto ela
estiver mantida, essa camada recebe os atalhos; soltar restaura a anterior.
Pausa, edição, mudança manual/de aplicativo e perda da entrada cancelam a camada
temporária. As teclas continuam funcionando nos demais aplicativos.

O seletor de teclado lista dispositivos reais quando o backend e a permissão
permitem. **Todos os teclados** mantém a agregação padrão. Ao escolher um teclado,
as ações e o Rastreio passam a usar essa origem. Desconexão ou mudança de seleção
cancela gestos e pausa ações; confira o estado antes de reativar. Teclados sem
identidade disponível não são apresentados como se tivessem suporte por dispositivo.
No Linux, a seleção exige o componente evdev e sua autorização, inclusive em X11.
No macOS, a integração pode solicitar Monitoramento de Entrada.
Solte teclas e modificadores mantidos antes de iniciar o teste. Quando a origem
inicial de um modificador ainda é desconhecida, novas combinações são ignoradas
até soltá-lo, evitando executar uma ação com modificadores incorretos.

## Biblioteca e importação por camada

A biblioteca possui modelos locais de notas, textos/navegação e webhook. O modelo
de webhook usa um endereço de exemplo: substitua-o pelo serviço desejado e confira
os headers antes de executar. Nenhum modelo é ativado automaticamente.

Importar camadas permite escolher quais trazer, criar camadas novas ou mesclar
nas existentes. **Ignorar conflitos** preserva as ações atuais; **Substituir**
remove ações conflitantes indicadas na prévia. Controles reservados são sempre
preservados. A prévia mostra os totais antes de aplicar. Selecionar uma camada
que troca para outra exige trazer também essa dependência; IDs são remapeados.
Headers e associações de aplicativo são removidos da cópia portátil. Planos
expiram após cinco minutos ou quando a configuração muda.

**Exportar camada** inclui as camadas referenciadas pelas ações, sem headers ou
associações. A importação da configuração inteira continua disponível nas opções
de dados e substitui o conjunto atual conforme sua confirmação.

## Sequências com dados e condições

Abra as opções avançadas de uma etapa para definir **espera antes da etapa**,
independente do intervalo geral entre etapas. Em uma requisição HTTP, dê um nome
ao resultado, por exemplo `consulta`. Etapas posteriores podem usar
`{{steps.consulta.status}}`, `{{steps.consulta.body}}` ou
`{{steps.consulta.json.nome}}` em conteúdo compatível. Destinos dinâmicos são
validados novamente antes do efeito: URLs continuam restritas a HTTP/HTTPS sem
credenciais embutidas e arquivos não podem atingir os dados internos do Dobra.
A resposta é limitada a 64 KiB e não é guardada no histórico.

Uma condição compara um resultado anterior por igualdade, diferença, conteúdo
ou existência. Condição falsa mostra a etapa como **Ignorada** e continua o fluxo.
A prévia informa valores que só existirão na execução; abrir a prévia não faz
requisições. Não há loops nem sequências aninhadas. Falhas e cancelamentos mantêm
os limites atuais e impedem as próximas etapas. Resultados dinâmicos não podem
ser usados em mensagens de log legadas, que seriam persistidas.

## Desfazer e refazer configuração

Os controles **Desfazer** e **Refazer** recuperam até dez alterações desta sessão,
incluindo exclusões e importações. A recuperação pausa/cancela execuções e salva
pelo mesmo mecanismo protegido da configuração. Uma edição nova elimina o caminho
de refazer. Fechar o aplicativo encerra esse histórico em memória; o backup em
disco continua disponível. Desfazer não reverte arquivos, clipboard, notificações,
aplicativos ou requisições que já foram executados. A edição de texto nos campos
mantém seu próprio Desfazer nativo.
