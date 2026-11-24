const posts = [
  { slug: 'hello-nev', title: 'Hello, Nev', date: '2026-01-05', summary: 'Why a zero-build framework?', body: 'Nev renders on the server, then the browser takes over. Pages are plain JavaScript modules — no bundler required.' },
  { slug: 'file-routing', title: 'File-based routing', date: '2026-01-12', summary: 'Files become URLs.', body: 'pages/blog/[slug].js becomes /blog/:slug. Put a [slug].server.js next to it to load data on the server.' },
  { slug: 'signals', title: 'Signals in 5 minutes', date: '2026-01-20', summary: 'Fine-grained reactivity.', body: 'A signal is a value that remembers who read it. Change it and only those readers update.' },
];

export const listPosts = () => posts.map(({ body, ...rest }) => rest);
export const findPost = (slug) => posts.find((p) => p.slug === slug) ?? null;
