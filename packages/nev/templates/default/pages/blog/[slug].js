import { h, Link } from '@adityadevid/nevf';

export const head = ({ data }) => ({
  title: data.post.title,
  meta: [{ name: 'description', content: data.post.summary }],
});

export default function Post(props) {
  const { post } = props.data;
  return h(
    'article',
    null,
    h('p', null, h(Link, { href: '/blog' }, '← All posts')),
    h('h1', null, post.title),
    h('p', { class: 'muted' }, post.date),
    h('p', null, post.body),
  );
}
