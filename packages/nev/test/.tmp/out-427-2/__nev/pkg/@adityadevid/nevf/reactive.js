// NevF.js — fine-grained reactivity core (signals, computed, effects, owners).
//
// Mental model:
//   * a signal holds a value and remembers which effects read it
//   * writing a signal re-runs exactly those effects (batched, glitch-free)
//   * every effect/component runs inside an "owner"; when the owner is
//     re-run or disposed, everything created inside it is cleaned up

const noop = () => {};

let activeObserver = null; // effect/computed currently collecting dependencies
let currentOwner = null; //   owner that receives cleanups and child effects
let batchDepth = 0;
let flushing = false;
let serverMode = false;
const queue = new Set();

/** Internal: switch SSR mode on/off. Returns the previous value. */
export function setServerMode(on) {
  const prev = serverMode;
  serverMode = !!on;
  return prev;
}
/** True while renderToString() is running. */
export const isServer = () => serverMode;

// ---------------------------------------------------------------- internals

function track(subs) {
  if (activeObserver) {
    subs.add(activeObserver);
    activeObserver.sources.add(subs);
  }
}

function detach(o) {
  for (const subs of o.sources) subs.delete(o);
  o.sources.clear();
}

function propagate(subs) {
  for (const o of [...subs]) {
    if (o.kind === 'computed') {
      if (!o.dirty) {
        o.dirty = true;
        propagate(o.subs);
      }
    } else if (!o.disposed) {
      queue.add(o);
    }
  }
}

function runCleanups(o) {
  const list = o.cleanups;
  o.cleanups = [];
  for (let i = list.length - 1; i >= 0; i--) {
    try {
      list[i]();
    } catch (err) {
      console.error('[nevf] error in cleanup:', err);
    }
  }
}

function flush() {
  if (flushing) return;
  flushing = true;
  let failed = false;
  let firstError;
  try {
    let rounds = 0;
    while (queue.size) {
      if (++rounds > 1000) {
        queue.clear();
        throw new Error('[nevf] Possible infinite loop: effects keep re-triggering each other.');
      }
      const list = [...queue];
      queue.clear();
      for (const o of list) {
        try {
          if (!o.disposed) runEffect(o);
        } catch (err) {
          if (!failed) {
            failed = true;
            firstError = err;
          }
        }
      }
    }
  } finally {
    flushing = false;
  }
  if (failed) throw firstError;
}

function runEffect(o) {
  if (o.disposed) return;
  detach(o);
  runCleanups(o);
  const prevObserver = activeObserver;
  const prevOwner = currentOwner;
  activeObserver = o;
  currentOwner = o;
  try {
    const result = o.fn();
    if (typeof result === 'function') o.cleanups.push(result);
  } catch (err) {
    handleError(err, o);
  } finally {
    activeObserver = prevObserver;
    currentOwner = prevOwner;
  }
}

/** Walk up the owner chain looking for an ErrorBoundary handler. */
export function handleError(err, owner) {
  for (let o = owner; o; o = o.parent) {
    if (o.errorHandler) {
      o.errorHandler(err);
      return;
    }
  }
  throw err;
}

// ------------------------------------------------------------------ signals

/**
 * Create a reactive value.
 *   const count = signal(0)
 *   count()            // read (tracked)
 *   count.peek()       // read (untracked)
 *   count.set(5)       // write
 *   count.update(n => n + 1)
 */
export function signal(initial, options = {}) {
  let value = initial;
  const subs = new Set();
  const equals = options.equals === undefined ? Object.is : options.equals;

  function read() {
    track(subs);
    return value;
  }
  read.peek = () => value;
  read.set = (next) => {
    if (equals && equals(value, next)) return value;
    value = next;
    propagate(subs);
    if (batchDepth === 0) flush();
    return value;
  };
  read.update = (fn) => read.set(fn(value));
  read.$$signal = true;
  return read;
}

export const isSignal = (v) => typeof v === 'function' && v.$$signal === true;

/** Lazily-evaluated derived value. */
export function computed(fn) {
  if (serverMode) {
    const read = () => untrack(fn);
    read.peek = read;
    return read;
  }
  const o = { kind: 'computed', sources: new Set(), subs: new Set(), dirty: true, value: undefined };
  const refresh = () => {
    detach(o);
    const prev = activeObserver;
    activeObserver = o;
    try {
      o.value = fn();
    } finally {
      activeObserver = prev;
    }
    o.dirty = false;
  };
  const read = () => {
    if (o.dirty) refresh();
    track(o.subs);
    return o.value;
  };
  read.peek = () => {
    if (o.dirty) refresh();
    return o.value;
  };
  return read;
}

