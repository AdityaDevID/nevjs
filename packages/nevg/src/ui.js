import { Entity } from './entity.js';
import { pointInRect, clamp } from './math.js';

function roundRectPath(ctx, w, h, r) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, r);
  } else {
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
  }
}

export class Button extends Entity {
  constructor(props = {}) {
    super({
      text: '',
      font: '14px sans-serif',
      color: '#334155',
      hoverColor: '#475569',
      pressColor: '#1e293b',
      disabledColor: '#1f2937',
      textColor: '#fff',
      radius: 4,
      disabled: false,
      screenSpace: true,
      collides: false,
      z: 1000,
      w: 80,
      h: 24,
      onClick: null,
      ...props,
    });
    this.hover = false;
    this.pressed = false;
  }

  update() {
    const input = this.scene?.input;
    if (!input) return;
    const p = input.pointer;
    const inside = !this.disabled && pointInRect(p.x, p.y, { x: this.worldX, y: this.worldY, w: this.w, h: this.h });
    this.hover = inside;
    if (inside && p.pressed) this.pressed = true;
    if (p.released) {
      if (this.pressed && inside) this.click();
      this.pressed = false;
    } else if (!p.down) this.pressed = false;
  }

  click() {
    if (this.disabled) return;
    this.onClick?.(this);
    this.emit('click', this);
  }

  draw(ctx) {
    ctx.fillStyle = this.disabled ? this.disabledColor : this.pressed ? this.pressColor : this.hover ? this.hoverColor : this.color;
    roundRectPath(ctx, this.w, this.h, this.radius);
    ctx.fill();
    ctx.fillStyle = this.textColor;
    ctx.globalAlpha *= this.disabled ? 0.5 : 1;
    ctx.font = this.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(typeof this.text === 'function' ? this.text() : String(this.text), this.w / 2, this.h / 2);
  }
}

export class ProgressBar extends Entity {
  constructor(props = {}) {
    super({
      value: 1,
      max: 1,
      color: '#22c55e',
      back: '#0f172a',
      border: null,
      radius: 2,
      screenSpace: true,
      collides: false,
      w: 60,
      h: 6,
      ...props,
    });
  }

  get ratio() {
    const v = typeof this.value === 'function' ? this.value() : this.value;
    return this.max ? clamp(v / this.max, 0, 1) : 0;
  }

  draw(ctx) {
    ctx.fillStyle = this.back;
    roundRectPath(ctx, this.w, this.h, this.radius);
    ctx.fill();
    const fill = this.w * this.ratio;
    if (fill > 0) {
      ctx.fillStyle = this.color;
      ctx.fillRect(0, 0, fill, this.h);
    }
    if (this.border) {
      ctx.strokeStyle = this.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, this.w - 1, this.h - 1);
    }
  }
}
