import { Emitter } from './emitter.js';

const DEFAULT_ACTIONS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'ArrowUp', 'KeyW'],
  action: ['KeyZ', 'KeyJ', 'Enter'],
  cancel: ['KeyX', 'KeyK', 'Escape'],
  pause: ['KeyP', 'Escape'],
};

/**
 * Keyboard + pointer (mouse/touch/pen) input with named actions.
 *
 *   input.down('left')          held this frame
 *   input.pressed('jump')       went down this frame
 *   input.released('jump')
 *   input.axis('left','right')  -1 | 0 | 1
 *   input.pointer               { x, y, down, pressed, released } in GAME pixels
 *
 * Call input.endFrame() once per update step (Game does this for you).
 */
export class Input extends Emitter {
  constructor(actions = DEFAULT_ACTIONS) {
    super();
    this.actions = {};
    for (const k in actions) this.actions[k] = [].concat(actions[k]);
    this.keys = new Set();
    this._pressed = new Set();
    this._released = new Set();
    this.pointer = { x: 0, y: 0, down: false, pressed: false, released: false, id: null };
    this._target = null;
    this._canvas = null;
    this._toGame = null;
    this._off = [];
  }

  /** Rebind: input.bind('jump', ['Space', 'KeyZ']) */
  bind(action, codes) {
    this.actions[action] = [].concat(codes);
    return this;
  }

  // ---- queries -------------------------------------------------------------
  _codes(a) {
    return this.actions[a] ?? [a]; // an unknown action name is treated as a raw key code
  }
  down(a) {
    return this._codes(a).some((c) => this.keys.has(c));
  }
  pressed(a) {
    return this._codes(a).some((c) => this._pressed.has(c));
  }
  released(a) {
    return this._codes(a).some((c) => this._released.has(c));
  }
  axis(neg, pos) {
    return (this.down(pos) ? 1 : 0) - (this.down(neg) ? 1 : 0);
  }
  /** Normalised movement vector from four actions. */
  vector(left = 'left', right = 'right', up = 'up', down = 'down') {
    let x = this.axis(left, right);
    let y = this.axis(up, down);
    if (x && y) {
      x *= Math.SQRT1_2;
      y *= Math.SQRT1_2;
    }
    return { x, y };
  }

  // ---- event feed (also usable directly from tests / on-screen buttons) -------
  keyDown(code) {
    if (!this.keys.has(code)) this._pressed.add(code);
    this.keys.add(code);
    this.emit('keydown', code);
  }
  keyUp(code) {
    if (this.keys.delete(code)) this._released.add(code);
    this.emit('keyup', code);
  }
  pointerMove(x, y) {
    this.pointer.x = x;
    this.pointer.y = y;
  }
  pointerDown(x, y, id = 0) {
    this.pointerMove(x, y);
    if (!this.pointer.down) this.pointer.pressed = true;
    this.pointer.down = true;
    this.pointer.id = id;
    this.emit('pointerdown', this.pointer);
  }
  pointerUp(x, y) {
    if (x != null) this.pointerMove(x, y);
    if (this.pointer.down) this.pointer.released = true;
    this.pointer.down = false;
    this.emit('pointerup', this.pointer);
  }

  /** Clear the per-frame "pressed/released" flags. */
  endFrame() {
    this._pressed.clear();
    this._released.clear();
    this.pointer.pressed = false;
    this.pointer.released = false;
  }

  releaseAll() {
    for (const k of [...this.keys]) this.keyUp(k);
    if (this.pointer.down) this.pointerUp();
  }

  // ---- DOM wiring ------------------------------------------------------------
  /**
   * Attach DOM listeners. `toGame(clientX, clientY)` converts to game pixels.
   * Returns a detach function.
   */
  attach(canvas, toGame, target = typeof window !== 'undefined' ? window : null) {
    this.detach();
    this._canvas = canvas;
    this._target = target;
    this._toGame = toGame;
    const add = (el, type, fn, opts) => {
      if (!el) return;
      el.addEventListener(type, fn, opts);
      this._off.push(() => el.removeEventListener(type, fn, opts));
    };
    const isTyping = (e) => {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    const gameKeys = new Set();
    for (const k in this.actions) for (const c of this.actions[k]) gameKeys.add(c);

    add(target, 'keydown', (e) => {
      if (isTyping(e) || e.repeat) {
        if (!isTyping(e) && gameKeys.has(e.code)) e.preventDefault();
        return;
      }
      if (gameKeys.has(e.code) && (e.code.startsWith('Arrow') || e.code === 'Space')) e.preventDefault();
      this.keyDown(e.code);
    });
    add(target, 'keyup', (e) => {
      if (!isTyping(e)) this.keyUp(e.code);
    });
    add(target, 'blur', () => this.releaseAll());

    const point = (e) => toGame(e.clientX, e.clientY);
    add(canvas, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const p = point(e);
      try {
        canvas.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      this.pointerDown(p.x, p.y, e.pointerId);
    });
    add(canvas, 'pointermove', (e) => {
      const p = point(e);
      this.pointerMove(p.x, p.y);
    });
    const up = (e) => {
      const p = point(e);
      this.pointerUp(p.x, p.y);
    };
    add(canvas, 'pointerup', up);
    add(canvas, 'pointercancel', up);
    add(canvas, 'contextmenu', (e) => e.preventDefault());
    return () => this.detach();
  }

  detach() {
    for (const off of this._off) off();
    this._off = [];
  }
}
