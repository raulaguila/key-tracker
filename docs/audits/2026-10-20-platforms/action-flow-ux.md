# Recomendação para cadastrar ações e sequências

Data: 20/10/2026. Status: recomendação de UX, sem redesign aplicado ao produto.
A correção de A08 otimiza atualização de estado, linhas e menus; não muda este
fluxo de cadastro. A proposta abaixo usa os tipos, limites e APIs existentes.

## Direção recomendada

Manter o drawer e um fluxo linear: **gatilho → etapas → salvar → prévia → teste**.
Não usar canvas, nós ou conexões. Uma sequência tem uma ordem única, até dez etapas
e para na primeira falha; a interface deve mostrar precisamente essa estrutura.
Uma ação simples continua com um formulário único, sem exigir uma sequência.

A camada permanece o contexto da ação. O rastreio e o controle global de
ativação continuam independentes. Criar uma ação, selecionar uma camada de destino
ou abrir uma prévia não deve ativar o motor nem executar efeitos.

## O que o cadastro atual já resolve

- Nome, atalho e ativação precedem a configuração; o fundo não é comprimido.
- Os campos são específicos por tipo, sem JSON, inclusive dentro de etapas.
- Alternar tipos preserva rascunhos, pares HTTP incompletos e ordem das etapas.
- O cadastro mantém de uma a dez etapas, com mover, remover e foco explícitos.
- A prévia apresenta os valores resolvidos em ordem. A execução exige outro clique.
- Após o teste, o resultado persistente vem antes da prévia; falhas e duração por
  etapa também aparecem no Histórico.

O principal atrito é vertical: nome, captura do atalho, ativação, tipo e avisos
ocupam boa parte do drawer antes da primeira etapa. Cada etapa repete seletor e
campos; ao adicionar várias, todas podem continuar abertas. Quando fechadas, as
etapas mostram número e tipo, mas pouco do destino configurado. Para conferir a
rotina inteira, a pessoa precisa abrir várias seções e percorrer o formulário.

Referências de implementação: [formulário](../../../app/renderer/app.js),
[editor e etapas](../../../app/renderer/action-editor.js) e
[estilos do drawer](../../../app/renderer/styles.css).

## Composição compacta proposta

```text
Camada: Trabalho                         Fechar
Nova ação
Ao pressionar [Ctrl] + [B]           Ativada
─────────────────────────────────────────────
Nome da ação
[Preparar reunião                         ]
O que esta tecla deve fazer?
[Executar sequência                       ▾]

1  Copiar texto          Texto configurado
2  Abrir destino         pauta.pdf
   ┌ etapa aberta: tipo e campos necessários
   │ mover para cima / baixo · remover
   └─────────────────────────────────────────
3  Trocar camada         Apresentação

[+ Adicionar etapa]                 3 de 10
Para na primeira falha; efeitos anteriores
não são desfeitos.
─────────────────────────────────────────────
Alterações não salvas       Cancelar   Salvar
```

O desenho é um esquema de informação, não uma tela implementada. A versão final
manteria os tokens, temas, tamanhos de texto e controles aprovados.

**Cabeçalho e gatilho.** Manter contexto, título e resumo do gatilho fixos no topo.
Usar uma linha curta para a combinação e o estado, com edição do atalho no próprio
drawer. O campo de nome fica logo abaixo, no conteúdo. Evitar manter a captura
completa, todos os avisos e um seletor grande permanentemente no cabeçalho: isso
retiraria espaço das etapas, especialmente com zoom ou janelas baixas.

**Uma etapa aberta por vez.** A lista mantém todas as etapas visíveis como resumos.
Selecionar uma abre seus campos e recolhe a anterior; adicionar abre a nova sem
perder os valores já preenchidos. Mover preserva valores, ordem, seção aberta e
foco. Os botões de mover e remover ficam junto da etapa em edição. A numeração
representa a ordem real, sem exigir arrastar como única forma de reorganizar.

**Resumo útil.** Mostrar tipo e um dado suficiente para reconhecer a etapa:

