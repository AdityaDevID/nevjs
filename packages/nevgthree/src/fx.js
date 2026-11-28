import * as THREE from 'three';
import { Entity3D } from './entity3d.js';

export class Particles3D extends Entity3D {
  constructor({ max = 300, size = 0.28, gravity = 6, texture = null } = {}) {
    // max < 1 would make the buffers empty and burst() divide by zero.
    max = Math.max(1, Math.floor(max) || 1);
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(max * 3);
    const col = new Float32Array(max * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: texture }),
    );
    pts.frustumCulled = false;
    super({ object: pts, collides: false, castShadow: false });
    this.max = max;
    this.gravity = gravity;
    this.p = Array.from({ length: max }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1 }));
    this.cursor = 0;
    this.pos = pos;
    this.col = col;
    this.geo = geo;
    this.rand = Math.random;
  }

  burst(at, { count = 20, color = '#ffffff', colors = null, speed = 4, spread = 1, up = 1.5, life = 0.8, gravity = null } = {}) {
    const c = new THREE.Color();
    const o = at.object?.position ?? at;
    for (let i = 0; i < count; i++) {
      const p = this.p[this.cursor];
      this.cursor = (this.cursor + 1) % this.max;
      const a = this.rand() * Math.PI * 2;
      const e = (this.rand() - 0.3) * Math.PI * spread;
      const s = speed * (0.4 + this.rand() * 0.8);
      p.x = o.x;
      p.y = o.y;
      p.z = o.z;
      p.vx = Math.cos(a) * Math.cos(e) * s;
      p.vz = Math.sin(a) * Math.cos(e) * s;
      p.vy = Math.sin(e) * s + up;
      p.life = p.max = life * (0.6 + this.rand() * 0.6);
      p.g = gravity;
      c.set(colors ? colors[Math.floor(this.rand() * colors.length)] : color);
      p.r = c.r;
      p.gc = c.g;
      p.b = c.b;
    }
  }

  update(dt) {
    const { pos, col } = this;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life > 0) {
        p.life -= dt;
        p.vy -= (p.g ?? this.gravity) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const f = Math.max(0, p.life / p.max);
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.y;
        pos[i * 3 + 2] = p.z;
        col[i * 3] = p.r * f;
        col[i * 3 + 1] = p.gc * f;
        col[i * 3 + 2] = p.b * f;
      } else {
        pos[i * 3 + 1] = -9999;
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
