# Dobra

Identidade aprovada: **Dobra**. Assinatura: **Mais possibilidades em cada tecla.**
Personalidade: próxima, tátil e versátil. O D representa uma superfície dobrada,
associando uma mesma tecla às possibilidades de suas camadas.

## Identidade visual

| Papel | Referência |
| --- | --- |
| Cobre | `#A94320` |
| Tinta | `#302721` |
| Porcelana | `#F6F2EF` |
| Pêssego | `#F4AE85` |

A interface usa variantes OKLCH adequadas ao tema e mantém a tipografia do sistema,
o layout compacto e os drawers sobrepostos. Verde/âmbar/azul/vermelho comunicam
estados independentemente da marca. O wordmark é `dobra`, em minúsculas; o nome
do aplicativo, dos instaladores e dos textos é **Dobra**.

`app/assets/` contém logo claro/escuro, símbolo, ícone SVG e PNG. O script
`python3 scripts/generate-icon.py` regenera o PNG a partir da mesma geometria.
O estudo comparativo completo permanece em `docs/prototypes/identity/`.
Os logos SVG ainda usam texto com a fonte do sistema, conforme o estudo aprovado.

## Identidade técnica

Não há usuários publicados nem migração de nomes antigos. A configuração inicial
usa exclusivamente a identidade Dobra:

- Pacote/executável Linux: `dobra`; produto Windows/macOS: `Dobra`.
- App ID: `io.dobra.app`; desktop Linux: `io.dobra.app.desktop`.
- Nome Electron/cofre do sistema: `Dobra`; perfil no diretório de dados do SO.
- Arquivos de ações com pasta vazia: `Documentos/Dobra`.
- API isolada do preload: `window.dobra`; IPC: `dobra:*`.
- Preferências visuais: `dobra.*`; aparência: `window.dobraAppearance`.
- Envelope criptografado: `dobra.safeStorage`, versão 1.
- Perfil isolado de desenvolvimento: `DOBRA_DATA_DIR` (ignorado no app empacotado).
- Variáveis de QA: prefixo `DOBRA_`; testes usam perfis temporários.

Não há aliases ou fallback para configurações/perfis da identidade anterior.
Os formatos de camadas e ações e os recursos funcionais continuam os mesmos.
O endereço Git remoto continua apontando ao repositório existente do projeto.
Relatórios de auditoria e capturas anteriores são registros históricos, não
promessas de validação da identidade atual.
