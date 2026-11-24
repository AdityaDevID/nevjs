import { Emitter } from './emitter.js';

let nextId = 1;

/**
 * Base game object. Subclass it, or pass hooks:
 *   new Entity({ x: 10, y: 20, w: 16, h: 16, tags: ['enemy'], update(dt) {...}, draw(ctx) {...} })
 *
 * Position (x, y) is the TOP-LEFT of the box; w/h is the hitbox. Visual
 * transforms (rotation, scale, alpha) pivot around the box center.
 * Children are positioned relative to their parent.
 */
export class Entity extends Emitter {
  constructor(props = {}) {
    super();
    this.id = nextId++;
    this.x = 0;
    this.y = 0;
    this.w = 16;
    this.h = 16;
    this.vx = 0;
    this.vy = 0;
    this.rotation = 0;
    this.scaleX = 1;
    this.scaleY = 1;
    this.alpha = 1;
    this.visible = true;
    this.active = true; // inactive entities skip update()
    this.z = 0; // draw order (higher = on top)
    this.tags = new Set();
    this.solid = false; // blocks moveAndCollide() of others
    this.collides = true; // takes part in overlap events
    this.screenSpace = false; // true → ignores the camera (HUD)
    this.scene = null;
    this.parent = null;
    this.children = [];
    this.dead = false;
    this._timers = [];

    const { tags, update, draw, ...rest } = props;
    Object.assign(this, rest);
    if (tags) for (const t of [].concat(tags)) this.tags.add(t);
    if (update) this.update = update;
    if (draw) this.draw = draw;
  }

  // ---- geometry ---------------------------------------------------------
  get cx() {
    return this.x + this.w / 2;
  }
  set cx(v) {
    this.x = v - this.w / 2;
  }
  get cy() {
    return this.y + this.h / 2;
  }
  set cy(v) {
    this.y = v - this.h / 2;
  }
  get right() {
    return this.x + this.w;
  }
  get bottom() {
    return this.y + this.h;
  }
  /** World position of this entity (parents' positions added). */
  get worldX() {
    return this.parent ? this.parent.worldX + this.x : this.x;
  }
  get worldY() {
    return this.parent ? this.parent.worldY + this.y : this.y;
  }
  /** Hitbox in world coordinates. */
  get rect() {
    return { x: this.worldX, y: this.worldY, w: this.w, h: this.h };
  }

  hasTag(tag) {
    return this.tags.has(tag);
  }
  addTag(...tags) {
    for (const t of tags) this.tags.add(t);
    if (this.scene) this.scene._tagsChanged = true;
    return this;
  }
  removeTag(tag) {
    this.tags.delete(tag);
    return this;
  }

  // ---- hierarchy --------------------------------------------------------
  add(child) {
    if (child.parent) child.parent.remove(child);
    child.parent = this;
    this.children.push(child);
    if (this.scene) this.scene._attach(child);
    return child;
  }

  remove(child) {
    const i = this.children.indexOf(child);
    if (i < 0) return child;
    this.children.splice(i, 1);
    child.parent = null;
    return child;
  }

  /** Remove from the scene at the end of the current frame. */
  destroy() {
    if (this.dead) return;
    this.dead = true;
    for (const c of this.children) c.destroy();
  }

  // ---- timers (use game time, pause with the scene) ----------------------
  /** Run fn once after `seconds`. Returns a cancel function. */
  after(seconds, fn) {
    const t = { left: seconds, fn, every: 0, cancelled: false };
    this._timers.push(t);
    return () => (t.cancelled = true);
  }

  /** Run fn every `seconds`. Returns a cancel function. */
  every(seconds, fn) {
    const t = { left: seconds, fn, every: seconds, cancelled: false };
    this._timers.push(t);
    return () => (t.cancelled = true);
  }

  _tick(dt) {
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
  }

  // ---- hooks to override --------------------------------------------------
  /** Called once when added to a scene. */
  init() {}
  /** Called every fixed step. */
  update(dt) {}
  /** Draw in local space: the origin is the entity's top-left. */
  draw(ctx) {}
  /** Another collidable entity overlaps this one. */
  onCollide(other) {}
  /** Called when removed. */
  onDestroy() {}
}

// ---------------------------------------------------------------- built-ins

/** Filled rectangle. */
export class Rect extends Entity {
  constructor(props = {}) {
    super({ color: '#fff', ...props });
  }
  draw(ctx) {
    ctx.fillStyle = this.color;
    ctx.fillRect(0, 0, this.w, this.h);
  }
}

/** Filled circle (hitbox is still the bounding box). */
export class Circle extends Entity {
  constructor(props = {}) {
    super({ color: '#fff', ...props });
    if (props.radius != null) {
      this.w = this.h = props.radius * 2;
    }
  }
  draw(ctx) {
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.ellipse(this.w / 2, this.h / 2, this.w / 2, this.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Text label. Set `screenSpace: true` for HUD text. */
export class Label extends Entity {
  constructor(props = {}) {
    super({ text: '', color: '#fff', font: '16px sans-serif', align: 'left', baseline: 'top', collides: false, ...props });
  }
  draw(ctx) {
    ctx.fillStyle = this.color;
    ctx.font = this.font;
    ctx.textAlign = this.align;
    ctx.textBaseline = this.baseline;
    ctx.fillText(typeof this.text === 'function' ? this.text() : String(this.text), 0, 0);
  }
}

/**
 * Image / spritesheet sprite with frame animations.
 *   new Sprite({ image, frameW: 16, frameH: 16, animations: { run: { frames: [0,1,2,3], fps: 10 } } })
 *   sprite.play('run')
 */
export class Sprite extends Entity {
  constructor(props = {}) {
    super({ image: null, frameW: 0, frameH: 0, frame: 0, animations: {}, flipX: false, anim: null, ...props });
    if (!this.frameW && this.image) this.frameW = this.image.width;
    if (!this.frameH && this.image) this.frameH = this.image.height;
    if (props.w == null) this.w = this.frameW || 16;
    if (props.h == null) this.h = this.frameH || 16;
    this._animTime = 0;
    this._current = null;
    if (props.anim) this.play(props.anim);
  }

  play(name, { restart = false } = {}) {
    if (this._current === name && !restart) return this;
    const a = this.animations[name];
    if (!a) throw new Error(`[nevg] Unknown animation "${name}"`);
    this._current = name;
    this._animTime = 0;
    this.frame = a.frames[0];
    return this;
  }

  get currentAnimation() {
    return this._current;
  }

  update(dt) {
    const a = this._current && this.animations[this._current];
    if (!a) return;
    this._animTime += dt;
    const n = a.frames.length;
    let i = Math.floor(this._animTime * (a.fps ?? 10));
    if (a.loop === false) {
      if (i >= n) {
        i = n - 1;
        if (!this._animDone) {
          this._animDone = true;
          this.emit('animationend', this._current);
        }
      } else this._animDone = false;
    } else i %= n;
    this.frame = a.frames[i];
  }

  draw(ctx) {
    if (!this.image) return;
    const cols = Math.max(1, Math.floor(this.image.width / this.frameW));
    const sx = (this.frame % cols) * this.frameW;
    const sy = Math.floor(this.frame / cols) * this.frameH;
    if (this.flipX) {
      ctx.translate(this.w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(this.image, sx, sy, this.frameW, this.frameH, 0, 0, this.w, this.h);
  }
}
