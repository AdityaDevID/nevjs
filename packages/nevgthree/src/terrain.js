import * as THREE from 'three';
import { createRng, clamp, lerp } from '@adityadevid/nevg';

function makeNoise(seed) {
  const rng = createRng(seed);
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = (x, y) => perm[(perm[x & 255] + y) & 255] / 255;
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const sx = smooth(x - xi);
    const sy = smooth(y - yi);
    return lerp(lerp(val(xi, yi), val(xi + 1, yi), sx), lerp(val(xi, yi + 1), val(xi + 1, yi + 1), sx), sy);
  };
  return (x, y, octaves = 4) => {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
}

export class Terrain extends THREE.Mesh {
  constructor({ size = 120, segments = 60, height = 7, seed = 1, scale = 0.045, flatRadius = 9, island = true, waterLevel = 0.6, colors = {} } = {}) {
    super();
    this.size = size;
    this.segments = segments;
    this.height = height;
    this.waterLevel = waterLevel;
    const c = { sand: '#e6d59a', grass: '#6fb35a', grass2: '#4f9a4a', rock: '#8a8f98', snow: '#f4f7fb', ...colors };
    const n = makeNoise(seed);
    const N = segments + 1;
    const step = size / segments;
    const half = size / 2;
    const H = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = i * step - half;
        const z = j * step - half;
        let h = Math.pow(n(x * scale + 100, z * scale + 100, 4), 1.4) * 1.6;
        const d = Math.hypot(x, z);
        if (island) h *= clamp(1 - Math.pow(d / (half * 0.98), 3), 0, 1) * 1.15 + (d < half ? 0 : 0);
        const flat = clamp((d - flatRadius * 0.5) / (flatRadius * 0.9), 0, 1);
        h = lerp(0.12, h, flat * flat * (3 - 2 * flat));
        H[j * N + i] = h * height - (island ? 0.3 : 0);
      }
    }
    this.H = H;
    this.N = N;
    this.step = step;
    this.half = half;

    const pos = [];
    const col = [];
    const color = new THREE.Color();
    const cs = { sand: new THREE.Color(c.sand), grass: new THREE.Color(c.grass), grass2: new THREE.Color(c.grass2), rock: new THREE.Color(c.rock), snow: new THREE.Color(c.snow) };
    const rng = createRng(seed ^ 0x9e3779b9);
    const vert = (i, j) => [i * step - half, H[j * N + i], j * step - half];
    const pushTri = (a, b, d) => {
      const e1 = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const e2 = new THREE.Vector3(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
      const nrm = e1.cross(e2).normalize();
      const my = (a[1] + b[1] + d[1]) / 3;
      const slope = 1 - Math.abs(nrm.y);
      if (my < waterLevel + 0.45) color.copy(cs.sand);
      else if (my > height * 0.78) color.copy(cs.snow);
      else if (slope > 0.32) color.copy(cs.rock);
      else color.copy(cs.grass).lerp(cs.grass2, clamp((my / height) * 1.4 + (rng() - 0.5) * 0.35, 0, 1));
      color.offsetHSL(0, 0, (rng() - 0.5) * 0.04);
      for (const v of [a, b, d]) {
        pos.push(...v);
        col.push(color.r, color.g, color.b);
      }
    };
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        const a = vert(i, j);
        const b = vert(i, j + 1);
        const cc = vert(i + 1, j + 1);
        const d = vert(i + 1, j);
        pushTri(a, b, d);
        pushTri(b, cc, d);
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.geometry.computeVertexNormals();
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    this.receiveShadow = true;
  }

  heightAt(x, z) {
    const { N, step, half, H } = this;
    const fx = (x + half) / step;
    const fz = (z + half) / step;
    if (fx < 0 || fz < 0 || fx > N - 1 || fz > N - 1) return -50;
    const i = Math.min(N - 2, Math.floor(fx));
    const j = Math.min(N - 2, Math.floor(fz));
    const u = fx - i;
    const v = fz - j;
    const a = H[j * N + i];
    const b = H[(j + 1) * N + i];
    const c = H[(j + 1) * N + i + 1];
    const d = H[j * N + i + 1];
    if (u + v <= 1) return a + (d - a) * u + (b - a) * v;
    return c + (b - c) * (1 - u) + (d - c) * (1 - v);
  }

  isLand(x, z, margin = 0) {
    return this.heightAt(x, z) > this.waterLevel + margin;
  }

  scatter(count, { rng = createRng(1), minHeight = this.waterLevel + 0.5, maxHeight = Infinity, avoid = [], radius = this.half * 0.9 } = {}) {
    const out = [];
    for (let tries = 0; out.length < count && tries < count * 40; tries++) {
      const x = rng.range(-radius, radius);
      const z = rng.range(-radius, radius);
      const h = this.heightAt(x, z);
      if (h < minHeight || h > maxHeight) continue;
      if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.r)) continue;
      out.push({ x, y: h, z });
    }
    return out;
  }
}

export function createWater({ size = 400, level = 0.6, color = '#3aa7d9', opacity = 0.72 } = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.25, metalness: 0.1 }));
  m.position.y = level;
  m.receiveShadow = true;
  return m;
}
