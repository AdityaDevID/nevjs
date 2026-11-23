// NevF.js — control-flow components: Show, For, Switch/Match, ErrorBoundary.

import { memo, signal, untrack, getOwner } from './reactive.js';
import { isVNode } from './dom.js';

const read = (v) => (typeof v === 'function' ? v() : v);
const render = (children, ...args) => (typeof children === 'function' ? children(...args) : children);

/**
 * Conditional rendering.
 *   h(Show, { when: user, fallback: h(Login) }, (u) => h(Profile, { user: u }))
 * `when` may be a signal / function (reactive) or a plain value.
 */
export function Show(props) {
  const value = memo(() => read(props.when)); // only notifies when the value actually changes
  const on = memo(() => !!value());
  return () => {
    if (!on()) return props.fallback ?? null;
    // A render-prop receives the current value and is re-run when that value is replaced
    // (e.g. a refetch returns a new object). Plain children only depend on truthiness.
    if (typeof props.children === 'function') {
      const v = value();
      return untrack(() => props.children(v));
    }
    return props.children;
  };
}

/**
 * Keyed list. Items are matched by identity, so moving an item moves its DOM
 * instead of re-creating it.
 *   h(For, { each: todos }, (todo, index) => h('li', null, todo.title))
 * `index` is an accessor: index() gives the current position.
 */
export function For(props) {
  const get = () => {
    const list = read(props.each);
    return list ? Array.from(list) : [];
  };
  // Server / non-DOM path: plain map.
  const fn = () => get().map((item, i) => props.children(item, () => i));
  // Client path: keyed reconciliation (see insertFor in dom.js).
  fn.$$for = { each: get, render: (item, index) => props.children(item, index) };
  return fn;
}

/** Marker used inside <Switch>. */
export function Match(props) {
  return props;
}

/**
 *   h(Switch, { fallback: h(NotFound) },
 *     h(Match, { when: () => state() === 'loading' }, h(Spinner)),
 *     h(Match, { when: () => state() === 'ready' },   h(Page)))
 */
export function Switch(props) {
  const kids = [].concat(props.children ?? []).flat(Infinity).filter((v) => isVNode(v) && v.type === Match);
  const index = memo(() => kids.findIndex((m) => !!read(m.props.when)));
  return () => {
    const i = index();
    if (i < 0) return props.fallback ?? null;
    const m = kids[i];
    return untrack(() => render(m.props.children, read(m.props.when)));
  };
}

/**
 * Catch errors thrown while rendering or updating children (browser).
 *   h(ErrorBoundary, { fallback: (err, reset) => h('p', null, err.message) }, h(Risky))
 */
export function ErrorBoundary(props) {
  const failure = signal(null);
  const owner = getOwner();
  if (owner) {
    owner.errorHandler = (err) => {
      console.error('[nevf] ErrorBoundary caught:', err);
      failure.set({ err });
    };
  }
  const reset = () => failure.set(null);
  return () => {
    const f = failure();
    if (f) {
      return typeof props.fallback === 'function'
        ? untrack(() => props.fallback(f.err, reset))
        : props.fallback ?? null;
    }
    return props.children;
  };
}
