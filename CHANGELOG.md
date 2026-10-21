# Changelog

As mudanças abaixo ainda não correspondem a uma release pública. A versão do
pacote é 0.1.0; tags e datas de distribuição serão adicionadas quando publicadas.

## Não lançado

### Recursos

- Identidade Dobra, instaladores e identificador `io.dobra.app`.
- Camadas de teclado, ativação individual, duplicação e editor por tabela/teclado.
- Ações de clipboard, abertura de destino, notificação, troca de camada,
  sequência, HTTP e arquivo.
- Gatilhos ao pressionar, manter e soltar; delay inicial, repetição e intervalo
  entre etapas de sequência.
- Rastreio opt-in, layouts automáticos/manuais e formatos ajustáveis.
- Temas claro/escuro/sistema, sidebar recolhível e drawers sobrepostos.
- Perfis por aplicativo e integração opcional com a bandeja.
- Prévia sem efeitos, teste explícito, histórico e cancelamento de execução.
- Configuração com backup, recuperação, proteção de headers pelo cofre nativo,
  exportação portátil sem headers e diagnóstico sanitizado.

### Ajustes recentes

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
