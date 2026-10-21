# Política de segurança

O Dobra está em desenvolvimento, atualmente na linha 0.1. Mudanças de segurança
são aplicadas à `main`; não há branches antigas com suporte ou prazo de resposta
garantido. Use a versão mais recente do código para reproduzir um problema.

## Reportar uma vulnerabilidade

Use **Report a vulnerability** na aba
[Security](https://github.com/raulaguila/key-tracker/security), quando a opção de
relato privado estiver habilitada. Se ela não estiver disponível, abra uma issue
apenas solicitando um canal privado, sem publicar detalhes de exploração,
credenciais ou dados pessoais. Não há endereço de e-mail de segurança anunciado.

Em um canal privado, informe versão/commit, plataforma, impacto, pré-condições e
passos mínimos de reprodução com dados sintéticos. Não teste contra serviços de
terceiros sem autorização. Issues públicas servem para problemas comuns e para
correções já divulgadas de forma coordenada.

## Limites e controles

- O renderer usa sandbox, isolamento de contexto e um preload com métodos explícitos.
  O processo principal valida origem IPC, configuração e destinos das ações.
- O rastreio não persiste eventos de teclado. O diagnóstico usa uma lista explícita
  de campos permitidos e só é exportado por solicitação.
- Headers HTTP fazem a configuração e o backup usarem o cofre seguro do sistema.
  Sem provedor seguro, o salvamento sensível é recusado. O cofre não é isolamento
  absoluto contra processos da mesma conta local.
- Arquivos criados/acrescentados e destinos HTTP são escolhidos pelo usuário.
  A aplicação não é uma sandbox para executar configurações de terceiros.
- Exportar configuração remove headers, mas preserva outros conteúdos. Revise o
  JSON antes de compartilhar e confira configurações importadas antes de ativar.

Veja [privacidade](docs/PRIVACY.md), [arquitetura](ARCHITECTURE.md) e
[produção](docs/PRODUCTION.md) para o modelo de dados e as limitações conhecidas.
O gate de dependências bloqueia alertas moderados, altos e críticos. Isso não
garante ausência de vulnerabilidades desconhecidas nem audita integralmente os
binários Electron/Chromium/Node distribuídos com o aplicativo. Assinatura/notarização
pública e QA físico continuam pendências de distribuição.
