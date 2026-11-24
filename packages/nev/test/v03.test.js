import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNev, createHandler, parseEnv, loadEnv, fileToPattern, expandHead, notFound } from '../src/index.js';
import { fillDestination } from '../src/rules.js';
import { makeApp, cleanup } from './helpers.js';

after(cleanup);
const page = (text) => `import { h } from '@adityadevid/nevf'; export default () => h('main', null, ${JSON.stringify(text)});`;
const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'nev.js');

describe('.env', () => {
  test('parseEnv: comments, quotes, export, expansion, multi-line', () => {
    const env = parseEnv(`# comment
A=1
export B = two  # trailing
C="line1\\nline2"
D='raw \${A}'
E="has \${A}"
F=\${A}\${B}
G="multi
line"
bad line
`);
    assert.deepEqual(env, { A: '1', B: 'two', C: 'line1\nline2', D: 'raw ${A}', E: 'has 1', F: '1two', G: 'multi\nline' });
  });

  test('precedence: process.env > .env.<mode>.local > .env.local > .env.<mode> > .env; test mode skips .env.local', () => {
    const keys = ['NEVT_A', 'NEVT_B', 'NEVT_C', 'NEVT_D', 'NEV_PUBLIC_NEVT'];
    for (const k of keys) delete process.env[k];
    process.env.NEVT_D = 'real';
    const root = makeApp({
      '.env': 'NEVT_A=base\nNEVT_B=base\nNEVT_C=base\nNEVT_D=base\nNEV_PUBLIC_NEVT=pub',
      '.env.local': 'NEVT_B=local\nNEVT_C=local',
      '.env.production': 'NEVT_C=prod',
      '.env.production.local': 'NEVT_C=prodlocal',
    });
    try {
      const r = loadEnv(root, { mode: 'production' });
      assert.equal(process.env.NEVT_A, 'base');
      assert.equal(process.env.NEVT_B, 'local');
      assert.equal(process.env.NEVT_C, 'prodlocal');
      assert.equal(process.env.NEVT_D, 'real', 'real environment always wins');
      assert.equal(r.public.NEV_PUBLIC_NEVT, 'pub');
      assert.equal(r.public.NEVT_A, undefined, 'non-public variables are never public');
      for (const k of keys) delete process.env[k];
      loadEnv(root, { mode: 'test' });
      assert.equal(process.env.NEVT_B, 'base', '.env.local is skipped in test mode');
    } finally {
      for (const k of keys) delete process.env[k];
    }
  });

  test('server: secrets stay on the server, NEV_PUBLIC_* reaches SSR + boot data', async () => {
    delete process.env.NEVT_SECRET;
    delete process.env.NEV_PUBLIC_NEVT_SITE;
    const root = makeApp({
      '.env': 'NEVT_SECRET=hunter2\nNEV_PUBLIC_NEVT_SITE=hello-public',
      'pages/index.js': `import { h, publicEnv } from '@adityadevid/nevf'; export default () => h('p', null, publicEnv('NEV_PUBLIC_NEVT_SITE', 'none'), '|', publicEnv('NEVT_SECRET', 'hidden'));`,
      'api/who.js': 'export const get = () => ({ secret: process.env.NEVT_SECRET });',
    });
    try {
      const { app } = await createNev({ root, silent: true });
      const html = await (await app.request('/')).text();
      assert.match(html, /hello-public\|hidden/);
      assert.ok(!html.includes('hunter2'), 'secret must never be in HTML');
      assert.deepEqual(await (await app.request('/api/who')).json(), { secret: 'hunter2' });
      assert.equal((await app.request('/__nev/app/.env')).status, 404);
    } finally {
      delete process.env.NEVT_SECRET;
      delete process.env.NEV_PUBLIC_NEVT_SITE;
    }
  });
});

describe('route groups', () => {
  test('fileToPattern ignores (group) folders', () => {
    assert.equal(fileToPattern('(shop)/cart.js'), '/cart');
    assert.equal(fileToPattern('(marketing)/index.js'), '/');
    assert.equal(fileToPattern('(a)/(b)/blog/[slug].js'), '/blog/:slug');
  });

  test('groups share layouts without changing URLs; duplicates are reported', async () => {
    const root = makeApp({
      'pages/_layout.js': `import { h } from '@adityadevid/nevf'; export default (p) => h('div', { id: 'root' }, p.children);`,
      'pages/(shop)/_layout.js': `import { h } from '@adityadevid/nevf'; export default (p) => h('section', { id: 'shop' }, p.children);`,
      'pages/(shop)/cart.js': page('cart'),
      'pages/(shop)/index.js': page('home'),
      'pages/about.js': page('about'),
    });
    const { app, pages } = await createNev({ root, silent: true });
    assert.deepEqual(pages.routes.map((r) => r.pattern).sort(), ['/', '/about', '/cart']);
    const cart = await (await app.request('/cart')).text();
    assert.match(cart, /id="shop"[^>]*>.*cart/s);
    assert.ok(!(await (await app.request('/about')).text()).includes('id="shop"'));
    assert.equal((await app.request('/(shop)/cart')).status, 404);

    const clash = makeApp({ 'pages/(a)/x.js': page('1'), 'pages/x.js': page('2') });
    await assert.rejects(createNev({ root: clash, silent: true }), /Two pages map to "\/x"/);
  });
});

