# Instalação e compatibilidade

[Voltar à documentação](README.md)

## Status de distribuição

O Dobra está em desenvolvimento. Há pacotes de teste produzidos pelo workflow
[Desktop](https://github.com/raulaguila/key-tracker/actions/workflows/desktop.yml).
Não há release pública assinada no momento desta revisão. Um build verde no CI
não comprova assinatura, notarização ou instalação em todos os computadores.

## Baixar um build de teste

1. Entre no GitHub e abra **Actions → Desktop** no repositório.
2. Escolha uma execução bem-sucedida da `main`, conferindo o commit desejado.
3. Na seção **Artifacts**, baixe `dobra-<sistema>-<arquitetura>` e extraia o arquivo.
4. Escolha o instalador conforme a tabela abaixo.

Artifacts exigem login e expiram conforme a retenção do GitHub. Uma execução
pode ser refeita manualmente por mantenedores se o arquivo não estiver disponível.
[Orientações do GitHub](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts).

| Sistema/arquitetura | Artifact | Conteúdo |
| --- | --- | --- |
| Windows x64 | `dobra-Windows-X64` | `Dobra-<versão>-win-x64.exe` |
| Mac Apple Silicon | `dobra-macOS-ARM64` | `Dobra-<versão>-mac-arm64.dmg` e `.zip` |
| Mac Intel | `dobra-macOS-X64` | `Dobra-<versão>-mac-x64.dmg` e `.zip` |
| Linux x64 | `dobra-Linux-X64` | `Dobra-<versão>-linux-x64.AppImage` e `.deb` |

## Windows

O instalador NSIS permite escolher a pasta de instalação. Execute o `.exe` no
ambiente de teste desejado. Builds de desenvolvimento não são assinados para
distribuição pública; o Windows pode exibir alertas de editor desconhecido.
O projeto ainda não disponibiliza uma versão de produção para resolver isso.

As teclas são observadas sem reservar atalhos de outros programas. Notificações
devem ser conferidas na versão instalada, pois dependem do atalho e da identidade
registrados pelo instalador, além das configurações de notificações do Windows.
Na configuração atual, desinstalar pelo NSIS preserva os dados do usuário.

## macOS

Escolha ARM64 para Apple Silicon ou x64 para Intel. O `.dmg` contém o aplicativo;
uma distribuição aprovada pode ser copiada para Aplicativos. O `.zip` contém o
bundle da arquitetura correspondente. Os builds de desenvolvimento ainda não
têm assinatura/notarização pública, e o Gatekeeper pode impedir sua abertura.

Para entrada global, confira **Ajustes do Sistema → Privacidade e Segurança →
Acessibilidade**. O sistema também pode solicitar **Monitoramento de Entrada**.
Negar ou revogar acesso limita as funções; o estado é informado no Dobra.
Após alterar permissões, reabra o aplicativo se a entrada continuar indisponível.
Notificações precisam ser validadas na distribuição assinada.

## Linux

O CI usa Linux x64 e X11. O `.deb` declara as dependências do Electron e da
captura nativa; instale-o pelo gerenciador de pacotes da distribuição. O AppImage
precisa de permissão de execução e das bibliotecas disponíveis no sistema:

```bash
chmod +x Dobra-*.AppImage
./Dobra-*-linux-x64.AppImage
```

Mantenha apenas um AppImage nessa pasta ao usar o comando com `*`. O AppImage não instala dependências.
As dependências declaradas estão em `build.deb.depends` no [package.json](../package.json),
incluindo `libxt6 | libxt6t64`. Para detectar o aplicativo em foco em X11, são
necessários `xprop` e `xwininfo`. Ocultar na bandeja depende de um host
StatusNotifier e de `dbus-send`; sem host, a janela permanece recuperável.

Para salvar headers HTTP, disponibilize um cofre seguro, como GNOME Keyring ou
KWallet. Sem ele, o Dobra recusa novas gravações com headers, sem fallback para
armazenamento desprotegido.

### Wayland

O rastreio é local, com a janela do Dobra em foco. A observação global passiva
não está disponível: ações por tecla, troca de camada e pausa pelo teclado
exigem X11 no Linux. O Dobra informa a limitação e mantém os controles da
interface e a execução manual disponíveis. Não reserva atalhos pelo portal.

## Primeiro início e atualização

As ações iniciam pausadas e o rastreio, desligado. Siga o [guia de uso](USAGE.md).
Não há atualizador automático. Antes de trocar de computador ou retornar a uma
versão anterior, exporte uma configuração portátil; ela remove todos os headers
HTTP, que precisam ser reinformados. Backups criptografados locais não são portáteis.

## O que foi validado

O CI inclui Windows x64, Linux x64, macOS ARM64 e macOS x64. Instalação real,
permissões, hardware, layouts/IMEs e comportamento de cada desktop ainda exigem
o [roteiro de QA instalado](PRODUCTION.md#roteiro-de-qa-instalado--registrar-não-presumir).
Os sistemas mínimos dependem do Electron fixado no [package.json](../package.json);
não há certificação adicional de versões de SO ou arquiteturas fora da matriz.
