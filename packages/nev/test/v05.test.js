import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createNev, startServer, exportSite, buildNetlify, redirectsFile, headersFile } from '../src/index.js';
import { makeApp, cleanup } from './helpers.js';

after(cleanup);

const page = `import { h } from '@adityadevid/nevf';
export default (p) => h('main', null, 'BODY ' + JSON.stringify(p.data) + ' ' + (p.error ? 'ERR ' + p.error.status : ''));`;

async function readChunks(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  return {
    next: async () => {
      const { value, done } = await reader.read();
      return done ? null : dec.decode(value);
    },
    all: async () => {
      let out = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return out;
        out += dec.decode(value);
      }
    },
  };
}

describe('streaming SSR', () => {
  const gate = () => {
    let release;
    globalThis.__nevGate = new Promise((r) => (release = r));
    return release;
  };

  const app = (extraServer = '', head = "export const head = { title: 'Streamed', description: 'early' };") =>
    makeApp({
      'pages/index.js': page + '\n' + head,
      'pages/index.server.js': `export const streaming = true;
        export const load = async () => { await globalThis.__nevGate; return { ok: 1 }; };${extraServer}`,
      'pages/buffered.js': page,
      'pages/buffered.server.js': `export const load = async () => { await globalThis.__nevGate; return { ok: 2 }; };`,
    });

  test('loader is awaited before streaming starts (real status); head and body are still separate chunks', async () => {
    const release = gate();
    const nev = await createNev({ root: app(), silent: true });
    // Do not await the request yet: the loader is awaited server-side before
    // any byte/status is produced, so the response only arrives after release.
    const pending = nev.app.request('/');
    release();
    const res = await pending;
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const chunks = await readChunks(res);
    const first = await chunks.next();
    assert.match(first, /<title>Streamed<\/title>/);
    assert.match(first, /name="description" content="early"/);
    assert.match(first, /rel="modulepreload"/);
    assert.ok(!first.includes('BODY'), 'head chunk does not contain the body');
    const rest = await chunks.all();
    assert.match(rest, /BODY \{"ok":1\}/);
    assert.match(rest, /id="__NEV_DATA__"/);
    assert.match(rest, /<\/html>/);
  });

  test('pages without streaming stay buffered (same status/body as before)', async () => {
    const release = gate();
    release();
    const nev = await createNev({ root: app(), silent: true });
    const res = await nev.app.request('/buffered');
    assert.match(await res.text(), /BODY \{"ok":2\}/);
  });

  test('head() that depends on data falls back to the buffered path', async () => {
    const release = gate();
    release();
    const nev = await createNev({ root: app('', "export const head = (p) => ({ title: 'T ' + p.data?.ok });"), silent: true });
    const html = await (await nev.app.request('/')).text();
    assert.match(html, /<title>T 1<\/title>/);
  });

  test('a streamed loader redirect is a real HTTP redirect (loader runs before streaming)', async () => {
    const r = makeApp({
      'pages/index.js': page,
      'pages/index.server.js': `import { redirect } from '@adityadevid/nevjs'; export const streaming = true; export const load = () => redirect('/elsewhere?a=1&b=2');`,
    });
    const nev = await createNev({ root: r, silent: true });
    const res = await nev.app.request('/');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/elsewhere?a=1&b=2');
  });

  test('notFound()/errors inside a streamed loader return the real 404/500 status', async () => {
    const nf = makeApp({
      'pages/index.js': page,
      'pages/index.server.js': `import { notFound } from '@adityadevid/nevjs'; export const streaming = true; export const load = () => notFound();`,
    });
    const nfRes = await (await createNev({ root: nf, silent: true })).app.request('/');
    assert.equal(nfRes.status, 404, 'streamed loader 404 must not be masked as 200');
    const html = await nfRes.text();
    assert.match(html, /404/);
    assert.match(html, /__NEV_DATA__/);

    const er = makeApp({
      'pages/index.js': page,
      'pages/index.server.js': `export const streaming = true; export const load = () => { throw new Error('kaboom secret'); };`,
    });
    const erRes = await (await createNev({ root: er, silent: true })).app.request('/');
    assert.equal(erRes.status, 500, 'streamed loader error must not be masked as 200');
    const html2 = await erRes.text();
    assert.ok(!html2.includes('kaboom secret'), 'production never leaks the message');
    assert.match(html2, /500/);
  });

  test('config.streaming turns it on globally; export = false opts a page out; nev export is never streamed', async () => {
    const release = gate();
    release();
    const root = makeApp({
      'pages/index.js': page,
      'pages/index.server.js': `export const load = () => ({ ok: 3 });`,
      'pages/off.js': page,
      'pages/off.server.js': `export const streaming = false; export const load = () => ({ ok: 4 });`,
    });
    const nev = await createNev({ root, silent: true, config: { streaming: true } });
    const on = await readChunks(await nev.app.request('/'));
    const firstChunk = await on.next();
    assert.match(firstChunk, /<!doctype html>/i);
    assert.ok(!firstChunk.includes('BODY'), 'streamed: head and body are separate chunks');
    const off = await readChunks(await nev.app.request('/off'));
    assert.match(await off.next(), /BODY \{"ok":4\}/, 'streaming = false: whole document in one piece');
    const result = await exportSite({ root, out: path.join(root, 'out'), config: { streaming: true } });
    assert.deepEqual(result.errors, []);
    assert.match(fs.readFileSync(path.join(root, 'out', 'index.html'), 'utf8'), /BODY \{"ok":3\}/);
  });

  test('buffered documents now carry modulepreload hints for client, page and layouts', async () => {
    const root = makeApp({
      'pages/_layout.js': `import { h } from '@adityadevid/nevf'; export default (p) => h('div', null, p.children);`,
      'pages/index.js': page,
    });
    const html = await (await (await createNev({ root, silent: true })).app.request('/')).text();
    const hints = [...html.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(hints.includes('/__nev/client.js'));
    assert.ok(hints.some((h) => h.endsWith('/pages/index.js')));
    assert.ok(hints.some((h) => h.endsWith('/pages/_layout.js')));
    assert.ok(html.indexOf('type="importmap"') < html.indexOf('rel="modulepreload"'), 'import map must come first');
  });
});

test('streaming over a real HTTP connection: status/head wait for the slow loader, then chunks stream', async () => {
  const root = makeApp({
    'pages/index.js': page,
    'pages/index.server.js': `export const streaming = true; export const load = async () => { await new Promise((r) => setTimeout(r, 400)); return { slow: true }; };`,
  });
  const srv = await startServer({ root, port: 0, silent: true });
  try {
    const t0 = Date.now();
    const res = await fetch(`http://localhost:${srv.port}/`);
    const reader = res.body.getReader();
    const first = await reader.read();
    const tFirst = Date.now() - t0;
    let rest = '';
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += dec.decode(value);
    }
    const tDone = Date.now() - t0;
    const firstText = new TextDecoder().decode(first.value);
    assert.match(firstText, /<title>/);
    assert.match(firstText + rest, /"slow":true/, 'head and body chunks together carry the loader data');
    // The loader is awaited before streaming starts (so failures get a real
    // status), therefore the first chunk cannot beat the 400ms loader.
    assert.ok(tFirst >= 300, `first chunk took ${tFirst}ms — it must wait for the loader`);
    assert.ok(tDone >= 380, `whole page took ${tDone}ms`);
  } finally {
    await new Promise((r) => srv.server.close(r));
  }
});

