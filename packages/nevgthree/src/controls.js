import { clamp } from '@adityadevid/nevg';

export class Controls3D {
  constructor(game, { mount = null, touch = 'auto', joystick = true, buttons = [], sensitivity = 0.005, touchSensitivity = 0.006, pointerLock = false, invertY = false, deadzone = 0.12 } = {}) {
    this.game = game;
    this.input = game.input;
    this.sensitivity = sensitivity;
    this.touchSensitivity = touchSensitivity;
    this.invertY = invertY;
    this.deadzone = deadzone;
    this.stick = { x: 0, y: 0 };
    this._look = { x: 0, y: 0 };
    this._pointers = new Map();
    this._off = [];
    this.root = null;
    this.touchUI = false;

    const hasDom = typeof document !== 'undefined' && game.canvas;
    if (!hasDom) return;
    const host = mount ?? game.canvas.parentElement ?? document.body;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.touchUI = touch === true || (touch === 'auto' && coarse);
    const canvas = game.canvas;
    const on = (el, ev, fn, o) => {
      el.addEventListener(ev, fn, o);
      this._off.push(() => el.removeEventListener(ev, fn, o));
    };

    on(canvas, 'pointerdown', (e) => {
      if (e.pointerType === 'touch') return this._touchDown(e, canvas);
      if (pointerLock && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
      this._pointers.set(e.pointerId, { role: 'mouse', x: e.clientX, y: e.clientY });
      canvas.setPointerCapture?.(e.pointerId);
    });
    on(window, 'pointermove', (e) => {
      const p = this._pointers.get(e.pointerId);
      if (document.pointerLockElement === canvas) return this.addLook(e.movementX * this.sensitivity, e.movementY * this.sensitivity);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (p.role === 'mouse') this.addLook(dx * this.sensitivity, dy * this.sensitivity);
      else if (p.role === 'look') this.addLook(dx * this.touchSensitivity, dy * this.touchSensitivity);
      else if (p.role === 'joy') this._joyMove(p, e);
    });
    const end = (e) => this._release(e);
    on(window, 'pointerup', end);
    on(window, 'pointercancel', end);
    on(canvas, 'wheel', (e) => this.game.emit('wheel', e.deltaY), { passive: true });

    if (this.touchUI) this._buildUI(host, joystick, buttons);
  }

  get move() {
    const k = this.input.vector();
    let x = k.x + this.stick.x;
    let y = -k.y + this.stick.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  consumeLook() {
    const l = this._look;
    const out = { x: l.x, y: this.invertY ? -l.y : l.y };
    l.x = l.y = 0;
    return out;
  }

  addLook(dx, dy) {
    this._look.x += dx;
    this._look.y += dy;
  }

  setStick(x, y) {
    this.stick.x = x;
    this.stick.y = y;
  }

  destroy() {
    for (const off of this._off) off();
    this._off = [];
    this.root?.remove();
    this.root = null;
  }

  _touchDown(e, canvas) {
    const r = canvas.getBoundingClientRect();
    const leftHalf = e.clientX - r.left < r.width * 0.4;
    const hasJoy = this.touchUI && this._joy;
    if (leftHalf && hasJoy && ![...this._pointers.values()].some((p) => p.role === 'joy')) {
      const p = { role: 'joy', ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
      this._pointers.set(e.pointerId, p);
      this._joy.style.display = 'block';
      this._joy.style.left = `${e.clientX - r.left - 55}px`;
      this._joy.style.top = `${e.clientY - r.top - 55}px`;
      this._nub.style.transform = 'translate(0,0)';
    } else {
      this._pointers.set(e.pointerId, { role: 'look', x: e.clientX, y: e.clientY });
    }
    canvas.setPointerCapture?.(e.pointerId);
  }

  _joyMove(p, e) {
    const R = 45;
    let dx = e.clientX - p.ox;
    let dy = e.clientY - p.oy;
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx = (dx / len) * R;
      dy = (dy / len) * R;
    }
    this._nub.style.transform = `translate(${dx}px,${dy}px)`;
    const nx = dx / R;
    const ny = dy / R;
    const m = Math.hypot(nx, ny);
    if (m < this.deadzone) return this.setStick(0, 0);
    const k = (m - this.deadzone) / (1 - this.deadzone) / m;
    this.setStick(clamp(nx * k, -1, 1), clamp(-ny * k, -1, 1));
  }

  _release(e) {
    const p = this._pointers.get(e.pointerId);
    if (!p) return;
    this._pointers.delete(e.pointerId);
    if (p.role === 'joy') {
      this.setStick(0, 0);
      if (this._joy) this._joy.style.display = 'none';
    }
  }

  _buildUI(host, joystick, buttons) {
    const root = document.createElement('div');
    Object.assign(root.style, { position: 'absolute', inset: '0', pointerEvents: 'none', userSelect: 'none', webkitUserSelect: 'none', zIndex: 5 });
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    if (joystick) {
      const joy = document.createElement('div');
      Object.assign(joy.style, { position: 'absolute', width: '110px', height: '110px', borderRadius: '50%', background: 'rgba(255,255,255,.14)', border: '2px solid rgba(255,255,255,.35)', display: 'none' });
      const nub = document.createElement('div');
      Object.assign(nub.style, { position: 'absolute', left: '30px', top: '30px', width: '50px', height: '50px', borderRadius: '50%', background: 'rgba(255,255,255,.5)' });
      joy.append(nub);
      root.append(joy);
      this._joy = joy;
      this._nub = nub;
    }
    buttons.forEach((b, i) => {
      const el = document.createElement('div');
      const size = b.size ?? 66;
      el.textContent = b.label ?? b.code;
      Object.assign(el.style, {
        position: 'absolute', right: `${18 + (i % 2) * (size + 12)}px`, bottom: `${22 + Math.floor(i / 2) * (size + 12) + (i % 2) * 28}px`,
        width: `${size}px`, height: `${size}px`, borderRadius: '50%', background: 'rgba(255,255,255,.18)', border: '2px solid rgba(255,255,255,.4)',
        color: '#fff', font: '600 20px system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto', touchAction: 'none',
      });
      const down = (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.style.background = 'rgba(255,255,255,.38)';
        this.input.keyDown(b.code);
      };
      const up = () => {
        el.style.background = 'rgba(255,255,255,.18)';
        this.input.keyUp(b.code);
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
      root.append(el);
    });
    host.append(root);
    this.root = root;
  }
}
