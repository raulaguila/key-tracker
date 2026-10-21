const MODIFIER_CODES = {
  ControlLeft: 'ctrlKey', ControlRight: 'ctrlKey',
  AltLeft: 'altKey', AltRight: 'altKey',
  ShiftLeft: 'shiftKey', ShiftRight: 'shiftKey',
  MetaLeft: 'metaKey', MetaRight: 'metaKey'
};
const FLAGS = ['ctrlKey', 'altKey', 'shiftKey', 'metaKey'];

function shortcutModifiers(effective) {
  const names = effective.split('+').slice(0, -1);
  if (effective.split('+').at(-1) === 'Plus') names.push('Shift');
  return new Set(names.map(name => ({ Control: 'ctrlKey', Alt: 'altKey', Shift: 'shiftKey', Command: 'metaKey', Super: 'metaKey' })[name]).filter(Boolean));
}

function matchesModifiers(event, modifiers) {
  return FLAGS.every(flag => Boolean(event[flag]) === modifiers.has(flag));
}

class KeyGestures {
  constructor({ findGroup, isActive, run }) {
    Object.assign(this, { findGroup, isActive, run });
    this.down = new Set();
    this.active = new Map();
  }

  cancel(gesture) {
    clearTimeout(gesture.timer);
    if (this.active.get(gesture.code) === gesture) this.active.delete(gesture.code);
  }

  reset() {
    for (const gesture of this.active.values()) this.cancel(gesture);
    // A reset is not a keyup. Keep observed keys blocked until their real keyup.
  }

  schedule(gesture, delay = gesture.group.bindings.hold.repeatMs ?? 400) {
    const hold = gesture.group.bindings.hold;
    gesture.timer = setTimeout(async () => {
      if (this.active.get(gesture.code) !== gesture || !this.isActive(gesture.group)) return;
      await this.run(gesture.group, hold);
      if (this.active.get(gesture.code) === gesture && this.isActive(gesture.group)) this.schedule(gesture);
    }, delay);
    gesture.timer.unref?.();
  }

  handle(event, { dispatch = true } = {}) {
    if (!event || typeof event.code !== 'string' || !['down', 'up'].includes(event.direction)) return;
    for (const gesture of this.active.values()) {
      const releasedModifier = event.direction === 'up' && gesture.group.modifiers.has(MODIFIER_CODES[event.code]) &&
        ![...this.down].some(code => code !== event.code && MODIFIER_CODES[code] === MODIFIER_CODES[event.code]);
      const missingModifier = [...gesture.group.modifiers].some(flag => !event[flag]);
      if (releasedModifier || missingModifier) this.cancel(gesture);
    }
    if (event.direction === 'up') {
      this.down.delete(event.code);
      const gesture = this.active.get(event.code);
      if (!gesture) return;
      this.cancel(gesture);
      if (gesture.group.bindings.release && this.isActive(gesture.group)) void this.run(gesture.group, gesture.group.bindings.release);
      return;
    }
    if (this.down.has(event.code)) return;
    this.down.add(event.code);
    if (!dispatch) return;
    const group = this.findGroup(event);
    if (!group || !this.isActive(group)) return;
    const gesture = { code: event.code, group, timer: null };
    this.active.set(event.code, gesture);
    if (group.bindings.press) void this.run(group, group.bindings.press);
    if (group.bindings.hold && this.active.get(event.code) === gesture) this.schedule(gesture, group.bindings.hold.holdDelayMs ?? group.bindings.hold.repeatMs ?? 400);
    return true;
  }
}

module.exports = { KeyGestures, shortcutModifiers, matchesModifiers };
