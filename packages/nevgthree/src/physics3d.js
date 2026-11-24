import * as THREE from 'three';

export class Body3D {
  constructor(entity, o = {}) {
    this.entity = entity;
    this.vel = new THREE.Vector3();
    this.gravity = o.gravity ?? 30;
    this.maxFall = o.maxFall ?? 55;
    this.accel = o.accel ?? 45;
    this.friction = o.friction ?? 35;
    this.airControl = o.airControl ?? 0.5;
    this.stepHeight = o.stepHeight ?? 0.45;
    this.coyote = o.coyote ?? 0.1;
    this.jumpBuffer = o.jumpBuffer ?? 0.12;
    this.onGround = false;
    this.hit = null;
    this._want = new THREE.Vector3();
    this._coyoteLeft = 0;
    this._bufferLeft = 0;
    this._jumpPower = 0;
    entity.body = this;
  }

  walk(dx, dz, speed) {
    this._want.set(dx * speed, 0, dz * speed);
  }

  stop() {
    this._want.set(0, 0, 0);
  }

  jump(power) {
    this._jumpPower = power;
    if (this._coyoteLeft > 0) {
      this.vel.y = power;
      this._coyoteLeft = 0;
      this._bufferLeft = 0;
      this.onGround = false;
      this.entity.emit?.('jump');
      return true;
    }
    this._bufferLeft = this.jumpBuffer;
    return false;
  }

  cutJump(factor = 0.5) {
    if (this.vel.y > 0) this.vel.y *= factor;
  }

  impulse(x, y, z) {
    this.vel.x += x;
    this.vel.y += y;
    this.vel.z += z;
    if (y > 0) this.onGround = false;
  }

  step(dt) {
    const e = this.entity;
    const v = this.vel;
    const rate = (this._want.lengthSq() > 0 ? this.accel : this.friction) * (this.onGround ? 1 : this.airControl) * dt;
    const dx = this._want.x - v.x;
    const dz = this._want.z - v.z;
    const d = Math.hypot(dx, dz);
    if (d <= rate) {
      v.x = this._want.x;
      v.z = this._want.z;
    } else {
      v.x += (dx / d) * rate;
      v.z += (dz / d) * rate;
    }
    v.y = Math.max(v.y - this.gravity * dt, -this.maxFall);

    const scene = e.scene;
    let hit;
    if (scene) hit = scene.moveAndCollide3(e, v.x * dt, v.y * dt, v.z * dt, { stepHeight: this.stepHeight, snapDown: this.onGround && v.y <= 0 ? this.stepHeight : 0 });
    else {
      e.object.position.addScaledVector(v, dt);
      hit = { x: false, y: false, z: false, bottom: false };
    }
    this.hit = hit;
    if (hit.x) v.x = 0;
    if (hit.z) v.z = 0;
    if (hit.y) v.y = 0;
    const was = this.onGround;
    this.onGround = !!hit.bottom && v.y <= 0;
    if (this.onGround) this._coyoteLeft = this.coyote;
    else this._coyoteLeft = Math.max(0, this._coyoteLeft - dt);
    if (was !== this.onGround) e.emit?.(this.onGround ? 'land' : 'leaveground');
    if (this._bufferLeft > 0) {
      this._bufferLeft -= dt;
      if (this._coyoteLeft > 0) this.jump(this._jumpPower);
    }
    return hit;
  }
}
