import { Emitter } from './emitter.js';
import { Camera } from './camera.js';
import { Tweens } from './tween.js';
import { rectsOverlap } from './math.js';

export class Scene extends Emitter {
  constructor(props = {}) {
    super();
    this.game = null;
    this.entities = [];
    this.camera = new Camera();
    this.tweens = new Tweens();
    this.background = null;
    this.tilemap = null;
    this.time = 0;
    this.paused = false;
    this._pending = [];
    this._timers = [];
    this._sorted = true;
    this._tagsChanged = false;
    this._started = false;
    const { init, update, draw, exit, ...rest } = props;
    Object.assign(this, rest);
    if (init) this.init = init;
    if (update) this.update = update;
    if (draw) this.draw = draw;
    if (exit) this.exit = exit;
  }

  init() {}
  update(dt) {}
  draw(ctx) {}
  drawHud(ctx) {}
  exit() {}

  get input() {
    return this.game?.input;
  }
  get assets() {
    return this.game?.assets;
  }
  get width() {
    return this.game?.width ?? this.camera.width;
  }
  get height() {
    return this.game?.height ?? this.camera.height;
  }

  add(...list) {
    for (const e of list.flat()) {
      this._attach(e);
      this.entities.push(e);
      this._sorted = false;
    }
    return list.length === 1 ? list[0] : list;
  }

  _attach(e) {
    e.scene = this;
    e.dead = false;
    for (const c of e.children) this._attach(c);
    e.init();
  }

  remove(e) {
    e.destroy();
    return e;
  }

  withTag(tag) {
    const out = [];
    const visit = (list) => {
      for (const e of list) {
        if (!e.dead && e.tags.has(tag)) out.push(e);
        if (e.children.length) visit(e.children);
      }
    };
    visit(this.entities);
    return out;
  }

  first(tag) {
    return this.withTag(tag)[0] ?? null;
  }

  query(rect, tag) {
    const out = [];
    for (const e of this.entities) {
      if (e.dead || (tag && !e.tags.has(tag))) continue;
      if (rectsOverlap(rect, e.rect)) out.push(e);
    }
    return out;
  }

  after(seconds, fn) {
    const t = { left: seconds, fn, every: 0, cancelled: false };
    this._timers.push(t);
    return () => (t.cancelled = true);
  }

  every(seconds, fn) {
    const t = { left: seconds, fn, every: seconds, cancelled: false };
    this._timers.push(t);
    return () => (t.cancelled = true);
  }

  tween(target, props, options) {
    return this.tweens.to(target, props, options);
  }

  moveAndCollide(e, dx, dy) {
    const hit = { x: false, y: false, left: false, right: false, top: false, bottom: false, entity: null };
    const solids = this.entities.filter((o) => o !== e && o.solid && !o.dead && o.collides);
    const blocked = (x, y) => {
      const box = { x, y, w: e.w, h: e.h };
      if (this.tilemap && this.tilemap.rectHitsSolid(box)) return true;
      for (const s of solids) {
        if (rectsOverlap(box, s.rect)) {
          hit.entity = s;
          return true;
        }
      }
      return false;
    };
    const step = (axis, delta) => {
      if (delta === 0) return;
      const sign = delta > 0 ? 1 : -1;
      const units = Math.floor(Math.abs(delta) / 4);
      const advance = (amount) => {
        const nx = axis === 'x' ? e.x + amount : e.x;
        const ny = axis === 'y' ? e.y + amount : e.y;
        if (blocked(nx, ny)) return false;
        e.x = nx;
        e.y = ny;
        return true;
      };
      let stopped = false;
      for (let i = 0; i < units && !stopped; i++) stopped = !advance(4 * sign);
      const rest = Math.abs(delta) - units * 4;
      if (!stopped && rest > 0) stopped = !advance(rest * sign);
      if (stopped) {
        for (const inc of [1, 0.25, 0.0625]) {
          while (advance(inc * sign)) {
          }
        }
        hit[axis] = true;
        if (axis === 'x') hit[sign > 0 ? 'right' : 'left'] = true;
        else hit[sign > 0 ? 'bottom' : 'top'] = true;
      }
    };
    step('x', dx);
    step('y', dy);
    return hit;
  }

