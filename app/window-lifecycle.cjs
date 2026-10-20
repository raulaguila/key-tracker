// Native close and tray quit share the renderer's draft confirmation.
class WindowLifecycle {
  constructor({ window, shouldHide, requestConfirmation, beforeHide = () => {}, quit }) {
    this.window = window;
    this.shouldHide = shouldHide;
    this.requestConfirmation = requestConfirmation;
    this.beforeHide = beforeHide;
    this.quit = quit;
    this.allowClose = false;
    this.pending = null;
    this.forceQuitRequested = false;
    this.confirming = null;
    this.confirmationReady = false;
    this.onClose = event => {
      if (this.allowClose) return;
      event.preventDefault();
      void this.request();
    };
    window.on('close', this.onClose);
  }

  async request(forceQuit = false) {
    if (this.window.isDestroyed()) { this.quit(); return; }
    if (this.pending) {
      if (forceQuit) { this.forceQuitRequested = true; this.pending.toTray = false; }
      return;
    }
    const pending = { toTray: false };
    this.pending = pending;
    this.confirmationReady = false;
    this.forceQuitRequested = forceQuit;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
    let available = false;
    if (!forceQuit) try { available = Boolean(await this.shouldHide()); } catch { /* Keep the close flow usable when the native host fails. */ }
    if (this.pending !== pending || this.window.isDestroyed()) return;
    pending.toTray = available && !this.forceQuitRequested;
    this.confirmationReady = true;
    this.requestConfirmation(pending);
  }

  confirm() {
    const pending = this.pending;
    if (!pending || !this.confirmationReady || this.window.isDestroyed()) return Promise.resolve();
    if (this.confirming?.pending === pending) return this.confirming.promise;
    const confirmation = { pending, promise: null };
    confirmation.promise = Promise.resolve().then(async () => {
      let available = false;
      if (pending.toTray && !this.forceQuitRequested) try { available = Boolean(await this.shouldHide()); } catch { /* Losing the tray must leave the window recoverable. */ }
      if (this.pending !== pending || this.window.isDestroyed()) return;
      this.pending = null;
      this.confirmationReady = false;
      if (pending.toTray && !this.forceQuitRequested) {
        if (!available) { this.window.show(); this.window.focus(); return; }
        // A hidden editor must not leave shortcuts suspended indefinitely.
        this.beforeHide();
        this.window.hide();
      } else {
        this.allowClose = true;
        this.window.close();
      }
    }).finally(() => { if (this.confirming === confirmation) this.confirming = null; });
    this.confirming = confirmation;
    return confirmation.promise;
  }

  cancel() { this.pending = null; this.confirmationReady = false; }

  forceQuit() { this.allowClose = true; this.pending = null; this.confirmationReady = false; this.quit(); }
}

module.exports = { WindowLifecycle };
