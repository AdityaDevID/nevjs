// NevF.js — deep reactive stores: mutate plain objects/arrays, only the readers of what changed re-run.

import { signal, batch } from './reactive.js';

const RAW = Symbol('nevf.raw');
const proxies = new WeakMap(); // raw object → proxy
const nodes = new WeakMap(); // raw object → { keys: Map<key, versionSignal>, shape: versionSignal }

const isWrappable = (v) => {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return true;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

function nodeOf(target) {
  let n = nodes.get(target);
  if (!n) nodes.set(target, (n = { keys: new Map(), shape: signal(0) }));
  return n;
}

const keySignal = (target, key) => {
  const n = nodeOf(target);
  let s = n.keys.get(key);
  if (!s) n.keys.set(key, (s = signal(0)));
  return s;
};

const bump = (s) => s.set(s.peek() + 1);

const handler = {
  get(target, key, receiver) {
    if (key === RAW) return target;
    if (typeof key === 'symbol') return Reflect.get(target, key, receiver);
    if (Array.isArray(target) && key === 'length') {
      nodeOf(target).shape();
      return target.length;
    }
    const own = Object.prototype.hasOwnProperty.call(target, key);
    if (!own) {
      // methods (push, map, …) and prototype stuff: track shape so iteration helpers stay reactive
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') keySignal(target, key)();
      return value;
    }
    keySignal(target, key)(); // subscribe to this key
    const value = target[key];
    return isWrappable(value) ? wrap(value) : value;
  },
  has(target, key) {
    if (key === RAW) return true;
    if (typeof key !== 'symbol') keySignal(target, key)();
    return Reflect.has(target, key);
  },
  ownKeys(target) {
    nodeOf(target).shape();
    return Reflect.ownKeys(target);
  },
  set(target, key, value) {
    if (typeof key === 'symbol') return Reflect.set(target, key, value);
    if (value && typeof value === 'object' && value[RAW]) value = value[RAW]; // never store proxies inside raw data
    const had = Object.prototype.hasOwnProperty.call(target, key);
    const old = target[key];
    const isArr = Array.isArray(target);
    const oldLength = isArr ? target.length : 0;
    if (had && Object.is(old, value) && !(isArr && key === 'length')) return true;
    batch(() => {
      target[key] = value;
      const n = nodeOf(target);
      const s = n.keys.get(key);
      if (s) bump(s);
      if (!had) bump(n.shape);
      if (isArr) {
        if (key === 'length') {
          // truncation also invalidates removed indices
          for (let i = value; i < oldLength; i++) {
            const si = n.keys.get(String(i));
            if (si) bump(si);
          }
          if (value !== oldLength) bump(n.shape);
        } else if (target.length !== oldLength) bump(n.shape);
      }
    });
    return true;
  },
  deleteProperty(target, key) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) return true;
    batch(() => {
      delete target[key];
      const n = nodeOf(target);
      const s = n.keys.get(key);
      if (s) bump(s);
      bump(n.shape);
    });
    return true;
  },
};

function wrap(raw) {
  let p = proxies.get(raw);
  if (!p) proxies.set(raw, (p = new Proxy(raw, handler)));
  return p;
}

/**
 * const [state, setState] = createStore({ user: { name: 'Ada' }, todos: [] })
 *
 * state.user.name = 'Grace'          // direct mutation is reactive (deeply, arrays too)
 * state.todos.push({ title: 'x' })
 * setState({ ready: true })           // shallow merge
 * setState((s) => { s.todos.length = 0 })   // batched mutation
 *
 * Read inside effects / computed / JSX functions and they re-run only when what they read changes.
 */
export function createStore(initial = {}) {
  if (!isWrappable(initial)) throw new TypeError('createStore() expects a plain object or array');
  const state = wrap(initial[RAW] ?? initial);
  const setState = (update) => {
    batch(() => {
      if (typeof update === 'function') {
        const r = update(state);
        if (r && typeof r === 'object' && r !== state) Object.assign(state, r);
      } else if (update && typeof update === 'object') Object.assign(state, update);
    });
  };
  return [state, setState];
}

/** The plain (non-reactive) object behind a store proxy. Mutating it will NOT notify readers. */
export const unwrap = (store) => (store && store[RAW]) || store;

/** Deep plain copy of a store's current data (safe to JSON.stringify / send / persist). */
export function snapshot(store) {
  const seen = new WeakMap();
  const copy = (v) => {
    v = unwrap(v);
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);
    if (!isWrappable(v)) return v;
    const out = Array.isArray(v) ? [] : {};
    seen.set(v, out);
    for (const k of Object.keys(v)) out[k] = copy(v[k]);
    return out;
  };
  return copy(store);
}