  _enter(game) {
    this.game = game;
    this.camera.resize?.(game.width, game.height);
    if (!this._started) {
      this._started = true;
      this.init();
    }
  }

  _step(dt) {
    if (this.paused) return;
    this.time += dt;
    this.tweens.update(dt);

    if (this._timers.length) {
      for (const t of [...this._timers]) {
        if (t.cancelled) continue;
        t.left -= dt;
        while (t.left <= 0 && !t.cancelled) {
          t.fn(this);
          if (t.every > 0) t.left += t.every;
          else t.cancelled = true;
        }
      }
      this._timers = this._timers.filter((t) => !t.cancelled);
    }

    this.update(dt);
    const updateTree = (list) => {
      for (const e of [...list]) {
        if (e.dead || !e.active) continue;
        e._tick(dt);
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.update(dt);
        if (e.children.length) updateTree(e.children);
      }
    };
    updateTree(this.entities);

    this._collide();
    this.camera.update?.(dt);
    this._sweep();
  }

  _collide() {
    const list = this.entities.filter((e) => !e.dead && e.collides && e.w > 0 && e.h > 0);
    if (list.length < 2) return;
    const items = list.map((e) => ({ e, r: e.rect })).sort((a, b) => a.r.x - b.r.x);
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (b.r.x >= a.r.x + a.r.w) break;
        if (a.e.dead || b.e.dead) continue;
        if (rectsOverlap(a.r, b.r)) {
          a.e.onCollide(b.e);
          b.e.onCollide(a.e);
          a.e.emit('collide', b.e);
          b.e.emit('collide', a.e);
        }
      }
    }
  }

  _sweep() {
    const reap = (list) => {
      let removed = false;
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (e.children.length) reap(e.children);
        if (e.dead) {
          list.splice(i, 1);
          if (e.parent) e.parent = null;
          e.onDestroy();
          e.emit('destroy', e);
          e.clear();
          removed = true;
        }
      }
      return removed;
    };
    reap(this.entities);
  }

  _draw(ctx) {
    const w = this.game.width;
    const h = this.game.height;
    if (this.background) {
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, w, h);
    }
    if (!this._sorted) {
      this.entities.sort((a, b) => a.z - b.z);
      this._sorted = true;
    }
    ctx.save();
    this.camera.apply(ctx);
    if (this.tilemap) this.tilemap.draw(ctx, this.camera.view);
    const view = this.camera.view;
    const drawEntity = (e, parentWorldClip) => {
      if (!e.visible || e.dead) return;
      ctx.save();
      ctx.translate(e.x, e.y);
      if (e.rotation || e.scaleX !== 1 || e.scaleY !== 1) {
        ctx.translate(e.w / 2, e.h / 2);
        if (e.rotation) ctx.rotate(e.rotation);
        ctx.scale(e.scaleX, e.scaleY);
        ctx.translate(-e.w / 2, -e.h / 2);
      }
      ctx.globalAlpha *= e.alpha;
      e.draw(ctx);
      for (const c of e.children) drawEntity(c);
      ctx.restore();
    };
    const hud = [];
    for (const e of this.entities) {
      if (e.screenSpace) {
        hud.push(e);
        continue;
      }
      if (!e.noCull && !e.children.length && e.rotation === 0) {
        if (e.x > view.x + view.w || e.y > view.y + view.h || e.x + e.w < view.x || e.y + e.h < view.y) continue;
      }
      drawEntity(e);
    }
    this.draw(ctx);
    ctx.restore();

    ctx.save();
    for (const e of hud) drawEntity(e);
    this.drawHud(ctx);
    ctx.restore();
  }

  _exit() {
    this.exit();
    for (const e of this.entities) e.destroy();
    this._sweep();
    this.tweens.clear();
    this.clear();
    this._started = false;
  }
}
