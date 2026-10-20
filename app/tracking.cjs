const path = require('node:path');

class Tracker {
  constructor({ engine, fork, accessibility = () => true }) {
    this.engine = engine;
    this.fork = fork;
    this.accessibility = accessibility;
    this.worker = null;
    this.timer = null;
  }

  set(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Estado de rastreio inválido.');
    this.stop();
    if (!enabled) {
      this.engine.tracking = { enabled: false, mode: 'off', message: 'Rastreio desligado.' };
      return this.engine.publish();
    }
    if (this.engine.session === 'wayland') return this.local('No Wayland, o rastreio visual funciona apenas nesta janela. Para rastreio global no Linux, use uma sessão X11.');
    if (this.engine.platform === 'darwin' && !this.accessibility()) return this.local('Autorize o aplicativo em Ajustes do Sistema → Privacidade e Segurança → Acessibilidade. Depois, desligue e ative o rastreio. Por enquanto, apenas esta janela.');
    this.engine.tracking = { enabled: true, mode: 'starting', message: 'Iniciando captura global…' };
    try {
      const worker = this.fork(path.join(__dirname, 'tracker-worker.cjs'), [], { serviceName: 'Keyboard Tracker Input', stdio: 'ignore' });
      this.worker = worker;
      this.timer = setTimeout(() => {
        if (this.worker === worker) { this.stop(); this.local('Captura global não respondeu. Verifique as permissões de entrada. Rastreio local disponível.'); }
      }, 5000);
      worker.on('message', message => {
        if (this.worker !== worker) return;
        if (message.type === 'ready') {
          clearTimeout(this.timer);
          this.engine.tracking = { enabled: true, mode: 'global', message: 'Capturando pressionar e soltar em todo o sistema. As teclas não são salvas.' };
          this.engine.publish();
        } else if (message.type === 'key' && this.engine.tracking.mode === 'global') {
          this.engine.emit('key', { code: message.code, key: message.key, direction: message.direction, source: 'global' });
        }
      });
      worker.on('exit', () => {
        if (this.worker !== worker) return;
        this.worker = null;
        clearTimeout(this.timer);
        this.local('Captura global indisponível. Confira permissões e suporte do sistema. Rastreio local disponível.');
      });
    } catch {
      this.stop();
      return this.local('Não foi possível iniciar a captura global. Rastreio disponível nesta janela.');
    }
    return this.engine.publish();
  }

  local(message) {
    this.engine.tracking = { enabled: true, mode: 'local', message };
    return this.engine.publish();
  }

  stop() {
    clearTimeout(this.timer);
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      try { worker.postMessage('stop'); } catch { /* Already exited. */ }
      const timeout = setTimeout(() => { try { worker.kill(); } catch { /* Already exited. */ } }, 1000);
      timeout.unref();
    }
  }
}

module.exports = { Tracker };
