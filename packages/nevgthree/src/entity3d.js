import * as THREE from 'three';
import { Entity } from '@adityadevid/nevg';

const _v = new THREE.Vector3();

/**
 * A game object backed by a three.js Object3D.
 *
 *   scene.add(new Mesh3D({ shape: 'box', size: [1, 2, 1], color: '#6ee7b7', position: [0, 0, 0] }))
 *
 * `position` is the FEET of the entity (anchor 0) — or its center with anchor: 0.5.
 * `size` is the collision box (full extents). It collides with other entities that have a size.
 * Use `rot` (Euler) and `scale3` (Vector3) for orientation; 2D fields (x, y, w, h) are unused.
 */
export class Entity3D extends Entity {
  constructor({ object = null, position, rotation, scale, size = [1, 1, 1], anchor = 0, castShadow = true, receiveShadow = false, ...rest } = {}) {
    super({ w: 0, h: 0, ...rest }); // w/h = 0 keeps the entity out of the 2D collision pass
    this.object = object ?? new THREE.Group();
    this.object.userData.entity = this;
    this.size = Array.isArray(size) ? new THREE.Vector3(...size) : new THREE.Vector3().copy(size);
    this.anchor = anchor;
    if (position) this.position.set(...[].concat(position.toArray ? position.toArray() : position));
    if (rotation) this.rot.set(...rotation);
    if (scale != null) typeof scale === 'number' ? this.scale3.setScalar(scale) : this.scale3.set(...scale);
    this.castShadow = castShadow;
    this.receiveShadow = receiveShadow;
    this.object.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = castShadow;
        o.receiveShadow = receiveShadow;
      }
    });
    this.body = null; // set a Body3D to give it gravity/collision
    this.spin = rest.spin ?? null; // [rx, ry, rz] radians per second
    this.bob = rest.bob ?? null; // { amp, speed }
    this._bobBase = null;
    this._t = 0;
  }

  get position() {
    return this.object.position;
  }
  set position(v) {
    this.object.position.copy(v);
  }
  get rot() {
    return this.object.rotation;
  }
  get scale3() {
    return this.object.scale;
  }

  /** World-space AABB of the collision box. */
  get box() {
    const p = this.object.parent && this.object.parent.parent ? this.object.getWorldPosition(_v) : this.object.position;
    const s = this.size;
    const b = (this._box ??= new THREE.Box3());
    b.min.set(p.x - s.x / 2, p.y - s.y * this.anchor, p.z - s.z / 2);
    b.max.set(p.x + s.x / 2, p.y + s.y * (1 - this.anchor), p.z + s.z / 2);
    return b;
  }

  get center() {
    return this.box.getCenter(new THREE.Vector3());
  }

  distanceTo(other) {
    const a = this.object.position;
    const b = (other.object ?? other).position;
    return a.distanceTo(b);
  }

  /** Turn around Y to face a point (keeps the entity upright). */
  lookAtXZ(x, z, turn = 1) {
    const target = Math.atan2(x - this.object.position.x, z - this.object.position.z);
    let d = target - this.object.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.object.rotation.y += d * turn;
    return this;
  }

  _tick(dt) {
    super._tick(dt);
    this._t += dt;
    if (this.spin) this.object.rotation.set(this.object.rotation.x + this.spin[0] * dt, this.object.rotation.y + this.spin[1] * dt, this.object.rotation.z + this.spin[2] * dt);
    if (this.bob) {
      this._bobBase ??= this.object.position.y;
      this.object.position.y = this._bobBase + Math.sin(this._t * this.bob.speed) * this.bob.amp;
    }
    this.body?.step(dt);
  }
}

const GEOMETRIES = {
  box: (s) => new THREE.BoxGeometry(s[0], s[1], s[2]),
  sphere: (s) => new THREE.SphereGeometry(s[0] / 2, 20, 14),
  cylinder: (s) => new THREE.CylinderGeometry(s[0] / 2, s[0] / 2, s[1], 18),
  cone: (s) => new THREE.ConeGeometry(s[0] / 2, s[1], 16),
  capsule: (s) => new THREE.CapsuleGeometry(s[0] / 2, Math.max(0, s[1] - s[0]), 6, 14),
  plane: (s) => new THREE.PlaneGeometry(s[0], s[2] ?? s[1]).rotateX(-Math.PI / 2),
  octahedron: (s) => new THREE.OctahedronGeometry(s[0] / 2),
};

/** A single mesh from a primitive shape: box | sphere | cylinder | cone | capsule | plane | octahedron. */
export class Mesh3D extends Entity3D {
  constructor({ shape = 'box', size = [1, 1, 1], color = '#ffffff', material = null, geometry = null, flat = true, emissive = null, roughness = 0.8, metalness = 0, opacity = 1, ...rest } = {}) {
    const sz = Array.isArray(size) ? size : [size, size, size];
    const geo = geometry ?? GEOMETRIES[shape]?.(sz);
    if (!geo) throw new Error(`[nevgthree] Unknown shape "${shape}"`);
    const mat =
      material ??
      new THREE.MeshStandardMaterial({
        color,
        flatShading: flat,
        roughness,
        metalness,
        transparent: opacity < 1,
        opacity,
        ...(emissive ? { emissive, emissiveIntensity: 0.6 } : {}),
      });
    const mesh = new THREE.Mesh(geo, mat);
    // Anchor 0 (feet): lift the mesh so the entity position is the bottom of the shape.
    const anchor = rest.anchor ?? (shape === 'plane' ? 0 : 0);
    if (anchor === 0 && shape !== 'plane') mesh.position.y = sz[1] / 2;
    const g = new THREE.Group();
    g.add(mesh);
    super({ object: g, size: sz, ...rest });
    this.mesh = mesh;
    this.material = mat;
  }

  set color(c) {
    this.material.color.set(c);
  }
  get color() {
    return `#${this.material.color.getHexString()}`;
  }
}

/** Wrap a loaded model (e.g. gltf.scene). `clone: true` makes an independent copy. */
export class Model3D extends Entity3D {
  constructor({ model, clone = true, ...rest } = {}) {
    super({ object: new THREE.Group(), ...rest });
    const m = clone ? model.clone(true) : model;
    this.object.add(m);
    this.model = m;
    m.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = this.castShadow;
        o.receiveShadow = this.receiveShadow;
      }
    });
  }
}
