# Validação da expansão de produtividade — 21/10/2026

Escopo aceito em CONTRACT.md e docs/decisions/productivity.md: camadas temporárias,
painel separado, assistente, biblioteca/importação por camada, busca de comandos,
escolha física de teclado, sequências com dados/condições e desfazer/refazer.

## Evidência local

- Rodada Node integrada: 237 testes passaram. Após correções finais, mais 34
  regressões focadas passaram (incluem testes novos; não somar os totais).
- Protocolo Linux: 22 testes com D-Bus/GIO reais e FD privado, autoridade/teclados
  simulados, sem abrir dispositivos do usuário. Seleção entre dois teclados,
  isolamento de modificadores e dispositivo ausente cobertos.
- Electron UI completo passou: fluxos anteriores e oito recursos; 14 estados de
  acessibilidade existentes mais seis novos, zero violações WCAG A/AA verificadas;
  112 combinações responsivas anteriores mais quatro do importador,90 geometrias.
- Soak fixo:300 execuções,240 concluídas,60 canceladas,30 salvamentos e máximo
  de quatro efeitos simultâneos. Não equivale a um ensaio de uso por dias.
- Lifecycle passou em perfil/sessão temporários. XTest com receptor em outro
  processo comprovou passagem de letras, modificadores, pausa/camadas e solturas;
  nenhum teclado físico do host foi observado.
- AppImage e deb Linux gerados; seis payloads do serviço com modos protegidos,
  dependências e lifecycle de instalação verificados, sem instalar o serviço.
- Auditoria ASAR/runtime local:43 arquivos fonte comparados com o pacote, core
  aprovado, clipboard/processo/cancelamento/persistência e controles passivos.
  Runtime local usa a mesma fonte em Electron, não instala o pacote na conta do usuário.

## Regressões corrigidas durante a integração

Reativar Rastreio com observador já global agora publica o estado antes do
snapshot inicial, sem duplicar publicações. Decoders de processos preservam UTF-8
entre buffers, inclusive IDs e nomes Unicode. Teclas mantidas antes de iniciar e
seleção de um teclado já mantido são suprimidas até soltar. Painel não mostra
conteúdo de ação nem texto literal null; remoção da camada temporária limpa seu
controle com aviso. Dados HTTP dinâmicos não aparecem nas mensagens de resultado.

## Destinos e limites da prova

O workflow Desktop compila e testa Windows x64,macOS ARM64,macOS Intel eLinux.
Helpers Windows/macOS são compilados com o SDK do runner e executam self-test
sem abrir teclado. macOS tem uma checagem de permissão somente leitura para o CI;
sem Monitoramento de Entrada, o relatório declara a captura não validada. Runner
sem teclado real declara ausência, sem transformar isso em prova de entrada.
Consulte a execução vinculada ao commit em
[Actions](https://github.com/raulaguila/key-tracker/actions/workflows/desktop.yml).

Assinatura/notarização reais e QA instalado em hardware continuam pendentes do
ambiente apropriado. Nenhum certificado privado é criado ou incluído no código.
O pipeline de candidato exige os secrets e verifica também os helpers assinados.
Não há publicação pública automática nesta entrega. Ver docs/PRODUCTION.md.

## Compatibilidade e recuperação

Configuração permanece v1 com campos opcionais. O serviço Linux passa ao
protocolo2; atualize o deb junto do aplicativo. Importação remove headers e
associações, exige confirmação e invalida planos por revisão/prazo. Undo/redo é
limitado à sessão/configuração e não desfaz efeitos externos. A autorização de
entrada não é recuperada silenciosamente por importação, undo ou reinicialização.
