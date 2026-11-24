import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
const binFile = path.join(here, '..', 'bin', 'nev.js');
const templatesDir = path.join(here, '..', 'templates');

const HELP = `
Nev.js ${pkg.version} — zero-build fullstack framework

Usage:
  nev create <folder> [--template default|api|game|game3d]   Create a new project
  nev dev [folder] [--port 3000] [--host H]  Start with auto-restart + browser live reload
  nev start [folder] [--port 3000] [--host H]  Start in production mode
  nev routes [folder]                        Print the page and API routes
  nev export [folder] [--out out]            Render every page to static HTML (GitHub Pages, Netlify, S3, …)
  nev build [folder] --target vercel         Build for Vercel (.vercel/output, then: vercel deploy --prebuilt)
  nev info [folder]                          Show versions, routes, .env files and config summary (paste it in bug reports)

Environment: PORT overrides the configured port.
`;

const COMMANDS = ['create', 'dev', 'start', 'routes', 'export', 'build', 'info', 'help'];

export function suggest(input, names = COMMANDS) {
  const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  let best = null;
  let bestD = 3;
  for (const n of names) {
    const x = dist(String(input).toLowerCase(), n);
    if (x < bestD) { best = n; bestD = x; }
  }
  return best;
}

export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  const valued = new Set(['port', 'p', 'host', 'template', 'out', 'o', 'target']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') || (a.startsWith('-') && a.length === 2)) {
      let [key, value] = a.replace(/^-+/, '').split('=');
      if (key === 'p') key = 'port';
      if (key === 'o') key = 'out';
      if (value === undefined && valued.has(key)) {
        value = argv[++i];
        if (value === undefined) throw new Error(`Missing value for --${key}`);
      }
      flags[key] = value === undefined ? true : value;
    } else positional.push(a);
  }
  return { flags, positional };
}

function parsePort(value) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`Invalid port: ${value}`);
  return n;
}

function copyDir(src, dest, vars) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name.startsWith('_') && /^_(gitignore|dockerignore|npmrc|env\.example)$/.test(entry.name) ? '.' + entry.name.slice(1) : entry.name);
    if (entry.isDirectory()) copyDir(from, to, vars);
    else if (/\.(json|md)$/.test(entry.name)) {
      let text = fs.readFileSync(from, 'utf8');
      for (const [k, v] of Object.entries(vars)) text = text.split(`{{${k}}}`).join(v);
      fs.writeFileSync(to, text);
    } else fs.copyFileSync(from, to);
  }
}

export function create(target, template = 'default') {
  if (!target) throw new Error('Usage: nev create <folder>');
  const src = path.join(templatesDir, template);
  if (!fs.existsSync(src)) {
    const names = fs.readdirSync(templatesDir).join(', ');
    throw new Error(`Unknown template "${template}". Available: ${names}`);
  }
  const dest = path.resolve(target);
  if (fs.existsSync(dest) && fs.readdirSync(dest).length) throw new Error(`Folder "${target}" already exists and is not empty`);
  const name = path.basename(dest).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+/, '') || 'nev-app';
  copyDir(src, dest, { name });
  const rel = path.relative(process.cwd(), dest) || '.';
  console.log(`\n  Created ${name} in ${rel}\n\n  Next:\n    cd ${rel}\n    npm install\n    npm run dev\n`);
  return dest;
}

function printRoutes(nev) {
  const rows = [
    ...nev.pages.routes.map((r) => ['page', r.pattern, path.relative(nev.root, r.file) + (r.serverFile ? '  (+ loader)' : '')]),
    ...nev.api.map((r) => ['api ', r.pattern, path.relative(nev.root, r.file)]),
  ];
  const w = Math.max(5, ...rows.map((r) => r[1].length));
  for (const [kind, pattern, file] of rows) console.log(`  ${kind}  ${pattern.padEnd(w)}  ${file}`);
  if (!rows.length) console.log('  (no routes — add files to pages/ or api/)');
}

