# Privacidade e dados locais

[Documentação](README.md) · [Política de segurança](../SECURITY.md)

O Dobra funciona localmente, sem conta, sincronização em nuvem ou telemetria.
Ações HTTP acessam os destinos que você configurar; abrir uma URL encaminha o
destino ao navegador/sistema. A prévia de uma ação não faz essa requisição.

## Teclado e aplicativos

O rastreio recebe eventos de pressionar/soltar e códigos físicos apenas para a
visualização e o controle de gestos. Não persiste teclas rastreadas, não reconstrói
texto digitado e não as envia pela rede. O histórico pode identificar o **atalho
configurado** que executou uma ação; isso é diferente de registrar a digitação.

Rastreio visual e entrada necessária a manter/soltar são controles independentes.
Com ações desse tipo configuradas, o observador pode permanecer ativo durante
pausa/edição para reconhecer solturas, sem executar ações nesses estados.

A detecção opcional de aplicativo em foco usa nome/caminho/bundle do processo.
Não coleta títulos de janelas, URLs ou histórico de programas utilizados.

## Arquivos locais

Em Configurações, use a opção de abrir a pasta de dados para localizar os arquivos.
O perfil usa o nome `Dobra` no diretório de dados do Electron:

| Sistema | Local padrão |
| --- | --- |
| Windows | `%APPDATA%\Dobra` |
| macOS | `~/Library/Application Support/Dobra` |
| Linux | `$XDG_CONFIG_HOME/Dobra`, normalmente `~/.config/Dobra` |

- `config.json`: configuração atual; `config.backup.json`: versão válida anterior.
- `config.invalid-<UUID>.json`: cópia preservada após uma recuperação explícita.
- `logs/activity.jsonl`: resultados e eventos, rotacionado em 1 MiB com uma cópia.
- Preferências visuais ficam no armazenamento local do perfil do Electron.

Arquivos criados por ações ficam na pasta escolhida, ou em `Documentos/Dobra`
quando ela está vazia. Remover o aplicativo não remove esses arquivos.

## Credenciais e conteúdo

Se houver headers HTTP em qualquer ação/etapa, a configuração inteira e seus
backups são protegidos pelo cofre do sistema via `safeStorage`. Sem headers,
o JSON pode ficar legível. Sem provedor seguro, novas gravações com headers são
recusadas; não existe chave fixa ou fallback `basic_text`.

Corpo, query, URL e textos de ações não são campos de credenciais. Não coloque
segredos neles esperando criptografia automática. A proteção depende do sistema
e da conta local e não isola de forma absoluta outros processos do mesmo usuário.
Arquivos legados preservados na recuperação podem conter texto aberto original.

Resultados automáticos omitem headers, corpo HTTP e conteúdo de arquivos/textos.
Ações legadas de log podem conter a mensagem que foi configurada. Nomes de ações,
camadas e atalhos podem aparecer nos eventos; revise o histórico antes de enviá-lo.

## Exportações

| Exportação | Conteúdo e cuidados |
| --- | --- |
| Configuração | Remove **todos** os headers HTTP; preserva query, corpo, textos e caminhos |
| Histórico | Eventos da sessão, incluindo nomes e atalhos configurados |
| Diagnóstico | Versões, capacidades, contagens e tempos; sem configuração, nomes, caminhos pessoais, URLs ou teclas rastreadas |

Nenhum arquivo é enviado automaticamente. Você escolhe o destino pelo diálogo
nativo e decide se o compartilha. Para suporte, prefira o diagnóstico.
Backups criptografados são locais, não portáteis entre usuários/máquinas.

Para remover os dados, encerre o aplicativo e exclua sua pasta de perfil depois
de guardar o que precisa. Arquivos criados pelas ações e exportações devem ser
removidos separadamente. Não apague o cofre do sistema inteiro.
