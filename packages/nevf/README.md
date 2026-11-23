# nevf — NevF.js

Tiny fine-grained reactive UI framework: signals, components, SSR, router. No build step.

```js
import { h, signal, render } from 'nevf';

function Counter() {
  const n = signal(0);
  return h('button', { onClick: () => n.update((x) => x + 1) }, 'Clicked ', n);
}
render(h(Counter), document.body);
```

Full API reference: see the repository README (`../../README.md`).
