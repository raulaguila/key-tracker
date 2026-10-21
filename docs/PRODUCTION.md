# Preparação e operação de produção

[Documentação](README.md) · [Instalação](INSTALLATION.md) · [Assinatura e notarização](SIGNING.md)

**Status:** distribuição pública ainda pendente de certificados/integração de
assinatura, notarização real e QA instalado. O workflow prepara candidatos;
não demonstra que essas etapas externas já foram concluídas.

O CI valida Windows x64, Linux x64/X11, macOS ARM64 e macOS Intel x64. Os artifacts
de desenvolvimento são distintos dos candidatos assinados. Não há publicação ou
atualização automática. O usuário escolhe instalar cada versão.

## Dados, credenciais e recuperação

Configurações com headers HTTP, inclusive dentro de sequências, são gravadas em
envelope `dobra.safeStorage` versão 1, criptografando a configuração inteira
com o cofre do SO. A configuração em memória continua versão 1. Não há chave fixa
nem fallback `basic_text`. Configurações sem headers continuam JSON legível.

No Linux é necessário um cofre seguro disponível, como GNOME Keyring ou KWallet.
Sem ele, salvar headers é recusado. Credenciais antigas em texto aberto ficam
preservadas e a interface informa a migração pendente; habilite/desbloqueie o
cofre e reabra o aplicativo para migrar. A proteção do SO depende do usuário,
máquina e permissões; não é defesa universal contra outro processo do mesmo
usuário. Campos comuns (URL, query, corpo, arquivos) não são um cofre de segredos
quando a configuração não tem headers; não coloque credenciais nesses campos.

Cada salvamento válido mantém a configuração anterior em `config.backup.json`.
Um backup com headers também é criptografado. Escrita temporária, sincronização e
rename evitam truncamento do arquivo principal. Configuração inválida bloqueia
salvamento comum. Na abertura, o diálogo permite restaurar backup válido,
importar JSON portátil ou sair, preservando o arquivo com problema. Recuperação
explícita guarda uma cópia `config.invalid-<UUID>.json`; não apague essa cópia até
conferir os dados recuperados. Ela preserva os bytes originais, inclusive de um
legado que já continha dados em texto aberto.

Configurações → Restaurar backup pede confirmação, pausa ações e cancela as
execuções. A versão atual válida passa a ser o backup. Sem confirmação não há
alteração. Backup criptografado local não é um arquivo portátil: exporte pela
interface antes de trocar de computador/usuário ou voltar a uma versão anterior.
Exportar remove **todos os headers HTTP**, inclusive headers não secretos e os
de sequências; reinforme-os no destino. Corpo e query comuns são preservados.
Versões anteriores ao envelope não conseguem abri-lo: nunca faça downgrade
substituindo ou apagando o arquivo criptografado; use exportação portátil.

## Execuções e suporte

Histórico → Em execução mostra até quatro ações, etapa atual e espera. Cancelar
aborta a espera/requisição HTTP e impede etapas seguintes. Uma operação nativa já
iniciada pode precisar terminar; sua vaga permanece ocupada até isso acontecer.
Cancelar não desfaz arquivo gravado, requisição já recebida ou aplicativo aberto.
Parar todas também pausa os atalhos e cancela o gesto mantido. Pausar sozinho
continua impedindo apenas novos disparos. Encerrar cancela trabalho pendente.

Configurações → Exportar diagnóstico gera um JSON por escolha explícita. Inclui
versões, capacidades e contagens/tempos dos eventos recentes (até 100), sem
configuração, nomes, caminhos pessoais, URLs, mensagens livres ou teclas
rastreadas. Não há envio automático nem telemetria. O histórico comum pode ter
nomes escolhidos pelo usuário; use o diagnóstico para suporte sem esses dados.

## Gates automatizados

`npm run check`, `npm test`, `npm run test:soak` e os dois smokes Electron/XTest
validam os caminhos cobertos. A sonda padrão faz 300 execuções e 30 gravações.
Para carga prolongada, use `npm run test:soak -- --duration-seconds 1800` (até
3600 segundos); esse teste usa arquivos temporários e HTTP local, sem ativar
atalhos globais. Relata tempos, contagens e heap observado; não certifica ausência
de vazamento nem entrega de teclas físicas por horas.

Desktop gera instaladores dos quatro targets e abre o executável empacotado no
usuário descartável do CI, verificando `app.isPackaged`, arquitetura, preload,
persistência, clipboard, sequências e cancelamento. Platform audit verifica o
source em perfis isolados e compara o ASAR. Nenhum desses testes instala pela
interface, aceita permissões de usuário ou comprova todo hardware/compositor.

Dependency security roda no lockfile, bloqueando vulnerabilidades moderadas/altas/críticas;
Dependabot propõe atualizações semanalmente, sem auto-merge. Resultados anteriores
estão nos [relatórios datados](audits/README.md); contagens de advisories variam.
Consulte a execução atual, reavalie compatibilidade antes de cada release e não
force downgrades apenas para eliminar um alerta. Um gate aprovado não significa
ausência de vulnerabilidades ainda desconhecidas ou não catalogadas, nem a
segurança integral dos binários distribuídos.

## Candidato assinado e distribuição

