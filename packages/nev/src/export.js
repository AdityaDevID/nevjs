import fs from 'node:fs';
import path from 'node:path';
import { createNev } from './server.js';
import { siteOrigin } from './seo.js';

const ASSET_EXT = /\.(?:m?js|css|json|svg|png|jpe?g|gif|webp|avif|ico|woff2?|txt)$/i;
const SERVER_FILE = /\.server\.m?js$/;

const toPosix = (p) => p.split(path.sep).join('/');

export function copyFiltered(srcDir, destDir, keep) {
  if (!fs.existsSync(srcDir)) return 0;
  let count = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = toPosix(path.relative(srcDir, full));
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(full);
      } else if (entry.isFile() && !entry.name.startsWith('.') && keep(rel)) {
        const to = path.join(destDir, rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(full, to);
        count++;
      }
    }
  };
  walk(srcDir);
  return count;
}

export function pathToFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, '');
  const segs = clean.split('/').filter(Boolean);
  if (segs.some((s) => s === '..' || s === '.' || s.includes('\\') || s.includes('\0'))) throw new Error(`Unsafe path: ${pathname}`);
  return segs.length ? `${segs.join('/')}/index.html` : 'index.html';
}

export function findLinks(html) {
  const out = new Set();
  for (const m of html.matchAll(/<a\s[^>]*?href="([^"]+)"/gi)) {
    let href = m[1].replace(/&amp;/g, '&');
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    href = href.split('#')[0].split('?')[0];
    if (!href || href.startsWith('/__nev') || href === '/api' || href.startsWith('/api/')) continue;
    if (/\.[a-z0-9]{1,8}$/i.test(href)) continue;
    out.add(href.length > 1 ? href.replace(/\/+$/, '') : href);
  }
  return [...out];
}

export async function exportSite(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const nev = await createNev({ root, static: true, silent: true, dev: false, config: options.config });
  const cfg = nev.config.export ?? {};
  const out = path.resolve(options.out ?? cfg.out ?? path.join(root, 'out'));
  const crawl = options.crawl ?? cfg.crawl ?? true;

  if (out === root || root.startsWith(out + path.sep)) throw new Error('The export folder cannot be the project folder or one of its parents');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const result = { out, pages: [], files: 0, errors: [], warnings: [] };
  const queue = ['/'];
  for (const r of nev.pages.routes) if (!/[:*]/.test(r.pattern)) queue.push(r.pattern);
  const extra = typeof cfg.paths === 'function' ? await cfg.paths() : cfg.paths;
  for (const p of [...(extra ?? []), ...(options.paths ?? [])]) if (typeof p === 'string' && p.startsWith('/')) queue.push(p);

  const seen = new Set();
  const write = (rel, data) => {
    const file = path.join(out, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    result.files++;
  };

  while (queue.length) {
    const pathname = queue.shift();
    if (seen.has(pathname)) continue;
    seen.add(pathname);
    let res;
    try {
      res = await nev.app.request(pathname);
    } catch (err) {
      result.errors.push({ path: pathname, status: 500, message: err.message });
      continue;
    }
    if (res.status >= 300 && res.status < 400) {
      const target = res.headers.get('location') ?? '/';
      const html = `<!doctype html><meta charset="utf-8"><title>Redirecting…</title><meta http-equiv="refresh" content="0; url=${target.replace(/"/g, '&quot;')}"><link rel="canonical" href="${target.replace(/"/g, '&quot;')}"><p>Redirecting to <a href="${target.replace(/"/g, '&quot;')}">${target.replace(/</g, '&lt;')}</a></p>`;
      write(pathToFile(pathname), html);
      result.pages.push(pathname);
      result.warnings.push(`${pathname} redirects to ${target} (exported as a meta-refresh page)`);
      continue;
    }
    if (res.status !== 200) {
      result.errors.push({ path: pathname, status: res.status, message: `responded ${res.status}` });
      continue;
    }
    const html = await res.text();
    write(pathToFile(pathname), html);
    result.pages.push(pathname);
    if (crawl) for (const link of findLinks(html)) if (!seen.has(link)) queue.push(link);
  }

  try {
    const nf = await nev.app.request('/__nev-not-found__');
    if (nf.status === 404 && /html/.test(nf.headers.get('content-type') ?? '')) write('404.html', await nf.text());
  } catch {
    result.warnings.push('could not render 404.html');
  }

  if (siteOrigin(nev.config)) {
    for (const file of ['sitemap.xml', 'robots.txt']) {
      const r = await nev.app.request('/' + file);
      if (r.status === 200) write(file, await r.text());
    }
  }

  result.files += copyFiltered(path.join(root, 'public'), out, () => true);
  const clientDirs = nev.config.clientDirs;
  for (const dir of clientDirs) {
    result.files += copyFiltered(path.join(root, dir), path.join(out, '__nev', 'app', dir), (rel) => ASSET_EXT.test(rel) && !SERVER_FILE.test(rel));
  }
  result.files += copyFiltered(nev.clientDir, path.join(out, '__nev'), (rel) => /\.js$/.test(rel));
  for (const pkg of nev.packages) {
    result.files += copyFiltered(pkg.dir, path.join(out, pkg.prefix.replace(/^\//, '')), pkg.filter ?? ((rel) => /\.m?js$/.test(rel)));
  }
  write('.nojekyll', '');

  return result;
}
