import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const defineConfig = (config) => config;

const DEFAULTS = {
  title: 'Nev App',
  titleTemplate: '%s',
  lang: 'en',
  head: { meta: [], links: [], scripts: [] },
  clientDirs: ['pages', 'components', 'lib', 'shared'],
  browserPackages: ['@adityadevid/nevg'],
  port: 3000,
  setup: null,
  site: null,
  sitemapPaths: null,
  redirects: [],
  headers: [],
  trailingSlash: 'ignore',
  streaming: false,
  csrf: false,
  export: {},
};

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
