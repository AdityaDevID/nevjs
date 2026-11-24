import { Entity } from './entity.js';
import { createRng } from './math.js';

const pick = (v, rng) => (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' ? v[0] + rng() * (v[1] - v[0]) : v);

/**
 * Particle emitter entity. Particles live in the emitter's local space (origin = emitter center).
 *
 *   scene.add(new ParticleEmitter({ x: 100, y: 80, rate: 40, life: [0.4, 0.9], speed: [30, 90],
 *     angle: [-Math.PI, 0], gravity: 120, size: [4, 0], colors: ['#fde68a', '#f97316'] }))
 *   emitter.burst(30)                    // one-off explosion
 *   new ParticleEmitter({ rate: 0, once: true }) + burst()   → removes itself when its last particle dies
 *
 * Ranges are [min, max] pairs. `size: [start, end]` shrinks/grows over life, `alpha: [start, end]` fades.
 * Pass `rng: createRng(seed)` for reproducible effects (tests, replays).
 */
export class ParticleEmitter extends Entity {
  constructor(props = {}) {
    super({
      rate: 20, // particles per second (0 = only burst())
      life: [0.5, 1],
      speed: [20, 60],
      angle: [0, Math.PI * 2], // radians
      gravity: 0,
      drag: 0,
      size: [4, 0],
      alpha: [1, 0],
      colors: ['#ffffff'],
      shape: 'rect', // 'rect' | 'circle'
      max: 500,
      once: false,
      emitting: true,
      rng: null,
      collides: false,
      noCull: true,
      w: 1,
      h: 1,
      ...props,
    });
    this.rng = this.rng ?? createRng();
    this.particles = [];
    this._acc = 0;
  }

  get count() {
    return this.particles.length;
  }

  burst(n = 20, overrides = {}) {
    for (let i = 0; i < n; i++) this._spawn(overrides);
    return this;
  }

  /** Remove all live particles. */
  clearParticles() {
    this.particles.length = 0;
    return this;
  }

  _spawn(o = {}) {
    if (this.particles.length >= this.max) return;
    const rng = this.rng;
    const life = pick(o.life ?? this.life, rng);
    const speed = pick(o.speed ?? this.speed, rng);
    const angle = pick(o.angle ?? this.angle, rng);
    const colors = o.colors ?? this.colors;
    const sx = o.offsetX ?? 0;
    const sy = o.offsetY ?? 0;
    this.particles.push({
      x: this.w / 2 + sx + (this.spread ? (rng() - 0.5) * this.spread : 0),
      y: this.h / 2 + sy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      life: Math.max(life, 0.001),
      color: typeof colors === 'function' ? colors(rng) : colors[Math.floor(rng() * colors.length)],
    });
  }

  update(dt) {
    // age existing particles first, so ones spawned this step live their full `life`
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) {
        ps[i] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      p.vy += this.gravity * dt;
      if (this.drag) {
        const k = Math.max(0, 1 - this.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    if (this.emitting && this.rate > 0) {
      this._acc += this.rate * dt;
      while (this._acc >= 1) {
        this._acc -= 1;
        this._spawn();
      }
    }
    if (ps.length) this._hadParticles = true;
    else if (this.once && this._hadParticles && (this.rate === 0 || !this.emitting)) this.destroy();
  }

  draw(ctx) {
    const [s0, s1] = this.size;
    const [a0, a1] = this.alpha;
    const base = ctx.globalAlpha;
    for (const p of this.particles) {
      const t = p.age / p.life;
      const size = s0 + (s1 - s0) * t;
      if (size <= 0) continue;
      ctx.globalAlpha = base * Math.max(0, a0 + (a1 - a0) * t);
      ctx.fillStyle = p.color;
      if (this.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    }
    ctx.globalAlpha = base;
  }
}
