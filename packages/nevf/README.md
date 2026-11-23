# nevf — NevF.js

Tiny fine-grained reactive UI framework: signals, components, stores, context, SSR, router. **No build step, zero dependencies.**

```bash
npm install nevf
```

```js
import { h, signal, render } from 'nevf';

function Counter() {
  const n = signal(0);
  return h('button', { onClick: () => n.update((x) => x + 1) }, 'Clicked ', n);
}
render(h(Counter), document.body);
```

Components run **once**; only the functions/signals you place in the tree re-run.

## API
- **Reactivity:** `signal computed memo effect batch untrack onMount onCleanup createRoot resource`
- **Stores:** `createStore` — deep reactive objects/arrays you mutate directly (`state.todos.push(...)`), `unwrap`, `snapshot`
- **Context:** `createContext`, `useContext`
- **Control flow:** `Show For Switch/Match ErrorBoundary Dynamic Portal lazy`
- **Hooks:** `persisted` (localStorage signal), `debounced`, `throttled`, `interval`, `timeout`, `listen`, `mediaQuery`, `toggle`, `previous`
- **Forms:** `createForm` — values, errors, touched, dirty, submit; accepts a function or any `safeParse` schema (e.g. NevB's `v.object`)
- **SSR:** `renderToString`   **Router:** `Router Link navigate location useQuery`

```js
const [state] = createStore({ todos: [] });
const left = computed(() => state.todos.filter((t) => !t.done).length);

const Theme = createContext('light');
h(Theme.Provider, { value: 'dark' }, h(App));   // useContext(Theme) below

const form = createForm({ initial: { email: '' }, validate: (v) => ({ email: v.email.includes('@') ? '' : 'Invalid' }), onSubmit: save });
h('form', { onSubmit: form.submit }, h('input', form.field('email')));
```

Part of the [Nev.js](https://github.com/AdityaDevID/nevjs) family. MIT.
