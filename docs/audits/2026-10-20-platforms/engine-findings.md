# Auditoria do motor, ações e persistência

HEAD: `77a360d`. Somente leitura do produto. Provas em `engine-results.json`; script temporário `/tmp/keyboard-engine-os-audit.cjs`. Node 24.15.0, Linux; bordas nativas substituídas apenas nos diagnósticos do motor. Não houve execução nativa Windows/macOS.

## Achados confirmados

### P1 — Configuração aceita pode impedir reabertura e rejeitar o próprio backup

- Código: `app/config.cjs:107`, `app/storage.cjs:16`, `app/storage.cjs:31`, `app/main.cjs:135`, `app/main.cjs:143`.
- Causa: a validação mede JSON compacto; gravação/exportação acrescentam indentação; load/import limitam bytes físicos a 262.144.
- Reprodução atual com sequências: três camadas, 100 ações por camada, dez etapas clipboard por ação. Configuração normalizada de 129.054 B é aceita/salva; arquivo de 366.275 B faz `Storage.load()` rejeitar. A exportação tem os mesmos 366.275 B e seria rejeitada antes da importação.
- Reprodução simples: 12 camadas × 100 ações de log: 130.725 B compactos, 271.859 B salvos, mesma falha.
- Impacto: usuário não consegue reabrir o aplicativo com uma configuração aceita, embora o arquivo seja preservado. Afeta o algoritmo compartilhado dos três OS; as três variantes da validação aceitaram a fixture, execução real de save/load foi Linux.
- Recomendação: usar uma representação/critério de tamanho coerente entre validação, persistência, exportação e importação; cobrir roundtrip no limite antes de aceitar o save.

### P2 — Cooldown das ações impede pausa de emergência imediata

- Código: `app/engine.cjs:190` e `app/engine.cjs:192`.
- Reprodução: intervalo de 10.000 ms; retomar pelo atalho global de pausa; pressionar o mesmo atalho novamente imediatamente. `enabled` continua `true`.
- Impacto: controle global de interrupção ignora o usuário por até dez segundos após retomar. Código compartilhado, independente do OS após callback registrado.
- Recomendação: permitir pausa imediata antes da limitação de disparos das ações; tratar debounce de retomada separadamente, se necessário.

### P2 — Etapa de camada apaga cooldown e permite repetição acelerada da sequência

- Código: `app/actions.cjs:97`, `app/engine.cjs:86`, `app/engine.cjs:190`.
- Reprodução: ação A com sequência `[ativar camada atual, copiar texto]` e cooldown de 10.000 ms; disparar A, aguardar conclusão, disparar A novamente. Dois efeitos de clipboard e dois resultados ocorreram em menos de 1 ms nesta execução.
- Causa: a etapa chama `setLayer`, que limpa `lastRun`, inclusive o registro da ação que acabou de iniciar. O atalho nativo de alternância restaura seu registro na linha 198; a nova ação de camada não faz isso.
- Impacto: repetição de hardware pode gerar requests/arquivos/cópias muito acima do intervalo configurado em sequências que trocam de camada. Código compartilhado; diagnóstico usou serviço clipboard injetado, sem clipboard real.
- Recomendação: preservar o cooldown da ação de origem através da troca de camada e definir um critério consistente por binding/camada; cobrir alvo igual e alvo diferente.

## Verificações positivas

- Quatro sequências de dez etapas consumiram quatro vagas, executaram 40 chamadas e encerraram com zero vagas ocupadas. Quinta execução e duplicata em voo foram rejeitadas.
- Histórico manteve o limite de 100 entradas.
- Quatro sequências de dez etapas legadas de log, com filesystem real, gravaram 44 linhas: 40 mensagens solicitadas e quatro resultados automáticos. Pico de quatro escritas aguardando a fila; todas concluídas. A amostra levou 6,11 ms neste host, sem Electron; não é SLO nem medida de UI/hardware.
- Pausar durante uma sequência já iniciada permitiu a etapa posterior criar um arquivo, conforme contrato de que pausa impede novos disparos e ações em voo terminam normalmente. Não foi classificado como falha.
- Validação cruzada rejeitou `C:app.exe` e caminhos Windows em POSIX; caminho Windows com espaços foi preservado como um único alvo. A execução nativa usa `spawn(target, [], {shell:false})`, sem separação de argumentos.

## Limites de compatibilidade

Configurações com caminhos absolutos específicos de um OS não são automaticamente remapeadas para outro. A aceitação das regras de caminho foi exercitada passando explicitamente linux/win32/darwin; abertura nativa, alias de volume/UNC e permissões em Windows/macOS dependem da validação nesses sistemas. Não foram inferidas falhas nativas a partir desses casos puros. Fechamento do processo e duração real de serviços nativos permanecem sob a prova Electron/CI do parent.
