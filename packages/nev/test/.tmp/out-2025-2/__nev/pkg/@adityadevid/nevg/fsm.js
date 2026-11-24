import { Emitter } from './emitter.js';

/**
 * Finite state machine — enemies, players, game flow.
 *
 *   const ai = new StateMachine({
 *     idle:  { enter() {...}, update(dt) { if (seesPlayer) ai.go('chase') }, exit() {...} },
 *     chase: { update(dt) {...} },
 *   }, 'idle')
 *   ai.update(dt)         // call from your update()
 *   ai.is('chase')  ai.time  ai.previous
 *
 * Optional `can(from, to)` guard on a state: `chase: { can: (from) => from !== 'dead' }`.
 * Emits 'change' (to, from).
 */
export class StateMachine extends Emitter {
  constructor(states = {}, initial, context = null) {
    super();
    this.states = states;
    this.context = context;
    this.current = null;
    this.previous = null;
    this.time = 0; // seconds in the current state
    this.history = [];
    if (initial) this.go(initial);
  }

  is(name) {
    return this.current === name;
  }

  /** Switch state. Returns false when the target is unknown or refuses (`can`). */
  go(name, ...args) {
    const next = this.states[name];
    if (!next) throw new Error(`[nevg] Unknown state "${name}"`);
    if (name === this.current) return false;
    if (next.can && next.can.call(this.context, this.current, ...args) === false) return false;
    const from = this.current;
    if (from) this.states[from].exit?.call(this.context, name, ...args);
    this.previous = from;
    this.current = name;
    this.time = 0;
    this.history.push(name);
    if (this.history.length > 20) this.history.shift();
    next.enter?.call(this.context, from, ...args);
    this.emit('change', name, from);
    return true;
  }

  /** Go back to the previous state (if any). */
  back() {
    return this.previous ? this.go(this.previous) : false;
  }

  update(dt) {
    if (!this.current) return;
    this.time += dt;
    this.states[this.current].update?.call(this.context, dt, this.time);
  }
}

/** Countdown helper (cooldowns, reload times):  const fire = new Cooldown(0.25);  fire.update(dt);  if (fire.use()) shoot() */
export class Cooldown {
  constructor(duration = 1, { ready = true } = {}) {
    this.duration = duration;
    this.left = ready ? 0 : duration;
  }
  get ready() {
    return this.left <= 0;
  }
  get progress() {
    return this.duration ? 1 - Math.max(0, this.left) / this.duration : 1;
  }
  update(dt) {
    if (this.left > 0) this.left = Math.max(0, this.left - dt);
    return this;
  }
  /** If ready: start the cooldown and return true. */
  use() {
    if (!this.ready) return false;
    this.left = this.duration;
    return true;
  }
  reset() {
    this.left = 0;
  }
}
