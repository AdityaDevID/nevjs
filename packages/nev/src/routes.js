// Turn the folder structure into route tables.
//
//   pages/index.js            →  /
//   pages/about.js            →  /about
//   pages/blog/index.js       →  /blog
//   pages/blog/[slug].js      →  /blog/:slug
//   pages/docs/[...path].js   →  /docs/*path
//   pages/_layout.js          →  wraps every page below it (nested folders nest layouts)
//   pages/_404.js, _error.js  →  special pages
//   pages/blog/[slug].server.js → { load(c) } — runs ONLY on the server (never sent to browsers)
//
//   api/hello.js              →  /api/hello       exports get/post/put/patch/del/all (+ optional middleware[])
//   api/users/[id].js         →  /api/users/:id

import fs from 'node:fs';
import path from 'node:path';
import { compile } from '@adityadevid/nevb';
import { sortRoutes } from '@adityadevid/nevf';

const EXT = /\.(?:m?js)$/;
const SERVER = /\.server\.m?js$/;

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

/** 'blog/[slug].js' → '/blog/:slug' */
export function fileToPattern(rel) {
  const parts = posix(rel).replace(EXT, '').split('/');
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
      if (path.dirname(rel) !== '.') continue; // _404 / _error only at the pages root
      const name = base.replace(EXT, '');
      const layouts = layoutsFor(root, pagesDir, rel);
      if (name === '_404') notFound = { file: abs, url: appUrl(path.join('pages', rel)), layouts };
      if (name === '_error') error = { file: abs, url: appUrl(path.join('pages', rel)), layouts };
      continue;
    }
    if (path.dirname(rel).split(path.sep).some((d) => d.startsWith('_'))) continue; // private folders

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
    rootLayouts: layoutsFor(root, pagesDir, '_root.js'), // layouts that wrap the built-in 404/error pages
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