describe('redirects / headers / trailingSlash', () => {
  const files = { 'pages/index.js': page('home'), 'pages/about.js': page('about'), 'api/x.js': 'export const get = () => ({ ok: 1 })' };

  test('redirects: params, splats, query, permanent/temporary, external, no open redirect', async () => {
    const { app } = await createNev({
      root: makeApp(files),
      silent: true,
      config: {
        redirects: [
          { source: '/old/:slug', destination: '/blog/:slug', permanent: true },
          { source: '/docs/*path', destination: 'https://docs.example.com/*path' },
          { source: '/tmp', destination: '/about', statusCode: 301 },
          { source: '/evil/:x', destination: '/:x' },
        ],
      },
    });
    let r = await app.request('/old/hello%20world?ref=1');
    assert.equal(r.status, 308);
    assert.equal(r.headers.get('location'), '/blog/hello%20world?ref=1');
    r = await app.request('/docs/a/b/c');
    assert.equal(r.status, 307);
    assert.equal(r.headers.get('location'), 'https://docs.example.com/a/b/c');
    assert.equal((await app.request('/tmp')).status, 301);
    r = await app.request('/evil/%2Fevil.com');
    assert.ok(!r.headers.get('location').startsWith('//'), r.headers.get('location'));
    assert.equal((await app.request('/about')).status, 200);
  });

  test('headers rules (object and key/value forms) apply to pages and APIs', async () => {
    const { app } = await createNev({
      root: makeApp(files),
      silent: true,
      config: {
        headers: [
          { source: '/api/*', headers: { 'cache-control': 'no-store' } },
          { source: '/*', headers: [{ key: 'x-powered-by-nev', value: 'yes' }] },
        ],
      },
    });
    const api = await app.request('/api/x');
    assert.equal(api.headers.get('cache-control'), 'no-store');
    assert.equal(api.headers.get('x-powered-by-nev'), 'yes');
    assert.equal((await app.request('/about')).headers.get('x-powered-by-nev'), 'yes');
  });

  test('bad rules fail at startup with a clear message', async () => {
    await assert.rejects(createNev({ root: makeApp(files), silent: true, config: { redirects: [{ source: 'x', destination: '/y' }] } }), /redirects\[0\]/);
    await assert.rejects(createNev({ root: makeApp(files), silent: true, config: { redirects: [{ source: '/x', destination: 'javascript:alert(1)' }] } }), /destination/);
    await assert.rejects(createNev({ root: makeApp(files), silent: true, config: { headers: [{ source: '/x', headers: { 'bad name': '1' } }] } }), /invalid header name/);
  });

  test('trailingSlash never/always (pages only — APIs and /__nev untouched)', async () => {
    const never = (await createNev({ root: makeApp(files), silent: true, config: { trailingSlash: 'never' } })).app;
    let r = await never.request('/about/?a=1');
    assert.equal(r.status, 308);
    assert.equal(r.headers.get('location'), '/about?a=1');
    assert.equal((await never.request('/about')).status, 200);
    assert.equal((await never.request('/')).status, 200);
    const always = (await createNev({ root: makeApp(files), silent: true, config: { trailingSlash: 'always' } })).app;
    r = await always.request('/about');
    assert.equal(r.status, 308);
    assert.equal(r.headers.get('location'), '/about/');
    assert.equal((await always.request('/api/x')).status, 200);
    assert.equal((await always.request('/__nev/ping')).status, 200);
  });

  test('fillDestination encodes values', () => {
    assert.equal(fillDestination('/a/:x/*rest', { x: 'a b', rest: 'c/d e' }), '/a/a%20b/c/d%20e');
    assert.equal(fillDestination('https://h:3000/:x', { x: 'k' }), 'https://h:3000/k');
  });
});

