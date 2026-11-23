import { h, Link, For } from 'nevf';

export const head = () => ({ title: 'Blog' });

export default function Blog(props) {
  return h(
    'div',
    null,
    h('h1', null, 'Blog'),
    h(For, { each: props.data.posts }, (post) =>
      h(
        'article',
        { class: 'card' },
        h('h2', { style: { margin: 0 } }, h(Link, { href: `/blog/${post.slug}` }, post.title)),
        h('p', { class: 'muted' }, post.date, ' — ', post.summary),
      ),
    ),
  );
}
