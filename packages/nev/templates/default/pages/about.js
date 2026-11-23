import { h } from 'nevf';

export const head = () => ({ title: 'About', meta: [{ name: 'description', content: 'About this site' }] });

export default function About() {
  return h(
    'div',
    null,
    h('h1', null, 'About'),
    h('p', null, 'This page is a plain file: ', h('code', null, 'pages/about.js'), '.'),
    h('ul', null,
      h('li', null, h('b', null, 'NevF'), ' — reactive UI (signals, components, SSR)'),
      h('li', null, h('b', null, 'NevB'), ' — HTTP backend (router, middleware, validation)'),
      h('li', null, h('b', null, 'NevG'), ' — 2D game engine'),
      h('li', null, h('b', null, 'Nev'), ' — ties them together'),
    ),
  );
}