| Tipo | Resumo recomendado quando fechado |
| --- | --- |
| Copiar texto | “Texto configurado · 128 caracteres” |
| Abrir URL | Host e caminho curto, sem query ou credenciais |
| Abrir arquivo/aplicativo | Nome do destino; caminho completo ao abrir a etapa |
| Notificação | Título configurado |
| Trocar camada | Nome da camada de destino |
| HTTP | Método e host/caminho, sem headers, corpo ou query |
| Arquivo | Criar/acrescentar e nome do arquivo |
| Log legado | “Registro em log · mensagem configurada” |

O resumo não substitui os campos nem a prévia completa. Limitar texto visualmente
com opção de abrir a etapa, preservando nome acessível completo. Não apresentar
segredos de autenticação nas linhas de resumo.

**Rodapé.** Manter Cancelar e Salvar fixos. Uma frase curta comunica alterações
pendentes; o limite “3 de 10” fica junto de Adicionar etapa. Manter avisos de
comportamento perto da lista, sem repetir a mesma explicação em cada etapa.

## Salvar, conferir e executar

Hoje `previewBinding(layerId, bindingId)` prepara uma ação **já persistida**. O
cadastro não possui API de teste de rascunho. Por isso, a recomendação compatível
com o produto atual é:

1. Salvar o formulário, validando o atalho, as referências e todas as etapas.
2. Abrir a prévia pelo controle de teste da ação salva.
3. Conferir a ordem, os valores resolvidos, destinos e headers mascarados.
4. Escolher explicitamente **Executar teste**.

Não disponibilizar um botão que pareça testar alterações ainda não salvas.
Opcionalmente, uma revisão futura poderia oferecer **Salvar e abrir prévia**:
primeiro persistir, depois chamar a API existente. Esse botão não executaria a
ação. Não é necessário criar uma API nova nem implementá-lo nesta correção.

Na prévia, separar “o que será feito” do resultado do teste. Após executar, manter
a confirmação persistente visível e alinhar resultados à mesma numeração das
etapas: concluída, falhou ou não iniciada. Os eventos atuais contêm somente as
etapas iniciadas; no drawer, o total pode vir da sequência congelada na prévia.
No Histórico, não inventar etapas ausentes usando uma configuração que pode ter
sido editada depois. Mostrar apenas os resultados efetivamente registrados.

Uma falha na terceira etapa deve ficar inequívoca: etapas 1 e 2 concluíram, a 3
falhou, as posteriores não começaram e **os efeitos já realizados não foram
desfeitos**. Não oferecer ou sugerir rollback que o motor não executa. Uma nova
tentativa prepara outra prévia e pode repetir os efeitos anteriores.

## Validação e acesso

- Validar a etapa afetada, abri-la e focar seu campo; o erro precisa citar o
  problema concreto, sem exigir procurar em dez seções fechadas.
- Preservar o foco ao recolher, adicionar, mover, remover e fechar o drawer.
  Oferecer nomes como “Mover etapa 2 para cima”, com limites visíveis.
- Manter teclado, leitor de tela, dois temas, movimento reduzido e rolagem própria.
  A versão recolhida da etapa também precisa comunicar sua posição e tipo.
- Conservar a proteção de rascunhos ao trocar de tela, fechar a janela ou descartar.
  Expandir/recolher uma etapa, por si só, não altera a configuração.

## Limite da proposta e critérios para uma revisão futura

Não adicionar condições, ramificações, paralelismo, canvas, novas integrações ou
novos limites para implementar esta organização. É uma reorganização do cadastro
existente. HTTP, arquivo e log continuam disponíveis em etapas e em configurações
legadas, com log claramente identificado como compatibilidade.

Antes de adotar o desenho, conferir tarefas concretas: criar uma ação simples;
montar e revisar uma sequência de quatro tipos; mover uma etapa sem perder campos;
corrigir um campo obrigatório em etapa recolhida; salvar, preparar a prévia e
executar um teste que falha no meio. Verificar os dois temas, foco e retorno,
janela desktop mínima, conteúdo longo e escala de texto, mantendo os resultados
sanitizados e a execução explícita.
