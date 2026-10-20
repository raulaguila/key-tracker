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

A interface distingue a camada em uso da camada aberta para configuração.
O editor protege alterações não salvas, e os testes mostram execução e resultado
na própria ação. Headers e parâmetros HTTP são preenchidos como pares nome/valor;
a configuração exportada continua usando o mesmo formato JSON.

Use **Recolher menu** no rodapé da navegação para ganhar espaço. Os ícones mantêm
dicas ao passar o mouse ou receber foco; **Expandir menu** restaura os rótulos.
A preferência fica salva neste computador. Ajuda, locais dos arquivos e permissões
podem ser abertos nas respectivas seções expansíveis.

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
executa a ação real mesmo pausado; o resultado aparece em **Histórico**. Pausar
impede novos disparos, mas não cancela uma ação já iniciada. Intervalo mínimo
reduz repetições; uma tecla segurada pode voltar a disparar após esse intervalo.
Fechar a janela encerra o app e todos os hooks.

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
HTTP reais em loopback, feedback de erro, rastreio local e 28 combinações de tela
e largura. Capturas ficam em `artifacts/ui-audit/` (não versionadas). O workflow
executa esse teste no job Linux; o processo de teste em CI usa `--no-sandbox`
somente para a instância isolada de QA.

Achados, correções e limites da avaliação estão em [docs/UI_UX_AUDIT.md](docs/UI_UX_AUDIT.md).

Validação local: testes automatizados de ações e persistência, app Electron e
captura nativa em display Linux/X11 isolado. Windows/macOS e portais Wayland ainda
precisam de teste no ambiente real antes de uma release pública. O capturador de
runtime não apresentou alertas na auditoria de dependências; o empacotador possui
alertas moderados transitivos de desenvolvimento, sem correção disponível na
versão atual de `sprintf-js`.
