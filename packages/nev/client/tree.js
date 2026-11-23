// Shared by the server (SSR) and the browser: nest a page inside its layouts.
import { h } from '@adityadevid/nevf';

export function buildTree(layouts, Page, props) {
  let node = h(Page, props);
  for (let i = layouts.length - 1; i >= 0; i--) node = h(layouts[i], props, node);
  return node;
}
