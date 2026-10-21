# Assinatura e notarização

[Documentação](README.md) · [Processo de release e QA](PRODUCTION.md)

O workflow [Signed release candidate](../.github/workflows/release.yml) usa o
environment GitHub `production-release`. Cadastre os secrets em **Settings →
Environments → production-release → Environment secrets**, com acesso restrito
e revisão humana quando disponível. Certificados e senhas não devem entrar no Git.
Configurar secrets não comprova uma assinatura válida.

## macOS

1. Com uma conta elegível no Apple Developer Program, obtenha um certificado
   **Developer ID Application**, com a chave privada correspondente. Não use
   certificado de distribuição da Mac App Store. Siga as
   [instruções da Apple](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/).
2. No Acesso às Chaves do Mac que contém a chave, exporte o certificado e sua
   chave privada como `.p12`, protegido por senha. Um `.cer` sozinho não contém
   a chave necessária. Faça esse preparo fora do repositório.
3. Converta o `.p12` para base64 e cadastre o conteúdo como `MAC_CSC_LINK` e a
   senha do arquivo como `MAC_CSC_KEY_PASSWORD`. Guarde/apague cópias temporárias
   conforme sua política de segurança; base64 não é criptografia.
4. Cadastre `APPLE_ID`, `APPLE_TEAM_ID` e `APPLE_APP_SPECIFIC_PASSWORD`. A última
   é uma [senha específica de aplicativo](https://support.apple.com/en-us/102654),
   não a senha principal da conta. A conta requer autenticação em dois fatores.

O mesmo certificado pode assinar os builds Intel e Apple Silicon. O projeto
configura hardened runtime, entitlements e notarização no
[build/release.cjs](../build/release.cjs). O
[script de assinatura](../scripts/signed-build.cjs) encaminha os secrets de
certificado ao electron-builder. A autenticação Apple está documentada para a
[versão 26 do builder](https://www.electron.build/v26/docs/notarization/).
O workflow atual exige esses secrets de Apple ID; autenticação por API key não
está integrada ao preflight do projeto.

Depois do build, o CI verifica o aplicativo com `codesign --verify --deep --strict`,
`spctl --assess` e `xcrun stapler validate`. Falhas de assinatura, autenticação,
notarização ou ticket impedem a aprovação do candidato. Ainda é necessário testar
o pacote assinado instalado numa conta/máquina de teste.

## Windows

O caminho implementado aceita `WIN_CSC_LINK` (PFX/P12 em base64) e
`WIN_CSC_KEY_PASSWORD`. Ele é uma integração técnica com o electron-builder;
**não resolve por si só a obtenção e uso de certificados públicos recentes**.

As regras atuais de certificados públicos de code signing exigem armazenamento
seguro da chave em hardware/HSM ou uma solução de assinatura compatível. Uma
chave em token/HSM normalmente não pode ser exportada para PFX. Consulte a
[orientação da DigiCert sobre exportação](https://knowledge.digicert.com/general-information/export-a-code-signing-certificate-as-a-pfx-file).

Antes da distribuição Windows, escolha um provedor disponível para a identidade
e região do distribuidor e implemente a integração dele no build, no preflight
e nos secrets do workflow. O builder v26 admite
[alternativas de assinatura](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/),
mas nenhuma integração de HSM/assinatura em nuvem está configurada no Dobra.
Não configure secrets fictícios nem substitua isso por certificado autoassinado
para uma release pública.

O workflow exige Authenticode com status `Valid`. Uma assinatura válida não
garante ausência imediata de avisos do SmartScreen; identidade e reputação são
verificações distintas. Veja as [opções documentadas pela Microsoft](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).

## Gerar e conferir o candidato

Siga o [processo de release](PRODUCTION.md#candidato-assinado-e-distribuição).
O input da tag deve ser `v<versão>` e corresponder exatamente ao `package.json`.
O preflight recusa credenciais ausentes e uma tag existente apontando para outro
commit. A confirmação de QA deve representar testes efetivamente realizados.

Somente os quatro destinos aprovados permitem criar um rascunho, com manifesto e
hashes SHA-256. Baixe os mesmos arquivos, registre os hashes e conclua o QA final.
A publicação é manual. Este documento não afirma que certificados reais já foram
configurados ou que a notarização de uma release pública já foi concluída.
