// Coalesce visual progress only. Input/cancellation are handled by the engine
// synchronously, before this transport is called.
class StateDelivery {
  constructor({ send, visible, intervalMs = 16 }) {
    Object.assign(this, { send, visible, intervalMs });
    this.pending = null;
    this.timer = null;
    this.signature = '';
  }
  push(state) {
    if (this.disposed) return;
    this.pending = state;
    if (!this.visible()) return;
    const signature = JSON.stringify([state.configRevision, state.enabled, state.editing, state.stopping,
      state.activeLayerId, state.events[0]?.id, state.running.map(item => item.bindingId)]);
    if (signature !== this.signature) { this.signature = signature; this.flush(); }
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), this.intervalMs);
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.pending || !this.visible()) return;
    const state = this.pending; this.pending = null;
    this.send(state);
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.timer = null; this.pending = null; }
}
module.exports = { StateDelivery };
