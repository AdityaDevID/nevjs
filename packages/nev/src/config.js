import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Identity helper that gives editors autocomplete in nev.config.js */
export const defineConfig = (config) => config;

const DEFAULTS = {
  title: 'Nev App',
  titleTemplate: '%s', // e.g. '%s · My Site'
  lang: 'en',
  head: { meta: [], links: [], scripts: [] }, // added to every page <head>
  clientDirs: ['pages', 'components', 'lib', 'shared'], // folders the browser may import from
  browserPackages: ['@adityadevid/nevg'], // extra packages importable in the browser ('@adityadevid/nevf' is always available)
  port: 3000,
  setup: null, // (app) => void — add your own middleware/routes before Nev's
  site: null, // 'https://example.com' → enables /sitemap.xml + /robots.txt (and absolute URLs in the sitemap)
  sitemapPaths: null, // extra sitemap URLs (array or async fn) — dynamic pages like /blog/:slug
  export: {}, // nev export: { out: 'out', paths: [...] | async fn, crawl: true }
};

/** Load <root>/nev.config.js (optional) and merge it over the defaults. */
export async function loadConfig(root, overrides = {}) {
  let user = {};
  for (const name of ['nev.config.js', 'nev.config.mjs']) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) {
      const mod = await import(pathToFileURL(file).href);
      user = mod.default ?? mod;
      break;
    }
  }
  const merged = { ...DEFAULTS, ...user, ...overrides };
  merged.head = { ...DEFAULTS.head, ...(user.head ?? {}), ...(overrides.head ?? {}) };
  return merged;
}
