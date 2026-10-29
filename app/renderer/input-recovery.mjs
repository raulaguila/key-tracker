// Capability/status codes drive recovery; user-facing messages are not parsed.
export function inputRecovery(state) {
  const device = state.inputDevices || {};
  const linux = state.linuxInput || {};
  if (['missing', 'waiting'].includes(device.status)) return {
    kind: 'device', title: device.status === 'missing' ? 'O teclado selecionado está desconectado' : 'Nenhum teclado disponível',
    message: 'Reconecte o teclado e tente ativar novamente. Você também pode escolher outro teclado nas configurações. Sua automação e o teste concluído continuam salvos.', label: 'Tentar ativar novamente'
  };
  if (linux.supported && ['not-installed', 'version-mismatch', 'runtime-missing'].includes(linux.status)) return {
    kind: 'install', title: linux.status === 'version-mismatch' ? 'Atualize o componente Linux' : 'Instale o componente de entrada',
    message: 'Use as opções abaixo para preparar a integração. Depois de instalar ou reabrir o Dobra, retome este guia; a automação e o teste continuam salvos.', label: 'Verificar instalação e autorizar'
  };
  if (linux.supported && ['disabled', 'denied', 'session-suspended', 'delayed', 'unavailable'].includes(linux.status)) return {
    kind: 'linux', title: linux.status === 'denied' ? 'A autorização foi negada' : ['session-suspended', 'delayed'].includes(linux.status) ? 'A observação do teclado foi interrompida' : 'Autorize a integração Linux',
    message: 'Autorize a observação das teclas nesta sessão. Isso preserva o teste e mantém as ações pausadas até você ativá-las novamente.', label: 'Autorizar integração'
  };
  if (linux.supported && linux.status === 'busy') return { kind: 'linux', title: 'O teclado está em uso por outra instância', message: 'Feche a outra instância do Dobra e tente autorizar novamente. Seu progresso permanece salvo.', label: 'Tentar autorizar novamente' };
  if (state.input?.mode === 'starting' || linux.status === 'authorizing') return { kind: 'pending', title: 'Aguardando o sistema', message: 'Conclua a autorização do sistema ou aguarde a entrada ficar disponível. Seu progresso permanece salvo.', label: 'Aguardando autorização…' };
  if (state.input?.mode !== 'unavailable') return null;
  if (state.platform === 'darwin') return { kind: 'mac', title: 'Permita o Monitoramento de Entrada', message: 'Em Ajustes do Sistema → Privacidade e Segurança → Monitoramento de Entrada, permita o Dobra. Se o sistema pedir para reabrir o aplicativo, seu progresso será retomado. Depois, tente ativar novamente.', label: 'Abrir ajustes de entrada' };
  return { kind: 'retry', title: 'A entrada global ainda não está pronta', message: linux.enabled ? 'A integração foi autorizada. Ative as ações para verificar o teclado. Seu teste continua válido.' : 'Verifique a conexão e as permissões do teclado e tente ativar novamente. Sua automação e o teste concluído estão preservados.', label: 'Tentar ativar novamente' };
}
