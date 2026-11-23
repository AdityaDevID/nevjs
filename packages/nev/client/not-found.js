import { h, Link } from 'nevf';

export default function NotFound(props) {
  return h(
    'main',
    { style: { fontFamily: 'system-ui, sans-serif', padding: '3rem 1.5rem', textAlign: 'center' } },
    h('h1', { style: { fontSize: '4rem', margin: 0 } }, '404'),
    h('p', null, 'There is nothing at ', h('code', null, props.url ?? 'this address'), '.'),
    h(Link, { href: '/' }, 'Back to the home page'),
  );
}
