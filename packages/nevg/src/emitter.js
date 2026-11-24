export class Emitter {
  constructor() {
    this._handlers = new Map();
  }

  on(event, fn) {
    let set = this._handlers.get(event);
    if (!set) this._handlers.set(event, (set = new Set()));
    set.add(fn);
    return () => this.off(event, fn);
  }

  once(event, fn) {
    const off = this.on(event, (...args) => {
      off();
      fn(...args);
    });
    return off;
  }

  off(event, fn) {
    const set = this._handlers.get(event);
    if (!set) return;
    if (fn) set.delete(fn);
    else set.clear();
  }

  emit(event, ...args) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) fn(...args);
  }

  clear() {
    this._handlers.clear();
  }
}
