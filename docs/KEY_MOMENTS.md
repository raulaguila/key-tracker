# Momentos da tecla

[Documentação](README.md) · [Guia de uso](USAGE.md) · [Contrato](../CONTRACT.md)

Uma combinação pode ter uma ação por momento em cada camada:

- **Ao pressionar:** executa quando a tecla é pressionada.
- **Enquanto pressionada:** aguarda o **Delay inicial** (0 a 60.000 ms) antes de
  executar pela primeira vez. Depois usa **Repetir a cada** (100 a 60.000 ms),
  esperando a execução anterior terminar. O intervalo mínimo global não substitui
  esses valores. Soltar antes do delay cancela a execução pendente.
- **Ao soltar:** executa na soltura real de um gesto iniciado nessa camada.

Por exemplo, A pode copiar um texto ao pressionar, enviar uma requisição a cada
500 ms enquanto estiver pressionada e mostrar uma notificação ao soltar. Crie
três ações com A e escolha um momento diferente em cada uma. Cada momento conta
como uma ação no limite da camada. Não é permitido repetir A no mesmo momento.

Exemplo: delay inicial **1.000 ms** e repetição **300 ms** aguardam um segundo após
pressionar e repetem a cada 300 ms depois de cada execução concluída. Delay zero
agenda a primeira execução imediatamente. Configurações antigas sem delay usam
o intervalo de repetição também na primeira execução, preservando o comportamento.

As teclas continuam chegando ao aplicativo em foco. O Dobra observa os eventos
sem reservar, bloquear ou reenviar teclas; isso também vale para trocar camada
e pausar/retomar.

Use **Capturar tecla**, principalmente em layouts diferentes de US: o aplicativo guarda a
posição da tecla junto do nome e dos modificadores da combinação. Isso evita
confundir a posição física com a legenda de outro layout. Alterar o atalho
manualmente remove a posição capturada; atalhos sem `keyCode` usam posições de
referência US. Manter/soltar exigem captura. Configurações antigas continuam legíveis:
o momento ausente equivale a Ao pressionar, sem aumentar seu tamanho ao migrar.
Ao mudar a fonte de entrada/layout do sistema, capture novamente essas combinações
para manter a posição e o atalho global coerentes. IMEs e alternância dinâmica de
layouts exigem validação no ambiente de uso.

## Ativação e disponibilidade

Todos os momentos usam observação global nativa em Windows, macOS e
Linux/X11, com as permissões do sistema. O drawer mostra a disponibilidade.
No Wayland, habilite o [componente Linux autorizado](WAYLAND.md). Sem ele,
ações por tecla ficam indisponíveis. Falha ou falta
de permissão não é tratada como soltura, e não inicia uma repetição fictícia.
Nenhuma combinação é reservada no sistema, mesmo quando a entrada está disponível.

A visualização em Rastreio é independente. Ativar as ações inicia a entrada quando
ela é necessária, mesmo com Rastreio desligado e somente ações de pressionar.
Depois da primeira ativação, a entrada continua observando solturas e o controle
de pausa/retomada até encerrar o aplicativo; ela não executa ações de teclas enquanto o motor está
pausado ou durante edição. Desligar Rastreio desliga somente a visualização.

Pressionar executa uma vez por gesto, inclusive em atalhos legados sem `keyCode`.
O autorepeat do sistema continua chegando ao outro aplicativo, mas não dispara
novamente a ação de pressionar. Para repetir, configure Enquanto pressionada.
O intervalo mínimo global continua limitando novos gestos de pressionar/soltar.

## Interrupções

Pausar, entrar em edição, mudar de camada/configuração, perder a entrada global,
bloquear/suspender o sistema ou sair interrompe gestos e repetições. Essas
interrupções não executam a ação de soltura. Ao bloquear ou suspender, o motor
fica pausado até uma nova ativação explícita. Uma tecla observada como pressionada
precisa ser solta antes de começar outro gesto após um cancelamento.

Em combinações, os modificadores precisam continuar pressionados. Soltar um deles
cancela o gesto; para executar Ao soltar, solte a tecla principal antes dos
modificadores. A execução começa na camada do pressionamento; não é transferida
para outra camada se ela mudar durante o gesto.

Uma ação já iniciada pode terminar depois de soltar ou pausar. Não há desfazer
automático de requisições, arquivos ou outros efeitos concluídos. A concorrência
máxima do motor continua limitada; ticks de repetição ocupados são descartados.

## Cadastro e teste

O drawer mantém o gatilho compacto no topo e Salvar/Cancelar no rodapé. Sequências
mostram a ordem, o resumo de cada etapa e apenas uma etapa aberta. Mover etapas
preserva os campos e o foco. Erros abrem a etapa afetada.

Salve antes de abrir a prévia. **Executar teste** realiza uma única execução
manual da ação salva, inclusive para Enquanto pressionada: não mantém uma tecla
pressionada, não aguarda o delay inicial da tecla nem inicia um loop. O **Delay
entre etapas** de uma sequência é respeitado, inclusive no teste: de 0 a 60.000 ms
após a conclusão de cada etapa, antes da próxima, sem espera inicial ou final.
Zero e sequências antigas não acrescentam espera. Uma falha interrompe a sequência
sem esperar pelo próximo intervalo. Pausar impede novos disparos; uma sequência
já iniciada termina normalmente.
Para conferir o gesto real, feche o editor,
ative as ações e use a combinação no teclado. Os resultados aparecem na ação e
no Histórico, com o momento configurado, sem salvar as teclas rastreadas.
