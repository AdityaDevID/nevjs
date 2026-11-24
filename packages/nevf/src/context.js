import { getOwner } from './reactive.js';

export function createContext(defaultValue) {
  const id = Symbol('nevf.context');
  function Provider(props) {
    const owner = getOwner();
    if (owner) (owner.ctx ??= new Map()).set(id, props.value);
    return props.children;
  }
  return { id, defaultValue, Provider };
}

export function useContext(context) {
  for (let o = getOwner(); o; o = o.parent) {
    if (o.ctx && o.ctx.has(context.id)) return o.ctx.get(context.id);
  }
  return context.defaultValue;
}
