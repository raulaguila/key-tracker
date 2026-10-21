# ADR: produtividade Dobra
Status: accepted — usuário autorizou a proposta completa em 21/10/2026.
Mode: Control / Process / Integrate / Store

Reutilizar Engine, configuração v1, validação, persistência e visual atual. Adições
opcionais para camadas temporárias, dados/condições em sequências e undo limitado.
Biblioteca e importação são locais, com revisão antes de aplicar e remapeamento de
IDs. Painel separado recebe projeção mínima e tem ciclo de vida ligado ao app.

Dispositivos precisam de identidade real: evdev por seat no Linux, Raw Input no
Windows e IOHID no macOS; helpers sem privilégios nos dois últimos. Captura não
reserva, bloqueia ou reinjeta teclas. Limitações/permissões ficam explícitas.

Sem novo banco, servidor, sincronização em nuvem ou execução de shell. Novos
helpers nativos acrescentam build e QA por SO para permitir seleção física real.
Privacidade: respostas HTTP apenas em memória durante execução; prévia não faz
I/O; undo fica na sessão; exportação remove headers. Erros e resultados usam o
histórico sanitizado existente. Assinatura e hardware real continuam exigindo
credenciais e ambiente apropriados, distintos de CI e builds de desenvolvimento.
