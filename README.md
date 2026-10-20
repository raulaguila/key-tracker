# Keyboard Tracker

Aplicativo desktop para associar **camadas de ações às teclas** e acompanhar seu
teclado visualmente. Interface em português. Base Electron para Windows, macOS e
Linux.

## Executar

Requer Node.js 24 e npm. Dentro da pasta do projeto:

```bash
npm ci
npm start
```

O aplicativo começa com as ações pausadas e o rastreio desligado.

A interface compacta usa ações em tabela e um drawer de edição sobreposto, sem
apertar o conteúdo ao fundo. Distingue a camada
em uso da camada aberta para configuração. O editor protege alterações não salvas,
e os testes mostram execução e resultado
na própria ação. Headers e parâmetros HTTP são preenchidos como pares nome/valor;
a configuração exportada continua usando o mesmo formato JSON.

Instalações novas começam com o menu recolhido. **Expandir menu** restaura os
rótulos e **Recolher menu** libera espaço. Os ícones mantêm dicas por mouse ou foco.
A preferência fica salva neste computador. Ajuda, locais dos arquivos e permissões
podem ser abertos nas respectivas seções expansíveis.

Em **Configurações → Aparência → Tema**, escolha **Claro**, **Escuro** ou
**Seguir o sistema**. A mudança é imediata e fica salva neste computador.
O botão de sol/lua no rodapé do menu lateral alterna diretamente entre claro e
escuro em qualquer tela. Para voltar ao tema automático, escolha “Seguir o sistema”.
Os drawers de ações/camadas fecham por Escape, botão de fechar ou clique no fundo;
alterações não salvas pedem confirmação. Escape durante a captura de um atalho
cancela primeiro a captura. Ao fechar, a página mantém foco e rolagem.

Em **Rastreio**, escolha **Automático (sistema)** ou BR ABNT2, US, PT, AZERTY e
QWERTZ. Se a leitura automática não estiver disponível, a tela informa e usa US
como referência provisória. O formato pode ser completo, TKL ou compacto; o
padrão físico pode ser corrigido na seção **Layout, privacidade e funcionamento**.
As escolhas ficam salvas neste computador e não alteram o mapeamento das ações.
A detecção fornece legendas, não identifica o modelo físico conectado. Algumas
teclas internacionais dependem do suporte do hook; variantes e IMEs podem diferir.

1. Em **Camadas**, cadastre ou edite suas camadas e ações.
2. Na camada 1 inicial, `A` salva uma mensagem em log. Na camada 2, `A` cria
   uma nota em `Documentos/Keyboard Tracker`.
3. Clique **Ativar ações**. `F8` alterna entre as camadas.
4. `Ctrl+Shift+F12` pausa/retoma; no macOS, `⌘+Shift+F12`. Os dois atalhos podem
   ser alterados em **Configurações**. O controle global de pausa passa a ficar
   disponível após a primeira ativação pelo botão.
5. Em **Rastreio**, ative a visualização para ver teclas pressionadas e soltas.

Com ações ativas, as teclas registradas podem substituir a digitação em outros
aplicativos. Ao editar formulários, as ações são suspensas. O botão **Testar**
abre uma prévia sem executar nada. **Executar teste** confirma a execução real,
mesmo pausado; o resultado aparece no drawer, na ação e em **Histórico**. Pausar
impede novos disparos, mas não cancela uma ação já iniciada. Intervalo mínimo
reduz repetições; uma tecla segurada pode voltar a disparar após esse intervalo.
Por padrão, fechar a janela encerra o app e todos os hooks. A opção de manter
na bandeja permite continuar usando os atalhos com a janela oculta.

## Configurar e usar mais rápido

- **Tabela ou teclado:** em Camadas, escolha **Teclado** e clique numa tecla para
  criar/editar sua ação. O seletor de combinação mostra Ctrl, Shift e outras
  combinações cadastradas. Teclas mapeadas ganham destaque; ações desativadas
  usam contorno tracejado. Setas navegam pelas teclas e Enter abre o editor.
  A tabela continua disponível e a preferência fica salva neste computador.
