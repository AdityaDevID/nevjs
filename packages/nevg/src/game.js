import { Emitter } from './emitter.js';
import { Input } from './input.js';
import { Assets } from './assets.js';
import { Sound } from './audio.js';
import { Tweens } from './tween.js';

export class Game extends Emitter {
  constructor({
    canvas = null,
    width = 800,
    height = 600,
    fps = 60,
    pixelArt = false,
    fit = 'contain',
    maxFrameTime = 0.25,
    maxDpr = 3,
    assets,
    input,
    raf,
    caf,
    now,
  } = {}) {
    super();
    this.width = width;
    this.height = height;
    this.step_ = 1 / fps;
    this.fps = fps;
    this.pixelArt = pixelArt;
    this.fit = fit;
    this.maxFrameTime = maxFrameTime;
    this.maxDpr = maxDpr;
    this.input = input ?? new Input();
    this.assets = assets ?? new Assets();
    this.sound = new Sound();
    this.tweens = new Tweens();
    this.scene = null;
    this.time = 0;
    this.frame = 0;
    this.running = false;
    this.timeScale = 1;
    this.stats = { fps: 0 };
    this._next = null;
    this._acc = 0;
    this._last = 0;
    this._handle = null;
    this._fpsFrames = 0;
    this._fpsTime = 0;
    this._offs = [];

    const g = globalThis;
    this._raf = raf ?? (g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : (fn) => setTimeout(() => fn(this._now()), 1000 / fps));
    this._caf = caf ?? (g.cancelAnimationFrame ? g.cancelAnimationFrame.bind(g) : clearTimeout);
    this._now = now ?? (() => (g.performance ? g.performance.now() : Date.now()));

    this.canvas = null;
    this.ctx = null;
    if (canvas) this._setupCanvas(canvas);
  }

  _setupCanvas(canvas) {
    const el = typeof canvas === 'string' ? document.querySelector(canvas) : canvas;
    if (!el) throw new Error(`[nevg] Canvas not found: ${canvas}`);
    this.canvas = el;
    this.ctx = this._createContext(el);
    this.dpr = 1;
    this._applySize();
    const resize = () => this._applySize();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', resize);
      this._offs.push(() => window.removeEventListener('resize', resize));
      const vis = () => {
        if (document.hidden) this._hidden();
        else this._visible();
      };
      document.addEventListener('visibilitychange', vis);
      this._offs.push(() => document.removeEventListener('visibilitychange', vis));
    }
    if (typeof ResizeObserver !== 'undefined' && el.parentElement) {
      const ro = new ResizeObserver(resize);
      ro.observe(el.parentElement);
      this._offs.push(() => ro.disconnect());
    }
    const toGame = (cx, cy) => {
      const r = el.getBoundingClientRect();
      return {
        x: ((cx - r.left) / (r.width || 1)) * this.width,
        y: ((cy - r.top) / (r.height || 1)) * this.height,
      };
    };
    this._offs.push(this.input.attach(el, toGame));
    const unlock = () => this.sound.unlock();
    el.addEventListener('pointerdown', unlock);
    if (typeof window !== 'undefined') window.addEventListener('keydown', unlock);
    this._offs.push(() => {
      el.removeEventListener('pointerdown', unlock);
      if (typeof window !== 'undefined') window.removeEventListener('keydown', unlock);
    });
  }

  _createContext(el) {
    return el.getContext('2d');
  }

  _applySize() {
    const el = this.canvas;
    if (!el) return;
    const dpr = Math.max(1, Math.min(this.maxDpr, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
    this.dpr = dpr;
    let cssW = this.width;
    let cssH = this.height;
    if (this.fit !== 'none') {
      const p = el.parentElement;
      const pw = (p && p.clientWidth) || (typeof window !== 'undefined' ? window.innerWidth : this.width);
      const ph = (p && p.clientHeight) || (typeof window !== 'undefined' ? window.innerHeight : this.height);
      const scale = this.fit === 'cover' ? Math.max(pw / this.width, ph / this.height) : Math.min(pw / this.width, ph / this.height);
      const s = this.pixelArt && scale >= 1 ? Math.floor(scale) : scale;
      cssW = Math.floor(this.width * s);
      cssH = Math.floor(this.height * s);
    }
    el.style.width = `${cssW}px`;
    el.style.height = `${cssH}px`;
    el.width = Math.round(cssW * dpr);
    el.height = Math.round(cssH * dpr);
    el.style.imageRendering = this.pixelArt ? 'pixelated' : 'auto';
    el.style.touchAction = 'none';
    if (this.ctx) this.ctx.imageSmoothingEnabled = !this.pixelArt;
  }

  setScene(scene) {
    if (!this.scene && !this.running) {
      this._swap(scene);
      return scene;
    }
    this._next = scene;
    return scene;
  }

  _swap(scene) {
    const old = this.scene;
    if (old) old._exit();
    this.scene = scene;
    if (scene) scene._enter(this);
    this.input.endFrame();
    this.emit('scene', scene, old);
  }

  start(scene) {
    if (scene) this.setScene(scene);
    if (this.running) return this;
    this.running = true;
    this._acc = 0;
    this._last = this._now();
    this._handle = this._raf((t) => this._tick(t));
    return this;
  }

  stop() {
    this.running = false;
    if (this._handle != null) this._caf(this._handle);
    this._handle = null;
    return this;
  }

  destroy() {
    this.stop();
    if (this.scene) this.scene._exit();
    this.scene = null;
    for (const off of this._offs) off();
    this._offs = [];
    this.input.detach();
  }

  _hidden() {
    this._wasRunning = this.running;
    this.input.releaseAll();
    if (this.running) this.stop();
    this.emit('blur');
  }

  _visible() {
    if (this._wasRunning && !this.running) {
      this._wasRunning = false;
      this.running = true;
      this._last = this._now();
      this._acc = 0;
      this._handle = this._raf((t) => this._tick(t));
      this.emit('focus');
    }
  }

  _tick(t) {
    if (!this.running) return;
    const now = typeof t === 'number' ? t : this._now();
    let frame = (now - this._last) / 1000;
    this._last = now;
    if (!(frame >= 0)) frame = 0;
    if (frame > this.maxFrameTime) frame = this.maxFrameTime;
    this._acc += frame * this.timeScale;

    const maxSteps = Math.ceil((this.maxFrameTime * Math.max(1, this.timeScale)) / this.step_) + 1;
    let steps = 0;
    while (this._acc >= this.step_ && steps < maxSteps) {
      this.step(this.step_);
      this._acc -= this.step_;
      steps++;
    }
    if (steps === maxSteps) this._acc = 0;
    this.render();

    this._fpsFrames++;
    this._fpsTime += frame;
    if (this._fpsTime >= 0.5) {
      this.stats.fps = Math.round(this._fpsFrames / this._fpsTime);
      this._fpsFrames = 0;
      this._fpsTime = 0;
    }
    if (this.running) this._handle = this._raf((t2) => this._tick(t2));
  }

  step(dt = this.step_) {
    this.time += dt;
    this.frame++;
    this.tweens.update(dt);
    if (this.scene) this.scene._step(dt);
    this.emit('update', dt);
    this.input.endFrame();
    if (this._next) {
      const next = this._next;
      this._next = null;
      this._swap(next);
    }
  }

  render() {
    const ctx = this.ctx;
    if (!ctx || !this.scene) return;
    ctx.setTransform(this.canvas.width / this.width, 0, 0, this.canvas.height / this.height, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.scene._draw(ctx);
    this.emit('render', ctx);
  }
}
