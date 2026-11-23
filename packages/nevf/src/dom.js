// NevF.js — virtual nodes + DOM renderer.
//
// h() only creates lightweight descriptions. Components run ONCE when mounted;
// anything that must update is expressed as a function (e.g. `() => count()`),
// and only that tiny region of the DOM is re-rendered when its signals change.

import {
  effect,
  untrack,
  batch,
  signal,
  createRoot,
  createOwner,
  disposeOwner,
  runWithOwner,
  runInScope,
  getOwner,
} from './reactive.js';

export const Fragment = Symbol.for('nevf.fragment');
const SVG_NS = 'http://www.w3.org/2000/svg';

export const UNITLESS = new Set([
  'opacity', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'order', 'lineHeight',
  'fontWeight', 'zoom', 'scale', 'aspectRatio', 'columns', 'tabSize', 'orphans', 'widows',
]);

/** Create a virtual node: h('div', { class: 'x' }, child1, child2) */
export function h(type, props, ...children) {
  const p = props ? { ...props } : {};
  if (children.length) p.children = children.length === 1 ? children[0] : children;
  return { $$nev: true, type, props: p, key: p.key };
}

export const isVNode = (v) => v != null && typeof v === 'object' && v.$$nev === true;

export function createRef() {
  return { current: null };
}

export function classNames(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'function') return classNames(v());
  if (Array.isArray(v)) return v.map(classNames).filter(Boolean).join(' ');
  if (typeof v === 'object') {
    return Object.keys(v)
      .filter((k) => (typeof v[k] === 'function' ? v[k]() : v[k]))
      .join(' ');
  }
  return String(v);
}

// ---------------------------------------------------------------- insertion

/** Insert `value` into `parent` before `anchor`. Handles every child type. */
function insert(parent, value, anchor, ctx) {
  if (value == null || typeof value === 'boolean') return;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'bigint') {
    parent.insertBefore(document.createTextNode(String(value)), anchor);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) insert(parent, item, anchor, ctx);
    return;
  }
  if (t === 'function') {
    insertDynamic(parent, value, anchor, ctx);
    return;
  }
  if (isVNode(value)) {
    mountVNode(parent, value, anchor, ctx);
    return;
  }
  if (typeof value.nodeType === 'number') {
    parent.insertBefore(value, anchor); // raw DOM node
    return;
  }
  parent.insertBefore(document.createTextNode(String(value)), anchor);
}

function clearBetween(start, end) {
  const parent = start.parentNode;
  if (!parent) return;
  while (start.nextSibling && start.nextSibling !== end) parent.removeChild(start.nextSibling);
}

function removeRange(start, end) {
  const parent = start.parentNode;
  if (!parent) return;
  let n = start;
  while (n) {
    const next = n.nextSibling;
    parent.removeChild(n);
    if (n === end) break;
    n = next;
  }
}

function isPrimitive(v) {
  const t = typeof v;
  return t === 'string' || t === 'number' || t === 'bigint';
}

/** A function child: a reactive region delimited by two comment markers. */
function insertDynamic(parent, fn, anchor, ctx) {
  if (fn.$$for) {
    insertFor(parent, fn.$$for, anchor, ctx);
    return;
  }
  const start = document.createComment('');
  const end = document.createComment('');
  parent.insertBefore(start, anchor);
  parent.insertBefore(end, anchor);
  let textNode = null;

  effect(() => {
    const value = fn(); // tracked
    untrack(() => {
      if (isPrimitive(value)) {
        // fast path: update the existing text node in place
        if (textNode && textNode.parentNode) {
          textNode.nodeValue = String(value);
          return;
        }
        clearBetween(start, end);
        textNode = document.createTextNode(String(value));
        end.parentNode.insertBefore(textNode, end);
        return;
      }
      textNode = null;
      clearBetween(start, end);
      insert(end.parentNode, value, end, ctx);
    });
  });
}

/** Keyed list reconciliation used by <For>. Items are keyed by identity. */
function insertFor(parent, spec, anchor, ctx) {
  const outer = getOwner();
  const start = document.createComment('for');
  const end = document.createComment('/for');
  parent.insertBefore(start, anchor);
  parent.insertBefore(end, anchor);
  let entries = [];

  const makeEntry = (item, i) => {
    const owner = createOwner(outer);
    const index = signal(i);
    const s = document.createComment('');
    const e = document.createComment('');
    const frag = document.createDocumentFragment();
    frag.appendChild(s);
    runWithOwner(owner, () => untrack(() => insert(frag, spec.render(item, index), null, ctx)));
    frag.appendChild(e);
    return { item, owner, index, start: s, end: e };
  };

  const moveRange = (parentNode, entry, before) => {
    const nodes = [];
    let n = entry.start;
    while (n) {
      nodes.push(n);
      if (n === entry.end) break;
      n = n.nextSibling;
    }
    for (const node of nodes) parentNode.insertBefore(node, before);
  };

  const reconcile = (items) => {
    const parentNode = end.parentNode;
    if (!parentNode) return;
    const pool = new Map();
    for (const en of entries) {
      const bucket = pool.get(en.item);
      if (bucket) bucket.push(en);
      else pool.set(en.item, [en]);
    }
    const next = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      const bucket = pool.get(items[i]);
      if (bucket && bucket.length) {
        const en = bucket.shift();
        en.index.set(i);
        next[i] = en;
      } else {
        next[i] = makeEntry(items[i], i);
      }
    }
    for (const bucket of pool.values()) {
      for (const en of bucket) {
        disposeOwner(en.owner);
        removeRange(en.start, en.end);
      }
    }
    let cursor = end;
    for (let i = next.length - 1; i >= 0; i--) {
      const en = next[i];
      if (en.end.nextSibling !== cursor) moveRange(parentNode, en, cursor);
      cursor = en.start;
    }
    entries = next;
  };

  if (outer) outer.cleanups.push(() => entries.forEach((en) => disposeOwner(en.owner)));

  effect(() => {
    const items = spec.each(); // tracked
    untrack(() => batch(() => reconcile(items)));
  });
}

