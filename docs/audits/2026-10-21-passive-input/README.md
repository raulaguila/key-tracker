# Observação passiva de teclas — 21/10/2026

O registro de ações com `Electron.globalShortcut` reservava combinações no SO.
A aplicação em foco podia deixar de receber essas teclas. A implementação usa
agora o mesmo observador nativo de pressionar/soltar para ações e controles,
com assinaturas em memória, sem bloquear ou reinjetar eventos.

## Validação local

- `npm run check`: sintaxe verificada.
- `npm test`: 194 testes passaram, incluindo aliases, posição física, modificadores,
  pausa/edição com tecla mantida, troca de camada sem disparo duplicado e prioridade
  dos controles sobre uma posição física importada conflitante.
- `npm run test:input`: Electron real e XTest em Xvfb próprio. Outro aplicativo,
  em processo independente e com foco, recebeu um único caractere por toque de A
  enquanto a ação foi executada uma vez. Também recebeu combinações modificadas,
  keyup, F8 e pausa/retomada. Configuração inicial só de pressionar iniciou o hook.
  Manter/soltar, cancelamentos, falha do worker e encerramento passaram.
  [Resultado nativo](native-linux.json).
- `npm run test:ui`: CRUD, captura, posições do teclado visual (incluindo pontuação
  ABNT2), rolagem de drawers, temas e indisponibilidade no Wayland. Axe-core: 14
  estados, zero violações WCAG A/AA; 112 combinações responsivas e 90 de teclado.
- `npm run test:lifecycle`: inicialização e encerramento no Electron real passaram.
- `npm run pack` e `scripts/platform-audit.cjs`: pacote inspecionado; 29 fontes
  iguais às do repositório, entrada global disponível e nenhum atalho exclusivo
  registrado nas combinações verificadas. Integrações e encerramento passaram.

## Limites

A prova de eventos usa entrada sintética em Linux/X11, não teclado físico.
CI nativo de Windows e macOS não certifica entrega de teclas ou permissões de
usuários reais. No macOS sem Acessibilidade, a auditoria registra a limitação
sem abrir um pedido de permissão.

Wayland não oferece suporte ao observador usado: ações por tecla ficam
indisponíveis, com aviso explícito. No Linux é necessária uma sessão X11.
Não há fallback para atalhos exclusivos do portal. Testes manuais continuam
disponíveis. Atalhos sem posição capturada usam referência US; use **Capturar
tecla** em outros layouts. A primeira ativação mantém o observador para reconhecer
solturas e o controle de pausa/retomada até encerrar o aplicativo, mesmo com o
rastreio visual desligado. Teclas observadas não são persistidas.
