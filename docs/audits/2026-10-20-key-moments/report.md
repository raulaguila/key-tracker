# Momentos da tecla e cadastro compacto

Escopo: implementar ações ao pressionar, enquanto mantém e ao soltar; adotar a
proposta de UX aprovada pelo usuário. Configuração permanece versão 1.

## Entrega

- Uma ação por momento para a mesma combinação na camada, incluindo duplicação,
  importação/exportação, tabela, teclado visual, prévia e histórico.
- Enquanto pressionada tem intervalo próprio de 100 a 60.000 ms; só agenda outra
  execução depois da anterior terminar. Teste manual executa uma vez.
- Hook compartilhado entre momentos e visualização, com controles independentes.
  Após ativação explícita, observa solturas também durante pausa/edição; não
  executa ações nesses estados. Falhas não reservam combinações sem efeito.
- Gestos cancelados ao editar, pausar, trocar camada/configuração, perder o hook
  ou bloquear/suspender o SO. Não geram soltura artificial. Bloquear/suspender
  pausa as ações até o usuário ativar novamente.
- Drawer com resumo fixo do gatilho, controles de momento/intervalo e rodapé
  acessível. Sequências com uma etapa aberta e resumos sem conteúdo privado.
  Campos, ordem e foco são preservados; erro abre a etapa correspondente.
- Captura separa letra lógica e posição física. Alterar o atalho manualmente
  invalida a posição capturada. Alias de modificadores não permite duas ações
  ambíguas sobre a mesma posição.

Configurações legadas de até 256 KiB continuam cabendo: o normalizador omite
`trigger: press` quando é o padrão, em vez de adicionar bytes a todas as ações.
Leitura de JSON legado formatado, limite canônico, snapshots e proteção de
exportações da auditoria anterior continuam cobertos pelos testes.

## Provas locais

**127 testes unitários passaram**, incluindo persistência, limites, gestos com
timers reais, saturação, falta de permissão, cancelamentos, observação durante
pausa/edição e compartilhamento de worker. Sintaxe e diff verificados.

[Prova Linux/X11](native-linux.json): Electron real, Engine/Tracker de produção,
perfil temporário e eventos XTest em display Xvfb pertencente ao teste. Nenhum
teclado ou perfil real do usuário foi manipulado. O teste usa atalhos globais
simultaneamente ao hook, sem substituir esses componentes por mocks.

- A: um press, dez repetições hold e um release na amostra.
- Ligar/desligar Rastreio reutilizou o worker e manteve momentos disponíveis.
- Pausa/retomada e edição durante a tecla mantida não criaram outro gesto.
- Control+B recebeu modificador real; soltar Control interrompeu a repetição sem
  executar release da tecla principal.
- Encerrar o processo do hook cancelou os gestos, liberou os registros e não
  reiniciou o processo em loop.

[Prova AZERTY independente](native-azerty-independent.json): fonte francesa em
Xvfb próprio; DOM capturou A lógico/KeyQ físico. Atalho global registrado e hook
ativo produziram press1/hold4/release1 com a posição correta. Não é certificado
para todos os layouts, IMEs ou mudanças de fonte depois da captura.

## Limites de uso e de evidência

- Wayland não oferece esses momentos pelo hook atual. A indisponibilidade fica
  explícita e não é simulada por timers ou eventos locais.
- No macOS, entrada global depende de Acessibilidade. A visualização pode usar
  modo local; os momentos de ação não recebem esse fallback.
- Atalhos legados só de press preservam autorepeat do sistema com cooldown.
  Grupos com hold/release usam gestos reais e não duplicam press no autorepeat.
- Em combinações, soltar o modificador cancela o gesto; solte a tecla principal
  antes dos modificadores para acionar release. Trocar camada cancela o gesto.
- Ao trocar o layout real do SO, recapture as combinações para manter o atalho e
  a posição coerentes. A prova AZERTY usa a fonte vigente durante a captura.
- XTest é entrada sintética pelo SO em display próprio. Não comprova teclado USB,
  toda permissão de usuário, todos os compositores ou um instalador assinado.
- Ações já iniciadas podem terminar após soltar/pausar; efeitos não são desfeitos.

Guia de uso: [KEY_MOMENTS.md](../../KEY_MOMENTS.md).
