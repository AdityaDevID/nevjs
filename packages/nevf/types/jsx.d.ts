// JSX: set "jsx": "react-jsx" and "jsxImportSource": "nevf" in tsconfig (you bring your own transpiler).
import type { VNode } from './index';
export namespace JSX {
  type Element = VNode;
  interface IntrinsicElements { [tag: string]: Record<string, any> }
  interface ElementChildrenAttribute { children: {} }
}
