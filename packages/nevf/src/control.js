import { memo, signal, untrack, getOwner } from './reactive.js';
import { isVNode } from './dom.js';

const read = (v) => (typeof v === 'function' ? v() : v);
const render = (children, ...args) => (typeof children === 'function' ? children(...args) : children);

export function Show(props) {
  const value = memo(() => read(props.when));
  const on = memo(() => !!value());
  return () => {
    if (!on()) return props.fallback ?? null;
    if (typeof props.children === 'function') {
      const v = value();
      return untrack(() => props.children(v));
    }
    return props.children;
  };
}

export function For(props) {
  const get = () => {
    const list = read(props.each);
    return list ? Array.from(list) : [];
  };
  const fn = () => get().map((item, i) => props.children(item, () => i));
  fn.$$for = { each: get, render: (item, index) => props.children(item, index) };
  return fn;
}

export function Match(props) {
  return props;
}

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
