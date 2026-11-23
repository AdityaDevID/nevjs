import { h, Link } from '@adityadevid/nevf';
import Counter from '../components/Counter.js';

export const head = () => ({ title: 'Home' });

export default function Home() {
  return h(
    'div',
    null,
    h('h1', null, 'Welcome to Nev.js'),
    h('p', { class: 'muted' }, 'File-based routes, server rendering and instant client-side navigation. No build step.'),
    h(Counter, { start: 0 }),
    h(
      'p',
      null,
      'Try the ',
      h(Link, { href: '/blog' }, 'blog'),
      ' (server loaders), the ',
      h(Link, { href: '/guestbook' }, 'guestbook'),
      ' (API routes) or the ',
      h(Link, { href: '/game' }, 'game'),
      ' (NevG).',
    ),
  );
}
