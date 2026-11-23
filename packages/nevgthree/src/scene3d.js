import * as THREE from 'three';
import { Scene } from '@adityadevid/nevg';

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _off = new THREE.Vector3();

/** Free GPU resources of an object tree. */
export function disposeObject(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    for (const m of [].concat(o.material ?? [])) {
      for (const k in m) if (m[k]?.isTexture) m[k].dispose();
      m.dispose?.();
    }
  });
}

/**
 * A 3D scene. Extends the NevG Scene: lifecycle (init/update/exit), timers (after/every),
 * tweens, input, assets and entities all work the same — but `camera` is a three.js
 * PerspectiveCamera and drawing is done by three.js.
 *
 *   class Play extends Scene3D {
 *     init() {
 *       this.lights()                      // sun + sky light (+ shadows)
 *       this.ground = new Terrain({ seed: 7 }); this.add(this.ground)
 *       this.player = this.add(new Mesh3D({ shape: 'capsule', size: [0.8, 1.8, 0.8], color: '#6ee7b7' }))
 *       this.rig = new OrbitRig(this.camera, { target: this.player })
 *     }
 *   }
 */
export class Scene3D extends Scene {
  constructor(props = {}) {
    super(props);
    this.three = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(props.fov ?? 60, 1, 0.1, props.far ?? 400);
    this.rig = null; // camera controller with update(dt) — see OrbitRig / FirstPersonRig
    this.ground = null; // object with heightAt(x, z) (e.g. Terrain); otherwise a flat plane at groundY
    this.groundY = 0;
    this.sky = null;
    this.sun = null;
    this.background = this._bg ?? null;
    this._shake = { time: 0, duration: 0, power: 0 };
    this._shakeOff = new THREE.Vector3();
  }

  get background() {
    return this._bg;
  }
  set background(v) {
    this._bg = v;
    if (this.three) this.three.background = v == null ? null : v.isTexture || v.isColor ? v : new THREE.Color(v);
  }

  get fog() {
    return this.three.fog;
  }
  /** scene.fog = ['#bde0ff', 40, 150] (linear) or { color, density } (exp2) */
  set fog(v) {
    if (!v) this.three.fog = null;
    else if (v.isFog || v.isFogExp2) this.three.fog = v;
    else if (Array.isArray(v)) this.three.fog = new THREE.Fog(v[0], v[1], v[2]);
    else this.three.fog = new THREE.FogExp2(v.color, v.density ?? 0.01);
  }

