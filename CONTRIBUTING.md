# Contribuir com o Dobra

Obrigado por contribuir. O projeto é um aplicativo desktop em desenvolvimento,
com interface e documentação em português. Correções, melhorias de acessibilidade,
testes de compatibilidade e documentação são bem-vindos.

## Relatar um problema

Use [Issues](https://github.com/raulaguila/key-tracker/issues/new/choose) e informe
versão/commit, SO e arquitetura, sessão X11/Wayland quando aplicável, passos para
reproduzir e comportamento esperado. Para problemas de teclado, indique layout,
momento da tecla e se a janela estava em foco.

Anexe o diagnóstico exportado se ajudar. Revise capturas e arquivos antes de
enviá-los; configurações e histórico podem conter dados pessoais. Vulnerabilidades
devem seguir a [política de segurança](SECURITY.md), sem detalhes sensíveis em issues.

## Preparar uma alteração

1. Faça um fork ou clone do repositório e crie uma branch a partir da `main`.
2. Configure Node.js 24 e execute `npm ci`.
3. Use um perfil temporário, conforme o [guia de desenvolvimento](docs/DEVELOPMENT.md).
4. Mantenha o escopo focado e atualize a documentação afetada.
5. Execute as verificações pertinentes e abra um pull request explicando problema,
   comportamento final e resultados de validação.

Não inclua certificados, credenciais, configurações pessoais, `node_modules/`,
`dist/` ou arquivos temporários. Arquivos de evidência devem usar dados sintéticos
e indicar o commit, ambiente e limitações do teste.

## Validação esperada

Para código, execute `npm run check` e `npm test`. Mudanças de UI devem conferir
os temas, navegação por teclado, foco, drawers e larguras menores; o smoke está em
`npm run test:ui`. Alterações de gestos/entrada pedem `npm run test:input` em X11.
Mudanças nativas, dependências e empacotamento pedem a matriz dos quatro destinos
no CI. Execute a carga de estabilidade se afetar execução, temporizadores ou I/O.

Para documentação, confira links, nomes de arquivos, comandos e exemplos com o
código atual; não é necessário repetir testes nativos sem alterar o produto.
Relate o que não foi possível testar. CI em máquinas virtuais não certifica
instalação, permissões ou hardware físico em todos os sistemas.

## Convenções

- Valide configuração e IPC no processo principal; não exponha APIs arbitrárias
  de Node, shell ou filesystem ao renderer.
- Preserve os contratos de dados ou documente uma transição compatível.
- Use textos claros em pt-BR, labels acessíveis e estados que não dependam só da cor.
- Evite dependências para funcionalidades pequenas já atendidas pelo projeto.
- Escreva commits e pull requests com intenção e evidência, sem dados privados.

A contribuição é distribuída sob a [licença MIT](LICENSE) do projeto. Dependências
e recursos de terceiros devem manter suas licenças e atribuições.
