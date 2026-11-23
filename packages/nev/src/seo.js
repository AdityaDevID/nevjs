// sitemap.xml / robots.txt generation.

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Normalise `config.site` to an origin without trailing slash, or null. */
export function siteOrigin(config) {
  const raw = config.site ?? config.siteUrl;
  if (!raw) return null;
  try {
    const u = new URL(String(raw));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Entries for the sitemap: every page route without parameters, plus `config.sitemapPaths`
 * (array or async function) for dynamic pages, e.g. () => posts.map((p) => '/blog/' + p.slug)
 * Each item is a path string or { path, lastmod, changefreq, priority }.
 */
export async function collectSitemapEntries(config, pages) {
  const entries = new Map();
  const add = (item) => {
    const e = typeof item === 'string' ? { path: item } : item;
    if (!e || typeof e.path !== 'string' || !e.path.startsWith('/') || e.path.startsWith('//')) return;
    entries.set(e.path, { ...entries.get(e.path), ...e });
  };
  for (const r of pages.routes) if (!/[:*]/.test(r.pattern)) add(r.pattern);
  const extra = typeof config.sitemapPaths === 'function' ? await config.sitemapPaths() : config.sitemapPaths;
  for (const item of extra ?? []) add(item);
  const skip = (config.sitemapExclude ?? []).map((p) => (p.endsWith('*') ? (x) => x.startsWith(p.slice(0, -1)) : (x) => x === p));
  return [...entries.values()].filter((e) => !skip.some((fn) => fn(e.path)));
}

export function buildSitemap(origin, entries) {
  const rows = entries.map((e) => {
    let row = `  <url>\n    <loc>${xml(origin + encodeURI(e.path))}</loc>\n`;
    if (e.lastmod) row += `    <lastmod>${xml(e.lastmod instanceof Date ? e.lastmod.toISOString() : e.lastmod)}</lastmod>\n`;
    if (e.changefreq) row += `    <changefreq>${xml(e.changefreq)}</changefreq>\n`;
    if (e.priority != null) row += `    <priority>${xml(e.priority)}</priority>\n`;
    return row + '  </url>';
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
}

/** robots.txt: allow everything (minus config.robots.disallow) and point crawlers at the sitemap. */
export function buildRobots(config, origin) {
  if (typeof config.robots === 'string') return config.robots;
  const disallow = config.robots?.disallow ?? [];
  const lines = ['User-agent: *'];
  if (disallow.length) for (const d of disallow) lines.push(`Disallow: ${d}`);
  else lines.push('Allow: /');
  if (origin && config.sitemap !== false) lines.push('', `Sitemap: ${origin}/sitemap.xml`);
  return lines.join('\n') + '\n';
}
