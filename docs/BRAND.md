# Dobra

[Documentação](README.md) · [Design da interface](../DESIGN.md)

Nome: **Dobra**. Assinatura: **Mais possibilidades em cada tecla.**
Personalidade: próxima, tátil e versátil. O D representa uma superfície dobrada,
associando uma mesma tecla às possibilidades de suas camadas.

## Identidade visual

A interface de Camadas, Rastreio, Histórico e Configurações segue uma direção inspirada no HabboAssets: azul quase
preto nas superfícies escuras, ciano nas ações/seleções, bordas discretas e teclas
com relevo. O tema claro adapta a mesma linguagem com contraste próprio. A marca
continua Dobra; a interface não depende de sprites, fontes ou serviços do Habbo.
Os tokens e componentes atuais estão descritos em [Design](../DESIGN.md).

Os arquivos nativos da marca acompanham os tokens da interface:

| Papel | Referência |
| --- | --- |
| Fundo azul-escuro | `#060F14` |
| Ciano no escuro | `#51C7F1` |
| Ciano no claro | `#005973` |
| Texto escuro | `#15242B` |

A interface usa variantes OKLCH azul/ciano adequadas ao tema e mantém a tipografia
do sistema, o layout compacto e os drawers sobrepostos. Verde/âmbar/azul/vermelho comunicam
estados independentemente da marca. O wordmark é `dobra`, em minúsculas; o nome
do aplicativo, dos instaladores e dos textos é **Dobra**.

O diretório [app/assets](../app/assets/) contém logo claro/escuro, símbolo, ícone SVG e PNG. O script
`python3 scripts/generate-icon.py` regenera o PNG a partir da mesma geometria,
lendo as cores diretamente do SVG para evitar divergência entre os arquivos.
O [estudo comparativo](prototypes/identity/README.md) é uma referência histórica.
Os logos SVG usam texto com a fonte do sistema; não são lettering em contornos.
O [kit da marca](dobra-brand-kit.zip) é um arquivo histórico da identidade anterior;
os ativos atuais estão em `app/assets`.

## Identidade técnica

A configuração e os pacotes usam exclusivamente a identidade Dobra:

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
O endereço do repositório permanece `github.com/raulaguila/key-tracker`.
Relatórios de auditoria e capturas anteriores são registros históricos, não
promessas de validação da identidade atual.
