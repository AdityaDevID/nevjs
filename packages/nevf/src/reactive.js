const noop = () => {};

let activeObserver = null;
let currentOwner = null;
let batchDepth = 0;
let flushing = false;
let serverMode = false;
const queue = new Set();

export function setServerMode(on) {
  const prev = serverMode;
  serverMode = !!on;
  return prev;
}
export const isServer = () => serverMode;


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

export function handleError(err, owner) {
  for (let o = owner; o; o = o.parent) {
    if (o.errorHandler) {
      o.errorHandler(err);
      return;
    }
  }
  throw err;
}


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

export function memo(fn, equals = Object.is) {
  const s = signal(undefined, { equals });
  effect(() => {
    s.set(fn());
  });
  const read = () => s();
  read.peek = s.peek;
  return read;
}

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

export function batch(fn) {
  batchDepth++;
  try {
    return fn();
  } finally {
    if (--batchDepth === 0) flush();
  }
}

export function untrack(fn) {
  const prev = activeObserver;
  activeObserver = null;
  try {
    return fn();
  } finally {
    activeObserver = prev;
  }
}


export const getOwner = () => currentOwner;

export function createOwner(parent = currentOwner) {
  return { parent, cleanups: [], errorHandler: null, disposed: false };
}

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

export function runInScope(fn) {
  const owner = createOwner(currentOwner);
  if (currentOwner) currentOwner.cleanups.push(() => disposeOwner(owner));
  return runWithOwner(owner, () => fn(owner));
}

export function createRoot(fn) {
  const owner = createOwner(null);
  return runWithOwner(owner, () => fn(() => disposeOwner(owner)));
}

export function onCleanup(fn) {
  if (currentOwner) currentOwner.cleanups.push(fn);
  return fn;
}

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
