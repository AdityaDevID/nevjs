export const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => --t * t * t + 1,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  inSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  outSine: (t) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;
  },
};

export class Tween {
  constructor(target, to, { duration = 1, ease: easing = 'linear', delay = 0, repeat = 0, yoyo = false, onUpdate, onComplete } = {}) {
    this.target = target;
    this.to = to;
    this.duration = Math.max(1e-6, duration);
    this.ease = typeof easing === 'function' ? easing : ease[easing] ?? ease.linear;
    this.delay = delay;
    this.repeat = repeat;
    this.yoyo = yoyo;
    this.onUpdate = onUpdate;
    this.onComplete = onComplete;
    this.from = null;
    this.time = 0;
    this.loop = 0;
    this.done = false;
    this.paused = false;
    this._resolve = null;
    this.finished = new Promise((r) => (this._resolve = r));
  }

  stop(complete = false) {
    if (this.done) return;
    if (complete) this._apply(this.yoyo && this.repeat % 2 === 1 ? 0 : 1);
    this._finish(false);
  }

  _finish(completed) {
    this.done = true;
    this._resolve(completed);
    if (completed && this.onComplete) this.onComplete(this.target);
  }

  _apply(t) {
    const e = this.ease(t);
    for (const k in this.from) this.target[k] = this.from[k] + (this.to[k] - this.from[k]) * e;
    if (this.onUpdate) this.onUpdate(this.target, t);
  }

  update(dt) {
    if (this.done || this.paused) return;
    if (this.delay > 0) {
      this.delay -= dt;
      if (this.delay > 0) return;
      dt = -this.delay;
      this.delay = 0;
    }
    if (!this.from) {
      this.from = {};
      for (const k in this.to) this.from[k] = this.target[k];
    }
    this.time += dt;
    while (this.time >= this.duration) {
      if (this.loop >= this.repeat) {
        this._apply(this.yoyo && this.loop % 2 === 1 ? 0 : 1);
        this._finish(true);
        return;
      }
      this.time -= this.duration;
      this.loop++;
    }
    const t = this.time / this.duration;
    this._apply(this.yoyo && this.loop % 2 === 1 ? 1 - t : t);
  }
}

export class Tweens {
  constructor() {
    this.list = [];
  }

  to(target, props, options) {
    const tween = new Tween(target, props, options);
    this.list.push(tween);
    return tween;
  }

  wait(seconds) {
    return this.to({ t: 0 }, { t: 1 }, { duration: seconds }).finished;
  }

  update(dt) {
    for (const tw of [...this.list]) tw.update(dt);
    this.list = this.list.filter((tw) => !tw.done);
  }

  killTweensOf(target) {
    for (const tw of this.list) if (tw.target === target) tw.stop(false);
    this.list = this.list.filter((tw) => !tw.done);
  }

  clear() {
    for (const tw of this.list) tw.stop(false);
    this.list = [];
  }
}
