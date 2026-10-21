import { el, button } from './ui.js';

const installStatuses = new Set(['not-installed', 'version-mismatch', 'runtime-missing']);
export function createLinuxInstallHelp({ api, onError }) {
  const feedback = el('p', { class: 'hint', role: 'status', hidden: true });
  let busy = false;
  async function open(control, task, failure) {
    if (busy) return;
    busy = true; download.disabled = installer.disabled = true; control.setAttribute('aria-busy', 'true'); feedback.hidden = true;
    try {
      const result = await task();
      if (result?.opened) { feedback.textContent = 'Instalador do sistema aberto. Conclua a instalação, reabra o Dobra e tente habilitar a integração novamente.'; feedback.hidden = false; }
    } catch (error) {
      const message = typeof error?.message === 'string' ? error.message : '';
      const known = ['Não foi possível abrir o instalador.', 'O arquivo selecionado não é um pacote .deb válido', 'Selecione o pacote .deb do Dobra'];
      const start = known.map(prefix => message.indexOf(prefix)).find(index => index >= 0);
      onError(start === undefined ? failure : message.slice(start, start + 500));
    }
    finally { busy = false; download.disabled = installer.disabled = false; control.removeAttribute('aria-busy'); }
  }
  const download = button('Obter pacote .deb', event => void open(event.currentTarget, () => api.openLinuxDownload(), 'Não foi possível abrir o download. Acesse o repositório do Dobra no GitHub e abra Actions → Desktop.'), '', { symbol: 'download' });
  const installer = button('Abrir .deb baixado', event => void open(event.currentTarget, () => api.openLinuxInstaller(), 'Não foi possível abrir o pacote. Escolha o instalador .deb do Dobra e tente novamente.'), '', { symbol: 'folder' });
  const node = el('section', { class: 'linux-install-help', hidden: true, 'aria-label': 'Instalar componente Linux' },
    el('h3', {}, 'Preparar a integração Linux'),
    el('p', { class: 'hint' }, 'Em Debian, Ubuntu e distribuições compatíveis, instale ou atualize o pacote .deb completo do Dobra. Ele inclui o componente necessário; o AppImage também depende desse componente instalado.'),
    el('div', { class: 'button-row' }, download, installer),
    el('p', { class: 'hint' }, 'No GitHub, escolha uma execução bem-sucedida da main em Desktop e baixe o artefato dobra-Linux-X64. É um build de teste, ainda sem release pública. Entre na sua conta, extraia o arquivo e escolha o .deb para abrir no instalador do sistema.'),
    el('p', { class: 'hint' }, 'O sistema pede a autorização para instalar. Depois, reabra o Dobra e tente habilitar a integração novamente.'), feedback);
  return { node, update(input) { node.hidden = !input?.supported || !installStatuses.has(input.status); } };
}
