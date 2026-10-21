# Adoção da identidade Dobra — 2026-10-21

O produto passa a se chamar Dobra. Pacote, App ID, perfil Electron, IPC,
preload, cofre, preferências, pasta de documentos e nomes de exportação passam
integralmente à identidade Dobra, sem aliases de migração. O código funcional
permanece; o projeto ainda não tem usuários publicados.

## Validação local

- `npm run check`: passou.
- `npm test`: 169 testes passaram.
- `xvfb-run -a npm run test:ui`: passou, incluindo nome Electron Dobra,
  isolamento por DOBRA_DATA_DIR, tema, CRUD, sequências, cancelamento, backups,
  IPC real, 112 combinações responsivas e 90 combinações de geometria de teclado.
- `npm run test:input`: passou com hook nativo e XTest em Xvfb próprio.
- `npm run test:soak`: 300 execuções, 240 concluídas, 60 canceladas, 30 gravações,
  pico de quatro execuções e nenhuma execução residual. Não certifica ausência
  de vazamento de memória.
- `npm run pack`: pacote Linux x64 gerado; executável `dist/linux-unpacked/dobra`.
- `xvfb-run -a node scripts/platform-audit.cjs`: núcleo passou; ASAR coincide
  com os arquivos de produção verificados; runtime source confirma nome Dobra.

As capturas são do aplicativo real em um perfil temporário, não do protótipo.
A sonda Linux usa Electron/source e inspeciona o pacote, mas não executa o
instalador. O ambiente sem desktop completo não confirmou notificações, host
na bandeja ou aplicativo em foco; esses estados permaneceram explícitos.
O JSON da sonda registra HEAD anterior à mudança porque foi gerado na árvore
modificada antes do commit. Não é uma certificação desse commit anterior.

Windows e macOS continuam previstos no CI; seus binários desta mudança ainda
precisam de validação. Assinatura pública e notarização não foram concluídas.