1. Configure um environment GitHub **production-release**, com revisão humana e
   acesso somente à branch/tag de release. Cadastre certificados apenas como
   secrets, nunca no repositório:
   - Windows, no caminho PFX atualmente implementado: `WIN_CSC_LINK` (PFX/P12
     base64), `WIN_CSC_KEY_PASSWORD`. **Certificados públicos recentes exigem
     proteção de chave em hardware/HSM ou serviço de assinatura. Essa integração
     ainda precisa ser implementada; não basta comprar um certificado e tentar
     exportá-lo para PFX.** Veja [o limite do workflow atual](SIGNING.md#windows).
   - macOS: `MAC_CSC_LINK` (Developer ID Application P12 base64),
     `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
     `APPLE_TEAM_ID`. Use senha específica de aplicativo da Apple.
2. Atualize `package.json` e lockfile para a versão desejada. Execute todos os
   gates e o roteiro abaixo no commit candidato. Registre resultados por target.
3. Execute **Signed release candidate**, informando `v<versão>` exatamente igual
   ao package.json e confirmando o QA. Credenciais ausentes recusam o build;
   presença de secrets não equivale à aprovação da assinatura. Uma tag existente
   deve apontar exatamente ao commit construído (inclusive tags anotadas); isso
   é conferido antes do build e novamente antes de criar o rascunho. Não mova tags.
4. O workflow exige assinatura Windows válida e macOS Developer ID com hardened
   runtime, notarização e ticket válido. Gera hashes SHA-256 e manifesto com
   commit, versão, tamanho e arquitetura. Exige quatro targets e recusa colisões.
5. Somente todos os jobs aprovados criam uma **release em rascunho**. Baixe esses
   mesmos candidatos assinados, repita instalação/permissões e registre o hash
   testado. Publique manualmente após aprovar o QA final. Não usamos assinatura
   ad-hoc como substituta do certificado público.

Verifique os arquivos com `Get-FileHash <arquivo> -Algorithm SHA256` no Windows,
`shasum -a 256 <arquivo>` no macOS ou `sha256sum <arquivo>` no Linux e compare com
`SHA256SUMS.txt`. Retorno: exporte configuração portátil, mantenha instalador/hash
anterior, pare o app, instale versão anterior e importe o JSON redigido. Reinsira
credenciais no cofre; não compartilhe o envelope entre máquinas.

Referências: [assinatura Electron](https://www.electronjs.org/docs/latest/tutorial/code-signing),
[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage),
[notarização builder v26](https://www.electron.build/v26/docs/notarization/).

## Roteiro de QA instalado — registrar, não presumir

Para cada target, registre versão do SO/arquitetura, hash do instalador, layout,
hardware, resultado e evidência. Use um usuário de teste. Sem preenchimento não
há certificação de instalação/hardware.

| Caso | Critério de aprovação |
| --- | --- |
| Instalar em máquina limpa | Instala/abre pelo atalho normal sem ferramentas de desenvolvimento |
| Identidade pública | Editor/assinatura e notarização verificados; permissões do app instalado |
| Primeira abertura | Ações e rastreio pausados; permissões pedidas somente no uso apropriado |
| Permissões | Negar, conceder e revogar entrada/notificações; estado explícito e recuperação |
| Teclado físico | Press/hold/release, modificadores, ABNT2/ANSI/ISO e layout ativo corretos |
| Outros aplicativos | Ações globais em foco externo; conflitos detectados e pausa disponível |
| Sessão | Bloquear/suspender/desconectar teclado; sem repetições fantasmas após voltar |
| Efeitos reais | HTTP local/timeout, clipboard, arquivo, notificação e abertura de app confirmados |
| Interrupção | Cancelar em espera/HTTP impede etapa seguinte; Parar todas interrompe hold |
| Dados | Reabrir com cofre bloqueado, backup/restauração e arquivo corrompido preservados |
| Atualizar/retornar | Configuração preservada; exportação portátil permite retorno compatível |
| Remover/reinstalar | Sem processo/hook residual; Windows mantém dados por padrão |
| Uso prolongado | Sessão de trabalho real com observação de CPU, memória, falhas e recuperação |
| Linux | X11 suportado; Wayland opcional exige validar serviço/Polkit, lock e teclados em GNOME/KDE instalados |

Estado inicial desse roteiro: **pendente em hardware real**, incluindo Windows,
Mac Intel e Apple Silicon. Provas virtuais/automatizadas são registradas à parte.


O gate `test:lifecycle` prova, com provedores de teste e Electron real, janela
visível antes do cofre resolver, saída durante preparação, sincronização ao
ocultar/mostrar, HTTP cancelado sem próxima etapa, gravação aceita antes de sair
e reabertura com configuração/backup legíveis e histórico final. O teste nativo
Linux também para/encerra com uma tecla mantida e aguarda a saída do worker.
Essas provas não substituem testes em disco cheio, logout/encerramento do SO ou
hardware físico. O prazo de shutdown limita a espera, sem garantir rollback de
uma operação nativa em andamento.

## QA da expansão de produtividade

Além do roteiro anterior, validar instalado: dois teclados simultâneos com mesma
tecla, seleção/desconexão/reconexão, teclas já mantidas na ativação, troca de seat,
camada temporária com modificadores e interrupção, retorno do painel sem tomar
acesso à janela principal, negação/revogação de Monitoramento de Entrada no Mac,
importação com conflitos/dependências e undo após falha de persistência. Exercitar
respostas HTTP pequenas/grandes/lentas e condições ignoradas sem vazar conteúdo
no histórico. Helpers novos também precisam fazer parte da verificação de assinatura.

Nesta implementação, certificados privados não são gerados nem incluídos no
repositório. A execução de desenvolvimento não substitui a assinatura real via
secrets do environment production-release ou o roteiro físico instalado.
