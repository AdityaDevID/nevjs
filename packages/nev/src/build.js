// `nev build --target vercel` — produce a Vercel "Build Output API v3" folder (.vercel/output) from a Nev project.
//
//   .vercel/output/config.json                    filesystem first (CDN: public/, /__nev/*), everything else → the function
//   .vercel/output/static/…                       public/, framework client files, app modules, browser packages
//   .vercel/output/functions/index.func/          Node function: app/ (your project) + node_modules (production closure) + index.mjs
//
// Deploy with `vercel deploy --prebuilt` (or `vercel build` is not needed — this IS the build).
// Environment variables are read from the platform (process.env); .env files are NOT copied into the function.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createNev } from './server.js';
import { copyFiltered } from './export.js';

const ASSET_EXT = /\.(?:m?js|css|json|svg|png|jpe?g|gif|webp|avif|ico|woff2?|txt)$/i;
const SERVER_FILE = /\.server\.m?js$/;
const toPosix = (p) => p.split(path.sep).join('/');
const SKIP_APP = new Set(['node_modules', '.git', '.vercel', '.netlify', 'out', '.scratch']);

/** Directory of an installed package, found by walking up node_modules from `from` (symlinks resolved). */
export function findPackageDir(name, from) {
  let dir = path.resolve(from);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...name.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** All production packages needed to run `deps`: [{ name, dir }] (dependencies + optionalDependencies, transitively). */
export function productionClosure(deps, from) {
  const seen = new Map();
  const queue = deps.map((name) => ({ name, from }));
  const missing = [];
  while (queue.length) {
    const { name, from: base } = queue.shift();
    if (seen.has(name)) continue;
    const dir = findPackageDir(name, base);
    if (!dir) {
      missing.push(name);
      continue;
    }
    seen.set(name, dir);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) queue.push({ name: dep, from: dir });
  }
  return { packages: [...seen].map(([name, dir]) => ({ name, dir })), missing };
}

function copyTree(src, dest, skip = () => false) {
  let count = 0;
  const walk = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (skip(entry.name, from)) continue;
      const a = path.join(from, entry.name);
      const b = path.join(to, entry.name);
      const stat = entry.isSymbolicLink() ? fs.statSync(a) : null;
      if (entry.isDirectory() || stat?.isDirectory()) walk(a, b);
      else if (entry.isFile() || stat?.isFile()) {
        fs.copyFileSync(a, b);
        count++;
      }
    }
  };
  walk(src, dest);
  return count;
}

export async function buildVercel(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const out = path.resolve(options.out ?? path.join(root, '.vercel', 'output'));
  const nodeVersion = options.nodeVersion ?? 'nodejs22.x';
  if (out === root || root.startsWith(out + path.sep)) throw new Error('The output folder cannot be the project folder or one of its parents');

  const nev = await createNev({ root, silent: true, env: false, config: options.config });
  const pkgFile = path.join(root, 'package.json');
  if (!fs.existsSync(pkgFile)) throw new Error('package.json not found — a Vercel build needs it to know which dependencies to bundle');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies });
  for (const must of ['@adityadevid/nevjs', '@adityadevid/nevb', '@adityadevid/nevf']) if (!deps.includes(must)) deps.push(must);

  fs.rmSync(out, { recursive: true, force: true });
  const staticDir = path.join(out, 'static');
  const fnDir = path.join(out, 'functions', 'index.func');
  fs.mkdirSync(staticDir, { recursive: true });
  fs.mkdirSync(fnDir, { recursive: true });

  const result = { out, static: 0, appFiles: 0, packages: [], warnings: [] };

  // 1. static assets (served by Vercel's CDN before the function runs)
  result.static += copyFiltered(path.join(root, 'public'), staticDir, () => true);
  for (const dir of nev.config.clientDirs) {
    result.static += copyFiltered(path.join(root, dir), path.join(staticDir, '__nev', 'app', dir), (rel) => ASSET_EXT.test(rel) && !SERVER_FILE.test(rel));
  }
  result.static += copyFiltered(nev.clientDir, path.join(staticDir, '__nev'), (rel) => /\.js$/.test(rel));
  for (const p of nev.packages) result.static += copyFiltered(p.dir, path.join(staticDir, p.prefix.replace(/^\//, '')), p.filter ?? ((rel) => /\.m?js$/.test(rel)));

  // 2. the function: project files + production dependencies
  const isEnv = (name) => /^\.env(\.|$)/.test(name);
  result.appFiles = copyTree(root, path.join(fnDir, 'app'), (name, from) => SKIP_APP.has(name) || isEnv(name) || (from === root && name === path.basename(out) && out.startsWith(root + path.sep)));
  const { packages, missing } = productionClosure(deps, root);
  for (const name of missing) result.warnings.push(`dependency "${name}" is not installed — run \`npm install\` first`);
  for (const p of packages) {
    copyTree(p.dir, path.join(fnDir, 'node_modules', ...p.name.split('/')), (name) => name === 'node_modules' || name === 'test' || name === '.git');
    result.packages.push(p.name);
  }
  fs.writeFileSync(
    path.join(fnDir, 'package.json'),
    JSON.stringify({ type: 'module', private: true }, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(fnDir, 'index.mjs'),
    `// Generated by \`nev build --target vercel\` — do not edit.
import { createNodeHandler } from '@adityadevid/nevb';
import { createNev } from '@adityadevid/nevjs';

const root = new URL('./app/', import.meta.url).pathname;
const nev = await createNev({ root, silent: false, env: false });
export default createNodeHandler(nev.app);
`,
  );
  fs.writeFileSync(
    path.join(fnDir, '.vc-config.json'),
    JSON.stringify({ runtime: nodeVersion, handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false }, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(out, 'config.json'),
    JSON.stringify({ version: 3, routes: [{ handle: 'filesystem' }, { src: '/(.*)', dest: '/index' }] }, null, 2) + '\n',
  );
  return result;
}