async function start(root, flags, { dev }) {
  const { startServer } = await import('./server.js');
  const port = parsePort(flags.port ?? process.env.PORT);
  const nev = await startServer({ root, dev, port, host: flags.host === true ? undefined : flags.host });
  const host = flags.host && flags.host !== true ? flags.host : 'localhost';
  console.log(`\n  Nev ${dev ? 'dev server' : 'server'} ready → http://${host}:${nev.port}\n`);
  const shutdown = () => {
    nev.server.close(() => process.exit(0));
    nev.server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

function supervise(root, argv) {
  let child = null;
  let timer = null;
  let stopping = false;
  let crashed = false;

  const launch = () => {
    crashed = false;
    child = spawn(process.execPath, [binFile, 'start', '--dev', ...argv], { stdio: 'inherit', env: process.env });
    child.on('exit', (code, signal) => {
      if (stopping || signal === 'SIGTERM') return;
      crashed = true;
      console.error(`\n  [nev] server exited (${code ?? signal}). Waiting for a file change to restart…\n`);
    });
  };

  const restart = () => {
    const old = child;
    const go = () => {
      console.log('  [nev] change detected — restarting…');
      launch();
    };
    if (old && old.exitCode === null && old.signalCode === null) {
      old.once('exit', go);
      old.kill('SIGTERM');
    } else go();
  };

  const ignored = (file) => !file || /(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(file) || /(^|[\\/])\.[^\\/]*$/.test(file);
  let watcher;
  try {
    watcher = fs.watch(root, { recursive: true }, (_event, file) => {
      if (ignored(file)) return;
      clearTimeout(timer);
      timer = setTimeout(restart, 150);
    });
  } catch (err) {
    console.warn('  [nev] file watching is unavailable here; restart manually after edits.', err.message);
  }

  const stop = () => {
    stopping = true;
    watcher?.close();
    if (child && child.exitCode === null) {
      child.once('exit', () => process.exit(0));
      child.kill('SIGTERM');
      setTimeout(() => process.exit(0), 2000).unref();
    } else process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  launch();
}

export async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }
  if (command === '--version' || command === '-v') {
    console.log(pkg.version);
    return;
  }
  const { flags, positional } = parseArgs(rest);
  const root = path.resolve(positional[0] ?? '.');

  switch (command) {
    case 'create':
      create(positional[0], typeof flags.template === 'string' ? flags.template : 'default');
      return;
    case 'dev':
      return supervise(root, rest);
    case 'start':
      return start(root, flags, { dev: !!flags.dev });
    case 'routes': {
      const { createNev } = await import('./server.js');
      printRoutes(await createNev({ root, silent: true }));
      return;
    }
    case 'build': {
      const target = typeof flags.target === 'string' ? flags.target : 'vercel';
      if (target !== 'vercel') throw new Error(`Unknown --target "${target}". Available: vercel`);
      const { buildVercel } = await import('./build.js');
      const r = await buildVercel({ root, out: typeof flags.out === 'string' ? flags.out : undefined });
      for (const w of r.warnings) console.log(`  ! ${w}`);
      console.log(`\n  Built for Vercel → ${path.relative(process.cwd(), r.out) || '.'}\n  ${r.static} static files, ${r.appFiles} app files, ${r.packages.length} packages in the function\n  Deploy: npx vercel deploy --prebuilt   (set your env vars in the Vercel dashboard)\n`);
      if (r.warnings.length) process.exitCode = 1;
      return;
    }
    case 'info': {
      const { createNev } = await import('./server.js');
      const { envFiles, PUBLIC_PREFIX } = await import('./env.js');
      const nev = await createNev({ root, silent: true, env: false });
      const found = envFiles(process.env.NODE_ENV ?? 'production').filter((f) => fs.existsSync(path.join(root, f)));
      console.log(`
  Nev.js        ${pkg.version}
  Node          ${process.version}  (${process.platform}/${process.arch})
  Project       ${root}
  Pages         ${nev.pages.routes.length}   API routes ${nev.api.length}
  Layouts       ${new Set(nev.pages.routes.flatMap((r) => r.layouts.map((l) => l.file))).size}
  .env files    ${found.length ? found.join(', ') : '(none)'}   (browser sees only ${PUBLIC_PREFIX}*)
  Site          ${nev.config.site ?? '(not set — no sitemap.xml/robots.txt)'}
  Redirects     ${nev.config.redirects.length}   Headers rules ${nev.config.headers.length}   trailingSlash ${nev.config.trailingSlash}
  Middleware    ${['middleware.js', 'middleware.mjs'].some((f) => fs.existsSync(path.join(root, f))) ? 'yes' : 'no'}
`);
      return;
    }
    case 'export': {
      const { exportSite } = await import('./export.js');
      const result = await exportSite({ root, out: typeof flags.out === 'string' ? flags.out : undefined, crawl: flags['no-crawl'] ? false : undefined });
      for (const p of result.pages) console.log(`  ✓ ${p}`);
      for (const w of result.warnings) console.log(`  ! ${w}`);
      for (const e of result.errors) console.error(`  ✗ ${e.path}  ${e.message}`);
      console.log(`\n  Exported ${result.pages.length} page${result.pages.length === 1 ? '' : 's'} (${result.files} files) → ${path.relative(process.cwd(), result.out) || '.'}`);
      console.log('  Serve it from the root of a domain (e.g. `npx serve out`). API routes are not part of a static export.\n');
      if (result.errors.length) process.exitCode = 1;
      return;
    }
    default:
      console.error(`Unknown command "${command}".${suggest(command) ? ` Did you mean "nev ${suggest(command)}"?` : ''}`);
      console.log(HELP);
      process.exitCode = 1;
  }
}
