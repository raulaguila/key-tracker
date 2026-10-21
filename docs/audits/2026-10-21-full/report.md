# Auditoria de performance, segurança, funcionamento e UI/UX

> **Registro histórico.** Avaliação do commit `92dbe82`, em 21/10/2026.
> Consulte a [documentação atual](../../README.md) para uso e desenvolvimento.
> As [correções posteriores F01–F05](../2026-10-21-remediation/report.md) estão em registro separado.

**Conclusão:** os fluxos cobertos funcionam e o desempenho local é bom, mas há
**duas falhas P1** que devem ser corrigidas antes de produção: ações de arquivo
podem corromper configuração/backup, e chamadas ao cofre não têm prazo limite.
Não foi demonstrada invasão remota ou exposição de credenciais. Há três achados
P2: semântica ARIA da marca, advisory moderado na cadeia de empacotamento e patch
do Electron pendente.
Nenhuma correção do produto foi aplicada nesta rodada.

[Resumo verificável](summary.json) · [Reproduções](reproduction.json) ·
[Script de reprodução](reproduce.cjs) · [Índice de auditorias](../README.md)

## Escopo e método

- Source auditado: [92dbe82](https://github.com/raulaguila/key-tracker/commit/92dbe82a68563891677bc6932c7f62a25ccf15b9).
- Execução local: Linux x64, Electron 44.9.1, Node 24, Xvfb e GPU desabilitada.
  Hardware e demais condições estão no [JSON de performance](performance.json).
- Perfis, arquivos de ações, HTTP de teste, D-Bus e cofre GNOME foram isolados.
  Os testes não carregaram configurações pessoais nem enviaram ações a serviços externos.
- Revisão de validação, IPC, execução/cancelamento, persistência, exportações,
  criptografia, rastreio, dependências, CI e distribuição.
- UI no Electron real: smoke existente, axe-core 4.12.1 em 14 estados e dois
  cenários adicionais com zoom de 200%; inspeção visual das capturas.
- `agent-browser` não estava instalado. A inspeção usou o harness CDP existente
  e sondas descartáveis, sem instalar ferramentas no projeto.

## Achados por prioridade

### F01 — [P1] Ação de arquivo consegue corromper configuração e backup

**Local:** [app/actions.cjs, linhas 140–150](../../../app/actions.cjs#L140-L150).
A execução de `file` valida nome/caminho e symlink, mas não exclui os arquivos
internos protegidos pelo armazenamento. A proteção já usada nas exportações não
é aplicada aqui.

**Prova:** em perfil temporário, salvar uma sequência com duas etapas `file`,
modo `append`, apontando para `config.json` e `config.backup.json` da própria pasta
de dados. Executar a sequência retorna `success`; ambos os JSONs deixam de ser
legíveis, e `storage.load()` e `readBackup()` falham. [Resultado](reproduction.json).

**Impacto:** uma ação mal direcionada compromete a configuração e sua recuperação
automática. É um problema de integridade/funcionamento; não implica execução remota
nem acesso além dos arquivos já acessíveis à conta do usuário.

**Recomendação:** recusar destinos internos nas ações de arquivo, inclusive
aliases, links e a mesma identidade de arquivo por outro caminho. Reutilizar a
política de arquivos protegidos e informar o problema na prévia/editor, além de
validar novamente na execução. Testar configuração, backup e logs em cada SO.
**Aceite:** execução recusada sem alterar os bytes de configuração/backup e sem
registrar sucesso falso. O arquivo comum escolhido pelo usuário continua funcionando.

### F02 — [P1] Cofre sem resposta pode impedir a inicialização

**Locais:** [config-protection.cjs:9](../../../app/config-protection.cjs#L9) e
[main.cjs:125](../../../app/main.cjs#L125). A janela só é criada depois da consulta
ao cofre e do carregamento da configuração. `isAsyncEncryptionAvailable`,
`encryptStringAsync` e `decryptStringAsync` são aguardados sem deadline.

**Prova:** a primeira sessão de UI, sem cofre isolado desbloqueado, não criou o
renderer nos 25 segundos do harness; com D-Bus/cofre descartáveis, o smoke passou.
Isso indica dependência do ambiente, sem identificar sozinho qual chamada nativa
ficou pendente. A reprodução determinística injeta um provedor de disponibilidade
que nunca resolve: a função permanece pendente além dos 150 ms observados, pois
não há limite interno. [Script e resultado](reproduce.cjs).

**Impacto:** um serviço de credenciais travado pode deixar o app sem janela mesmo
com configuração sem headers. Em gravação/leitura criptografada, a mesma ausência
de prazo pode reter a operação e a fila de salvamento.

**Recomendação:** limitar as operações do cofre, descartar respostas tardias e
preservar os arquivos. Oferecer estado/recuperação visíveis; manter a recusa de
gravação sensível quando não houver proteção. Não introduzir fallback em texto aberto.
**Aceite:** provedores sem resposta levam a erro recuperável dentro do prazo
explicitamente escolhido, sem perder dados e sem impedir silenciosamente a interface.

### F03 — [P2] Marca usa atributo ARIA proibido para seu papel

**Local:** [app/renderer/index.html:16](../../../app/renderer/index.html#L16).
`<div class="brand" aria-label="Dobra">` tem papel genérico, que não aceita esse
nome ARIA. O axe reportou `aria-prohibited-attr` nas quatro telas e nos dois temas:
**um problema repetido em oito estados**, não oito problemas independentes.

**Impacto:** semântica inválida para tecnologias assistivas. O texto visível da
marca permanece legível e os fluxos testados por teclado continuam operáveis;
por isso a prioridade é P2, apesar do impacto `serious` atribuído pela ferramenta.
Referência da regra: ARIA/nome acessível, WCAG 4.1.2.

**Recomendação:** remover o `aria-label` redundante ou adotar um papel apropriado
à função real. Incluir axe no gate de UI; o smoke atual verifica comportamento,
mas não executa axe. **Aceite:** zero ocorrências dessa regra nos oito estados.
[Evidência completa](axe-ui-settled.json).

### F04 — [P2] Advisory moderado na cadeia de build

`npm audit` encontrou oito entradas moderadas, todas na cadeia de desenvolvimento,
associadas a `sprintf-js` e dependentes. Há **zero alertas altos/críticos** nessa
consulta e **zero alertas no grafo `--omit=dev`**. São entradas do grafo,
não oito vulnerabilidades independentes.

O [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) descreve
negação de serviço quando o atacante controla especificadores de precisão; o
advisory consultado não informa versão corrigida. Não foi demonstrado caminho
explorável pela interface do Dobra. Os arquivos npm de build não compõem a API do renderer.

**Recomendação:** acompanhar a cadeia do electron-builder e validar uma solução
compatível nos quatro targets antes de adotá-la. O downgrade sugerido pelo npm
não foi aplicado automaticamente. A política atual bloqueia alto/crítico, não moderado.
[Auditoria completa](npm-audit.json) · [Somente produção](npm-audit-production.json).

### F05 — [P2] Electron está dois patches atrás da linha 44

O [package.json](../../../package.json) fixa Electron **44.9.1**. A consulta ao
registro confirmou **44.9.3** como patch atual da mesma linha e 45.0.0 como
`latest`. A [release oficial 44.9.3](https://github.com/electron/electron/releases/tag/v44.9.3)
registra backports de ANGLE, Chromium, PDFium, Skia e V8. Não foi estabelecida
aplicabilidade de um CVE específico ou exploração pelos fluxos do Dobra.

**Impacto:** correções do runtime distribuído ainda não estão no pacote.
O Electron consta em `devDependencies`, mas seu executável é parte do produto;
portanto **`npm audit --omit=dev` não valida todo o runtime entregue ao usuário**.
Também não equivale a auditar independentemente os binários nativos.

**Recomendação:** avaliar o patch 44.9.3, atualizar o lockfile e repetir a matriz
nativa, cofre e smokes antes da distribuição. Não é necessário migrar para a nova
major para tratar esse desvio. [Metadados conferidos](electron-runtime.json).
Nenhuma dependência foi atualizada durante a auditoria.

## Funcionamento e segurança validados

| Verificação | Resultado e alcance |
| --- | --- |
| Sintaxe e testes | `npm run check` passou; 169/169 testes, zero falhas |
| UI completa | CRUD, rascunhos, foco, drawer, menus, temas, sete tipos atuais, log legado e histórico passaram |
| Layouts/responsividade | 112 combinações de tela/tema/sidebar e 90 de teclado; ABNT2/ISO/ANSI e ajustes manuais cobertos pelo smoke |
| Gestos | XTest/Linux confirmou pressionar/manter/soltar, modificadores e cancelamento por edição, pausa e perda do worker |
| Sequências | Ordem, delays, falha parcial, cancelamento de espera/HTTP e parada geral passaram |
| Persistência | Validação, backup, recuperação, escrita serializada e exportações passaram nos caminhos já cobertos; F01 fica fora dessa proteção |
| Runtime | Sandbox/contextIsolation/webSecurity ativos; Node e process ausentes no renderer |
| IPC | Janela auxiliar com preload não autorizado recebeu `Origem não autorizada` |
| CSP e destinos | Evento real de violação `connect-src` confirmou bloqueio de fetch no renderer; URL `javascript:` foi recusada sem mudar configuração/revisão |
| Criptografia | Cofre GNOME descartável: backend `gnome_libsecret`, ciphertext distinto e round-trip correto |
| Conteúdo privado | Testes cobrem mascaramento de headers, exportação portátil, diagnóstico por allowlist e ausência de teclas rastreadas em disco |
| Pacote Linux | Build local passou; 25 arquivos inspecionados no ASAR correspondem ao source; inicialização/saída limpas |

[Resumo dos testes](summary.json) · [Entrada nativa](native-input.json) ·
[Segurança em runtime](security-runtime.json) · [Integração Linux](platform-linux-x64.json).
A sonda de integração usa o source; a medição de performance e as sondas extras
usam o executável empacotado. Isso não equivale a instalar o `.deb` ou AppImage.

## Performance medida

| Medida | Resultado |
| --- | --- |
| Inicialização do pacote, 5 amostras | Mediana 246,5 ms; p95 253,1 ms |
| CPU ociosa padrão | Mediana 0,042%, somada conforme `getAppMetrics` |
| Memória PSS padrão, snapshot | 225,7 MiB |
| Memória PSS com rastreio, snapshot | 317,2 MiB |
| Configuração grande | 25 camadas, 2.500 ações, 254.920 bytes |
| Memória PSS após cenário grande | 576,8 MiB; inclui alocações/caches do percurso anterior |
| Busca com 100 ações | Mediana 1,1 ms; p95 1,9 ms de trabalho síncrono |
| Abrir drawer com 100 ações | Mediana 19,4 ms; p95 24,7 ms de trabalho síncrono |
| Salvar configuração grande | Mediana 54,6 ms; p95 75,3 ms de round-trip |
| IPC de tecla sintética, 240 eventos | Mediana 0,53 ms; p95 1,64 ms até o callback |
| Carga de 120 s | 20.220 execuções: 16.176 concluídas e 4.044 canceladas |
| Gravações/concorrência na carga | 2.022 saves; pico de quatro ações; estruturas de execução vazias após os lotes |
| Cinco ciclos de UI após GC | DOM 4.236 nós e 559 listeners antes/depois; heap do renderer 2,99 → 2,84 MB |

Não foram observadas long tasks pelo observador dessa execução. Não há orçamento
formal de RAM/CPU/latência definido no projeto. O uso de memória no limite de
configuração merece acompanhamento, mas estes dados não demonstram vazamento.
A carga terminou com heap de processo maior sem GC comparável; isso também não
permite concluir vazamento ou ausência dele. [Carga](soak.json).

O desktop é compartilhado, os caches do SO não foram limpos e a instrumentação
adiciona custo. Estas métricas não são INP, latência de teclado físico nem um
benchmark controlado entre SOs. A tentativa de detectar aplicativo em foco ficou
indisponível no Xvfb: seu consumo não representa troca real de programas.

## UI/UX

**Veredito visual:** linguagem consistente de ferramenta, tipografia única,
densidade compacta e hierarquia clara. Não foram encontrados padrões decorativos
que dificultem os fluxos inspecionados. Foco, estados textuais, ações destrutivas,
proteção de rascunhos e formulários sobrepostos são pontos positivos.

| Dimensão Impeccable | Nota | Evidência/limite |
| --- | --- | --- |
| Acessibilidade | 3/4 | F03; testes automatizados não substituem uso com leitores de tela |
| Performance da interface | 3/4 | Boa resposta local; custo de memória do pacote e carga grande requer acompanhamento |
| Responsividade | 4/4 | Matriz do smoke e reflow sem overflow horizontal a 200% nos cenários extras |
| Temas | 4/4 | Claro/escuro/sistema funcionam; sem falha estável de contraste nos estados examinados |
| Antipadrões | 4/4 | Controles e hierarquia consistentes com o produto |
| **Total** | **18/20** | Excelente na amostra de UI; não é certificação WCAG |

O axe começou identificando contraste insuficiente em frames de transição.
Após aguardar estabilização, esses alertas desapareceram e foram excluídos dos
achados. Sete símbolos do teclado ficaram inconclusivos por serem caracteres
não textuais; a verificação complementar de cores calculadas mediu **14,14:1 no
claro e 14,66:1 no escuro**. Permanecem necessários testes com leitores de tela
reais, alto contraste do SO, IMEs e hardware.

[Camadas no tema escuro](layers-dark.png) · [Drawer a 200%, claro](zoom200-light.png) ·
[Drawer a 200%, escuro](zoom200-dark.png).

## Compatibilidade e gates de distribuição

Foram conferidos os oito jobs dos workflows
[Desktop](https://github.com/raulaguila/key-tracker/actions/runs/39609850287) e
[Platform audit](https://github.com/raulaguila/key-tracker/actions/runs/39609850130):
Windows x64, Linux x64, macOS ARM64 e macOS Intel, todos aprovados no commit
`d6c5cf4`. Entre ele e o HEAD auditado, só houve documentação; não houve novo teste
físico de Windows/macOS nesta sessão. [Dados do CI](ci.json).

Continuam **não comprovados por esta auditoria**: instalação guiada em máquinas
limpas, assinatura pública Windows, notarização Apple, permissões reais de cada
SO, hardware/IME e estabilidade de uma jornada inteira. A integração atual de
assinatura Windows baseada em PFX requer adaptação para um provedor moderno com
proteção de chave; veja [Assinatura](../../SIGNING.md).

No laboratório sem desktop completo, notificação não foi confirmada, bandeja
ficou indisponível e não houve aplicativo em foco identificável. A UI informou as
limitações; esses casos não foram contados como sucesso de integração nativa.
Wayland continua com rastreio local e sem manter/soltar globais.

## Próximas ações e reprodução

1. Corrigir F01 e F02 com regressões específicas; `$keel harden` cobre a proteção
   de dados e os limites das operações nativas.
2. Corrigir F03 e incorporar o axe ao gate; `$impeccable harden` cobre a semântica
   e a validação da interface. Tratar F04/F05 pela revisão da cadeia de dependências e do runtime.
3. Reexecutar as sondas afetadas e a matriz de SOs; concluir QA instalado e
   assinatura antes de publicar. `$impeccable polish` fica como última revisão visual.

Os itens podem ser tratados separadamente ou juntos; repetir `$impeccable audit`
após as correções permite comparar a evidência e a pontuação.

Os comandos executados incluem `npm run check`, `npm test`, `npm audit --json`,
`npm audit --omit=dev --json`, `npm run pack`, o smoke de UI com cofre isolado,
`npm run test:input`, `npm run test:soak -- --duration-seconds 120`,
`xvfb-run -a node scripts/performance-audit.cjs` e a sonda de plataforma.

Para reproduzir somente F01/F02, sem ativar atalhos ou usar dados pessoais:

```bash
node docs/audits/2026-10-21-full/reproduce.cjs
```

O script cria/remove seu próprio diretório temporário. No commit auditado, informa
sucesso da ação com dois arquivos ilegíveis e a promessa do cofre ainda pendente.
Os resultados mudam quando as falhas forem corrigidas. Não foi feito ajuste no
código do produto nem atualização automática de dependências nesta auditoria.
