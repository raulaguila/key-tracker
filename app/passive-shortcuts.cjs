const { effectiveShortcut } = require('./config.cjs');
const { shortcutModifiers, matchesModifiers } = require('./key-gestures.cjs');

// These are subscriptions in memory, never OS grabs or synthetic keystrokes.
// Captured positions are handled by KeyGestures; uncaptured shortcuts use the
// same US reference positions as the keyboard preview's provisional layout.
function referenceCode(key) {
  if (/^[A-Z]$/.test(key)) return 'Key' + key;
  if (/^\d$/.test(key)) return 'Digit' + key;
  if (['Up', 'Down', 'Left', 'Right'].includes(key)) return 'Arrow' + key;
  return key === 'Plus' ? 'Equal' : key;
}

class PassiveShortcuts {
  constructor(platform = process.platform) {
    this.platform = platform;
    this.subscriptions = new Map();
    this.index = null;
    this.down = new Set();
  }

  register(shortcut, callback) {
    const effective = effectiveShortcut(shortcut, this.platform);
    const key = effective.split('+').at(-1);
    const modifiers = shortcutModifiers(effective);
    const code = referenceCode(key);
    for (const [other, subscription] of this.subscriptions) {
      if (other !== effective && subscription.code === code && modifiers.size === subscription.modifiers.size && [...modifiers].every(flag => subscription.modifiers.has(flag))) return false;
    }
    this.subscriptions.set(effective, { effective, code, modifiers, callback });
    this.index = null;
    return true;
  }

  unregister(shortcut) { this.subscriptions.delete(effectiveShortcut(shortcut, this.platform)); this.index = null; }
  unregisterAll() { this.subscriptions.clear(); this.down.clear(); this.index = null; }
  synchronize(pressed) { this.down = new Set(pressed); }

  observe(event) {
    if (!event || typeof event.code !== 'string') return;
    if (event.direction === 'up') { this.down.delete(event.code); return; }
    if (event.direction !== 'down' || this.down.has(event.code)) return;
    this.down.add(event.code);
    if (!this.index) {
      this.index = new Map();
      for (const subscription of this.subscriptions.values()) {
        if (!this.index.has(subscription.code)) this.index.set(subscription.code, []);
        this.index.get(subscription.code).push(subscription);
      }
    }
    // Resolve before any callback can change the active subscriptions.
    return (this.index.get(event.code) || []).find(subscription => matchesModifiers(event, subscription.modifiers));
  }

  handleInput(event) { this.observe(event)?.callback(); }
}

module.exports = { PassiveShortcuts, referenceCode };