function mountVNode(parent, vnode, anchor, ctx) {
  const { type, props } = vnode;
  if (type === Fragment) {
    insert(parent, props.children, anchor, ctx);
    return;
  }
  if (typeof type === 'function') {
    runInScope(() => {
      const result = untrack(() => type(props));
      insert(parent, result, anchor, ctx);
    });
    return;
  }
  parent.insertBefore(createHost(type, props, ctx), anchor);
}

// -------------------------------------------------------------- host nodes

const LATE_PROPS = new Set(['value', 'checked', 'selected']);

function createHost(type, props, ctx) {
  const svg = ctx.svg || type === 'svg';
  const el = svg ? document.createElementNS(SVG_NS, type) : document.createElement(type);
  const childCtx = { svg: svg && type !== 'foreignObject' };

  for (const key in props) {
    if (key === 'children' || key === 'key' || key === 'ref' || LATE_PROPS.has(key)) continue;
    applyProp(el, key, props[key], svg);
  }
  insert(el, props.children, null, childCtx);
  for (const key of LATE_PROPS) {
    if (key in props) applyProp(el, key, props[key], svg);
  }
  const ref = props.ref;
  if (ref) {
    if (typeof ref === 'function') ref(el);
    else if (typeof ref === 'object') ref.current = el;
  }
  return el;
}

function applyProp(el, key, value, svg) {
  if (key.length > 2 && key[0] === 'o' && key[1] === 'n' && typeof value === 'function') {
    el.addEventListener(key.slice(2).toLowerCase(), value);
    return;
  }
  const composite =
    (key === 'class' || key === 'className' || key === 'style') && value && typeof value === 'object';
  if (typeof value === 'function' || composite) {
    let prev;
    effect(() => {
      prev = setProp(el, key, typeof value === 'function' ? value() : value, svg, prev);
    });
    return;
  }
  setProp(el, key, value, svg);
}

function setProp(el, key, value, svg, prev) {
  switch (key) {
    case 'class':
    case 'className': {
      const s = classNames(value);
      if (s) el.setAttribute('class', s);
      else el.removeAttribute('class');
      return undefined;
    }
    case 'style':
      return applyStyle(el, value, prev);
    case 'innerHTML':
      el.innerHTML = value == null ? '' : String(value);
      return undefined;
    case 'htmlFor':
      key = 'for';
      break;
    case 'value':
    case 'checked':
    case 'selected':
      if (!svg) {
        el[key] = value == null ? (key === 'value' ? '' : false) : value;
        return undefined;
      }
      break;
    default:
  }
  if (value == null || value === false) el.removeAttribute(key);
  else el.setAttribute(key, value === true ? '' : String(value));
  return undefined;
}

function applyStyle(el, value, prev) {
  if (typeof value === 'string') {
    el.style.cssText = value;
    return null;
  }
  if (prev && typeof prev === 'object') {
    for (const k in prev) if (!value || !(k in value)) setStyleProp(el, k, null);
  }
  if (value && typeof value === 'object') {
    for (const k in value) setStyleProp(el, k, value[k]);
  }
  return value;
}

function setStyleProp(el, k, v) {
  if (typeof v === 'function') v = v();
  if (v == null || v === false) v = '';
  if (typeof v === 'number' && v !== 0 && !UNITLESS.has(k) && !k.startsWith('--')) v += 'px';
  if (k.startsWith('--')) el.style.setProperty(k, String(v));
  else el.style[k] = v;
}

// ------------------------------------------------------------------ roots

/**
 * Render a tree into a container (replacing its content).
 * Returns a dispose() function.
 */
export function render(vnode, container) {
  let dispose;
  const frag = document.createDocumentFragment();
  createRoot((d) => {
    dispose = d;
    insert(frag, vnode, null, { svg: false });
  });
  container.replaceChildren(frag);
  return () => {
    dispose();
    container.replaceChildren();
  };
}

/**
 * Take over server-rendered markup. The tree is rebuilt off-screen and swapped
 * in atomically (no flash). DOM nodes are not reused — see README.
 */
export const hydrate = render;
