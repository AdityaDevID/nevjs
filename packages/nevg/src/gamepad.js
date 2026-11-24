const DPAD = { 12: 'PadUp', 13: 'PadDown', 14: 'PadLeft', 15: 'PadRight' };

export class Gamepads {
  constructor(input, { deadzone = 0.3, getGamepads } = {}) {
    this.input = input;
    this.deadzone = deadzone;
    this.getGamepads = getGamepads ?? (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []));
    this.held = new Set();
  }

  axis(index) {
    for (const pad of this.getGamepads()) {
      if (pad && pad.connected !== false) {
        const v = pad.axes[index] ?? 0;
        return Math.abs(v) < this.deadzone ? 0 : v;
      }
    }
    return 0;
  }

  poll() {
    const now = new Set();
    for (const pad of this.getGamepads()) {
      if (!pad || pad.connected === false) continue;
      pad.buttons.forEach((b, i) => {
        if (b.pressed || b.value > 0.5) {
          now.add(`Pad${i}`);
          if (DPAD[i]) now.add(DPAD[i]);
        }
      });
      const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
      const dz = this.deadzone;
      if (lx < -dz) now.add('PadLeft');
      if (lx > dz) now.add('PadRight');
      if (ly < -dz) now.add('PadUp');
      if (ly > dz) now.add('PadDown');
      if (rx < -dz) now.add('PadRightStickLeft');
      if (rx > dz) now.add('PadRightStickRight');
      if (ry < -dz) now.add('PadRightStickUp');
      if (ry > dz) now.add('PadRightStickDown');
    }
    for (const code of now) if (!this.held.has(code)) this.input.keyDown(code);
    for (const code of this.held) if (!now.has(code)) this.input.keyUp(code);
    this.held = now;
    return this;
  }

  release() {
    for (const code of this.held) this.input.keyUp(code);
    this.held.clear();
  }

  rumble(duration = 200, strong = 0.8, weak = 0.4) {
    for (const pad of this.getGamepads()) {
      pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration, strongMagnitude: strong, weakMagnitude: weak });
    }
  }
}
