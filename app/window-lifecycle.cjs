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
    this.onClose = event => {
      if (this.allowClose) return;
      event.preventDefault();
      this.request();
    };
    window.on('close', this.onClose);
  }

  request(forceQuit = false) {
    if (this.window.isDestroyed()) { this.quit(); return; }
    if (this.pending) { if (forceQuit) this.pending.toTray = false; return; }
    this.pending = { toTray: !forceQuit && this.shouldHide() };
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
    this.requestConfirmation(this.pending);
  }

  confirm() {
    const pending = this.pending;
    this.pending = null;
    if (!pending || this.window.isDestroyed()) return;
    if (pending.toTray) {
      // A hidden editor must not leave shortcuts suspended indefinitely.
      this.beforeHide();
      this.window.hide();
    } else {
      this.allowClose = true;
      this.window.close();
    }
  }

  cancel() { this.pending = null; }

  forceQuit() { this.allowClose = true; this.pending = null; this.quit(); }
}

module.exports = { WindowLifecycle };
