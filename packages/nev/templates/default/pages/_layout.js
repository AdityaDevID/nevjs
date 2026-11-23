import { h, Link, location } from '@adityadevid/nevf';

const links = [
  ['/', 'Home'],
  ['/blog', 'Blog'],
  ['/guestbook', 'Guestbook'],
  ['/game', 'Game'],
  ['/about', 'About'],
];

export default function Layout(props) {
  const active = (href) => () => {
    const p = location().pathname;
    return (href === '/' ? p === '/' : p === href || p.startsWith(href + '/')) ? 'nav active' : 'nav';
  };
  return h(
    'div',
    null,
    h(
      'header',
      { class: 'site' },
      h(
        'div',
        { class: 'shell' },
        h(Link, { href: '/', class: 'brand' }, 'Nev'),
        ...links.map(([href, label]) => h(Link, { href, class: active(href) }, label)),
      ),
    ),
    h('main', { class: 'shell' }, props.children),
    h('footer', { class: 'site' }, h('div', { class: 'shell' }, 'Built with Nev.js — NevF · NevB · NevG')),
  );
}
