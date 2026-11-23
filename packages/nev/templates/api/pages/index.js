import { h } from 'nevf';

export default function Home() {
  return h('main', { style: { fontFamily: 'sans-serif', padding: '2rem' } },
    h('h1', null, 'My Nev API'),
    h('p', null, 'Try ', h('code', null, 'GET /api/todos'), ' and ', h('code', null, 'POST /api/todos'), '.'));
}
