import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from '@adityadevid/nevb';
import { sortRoutes } from '@adityadevid/nevf';

const EXT = /\.(?:m?js)$/;
const SERVER = /\.server\.m?js$/;
const GROUP = /^\([^()/]+\)$/;

export const posix = (p) => p.split(path.sep).join('/');
export const appUrl = (rel) => '/__nev/app/' + encodeURI(posix(rel));

function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

export function fileToPattern(rel) {
  // Route groups never contribute a URL segment — including when the group
  // is the file itself (`pages/(marketing).js` → `/`, `pages/blog/(seo).js` → `/blog`).
  const parts = posix(rel).replace(EXT, '').split('/').filter((p) => !GROUP.test(p));
  if (parts[parts.length - 1] === 'index') parts.pop();
  const segs = parts.map((p) => {
    let m = /^\[\.\.\.(\w+)\]$/.exec(p);
    if (m) return '*' + m[1];
    m = /^\[(\w+)\]$/.exec(p);
    if (m) return ':' + m[1];
    if (/[[\]:*]/.test(p)) throw new Error(`[nev] Invalid file name segment "${p}" in "${rel}"`);
    return p;
  });
  return '/' + segs.join('/');
}

function layoutsFor(root, pagesDir, rel) {
  const dirs = posix(path.dirname(rel)) === '.' ? [] : posix(path.dirname(rel)).split('/');
  const out = [];
  let current = '';
  for (let i = -1; i < dirs.length; i++) {
    if (i >= 0) current = current ? `${current}/${dirs[i]}` : dirs[i];
    for (const ext of ['js', 'mjs']) {
      const relLayout = current ? `${current}/_layout.${ext}` : `_layout.${ext}`;
      const abs = path.join(pagesDir, relLayout);
      if (fs.existsSync(abs)) {
        out.push({ file: abs, url: appUrl(path.join('pages', relLayout)) });
        break;
      }
    }
  }
  return out;
}

export function scanPages(root) {
  const pagesDir = path.join(root, 'pages');
  const routes = [];
  const seen = new Map();
  let notFound = null;
  let error = null;

  for (const rel of walk(pagesDir)) {
    if (!EXT.test(rel) || SERVER.test(rel)) continue;
    const base = path.basename(rel);
    const abs = path.join(pagesDir, rel);

    if (base.startsWith('_')) {
      if (path.dirname(rel) !== '.') continue;
      const name = base.replace(EXT, '');
      const layouts = layoutsFor(root, pagesDir, rel);
      if (name === '_404') notFound = { file: abs, url: appUrl(path.join('pages', rel)), layouts };
      if (name === '_error') error = { file: abs, url: appUrl(path.join('pages', rel)), layouts };
      continue;
    }
    if (path.dirname(rel).split(path.sep).some((d) => d.startsWith('_'))) continue;

    const pattern = fileToPattern(rel);
    if (seen.has(pattern)) {
      throw new Error(`[nev] Two pages map to "${pattern}": ${seen.get(pattern)} and ${rel}`);
    }
    seen.set(pattern, rel);

    const serverRel = rel.replace(EXT, (m) => `.server${m}`);
    const serverAbs = path.join(pagesDir, serverRel);
    routes.push({
      kind: 'page',
      pattern,
      segs: compile(pattern),
      file: abs,
      url: appUrl(path.join('pages', rel)),
      serverFile: fs.existsSync(serverAbs) ? serverAbs : null,
      layouts: layoutsFor(root, pagesDir, rel),
    });
  }
  return {
    routes: sortRoutes(routes, (r) => r.pattern),
    notFound,
    error,
    rootLayouts: layoutsFor(root, pagesDir, '_root.js'),
  };
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

export function scanApi(root) {
  const apiDir = path.join(root, 'api');
  const routes = [];
  const seen = new Map();
  for (const rel of walk(apiDir)) {
    if (!EXT.test(rel) || path.basename(rel).startsWith('_')) continue;
    if (SERVER.test(rel)) continue;
    const pattern = '/api' + (fileToPattern(rel) === '/' ? '' : fileToPattern(rel));
    if (seen.has(pattern)) throw new Error(`[nev] Two API files map to "${pattern}": ${seen.get(pattern)} and ${rel}`);
    seen.set(pattern, rel);
    routes.push({ kind: 'api', pattern, segs: compile(pattern), file: path.join(apiDir, rel), mod: null });
  }
  return sortRoutes(routes, (r) => r.pattern);
}

export { METHODS };

export function fillPattern(pattern, params) {
  const segs = pattern.split('/').filter(Boolean).map((seg) => {
    const name = seg.slice(1);
    if (seg[0] !== ':' && seg[0] !== '*') return seg;
    const value = params?.[name];
    if (value == null || value === '') throw new Error(`missing param "${name}" for ${pattern}`);
    const text = String(value);
    return seg[0] === '*' ? text.split('/').map(encodeURIComponent).join('/') : encodeURIComponent(text);
  });
  return '/' + segs.join('/');
}

/**
 * Dynamic pages can list their URLs in `pages/.../x.server.js` with
 * `export async function staticPaths() { return [{ slug: 'a' }, { slug: 'b' }]; }`
 * (or return ready-made path strings). Used by `nev export` and sitemap.xml.
 */
export async function collectStaticPaths(pages, warn = () => {}) {
  const out = [];
  for (const route of pages.routes) {
    if (!/[:*]/.test(route.pattern) || !route.serverFile) continue;
    let mod;
    try {
      mod = await import(pathToFileURL(route.serverFile).href);
    } catch (err) {
      warn(`${route.pattern}: could not load ${path.basename(route.serverFile)} (${err.message})`);
      continue;
    }
    if (typeof mod.staticPaths !== 'function') continue;
    let list;
    try {
      list = await mod.staticPaths();
    } catch (err) {
      warn(`${route.pattern}: staticPaths() threw (${err.message})`);
      continue;
    }
    for (const item of Array.isArray(list) ? list : []) {
      try {
        out.push(typeof item === 'string' ? item : fillPattern(route.pattern, item));
      } catch (err) {
        warn(`${route.pattern}: skipped an entry from staticPaths() (${err.message})`);
      }
    }
  }
  return out.filter((x) => typeof x === 'string' && x.startsWith('/') && !x.startsWith('//'));
}