describe('head / SEO', () => {
  test('expandHead: description, robots, canonical, openGraph, twitter, jsonLd', () => {
    const out = expandHead(
      {
        description: 'D',
        robots: { index: false },
        canonical: '/p',
        openGraph: { image: '/i.png', siteName: 'S' },
        twitter: {},
        jsonLd: { '@type': 'Article' },
        meta: [{ name: 'x', content: 'y' }],
      },
      { origin: 'https://ex.com', title: 'T' },
    );
    const m = (k, v = 'name') => out.meta.find((x) => x[v] === k)?.content;
    assert.equal(m('description'), 'D');
    assert.equal(m('robots'), 'noindex, follow');
    assert.equal(m('og:title', 'property'), 'T');
    assert.equal(m('og:description', 'property'), 'D');
    assert.equal(m('og:image', 'property'), 'https://ex.com/i.png');
    assert.equal(m('og:url', 'property'), 'https://ex.com/p');
    assert.equal(m('twitter:card'), 'summary_large_image');
    assert.equal(m('twitter:image'), 'https://ex.com/i.png');
    assert.equal(m('x'), 'y');
    assert.deepEqual(out.links, [{ rel: 'canonical', href: 'https://ex.com/p' }]);
    assert.equal(out.jsonLd.length, 1);
    assert.deepEqual(expandHead({}, {}), { meta: [], links: [], jsonLd: [] });
  });

  test('SSR renders tags (tagged data-nev) and JSON-LD cannot break out of the script', async () => {
    const root = makeApp({
      'pages/index.js': `import { h } from '@adityadevid/nevf';
        export const head = () => ({ title: 'Hi', description: 'A "quoted" <b>desc</b>', canonical: '/', openGraph: { title: 'OG' },
          jsonLd: { '@type': 'Thing', name: '</script><script>alert(1)</script>' } });
        export default () => h('main', null, 'x');`,
    });
    const { app } = await createNev({ root, silent: true, config: { site: 'https://ex.com', titleTemplate: '%s · Ex' } });
    const html = await (await app.request('/')).text();
    assert.match(html, /<title>Hi · Ex<\/title>/);
    assert.match(html, /<meta name="description" content="A &quot;quoted&quot; &lt;b&gt;desc&lt;\/b&gt;" data-nev>/);
    assert.match(html, /<link rel="canonical" href="https:\/\/ex\.com\/" data-nev>/);
    assert.match(html, /<meta property="og:title" content="OG" data-nev>/);
    const ld = /<script type="application\/ld\+json" data-nev>(.*?)<\/script>/s.exec(html);
    assert.ok(ld, 'json-ld present');
    assert.ok(!ld[1].includes('<'), 'no raw < inside JSON-LD');
    assert.equal(JSON.parse(ld[1])['@type'], 'Thing');
    assert.equal((html.match(/<script>alert/g) ?? []).length, 0);
  });

  test('head may be a plain object', async () => {
    const root = makeApp({ 'pages/index.js': `import { h } from '@adityadevid/nevf'; export const head = { title: 'Static', description: 'd' }; export default () => h('i');` });
    const html = await (await (await createNev({ root, silent: true })).app.request('/')).text();
    assert.match(html, /<title>Static<\/title>/);
    assert.match(html, /name="description"/);
  });
});

describe('createHandler / notFound / CLI', () => {
  test('createHandler serves Web Requests', async () => {
    const root = makeApp({ 'pages/index.js': page('hi'), 'api/p.js': 'export const get = () => ({ pong: true })' });
    const handler = await createHandler({ root });
    const res = await handler(new Request('http://localhost/api/p'));
    assert.deepEqual(await res.json(), { pong: true });
    assert.match(await (await handler(new Request('http://localhost/'))).text(), /hi/);
    assert.equal((await handler(new Request('http://localhost/nope'))).status, 404);
  });

  test('notFound() in a loader → real 404 page', async () => {
    const root = makeApp({
      'pages/p/[id].js': page('post'),
      'pages/p/[id].server.js': `import { notFound } from '@adityadevid/nevjs'; export const load = (c) => c.params.id === '1' ? { ok: 1 } : notFound();`,
    });
    const { app } = await createNev({ root, silent: true });
    assert.equal((await app.request('/p/1')).status, 200);
    assert.equal((await app.request('/p/2')).status, 404);
  });

  test('`nev info` prints a summary', () => {
    const root = makeApp({ 'pages/index.js': page('x'), '.env': 'A=1', 'nev.config.js': `export default { redirects: [{ source: '/a', destination: '/b' }] }` });
    const r = spawnSync(process.execPath, [bin, 'info', root], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Pages\s+1/);
    assert.match(r.stdout, /\.env files\s+\.env/);
    assert.match(r.stdout, /Redirects\s+1/);
  });
});
