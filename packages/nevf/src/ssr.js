// NevF.js — server-side rendering to an HTML string (synchronous).

import { Fragment, isVNode, classNames, UNITLESS } from './dom.js';
import { setServerMode, createRoot, untrack, runInScope } from './reactive.js';

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

export function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function styleToString(v) {
  if (typeof v === 'function') v = v();
  if (typeof v === 'string') return v;
  if (!v || typeof v !== 'object') return '';
  const parts = [];
  for (const k of Object.keys(v)) {
    let x = typeof v[k] === 'function' ? v[k]() : v[k];
    if (x == null || x === false || x === '') continue;
    if (typeof x === 'number' && x !== 0 && !UNITLESS.has(k) && !k.startsWith('--')) x += 'px';
    const name = k.startsWith('--') ? k : k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    parts.push(`${name}:${x}`);
  }
  return parts.join(';');
}

function renderAttrs(props, tag) {
  let out = '';
  for (const key in props) {
    if (key === 'children' || key === 'key' || key === 'ref' || key === 'innerHTML') continue;
    let v = props[key];
    if (key.length > 2 && key[0] === 'o' && key[1] === 'n' && typeof v === 'function') continue;
    if (typeof v === 'function' && key !== 'style' && key !== 'class' && key !== 'className') v = untrack(v);
    let name = key;
    if (key === 'className') name = 'class';
    else if (key === 'htmlFor') name = 'for';
    if (name === 'class') {
      v = classNames(v);
      if (!v) continue;
    } else if (name === 'style') {
      v = styleToString(v);
      if (!v) continue;
    }
    if (v == null || v === false) continue;
    if (tag === 'textarea' && name === 'value') continue;
    out += v === true ? ` ${name}` : ` ${name}="${escapeAttr(v)}"`;
  }
  return out;
}

function rawText(children) {
  return [].concat(children ?? [])
    .flat(Infinity)
    .map((c) => (typeof c === 'function' ? c() : c))
    .filter((c) => c != null && c !== false && c !== true)
    .join('')
    .replace(/<\//g, '<\\/');
}

function renderNode(value) {
  if (value == null || typeof value === 'boolean') return '';
  const t = typeof value;
  if (t === 'string') return escapeText(value);
  if (t === 'number' || t === 'bigint') return String(value);
  if (Array.isArray(value)) {
    let out = '';
    for (const v of value) out += renderNode(v);
    return out;
  }
  if (t === 'function') return renderNode(untrack(value));
  if (!isVNode(value)) return escapeText(String(value));

  const { type, props } = value;
  if (type === Fragment) return renderNode(props.children);
  if (typeof type === 'function') {
    return runInScope(() => renderNode(untrack(() => type(props))));
  }
  const open = `<${type}${renderAttrs(props, type)}`;
  if (VOID.has(type)) return `${open}>`;
  let inner;
  if (props.innerHTML != null) inner = String(typeof props.innerHTML === 'function' ? props.innerHTML() : props.innerHTML);
  else if (type === 'textarea' && props.value != null) inner = escapeText(String(typeof props.value === 'function' ? props.value() : props.value));
  else if (type === 'script' || type === 'style') inner = rawText(props.children);
  else inner = renderNode(props.children);
  return `${open}>${inner}</${type}>`;
}

/**
 * Render a tree to an HTML string. Fully synchronous — fetch your data first,
 * then render. Effects run once, onMount is skipped.
 */
export function renderToString(vnode) {
  const prev = setServerMode(true);
  let out = '';
  try {
    createRoot((dispose) => {
      try {
        out = renderNode(vnode);
      } finally {
        dispose();
      }
    });
  } finally {
    setServerMode(prev);
  }
  return out;
}
