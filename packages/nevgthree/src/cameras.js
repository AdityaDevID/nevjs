import * as THREE from 'three';
import { clamp, damp } from '@adityadevid/nevg';

const _t = new THREE.Vector3();

const targetPos = (t, out) => {
  const o = t.object ?? t;
  return out.copy(o.position);
};

export class OrbitRig {
  constructor(camera, { target = null, distance = 7, height = 1.4, yaw = 0, pitch = 0.35, minPitch = -0.1, maxPitch = 1.25, minDistance = 2, maxDistance = 20, smoothing = 10, scene = null } = {}) {
    Object.assign(this, { camera, target, distance, height, yaw, pitch, minPitch, maxPitch, minDistance, maxDistance, smoothing, scene });
    this.focus = new THREE.Vector3();
    this._init = false;
  }

  rotate(dyaw, dpitch) {
    this.yaw -= dyaw;
    this.pitch = clamp(this.pitch + dpitch, this.minPitch, this.maxPitch);
  }

  zoom(delta) {
    this.distance = clamp(this.distance + delta, this.minDistance, this.maxDistance);
  }

  get forward() {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  relative(mx, my) {
    const f = this.forward;
    return { x: f.x * my + -f.z * mx, z: f.z * my + f.x * mx };
  }

  update(dt) {
    if (this.target) {
      targetPos(this.target, _t);
      _t.y += this.height;
      if (!this._init) {
        this.focus.copy(_t);
        this._init = true;
      } else {
        const k = this.smoothing > 0 ? 1 - Math.exp(-this.smoothing * dt) : 1;
        this.focus.lerp(_t, k);
      }
    }
    const cp = Math.cos(this.pitch);
    const x = this.focus.x + Math.sin(this.yaw) * cp * this.distance;
    const z = this.focus.z + Math.cos(this.yaw) * cp * this.distance;
    let y = this.focus.y + Math.sin(this.pitch) * this.distance;
    const gh = this.scene?.groundHeight?.(x, z);
    if (gh != null) y = Math.max(y, gh + 0.6);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.focus);
  }
}

export class FirstPersonRig {
  constructor(camera, { target = null, eye = 1.6, yaw = 0, pitch = 0, limit = 1.5 } = {}) {
    Object.assign(this, { camera, target, eye, yaw, pitch, limit });
    this.camera.rotation.order = 'YXZ';
  }
  rotate(dyaw, dpitch) {
    this.yaw -= dyaw;
    this.pitch = clamp(this.pitch - dpitch, -this.limit, this.limit);
  }
  get forward() {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }
  relative(mx, my) {
    const f = this.forward;
    return { x: f.x * my + -f.z * mx, z: f.z * my + f.x * mx };
  }
  update() {
    if (this.target) {
      targetPos(this.target, _t);
      this.camera.position.set(_t.x, _t.y + this.eye, _t.z);
    }
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}

export class TopDownRig extends OrbitRig {
  constructor(camera, opts = {}) {
    super(camera, { pitch: 0.95, yaw: Math.PI / 4, distance: 16, smoothing: 6, ...opts });
  }
  rotate() {}
}

export { damp };
