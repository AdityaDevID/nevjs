import { h, Link } from '@adityadevid/nevf';

export default function ErrorPage(props) {
  const e = props.error ?? {};
  return h(
    'main',
    { style: { fontFamily: 'system-ui, sans-serif', padding: '3rem 1.5rem', textAlign: 'center' } },
    h('h1', { style: { fontSize: '3rem', margin: 0 } }, e.status ?? 500),
    h('p', null, e.message ?? 'Something went wrong.'),
    e.stack ? h('pre', { style: { textAlign: 'left', overflow: 'auto', background: '#f5f5f5', padding: '1rem' } }, e.stack) : null,
    h(Link, { href: '/' }, 'Back to the home page'),
  );
}
