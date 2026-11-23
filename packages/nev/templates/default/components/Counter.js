import { h, signal } from 'nevf';

// A component body runs once; only the parts that read a signal update.
export default function Counter(props) {
  const count = signal(props.start ?? 0);
  return h(
    'div',
    { class: 'card' },
    h('p', null, 'Clicked ', h('strong', { id: 'count' }, count), ' times'),
    h('button', { id: 'inc', onClick: () => count.update((n) => n + 1) }, 'Click me'),
    ' ',
    h('button', { id: 'reset', onClick: () => count.set(0) }, 'Reset'),
  );
}