- **Ativação individual:** em **Mais opções** da ação, escolha Ativar/Desativar.
  A configuração continua salva; o atalho desativado deixa de ser registrado.
- **Duplicação:** Mais opções → Duplicar ação preserva seus parâmetros e pede
  outra tecla. Duplicar camada copia as ações com novos IDs, sem copiar as
  associações de aplicativos. As cópias podem ser revisadas antes de salvar.
- **Troca rápida:** o seletor “Em uso”, no rodapé, escolhe diretamente a camada.
  Trocas pelo seletor ou atalho mostram um aviso discreto.
- **Bandeja:** oferece abrir, ativar/pausar, escolher camada, desligar rastreio e
  sair. Em Configurações, **Manter na bandeja ao fechar a janela** é opcional;
  rascunhos continuam protegidos. No Linux, ocultar só fica disponível quando
  `dbus-send` confirma um host StatusNotifier, como os oferecidos pelo ambiente
  desktop. Se a bandeja não estiver disponível, a janela não fica oculta.
- **Prévia do teste:** mostra destino, parâmetros interpolados e conteúdo antes
  de executar. Valores de headers ficam mascarados. A execução usa os valores
  completos, congelados por até cinco minutos; atualizar a prévia permite outro
  teste. Salvar uma alteração invalida as prévias anteriores. O resultado mostra
  duração, status HTTP quando aplicável e mensagem de erro.

## Camadas por aplicativo

No editor da camada, abra **Trocar por aplicativo** e informe um identificador por
linha: nome, executável (`code.exe`), caminho completo ou bundle ID. Também pode
usar **Escolher aplicativo**. A correspondência é exata; caminhos têm prioridade
sobre nomes. Um mesmo identificador não pode estar associado a duas camadas.

Ative **Trocar camadas conforme o aplicativo em foco** em Configurações e salve.
Ao focar um aplicativo associado, sua camada é selecionada. Ao sair para um
aplicativo sem regra, volta a última camada escolhida manualmente. Uma seleção
manual permanece até a próxima mudança de aplicativo. Durante a edição, a troca
fica pendente; a automação nunca ativa ações que estavam pausadas.

A detecção é opcional, consulta apenas enquanto ativada e mantém somente a
identidade do aplicativo em memória. Títulos/URLs não atravessam o worker nem são
gravados. Funciona com integração nativa em Windows, macOS e Linux/X11; X11
precisa de `xprop` e `xwininfo`. Wayland informa a indisponibilidade e mantém a
troca manual. Erros/permissões também aparecem em Configurações.

## Ações disponíveis

| Ação | Configuração |
| --- | --- |
| Request HTTP | GET, POST, PUT, PATCH, DELETE ou HEAD; URL; headers e query como objetos JSON de strings; corpo opcional |
| Arquivo | Pasta (vazia usa Documentos/Keyboard Tracker), nome, conteúdo e modo criar/acrescentar |
| Log | Mensagem gravada no log local do aplicativo |

Exemplo de request: URL `http://localhost:3000/event`, método `POST`, headers
`{"Content-Type":"application/json"}`, query `{"origem":"teclado"}` e corpo
`{"valor":1,"tecla":"{{key}}","camada":"{{layer}}"}`.

Variáveis: `{{key}}`, `{{layer}}`, `{{date}}` (data UTC) e `{{timestamp}}`
(instante UTC em formato válido para nome de arquivo). Disponíveis em mensagens,
conteúdo/nome de arquivo, valores de query/headers e corpo HTTP. Para criar um
arquivo diferente por disparo, use `nota-{{timestamp}}.txt`. Criar recusa arquivo
existente; acrescentar adiciona exatamente o conteúdo informado, incluindo as
quebras de linha que você definir.

Requests têm limite de 10 segundos e não seguem redirecionamentos. Uma ação não
executa duas vezes ao mesmo tempo; até quatro ações diferentes podem executar
simultaneamente. Nenhuma request é disparada ao cadastrar ou abrir o aplicativo.

## Rastreio e compatibilidade

