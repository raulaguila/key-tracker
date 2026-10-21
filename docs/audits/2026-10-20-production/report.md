# Preparação para produção

Escopo autorizado: proteção de credenciais, backup/recuperação, cancelamento e
progresso, diagnóstico, estabilidade, distribuição assinada e Mac Intel. Código
da configuração permanece versão 1; envelope criptografado local tem versão 1.

## Entregas

- safeStorage assíncrono para configurações com headers HTTP, inclusive
  sequências e backups. Sem provider seguro não grava headers em texto aberto.
  Leitura legada conserva dados e migra quando a proteção está disponível.
- Backup anterior válido, escrita atômica sincronizada, fila de gravações,
  recuperação no startup por diálogo nativo, importação ou restauração;
  arquivos inválidos preservados. Exportação portátil redige todos os headers.
- Controllers por execução, transições de progresso, cancelamento de espera e
  HTTP, descarte de próximas etapas e cancelamento geral com pausa/gestos.
  Efeitos concluídos não são desfeitos; vagas ficam ocupadas até terminar.
- Histórico com execuções atuais, progresso/cancelar e resultado Cancelado.
  Configurações com proteção, restaurar backup e diagnóstico por escolha local.
- Diagnóstico allowlist de versões/SO/arquitetura/capacidades/contagens/tempos,
  sem copiar mensagens, configuração, conteúdo, nomes ou caminhos pessoais.
- CI nativo acrescenta macOS Intel x64; nomes dos pacotes incluem arquitetura.
  Workflow manual de candidato assinado exige versão, confirmação de QA e
  certificados; valida assinatura/notarização, gera checksums e rascunho.
  Atualização de dependências e auditoria altas/críticas ficam automatizadas.

## Evidência local

169 testes automatizados passaram, incluindo nova persistência, erro de disco,
limites, corrupção preservada, criptografia/indisponibilidade/migração, backup,
exportações, IPC, cancelamento/HTTP real, privacidade e gates de release.
Sintaxe, pacote Linux e diff verificados.

UI smoke completo passou: todos os fluxos anteriores, responsividade, ambos os
temas e novos controles. Sonda usou execução real com espera/HTTP, cancelamento
individual/todas, confirmação/cancelamento nativos de restore, proteção de
rascunho, exportação portátil e diagnóstico sem sete canários privados.
Capturas de execução/proteção nos dois temas foram inspecionadas.

[Cofre nativo Linux](native-storage-vault.json): Electron real, Xvfb/D-Bus e cofre
GNOME temporários isolados. Configuração e backup sem o segredo sintético, ambos
descriptografados corretamente, inclusive em segundo processo; basic_text
recusado. Essa prova não usa o cofre/perfil pessoal do usuário.

Sonda prolongada `node scripts/soak-test.cjs --duration-seconds 60`:
10.088 execuções em 60.022 ms, 8.068 concluídas, 2.020 canceladas, 1.010 saves,
pico de quatro, nenhum residual. Dez etapas por sequência; 100 eventos máximos.
Heap observado foi 5.465.752 → 60.751.320 bytes, sem coleta forçada: não prova
ausência de vazamento. O comando aceita até uma hora para ensaios adicionais;
o padrão curto de CI conserva 300 execuções/30 gravações.

Sonda Electron Linux de produção passou: pacote ASAR, preload, persistência,
clipboard, delay, cancelamento sem efeito posterior, hook compartilhado e saída
limpa. XTest Linux também passou press/hold/release, pausa, edição, modificador,
compartilhamento do worker e falha do capturador em display próprio.

## Limites externos e próximos gates

O workflow assinado está preparado, não foi executado com certificados públicos
nem criou/publicou release. QA de instalador, atualização/retorno, permissões e
hardware real precisa ser registrado por target. A sonda empacotada no CI não é
instalação interativa. Wayland continua com limitações explícitas.

Criptografia local é vinculada ao SO/usuário/cofre; exporte JSON portátil antes
de trocar usuário/máquina ou retornar a versões sem suporte ao envelope.
Somente headers disparam proteção automática; corpo/query/URL comuns continuam
campos de configuração e não devem servir de cofre de credenciais sem headers.

Auditoria npm completa identificou oito pacotes moderados da mesma cadeia de
build (`sprintf-js`), zero alto/crítico. Sem downgrade forçado do builder.
Critério de segurança do CI bloqueia alto/crítico; risco moderado permanece
documentado para reavaliação antes da publicação.

Operação, requisitos de assinatura e roteiro físico: [PRODUCTION.md](../../PRODUCTION.md).

CI dos quatro targets: aguardando push desta revisão.
