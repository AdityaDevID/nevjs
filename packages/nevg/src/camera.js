import { clamp, damp } from './math.js';

export class Camera {
  constructor(width = 800, height = 600) {
    this.x = width / 2;
    this.y = height / 2;
    this.zoom = 1;
    this.width = width;
    this.height = height;
    this.bounds = null;
    this.target = null;
    this.smoothing = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this._shake = { time: 0, duration: 0, power: 0, x: 0, y: 0 };
    this._rand = Math.random;
  }

  follow(target, { smoothing = 0, offsetX = 0, offsetY = 0 } = {}) {
    this.target = target;
    this.smoothing = smoothing;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    return this;
  }

  setBounds(x, y, w, h) {
    this.bounds = { x, y, w, h };
    return this;
  }

  shake(power = 8, duration = 0.3) {
    this._shake = { time: duration, duration, power, x: 0, y: 0 };
  }

  resize(width, height) {
    const left = this.x - this.width / this.zoom / 2;
    const top = this.y - this.height / this.zoom / 2;
    this.width = width;
    this.height = height;
    this.x = left + width / this.zoom / 2;
    this.y = top + height / this.zoom / 2;
  }

  _focus() {
    const t = this.target;
    if (!t) return null;
    const cx = typeof t.cx === 'number' ? t.cx : t.x + (t.w ?? 0) / 2;
    const cy = typeof t.cy === 'number' ? t.cy : t.y + (t.h ?? 0) / 2;
    return { x: cx + this.offsetX, y: cy + this.offsetY };
  }

  update(dt) {
    const f = this._focus();
    if (f) {
      if (this.smoothing > 0) {
        this.x = damp(this.x, f.x, this.smoothing, dt);
        this.y = damp(this.y, f.y, this.smoothing, dt);
      } else {
        this.x = f.x;
        this.y = f.y;
      }
    }
    this._clampToBounds();
    const s = this._shake;
    if (s.time > 0) {
      s.time = Math.max(0, s.time - dt);
      const k = s.duration > 0 ? s.time / s.duration : 0;
      s.x = (this._rand() * 2 - 1) * s.power * k;
      s.y = (this._rand() * 2 - 1) * s.power * k;
    } else {
      s.x = s.y = 0;
    }
  }

  _clampToBounds() {
    const b = this.bounds;
    if (!b) return;
    const halfW = this.width / this.zoom / 2;
    const halfH = this.height / this.zoom / 2;
    this.x = b.w <= halfW * 2 ? b.x + b.w / 2 : clamp(this.x, b.x + halfW, b.x + b.w - halfW);
    this.y = b.h <= halfH * 2 ? b.y + b.h / 2 : clamp(this.y, b.y + halfH, b.y + b.h - halfH);
  }

  get left() {
    return this.x + this._shake.x - this.width / this.zoom / 2;
  }
  get top() {
    return this.y + this._shake.y - this.height / this.zoom / 2;
  }

  get view() {
    return { x: this.left, y: this.top, w: this.width / this.zoom, h: this.height / this.zoom };
  }

  worldToScreen(wx, wy) {
    return { x: (wx - this.left) * this.zoom, y: (wy - this.top) * this.zoom };
  }

  screenToWorld(sx, sy) {
    return { x: sx / this.zoom + this.left, y: sy / this.zoom + this.top };
  }

  apply(ctx) {
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-Math.round(this.left * this.zoom) / this.zoom, -Math.round(this.top * this.zoom) / this.zoom);
  }
}
