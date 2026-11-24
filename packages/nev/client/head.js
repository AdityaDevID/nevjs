// Shared by the server (SSR) and the browser: turn a page's `head` export into <meta>/<link>/JSON-LD descriptors.
//
//   export const head = ({ data }) => ({
//     title: data.post.title,                    // → <title> (+ titleTemplate)
//     description: data.post.summary,            // → <meta name="description">
//     canonical: '/blog/' + data.post.slug,      // → <link rel="canonical"> (made absolute with config.site)
//     robots: { index: false },                  // → <meta name="robots" content="noindex">   (or a string)
//     themeColor: '#0b1020',
//     openGraph: { title, description, image: '/og.png', type: 'article', siteName: 'My Site' },
//     twitter: { card: 'summary_large_image' },  // inherits title/description/image from openGraph
//     jsonLd: { '@context': 'https://schema.org', '@type': 'Article', headline: '…' },
//     meta: [...], links: [...]                  // anything else, raw
//   })

const absolute = (value, origin) => {
  if (value == null || value === '') return value;
  const s = String(value);
  if (!origin || /^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  if (s.startsWith('//')) return s;
  return origin + (s.startsWith('/') ? '' : '/') + s;
};

function robotsContent(r) {
  if (typeof r === 'string') return r;
  if (!r || typeof r !== 'object') return null;
  const parts = [r.index === false ? 'noindex' : 'index', r.follow === false ? 'nofollow' : 'follow'];
  if (r.noarchive) parts.push('noarchive');
  if (r.nosnippet) parts.push('nosnippet');
  if (r.noimageindex) parts.push('noimageindex');
  if (r.index !== false && r.follow !== false && parts.length === 2) return null; // defaults — nothing to say
  return parts.join(', ');
}

/**
 * @param {object} head   what the page exported
 * @param {{ origin?: string|null, url?: string, title?: string }} ctx   site origin, current path, final <title> text
 * @returns {{ meta: object[], links: object[], jsonLd: object[] }}
 */
export function expandHead(head = {}, ctx = {}) {
  const origin = ctx.origin ?? null;
  const meta = [];
  const links = [];
  const jsonLd = [];
  const name = (n, content) => content != null && content !== '' && meta.push({ name: n, content: String(content) });
  const prop = (p, content) => content != null && content !== '' && meta.push({ property: p, content: String(content) });

  name('description', head.description);
  name('robots', robotsContent(head.robots));
  name('theme-color', head.themeColor);
  name('author', head.author);
  name('keywords', Array.isArray(head.keywords) ? head.keywords.join(', ') : head.keywords);

  const canonical = head.canonical != null ? absolute(head.canonical, origin) : null;
  if (canonical) links.push({ rel: 'canonical', href: canonical });
  if (head.icon) links.push({ rel: 'icon', href: head.icon });
  if (head.alternates && typeof head.alternates === 'object') {
    for (const [hreflang, href] of Object.entries(head.alternates)) links.push({ rel: 'alternate', hreflang, href: absolute(href, origin) });
  }

  const og = head.openGraph;
  if (og && typeof og === 'object') {
    prop('og:title', og.title ?? ctx.title);
    prop('og:description', og.description ?? head.description);
    prop('og:type', og.type ?? 'website');
    prop('og:url', absolute(og.url ?? head.canonical, origin) ?? undefined);
    prop('og:site_name', og.siteName);
    prop('og:locale', og.locale);
    const img = typeof og.image === 'string' ? { url: og.image } : og.image;
    if (img?.url) {
      prop('og:image', absolute(img.url, origin));
      prop('og:image:width', img.width);
      prop('og:image:height', img.height);
      prop('og:image:alt', img.alt);
    }
  }

  const tw = head.twitter;
  if (tw && typeof tw === 'object') {
    const img = tw.image ?? (typeof og?.image === 'string' ? og.image : og?.image?.url);
    name('twitter:card', tw.card ?? (img ? 'summary_large_image' : 'summary'));
    name('twitter:title', tw.title ?? og?.title ?? ctx.title);
    name('twitter:description', tw.description ?? og?.description ?? head.description);
    name('twitter:image', absolute(img, origin));
    name('twitter:site', tw.site);
    name('twitter:creator', tw.creator);
  }

  for (const item of [].concat(head.jsonLd ?? [])) if (item && typeof item === 'object') jsonLd.push(item);
  for (const m of head.meta ?? []) meta.push(m);
  for (const l of head.links ?? []) links.push(l);
  return { meta, links, jsonLd };
}