  onResize(w, h) {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  // ---- adding things ---------------------------------------------------------
  /** Add Entity3D(s) and/or raw three.js objects (lights, meshes, groups, Terrain…). */
  add(...list) {
    const out = [];
    for (const e of list.flat()) {
      if (e?.isObject3D) {
        this.three.add(e);
        out.push(e);
      } else if (e && e.object && !e.dead && !(e.object.isObject3D === false)) {
        out.push(super.add(e));
      } else out.push(e);
      if (e && typeof e.heightAt === 'function' && !this.ground) this.ground = e;
    }
    return list.length === 1 ? out[0] : out;
  }

  _attach(e) {
    super._attach(e);
    if (e.object && !e.object.parent) (e.parent?.object ?? this.three).add(e.object);
  }

  /** Sun + sky light with soft shadows. Returns { sun, hemi }. */
  lights({ sun = '#fff1d6', sky = '#bfe3ff', ground = '#4a5d3a', intensity = 2.2, ambient = 0.9, direction = [-0.5, 1, 0.35], shadows = true, shadowSize = 30, shadowMap = 1024 } = {}) {
    const hemi = new THREE.HemisphereLight(sky, ground, ambient);
    const dl = new THREE.DirectionalLight(sun, intensity);
    this._sunDir = new THREE.Vector3(...direction).normalize();
    dl.position.copy(this._sunDir).multiplyScalar(60);
    if (shadows) {
      dl.castShadow = true;
      dl.shadow.mapSize.set(shadowMap, shadowMap);
      const c = dl.shadow.camera;
      c.left = c.bottom = -shadowSize;
      c.right = c.top = shadowSize;
      c.near = 1;
      c.far = 140;
      dl.shadow.bias = -0.0005;
      dl.shadow.normalBias = 0.04;
    }
    this.three.add(hemi, dl, dl.target);
    this.sun = dl;
    return { sun: dl, hemi };
  }

  /** Keep the shadow box centered on something (call from update). */
  shadowFollow(target) {
    if (!this.sun || !this._sunDir) return;
    const p = target.object?.position ?? target.position ?? target;
    this.sun.target.position.set(Math.round(p.x), 0, Math.round(p.z)); // snapped: no shimmering
    this.sun.position.copy(this.sun.target.position).addScaledVector(this._sunDir, 60);
  }

  // ---- world queries ------------------------------------------------------------
  groundHeight(x, z) {
    return this.ground ? this.ground.heightAt(x, z) : this.groundY;
  }

  /** Cast a ray; returns [{ entity, object, point, distance }] nearest first. */
  raycast(origin, direction, { far = 200, filter = null } = {}) {
    _ray.set(origin, direction.clone().normalize());
    _ray.far = far;
    const hits = _ray.intersectObjects(this.three.children, true);
    const out = [];
    for (const h of hits) {
      let o = h.object;
      let entity = null;
      while (o && !entity) {
        entity = o.userData.entity ?? null;
        o = o.parent;
      }
      if (filter && !filter(entity, h.object)) continue;
      out.push({ entity, object: h.object, point: h.point, distance: h.distance });
    }
    return out;
  }

  /** Pick what is under a screen point (game pixels; default = the pointer). */
  pick(x = this.input?.pointer.x, y = this.input?.pointer.y, opts = {}) {
    _ndc.set((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    _ray.setFromCamera(_ndc, this.camera);
    const o = _ray.ray.origin.clone();
    const d = _ray.ray.direction.clone();
    return this.raycast(o, d, opts)[0] ?? null;
  }

  /** Entities (with a size) whose box overlaps `box`, optionally by tag. */
  queryBox(box, tag) {
    const out = [];
    for (const e of this.entities) if (!e.dead && e.size && (!tag || e.tags.has(tag)) && e.box.intersectsBox(box)) out.push(e);
    return out;
  }

  /**
   * Move `e` by (dx, dy, dz), blocked by solid entities and the ground. Axes are resolved
   * separately so you slide along walls. Walks up steps/slopes of height <= stepHeight.
   * Returns { x, y, z, bottom, top, ground, entity }.
   */
  moveAndCollide3(e, dx, dy, dz, { stepHeight = 0.4, snapDown = 0 } = {}) {
    const hit = { x: false, y: false, z: false, bottom: false, top: false, ground: false, entity: null };
    const p = e.object.position;
    const solids = this.entities.filter((o) => o !== e && o.solid && !o.dead && o.size);
    const probe = new THREE.Box3();
    const s = e.size;
    const boxAt = (x, y, z) => probe.set(new THREE.Vector3(x - s.x / 2, y - s.y * e.anchor, z - s.z / 2), new THREE.Vector3(x + s.x / 2, y + s.y * (1 - e.anchor), z + s.z / 2));
    const base = e.anchor * s.y; // feet = position.y - base
    const blockerTop = (x, y, z) => {
      const b = boxAt(x, y, z);
      let top = -Infinity;
      for (const o of solids) {
        const ob = o.box;
        if (b.intersectsBox(ob) && b.min.y < ob.max.y - 1e-4 && b.max.y > ob.min.y + 1e-4) {
          hit.entity = o;
          top = Math.max(top, ob.max.y);
        }
      }
      return top;
    };
    const horizontal = (axis, delta) => {
      if (delta === 0) return;
      const n = Math.max(1, Math.ceil(Math.abs(delta) / 0.2));
      const stepLen = delta / n;
      for (let i = 0; i < n; i++) {
        const nx = axis === 'x' ? p.x + stepLen : p.x;
        const nz = axis === 'z' ? p.z + stepLen : p.z;
        let ny = p.y;
        const feet = p.y - base;
        const gh = this.groundHeight(nx, nz);
        if (gh - feet > stepHeight) return void (hit[axis] = true); // too steep
        if (gh > feet) ny = gh + base;
        const top = blockerTop(nx, ny, nz);
        if (top > -Infinity) {
          const lift = top - (ny - base);
          if (lift <= stepHeight && blockerTop(nx, top + base, nz) === -Infinity) ny = top + base;
          else return void (hit[axis] = true);
        }
        p.x = nx;
        p.z = nz;
        p.y = ny;
      }
    };
    horizontal('x', dx);
    horizontal('z', dz);

    // vertical
    if (dy !== 0) {
      const n = Math.max(1, Math.ceil(Math.abs(dy) / 0.25));
      const stepLen = dy / n;
      for (let i = 0; i < n; i++) {
        const ny = p.y + stepLen;
        const top = blockerTop(p.x, ny, p.z);
        if (top > -Infinity) {
          if (dy < 0) {
            p.y = top + base;
            hit.bottom = true;
          } else hit.top = true;
          hit.y = true;
          break;
        }
        p.y = ny;
      }
    }
    const gh = this.groundHeight(p.x, p.z);
    if (p.y - base <= gh + 1e-4 && dy <= 0.0001) {
      p.y = gh + base;
      hit.bottom = hit.ground = hit.y = true;
    } else if (snapDown > 0 && dy <= 0 && p.y - base - gh <= snapDown && !hit.bottom) {
      p.y = gh + base;
      hit.bottom = hit.ground = true;
    }
    return hit;
  }

  /** Camera shake in world units. */
  shake(power = 0.25, duration = 0.3) {
    this._shake = { time: duration, duration, power };
  }

  // ---- engine internals --------------------------------------------------------------
  _enter(game) {
    super._enter(game);
    this.onResize(game.width, game.height);
  }

  _step(dt) {
    if (this.paused) return;
    this.camera.position.sub(this._shakeOff);
    super._step(dt);
    this.rig?.update(dt);
    const sh = this._shake;
    if (sh.time > 0) {
      sh.time -= dt;
      const k = Math.max(0, sh.time / sh.duration) * sh.power;
      this._shakeOff.set((Math.random() - 0.5) * 2 * k, (Math.random() - 0.5) * 2 * k, (Math.random() - 0.5) * 2 * k);
    } else this._shakeOff.set(0, 0, 0);
    this.camera.position.add(this._shakeOff);
  }

  /** Overlap events between entities that have a size and `collides`. */
  _collide() {
    const list = this.entities.filter((e) => !e.dead && e.collides && e.size && e.object);
    if (list.length < 2) return;
    const items = list.map((e) => ({ e, b: e.box.clone() })).sort((a, b) => a.b.min.x - b.b.min.x);
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (b.b.min.x > a.b.max.x) break;
        if (a.e.dead || b.e.dead) continue;
        if (a.b.intersectsBox(b.b)) {
          a.e.onCollide(b.e);
          b.e.onCollide(a.e);
          a.e.emit('collide', b.e);
          b.e.emit('collide', a.e);
        }
      }
    }
  }

  _sweep() {
    const detach = (list) => {
      for (const e of list) {
        if (e.children.length) detach(e.children);
        if (e.dead && e.object) {
          e.object.removeFromParent();
          disposeObject(e.object);
        }
      }
    };
    detach(this.entities);
    super._sweep();
  }

  _render3d(renderer) {
    if (this.sky) this.sky.position.copy(this.camera.position);
    renderer.render(this.three, this.camera);
  }

  _draw() {} // the 2D draw pass is not used

  _exit() {
    super._exit();
    disposeObject(this.three);
    this.three.clear();
    this.rig = null;
  }
}
