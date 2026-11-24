import { clamp } from './math.js';

export class Body {
  constructor(entity, o = {}) {
    this.entity = entity;
    this.vx = 0;
    this.vy = 0;
    this.gravity = o.gravity ?? 0;
    this.drag = o.drag ?? 0;
    this.airDrag = o.airDrag ?? 0;
    this.maxSpeed = o.maxSpeed ?? Infinity;
    this.maxFall = o.maxFall ?? Infinity;
    this.bounce = o.bounce ?? 0;
    this.coyote = o.coyote ?? 0.08;
    this.jumpBuffer = o.jumpBuffer ?? 0.1;
    this.onGround = false;
    this.hit = null;
    this._coyoteLeft = 0;
    this._bufferLeft = 0;
    this._jumpPower = 0;
  }

  jump(power) {
    this._jumpPower = power;
    if (this._coyoteLeft > 0) {
      this.vy = -power;
      this._coyoteLeft = 0;
      this._bufferLeft = 0;
      this.onGround = false;
      return true;
    }
    this._bufferLeft = this.jumpBuffer;
    return false;
  }

  cutJump(factor = 0.5) {
    if (this.vy < 0) this.vy *= factor;
  }

  step(dt) {
    const e = this.entity;
    const scene = e.scene;
    this.vy = Math.min(this.vy + this.gravity * dt, this.maxFall);
    const d = this.onGround ? this.drag : this.airDrag;
    if (d) {
      const k = Math.max(0, 1 - d * dt);
      this.vx *= k;
      if (Math.abs(this.vx) < 0.5) this.vx = 0;
    }
    this.vx = clamp(this.vx, -this.maxSpeed, this.maxSpeed);

    const dx = this.vx * dt;
    const dy = this.vy * dt;
    const hit = scene ? scene.moveAndCollide(e, dx, dy) : (((e.x += dx), (e.y += dy)), { x: false, y: false, bottom: false });
    this.hit = hit;
    if (hit.x) this.vx = this.bounce ? -this.vx * this.bounce : 0;
    if (hit.y) this.vy = this.bounce && Math.abs(this.vy) > 20 ? -this.vy * this.bounce : 0;
    const wasGround = this.onGround;
    this.onGround = !!hit.bottom && dy >= 0;
    if (this.onGround) this._coyoteLeft = this.coyote;
    else this._coyoteLeft = Math.max(0, this._coyoteLeft - dt);
    if (wasGround !== this.onGround) e.emit?.(this.onGround ? 'land' : 'leaveground');
    if (this._bufferLeft > 0) {
      this._bufferLeft -= dt;
      if (this._coyoteLeft > 0) this.jump(this._jumpPower);
    }
    return hit;
  }
}
