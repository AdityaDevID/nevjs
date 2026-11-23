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
  browserPackages: ['nevg'], // extra packages importable in the browser ('nevf' is always available)
  port: 3000,
  setup: null, // (app) => void — add your own middleware/routes before Nev's
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