describe('static host targets', () => {
  const config = {
    redirects: [
      { source: '/old/:id', destination: '/new/:id', permanent: true },
      { source: '/docs/*', destination: '/guide/*rest' },
      { source: '/x', destination: 'https://example.com/', statusCode: 302 },
    ],
    headers: [
      { source: '/*', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] },
      { source: '/assets/*', headers: { 'Cache-Control': 'public, max-age=31536000' } },
    ],
  };

  test('redirectsFile / headersFile translate the config', () => {
    assert.equal(redirectsFile(config), '/old/:id /new/:id 308\n/docs/* /guide/:splat 307\n/x https://example.com/ 302\n');
    assert.equal(headersFile(config), '/*\n  X-Frame-Options: DENY\n\n/assets/*\n  Cache-Control: public, max-age=31536000\n');
    assert.equal(redirectsFile({}), '');
  });

  test('nev export --target writes _redirects and _headers; unknown target rejected; none by default', async () => {
    const root = makeApp({ 'pages/index.js': page });
    const out = path.join(root, 'out');
    await exportSite({ root, out, config, target: 'netlify' });
    assert.ok(fs.existsSync(path.join(out, '_redirects')));
    assert.match(fs.readFileSync(path.join(out, '_headers'), 'utf8'), /X-Frame-Options: DENY/);
    await exportSite({ root, out, config, target: 'cloudflare' });
    assert.ok(fs.existsSync(path.join(out, '_redirects')));
    await exportSite({ root, out, config });
    assert.ok(!fs.existsSync(path.join(out, '_redirects')), 'only written when a target is chosen');
    await assert.rejects(exportSite({ root, out, target: 'heroku' }), /Unknown export target/);
  });

  test('CLI: build --target cloudflare explains why and points to export', () => {
    const root = makeApp({ 'pages/index.js': page });
    const bin = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'bin', 'nev.js');
    const r = spawnSync(process.execPath, [bin, 'build', root, '--target', 'cloudflare'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /nev export --target cloudflare/);
  });
});

