export class Pool {
  constructor(create, reset = () => {}, { max = Infinity, prewarm = 0 } = {}) {
    if (typeof create !== 'function') throw new TypeError('Pool needs a create() function');
    this.create = create;
    this.reset = reset;
    this.max = max;
    this.free = [];
    this.out = new Set();
    for (let i = 0; i < Math.min(prewarm, max); i++) this.free.push(create());
  }
  get size() {
    return this.free.length + this.out.size;
  }
  get active() {
    return this.out.size;
  }
  get() {
    let obj = this.free.pop();
    if (!obj) {
      if (this.size >= this.max) return null;
      obj = this.create();
    }
    this.reset(obj);
    this.out.add(obj);
    return obj;
  }
  release(obj) {
    if (!this.out.delete(obj)) return false;
    this.free.push(obj);
    return true;
  }
  releaseAll() {
    for (const o of this.out) this.free.push(o);
    this.out.clear();
  }
}