/**
 * Eager derived value with an equality cut-off: dependents only re-run when
 * the result actually changes. Perfect for "which route / which branch?".
 */
export function memo(fn, equals = Object.is) {
  const s = signal(undefined, { equals });
  effect(() => {
    s.set(fn());
  });
  const read = () => s();
  read.peek = s.peek;
  return read;
}

/** Run `fn` now and again whenever a signal it read changes. Returns dispose(). */
export function effect(fn) {
  if (serverMode) {
    untrack(fn);
    return noop;
  }
  const o = {
    kind: 'effect',
    fn,
    sources: new Set(),
    cleanups: [],
    parent: currentOwner,
    errorHandler: null,
    disposed: false,
  };
  const dispose = () => {
    if (o.disposed) return;
    o.disposed = true;
    detach(o);
    queue.delete(o);
    runCleanups(o);
  };
  if (currentOwner) currentOwner.cleanups.push(dispose);
  runEffect(o);
  return dispose;
}

/** Group several writes; effects run once at the end. */
export function batch(fn) {
  batchDepth++;
  try {
    return fn();
  } finally {
    if (--batchDepth === 0) flush();
  }
}

/** Read signals inside `fn` without subscribing. */
export function untrack(fn) {
  const prev = activeObserver;
  activeObserver = null;
  try {
    return fn();
  } finally {
    activeObserver = prev;
  }
}

// ------------------------------------------------------------------ owners

export const getOwner = () => currentOwner;

export function createOwner(parent = currentOwner) {
  return { parent, cleanups: [], errorHandler: null, disposed: false };
}

/** Permanently dispose an owner (runs its cleanups, newest first). */
export function disposeOwner(owner) {
  owner.disposed = true;
  runCleanups(owner);
}

export function runWithOwner(owner, fn) {
  const prev = currentOwner;
  currentOwner = owner;
  try {
    return fn();
  } finally {
    currentOwner = prev;
  }
}

/** Run `fn` in a child owner that is disposed together with the current owner. */
export function runInScope(fn) {
  const owner = createOwner(currentOwner);
  if (currentOwner) currentOwner.cleanups.push(() => disposeOwner(owner));
  return runWithOwner(owner, () => fn(owner));
}

/** Detached root. `fn` receives a dispose() function. */
export function createRoot(fn) {
  const owner = createOwner(null);
  return runWithOwner(owner, () => fn(() => disposeOwner(owner)));
}

/** Register a callback to run when the current owner is re-run or disposed. */
export function onCleanup(fn) {
  if (currentOwner) currentOwner.cleanups.push(fn);
  return fn;
}

/**
 * Run after the component's DOM is attached (browser only; ignored on the
 * server). If `fn` returns a function it is used as cleanup.
 */
export function onMount(fn) {
  if (serverMode) return;
  const owner = currentOwner;
  queueMicrotask(() => {
    if (owner && owner.disposed) return;
    const prev = currentOwner;
    currentOwner = owner;
    try {
      const result = untrack(fn);
      if (typeof result === 'function') {
        if (owner && !owner.disposed) owner.cleanups.push(result);
        else result();
      }
    } catch (err) {
      console.error('[nevf] error in onMount:', err);
    } finally {
      currentOwner = prev;
    }
  });
}

// ---------------------------------------------------------------- resources

/**
 * Async data helper.
 *   const user = resource(() => fetch('/api/me').then(r => r.json()))
 *   user.data() / user.loading() / user.error() / user.refetch()
 * On the server it does not auto-fetch (use a loader there).
 */
export function resource(fetcher, options = {}) {
  const data = signal(options.initial);
  const loading = signal(false);
  const error = signal(null);
  let ticket = 0;
  const refetch = async (...args) => {
    const mine = ++ticket;
    batch(() => {
      loading.set(true);
      error.set(null);
    });
    try {
      const result = await fetcher(...args);
      if (mine === ticket) data.set(result);
      return result;
    } catch (err) {
      if (mine === ticket) error.set(err);
    } finally {
      if (mine === ticket) loading.set(false);
    }
  };
  if (options.immediate !== false && !serverMode) refetch();
  return { data, loading, error, refetch };
}
