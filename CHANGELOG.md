# Changelog

As mudanças abaixo ainda não correspondem a uma release pública. A versão do
pacote é 0.1.0; tags e datas de distribuição serão adicionadas quando publicadas.

## Não lançado

### Recursos

- Camadas temporárias ao manter um controle, com restauração ao soltar ou interromper.
- Painel rápido separado, busca Ctrl/Cmd+K e assistente retomável de configuração.
- Modelos locais, importação/mescla por camada com prévia de conflitos e exportação com dependências.
- Identificação física de teclado por Raw Input (Windows), IOHID (macOS) e evdev autorizado (Linux).
- Sequências com espera por etapa, condições e dados HTTP efêmeros para etapas posteriores.
- Desfazer/refazer até dez alterações de configuração da sessão.

- Identidade Dobra, instaladores e identificador `io.dobra.app`.
- Camadas de teclado, ativação individual, duplicação e editor por tabela/teclado.
- Ações de clipboard, abertura de destino, notificação, troca de camada,
  sequência, HTTP e arquivo.
- Gatilhos ao pressionar, manter e soltar; delay inicial, repetição e intervalo
  entre etapas de sequência.
- Rastreio opt-in, layouts automáticos/manuais e formatos ajustáveis.
- Integração Wayland opcional: serviço passivo evdev, autorização Polkit, stream
  privado e revogação ao bloquear/suspender/trocar de sessão. Componente no `.deb`;
  AppImage requer instalação desse componente. QA com hardware GNOME/KDE pendente.
- Temas claro/escuro/sistema, sidebar recolhível e drawers sobrepostos.
- Perfis por aplicativo e integração opcional com a bandeja.
- Prévia sem efeitos, teste explícito, histórico e cancelamento de execução.
- Configuração com backup, recuperação, proteção de headers pelo cofre nativo,
  exportação portátil sem headers e diagnóstico sanitizado.

### Ajustes recentes

- Componente Linux ausente/incompatível mostra guia para obter o .deb ou abrir um pacote baixado no instalador do sistema, com ações pausadas e autorização pelo SO.

- Compatibilidade v1 com o novo painel, desativação explícita e conflitos físicos claros.
- Revisão de importação grande sem normalizar cada combinação repetidamente; revisão pendente invalida ao mudar a seleção.
- Painel preserva foco, evita atualizações idênticas e indica edição/parada; ocultação durante carga é respeitada.
- Assistente e formulários aguardam suspensão; fechar durante ativação não deixa rastreio ligado.
- Captura HTTP em chunks pequenos usa memória limitada e cede o event loop.
- Baselines de teclado respeitam modificadores/solturas por origem e dispositivo ausente impede ativação.
- Relógio nativo verificado no build e protocolo Linux recebe catálogos grandes/Unicode sem truncar.

- Janela inicial visível durante a preparação, com ações protegidas e backup diferido.
- Parada coordenada das ações e gravações, estado “Parando…” e aviso ao exceder a espera de saída.
- Configuração imutável reutilizada por revisão, progresso visual agrupado e atualizações suspensas quando oculto.
- Salvamento idêntico preserva arquivo/backup; migração e normalização de legado permanecem.
- Provas de lifecycle nos quatro destinos e parada com tecla mantida no Linux.

- Ações de arquivo recusam destinos no perfil interno e aliases de configuração,
  backup e logs, com validação na prévia e novamente na execução.
- Consultas e operações do cofre têm prazo de cinco segundos; falhas preservam
  arquivos, liberam a fila e não aceitam conclusões tardias.
- Semântica ARIA da marca corrigida e axe adicionado ao gate de UI nos dois temas.
- Electron atualizado para 44.9.3 e cadeia vulnerável de build removida via
  global-agent 4.1.3; gate de dependências passa a bloquear a partir de moderado.

- O indicador de teclas pressionadas usa somente chips com contorno; mantém
  o anúncio acessível sem duplicar visualmente a combinação.
- Registro em Log removido das opções de criar/editar ações e etapas.
  Configurações legadas continuam legíveis; resultados automáticos ficam no Histórico.

### Distribuição em preparação

- CI e pacotes de desenvolvimento para Windows x64, Linux x64, macOS ARM64 e Intel x64.
- Workflow manual de candidato assinado, verificações e rascunho de release.
- Assinaturas públicas, notarização real e QA instalado em hardware ainda pendentes.

Evidências anteriores estão em [Auditorias](docs/audits/README.md). Para a situação
de uso atual, consulte o [README](README.md) e o [guia de produção](docs/PRODUCTION.md).
