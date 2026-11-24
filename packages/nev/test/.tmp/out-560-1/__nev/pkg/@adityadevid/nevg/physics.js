import { clamp } from './math.js';

/**
 * Simple arcade physics for an entity: gravity, drag, speed limits, bouncing, and
 * "grounded" detection using scene.moveAndCollide (so solid tiles and solid entities block it).
 *
 *   class Player extends Rect {
 *     init() { this.body = new Body(this, { gravity: 900, maxFall: 400, drag: 4 }) }
 *     update(dt) {
 *       this.body.vx = this.scene.input.axis('left', 'right') * 100
 *       if (this.scene.input.pressed('jump')) this.body.jump(300)     // only works on the ground (+ coyote time)
 *       this.body.step(dt)
 *     }
 *   }
 * (Set the entity's own vx/vy to 0 — the Body owns the velocity and moves the entity itself.)
 */
export class Body {
  constructor(entity, o = {}) {
    this.entity = entity;
    this.vx = 0;
    this.vy = 0;
    this.gravity = o.gravity ?? 0;
    this.drag = o.drag ?? 0; // horizontal slow-down per second while on the ground (or always when airDrag)
    this.airDrag = o.airDrag ?? 0;
    this.maxSpeed = o.maxSpeed ?? Infinity;
    this.maxFall = o.maxFall ?? Infinity;
    this.bounce = o.bounce ?? 0; // 0..1 energy kept when hitting something
    this.coyote = o.coyote ?? 0.08; // seconds you may still jump after leaving a ledge
    this.jumpBuffer = o.jumpBuffer ?? 0.1; // seconds a too-early jump press is remembered
    this.onGround = false;
    this.hit = null;
    this._coyoteLeft = 0;
    this._bufferLeft = 0;
    this._jumpPower = 0;
  }

  /** Jump (negative y is up). Returns true when it happened now; otherwise the press is buffered. */
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

  /** Cut a jump short when the button is released. */
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