test('nev build --target netlify: self-contained Functions v2 handler serves pages + APIs from a different folder', async () => {
  const root = makeApp({
    'package.json': JSON.stringify({ name: 'x', type: 'module', dependencies: { '@adityadevid/nevjs': '*', '@adityadevid/nevf': '*' } }),
    'pages/index.js': `import { h } from '@adityadevid/nevf'; export default () => h('main', null, 'hello netlify');`,
    'api/ping.js': 'export const get = () => ({ pong: true, secret: process.env.NEVT_NETLIFY_SECRET ?? null })',
    'public/robots.txt': 'User-agent: *',
    '.env': 'NEVT_NETLIFY_SECRET=must-not-ship',
  });
  const r = await buildNetlify({ root });
  assert.deepEqual(r.warnings, []);
  const out = path.join(root, '.nev', 'netlify');
  assert.match(fs.readFileSync(path.join(out, 'netlify.toml'), 'utf8'), /publish = "publish"/);
  assert.ok(fs.existsSync(path.join(out, 'publish', 'robots.txt')));
  assert.ok(fs.existsSync(path.join(out, 'publish', '__nev', 'client.js')));
  const fn = path.join(out, 'functions', 'nev');
  assert.match(fs.readFileSync(path.join(fn, 'nev.mjs'), 'utf8'), /path: '\/\*', preferStatic: true/);
  assert.ok(!fs.existsSync(path.join(fn, 'app', '.env')));
  assert.ok(!fs.existsSync(path.join(fn, 'app', '.nev')), 'no recursive copy of the output');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nev-netlify-'));
  try {
    fs.cpSync(fn, path.join(tmp, 'fn'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'run.mjs'),
      `const mod = await import('./fn/nev.mjs');
       const call = async (p) => { const r = await mod.default(new Request('http://x' + p), {}); return { status: r.status, text: await r.text() }; };
       console.log('RESULT=' + JSON.stringify({ config: mod.config, home: await call('/'), api: await call('/api/ping'), nope: await call('/nope') }));
       process.exit(0);`,
    );
    const child = spawn(process.execPath, [path.join(tmp, 'run.mjs')], { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    await new Promise((resolve) => child.on('exit', resolve));
    const m = /RESULT=(.*)/.exec(stdout);
    assert.ok(m, `function did not run: ${stderr}`);
    const res = JSON.parse(m[1]);
    assert.deepEqual(res.config, { path: '/*', preferStatic: true });
    assert.match(res.home.text, /hello netlify/);
    assert.deepEqual(JSON.parse(res.api.text), { pong: true, secret: null });
    assert.equal(res.nope.status, 404);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
