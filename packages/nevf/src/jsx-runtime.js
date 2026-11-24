import { Fragment } from './dom.js';

export { Fragment };

export function jsx(type, props, key) {
  return { $$nev: true, type, props: props ?? {}, key };
}
export const jsxs = jsx;