| Sistema | Atalhos globais | Teclado visual global |
| --- | --- | --- |
| Windows | API nativa do Electron, com conflitos reportados | libuiohook; depende das permissões do aplicativo e da sessão |
| macOS | API nativa do Electron, com conflitos reportados | Requer autorização em Privacidade e Segurança → Acessibilidade; o SO pode solicitar Monitoramento de Entrada |
| Linux/X11 | API nativa do Electron | libuiohook; precisa das bibliotecas X11 do sistema |
| Linux/Wayland | Depende do portal GlobalShortcuts e do compositor; instalar o pacote desktop facilita a identidade do app | Rastreio local com esta janela em foco; para captura global integral, usar X11 |

Quando a captura global não estiver disponível, o aplicativo explica o motivo e
usa o rastreio local. Teclas simultâneas acendem até serem soltas. O desenho é uma
referência física QWERTY; layouts ABNT2/idiomas podem ter legendas diferentes.
O numpad tem desenho próprio; teclas extras reconhecidas também aparecem nos chips
e no texto de teclas pressionadas. Rastreio não salva teclas em arquivo/histórico,
não reconstitui texto digitado e não envia eventos à rede.

## Configuração e dados

**Configurações → Abrir pasta de dados** mostra `config.json` e
`logs/activity.jsonl`. Configuração persiste; a camada ativa é reiniciada na
primeira camada ao abrir. Histórico visual mostra até 100 eventos da sessão;
resultados e mensagens de log ficam em disco, com rotação em 1 MiB e uma cópia.

Importação/exportação JSON disponíveis na mesma tela. Importar pausa as ações e
valida o arquivo antes de substituir a configuração. Pastas absolutas podem
precisar ser ajustadas ao importar em outro SO; deixar pasta vazia usa Documentos
do sistema atual. Tokens configurados em headers ficam no JSON local e na
exportação; não há cofre de credenciais nesta versão.

## Testes e instaladores

```bash
npm run check
npm test
npm run pack
npm run dist
```

`dist` gera instaladores para o SO/arquitetura em execução: Windows NSIS `.exe`,
macOS `.dmg`/`.zip`, Linux `.AppImage`/`.deb`. Saída em `dist/`. Também existem
`dist:win`, `dist:mac` e `dist:linux`; prefira compilar cada pacote no SO de destino.

No GitHub, o workflow **Desktop** roda testes em Windows/macOS/Linux e gera
instaladores a cada push na `main`. Também pode ser executado em
**Actions → Desktop → Run workflow**. Baixe os artifacts de cada sistema;
eles não são publicados em releases automaticamente. Assinatura de
código e notarização dependem dos certificados do distribuidor; os builds de
desenvolvimento podem acionar avisos do sistema.

No Linux, o teste da interface em Electron real usa um display isolado:

```bash
xvfb-run -a npm run test:ui
```

Ele exercita cadastro, persistência, rascunhos, fechamento/navegação, requisições
HTTP reais em loopback, feedback de erro, rastreio local, editor por teclado, duplicação, ativação individual, prévias,
proteção de fechamento, 112 combinações de telas/tema/sidebar e 90 combinações
de layout/formato/largura/tema do teclado. Capturas ficam em `artifacts/ui-audit/` (não versionadas). O workflow
executa esse teste no job Linux; o processo de teste em CI usa `--no-sandbox`
somente para a instância isolada de QA.

Achados, correções e limites da avaliação estão em [docs/UI_UX_AUDIT.md](docs/UI_UX_AUDIT.md).
Análise atual, problemas reproduzidos e medições do executável:
[auditoria de UI/UX e performance](docs/audits/2026-10-20/report.md).

O protótipo que orientou o design adotado está preservado em
[docs/prototypes/compact](docs/prototypes/compact/README.md), com dados de exemplo.

Validação local: testes automatizados de ações e persistência, app Electron e
captura nativa em display Linux/X11 isolado. Windows/macOS e portais Wayland ainda
precisam de teste no ambiente real antes de uma release pública. O capturador de
runtime não apresentou alertas na auditoria de dependências; o empacotador possui
alertas moderados transitivos de desenvolvimento, sem correção disponível na
versão atual de `sprintf-js`.
