// NevF.js — small reactive utilities. All of them clean up with their owner (component / effect).

import { signal, effect, onCleanup, untrack, isServer, getOwner } from './reactive.js';
import { h, mountInto } from './dom.js';

const read = (v) => (typeof v === 'function' ? v() : v);

/** A signal mirrored to localStorage (JSON). Falls back to a plain signal where storage is unavailable (SSR). */
export function persisted(key, initial, options = {}) {
  const storage = options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  let start = initial;
  if (storage) {
    try {
      const raw = storage.getItem(key);
      if (raw != null) start = JSON.parse(raw);
    } catch {
      /* corrupt value or blocked storage → use initial */
    }
  }
  const s = signal(start);
  if (storage && !isServer()) {
    effect(() => {
      const v = s();
      try {
        storage.setItem(key, JSON.stringify(v));
      } catch {
        /* quota / private mode */
      }
    });
    if (options.sync !== false && typeof window !== 'undefined' && window.addEventListener) {
      const onStorage = (e) => {
        if (e.key !== key || e.storageArea !== storage) return;
        try {
          s.set(e.newValue == null ? initial : JSON.parse(e.newValue));
        } catch {
          /* ignore */
        }
      };
      window.addEventListener('storage', onStorage);
      onCleanup(() => window.removeEventListener('storage', onStorage));
    }
  }
  return s;
}

/** Follows `source` after it has been quiet for `ms`. */
export function debounced(source, ms = 200) {
  const out = signal(untrack(() => read(source)));
  let timer;
  effect(() => {
    const v = read(source);
    clearTimeout(timer);
    timer = setTimeout(() => out.set(v), ms);
  });
  onCleanup(() => clearTimeout(timer));
  return out;
}

/** Follows `source` at most once every `ms` (leading + trailing). */
export function throttled(source, ms = 200) {
  const out = signal(untrack(() => read(source)));
  let last = 0;
  let timer;
  let first = true;
  effect(() => {
    const v = read(source);
    if (first) {
      first = false; // the initial value is already in `out`
      return;
    }
    const wait = last + ms - Date.now();
    clearTimeout(timer);
    if (wait <= 0) {
      last = Date.now();
      out.set(v);
    } else {
      timer = setTimeout(() => {
        last = Date.now();
        out.set(v);
      }, wait);
    }
  });
  onCleanup(() => clearTimeout(timer));
  return out;
}

/** setInterval that stops with its owner. Returns a stop() function. No-op on the server. */
export function interval(fn, ms) {
  if (isServer()) return () => {};
  const id = setInterval(fn, ms);
  const stop = () => clearInterval(id);
  onCleanup(stop);
  return stop;
}

/** setTimeout that is cancelled with its owner. */
export function timeout(fn, ms) {
  if (isServer()) return () => {};
  const id = setTimeout(fn, ms);
  const stop = () => clearTimeout(id);
  onCleanup(stop);
  return stop;
}

/** addEventListener that is removed with its owner. `target` may be an element, window, or a function returning one. */
export function listen(target, type, handler, options) {
  if (isServer() || typeof document === 'undefined') return () => {};
  const el = typeof target === 'function' ? target() : target;
  if (!el) return () => {};
  el.addEventListener(type, handler, options);
  const stop = () => el.removeEventListener(type, handler, options);
  onCleanup(stop);
  return stop;
}

/** Reactive boolean for a CSS media query: mediaQuery('(max-width: 600px)'). Always false on the server. */
export function mediaQuery(query) {
  const s = signal(false);
  if (isServer() || typeof window === 'undefined' || !window.matchMedia) return s;
  const mq = window.matchMedia(query);
  s.set(!!mq.matches);
  const on = (e) => s.set(!!e.matches);
  mq.addEventListener?.('change', on);
  onCleanup(() => mq.removeEventListener?.('change', on));
  return s;
}

/** [value, toggle, set] boolean helper. */
export function toggle(initial = false) {
  const s = signal(!!initial);
  return [s, () => s.update((v) => !v), (v) => s.set(!!v)];
}

/** Value of `source` from the previous change. */
export function previous(source, initial) {
  const out = signal(initial);
  let prev = untrack(() => read(source));
  let first = true;
  effect(() => {
    const now = read(source);
    if (first) {
      first = false; // nothing has changed yet
      return;
    }
    untrack(() => out.set(prev));
    prev = now;
  });
  return out;
}

// ---------------------------------------------------------------- components

/**
 * Load a component on demand:
 *   const Chart = lazy(() => import('./Chart.js'))
 *   h(Chart, { fallback: h('p', null, 'Loading…'), ...props })
 * The loader runs once. On the server the fallback is rendered unless the module was preloaded.
 */
export function lazy(loader) {
  let loaded = null;
  let promise = null;
  const load = () => (promise ??= loader().then((m) => (loaded = { c: m && m.default ? m.default : m })));
  function Lazy(props) {
    const state = signal(loaded);
    if (!loaded && !isServer()) load().then((l) => state.set(l), (err) => state.set({ error: err }));
    return () => {
      const l = state();
      if (!l) return props.fallback ?? null;
      if (l.error) throw l.error;
      const { fallback, ...rest } = props;
      return h(l.c, rest);
    };
  }
  Lazy.preload = load;
  return Lazy;
}

/** Render `children` into another DOM node (default: document.body) — modals, tooltips, toasts. */
export function Portal(props) {
  if (isServer() || typeof document === 'undefined') return null;
  const target = (typeof props.mount === 'string' ? document.querySelector(props.mount) : read(props.mount)) ?? document.body;
  const host = document.createElement('div');
  host.style.display = 'contents';
  target.appendChild(host);
  mountInto(props.children, host);
  if (getOwner()) onCleanup(() => host.remove());
  return null;
}

/** Choose the component at runtime:  h(Dynamic, { component: () => (admin() ? Admin : User), ...props }) — or a tag name. */
export function Dynamic(props) {
  const { component, children, ...rest } = props;
  return () => {
    const c = read(component);
    if (!c) return null;
    return h(c, rest, ...[].concat(children ?? []));
  };
}
