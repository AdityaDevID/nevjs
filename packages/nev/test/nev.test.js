import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createNev, fileToPattern, scanPages, scanApi } from '../src/index.js';
import { create, parseArgs } from '../src/cli.js';
import { safeJSON, formatTitle } from '../src/html.js';
import { makeApp, cleanup } from './helpers.js';

after(cleanup);

const json = async (res) => JSON.parse(await res.text());

describe('route scanning', () => {
  test('fileToPattern', () => {
    assert.equal(fileToPattern('index.js'), '/');
    assert.equal(fileToPattern('about.js'), '/about');
    assert.equal(fileToPattern('blog/index.js'), '/blog');
    assert.equal(fileToPattern('blog/[slug].js'), '/blog/:slug');
    assert.equal(fileToPattern('docs/[...path].js'), '/docs/*path');
    assert.equal(fileToPattern('a\\b.js'.replace('\\', '/')), '/a/b');
    assert.throws(() => fileToPattern('we[ird.js'), /Invalid file name/);
  });

  test('scanPages: layouts nest, private files are skipped, specificity order', () => {
    const root = makeApp({
      'pages/_layout.js': 'export default () => null',
      'pages/index.js': 'export default () => null',
      'pages/blog/_layout.js': 'export default () => null',
      'pages/blog/[slug].js': 'export default () => null',
      'pages/blog/[slug].server.js': 'export const load = () => ({})',
      'pages/blog/new.js': 'export default () => null',
      'pages/[...rest].js': 'export default () => null',
      'pages/_private/hidden.js': 'export default () => null',
      'pages/_helper.js': 'export default () => null',
      'pages/_404.js': 'export default () => null',
      'pages/notes.txt': 'ignored',
    });
    const { routes, notFound, error } = scanPages(root);
    assert.deepEqual(routes.map((r) => r.pattern), ['/blog/new', '/blog/:slug', '/', '/*rest']);
    const slug = routes.find((r) => r.pattern === '/blog/:slug');
    assert.equal(slug.layouts.length, 2);
    assert.ok(slug.serverFile.endsWith('[slug].server.js'));
    assert.equal(routes.find((r) => r.pattern === '/').layouts.length, 1);
    assert.ok(notFound);
    assert.equal(error, null);
  });

  test('conflicting pages are reported with both file names', () => {
    const root = makeApp({
      'pages/about.js': 'export default () => null',
      'pages/about/index.js': 'export default () => null',
    });
    assert.throws(() => scanPages(root), /Two pages map to "\/about"/);
  });

  test('scanApi maps files to /api patterns', () => {
    const root = makeApp({
      'api/index.js': '',
      'api/users/[id].js': '',
      'api/_internal.js': '',
      'api/data.server.js': '',
    });
    assert.deepEqual(scanApi(root).map((r) => r.pattern), ['/api/users/:id', '/api']);
  });
});

describe('html helpers', () => {
  test('safeJSON cannot break out of a <script> element', () => {
    const out = safeJSON({ s: '</script><script>alert(1)</script>', amp: '&', ls: ' ' });
    assert.ok(!out.includes('<') && !out.includes('>') && !out.includes(' '));
    assert.deepEqual(JSON.parse(out), { s: '</script><script>alert(1)</script>', amp: '&', ls: ' ' });
  });

  test('formatTitle applies the template only to page titles', () => {
    const cfg = { title: 'Site', titleTemplate: '%s | Site' };
    assert.equal(formatTitle('Page', cfg), 'Page | Site');
    assert.equal(formatTitle(undefined, cfg), 'Site');
    assert.equal(formatTitle('A $& B', { title: 'S', titleTemplate: '%s!' }), 'A $& B!');
  });
});

const appFiles = {
  'nev.config.js': `export default { title: 'T', titleTemplate: '%s · T', head: { links: [{ rel: 'stylesheet', href: '/s.css' }] } }`,
  'pages/_layout.js': `import { h } from 'nevf'; export default (p) => h('div', { class: 'layout' }, p.children)`,
  'pages/index.js': `import { h } from 'nevf'; export const head = () => ({ title: 'Home' }); export default () => h('h1', null, 'Home')`,
  'pages/users/[id].js': `import { h } from 'nevf'; export default (p) => h('p', null, 'user ', p.params.id, ' q=', p.query.q ?? '-', ' data=', p.data.who)`,
  'pages/users/[id].server.js': `export const load = (c) => ({ who: 'server-' + c.params.id })`,
  'pages/xss.js': `import { h } from 'nevf'; export default (p) => h('p', null, p.data.text)`,
  'pages/xss.server.js': `export const load = () => ({ text: '</script><script>alert(1)</script>' })`,
  'pages/secret.js': `import { h } from 'nevf'; export default () => h('p', null, 'secret')`,
  'pages/secret.server.js': `import { redirect } from 'nevjs'; export const load = () => redirect('/login', 303)`,
  'pages/boom.js': `import { h } from 'nevf'; export default () => h('p', null, 'boom')`,
  'pages/boom.server.js': `export const load = () => { throw new Error('db password is hunter2') }`,
  'pages/forbidden.js': `import { h } from 'nevf'; export default () => h('p', null, 'x')`,
  'pages/forbidden.server.js': `import { HttpError } from 'nevjs'; export const load = () => { throw new HttpError(403, 'Members only') }`,
  'pages/missing.js': `import { h } from 'nevf'; export default () => h('p', null, 'x')`,
  'pages/missing.server.js': `import { HttpError } from 'nevjs'; export const load = () => { throw new HttpError(404) }`,
  'pages/render-fail.js': `export default () => { throw new Error('render exploded') }`,
  'pages/docs/[...path].js': `import { h } from 'nevf'; export default (p) => h('p', null, 'docs:', p.params.path)`,
  'pages/cookie.js': `import { h } from 'nevf'; export default () => h('p', null, 'c')`,
  'pages/cookie.server.js': `export const load = (c) => { c.setCookie('seen', '1'); return {} }`,
  'api/echo.js': `
    export const middleware = [(c, next) => { c.header('x-mw', 'yes'); return next() }]
    export const get = (c) => ({ q: c.query })
    export const post = [
      async (c, next) => { if (!(await c.body()).ok) return c.json({ error: 'not ok' }, 400); return next() },
      async (c) => c.json({ got: await c.body() }, 201),
    ]
    export const del = () => new Response(null, { status: 204 })
  `,
  'api/users/[id].js': `export default (c) => ({ id: c.params.id, method: c.method })`,
  'api/throws.js': `export const get = () => { throw new Error('internal detail') }`,
  'lib/util.js': `export const x = 1`,
  'lib/secret.server.js': `export const KEY = 'sk_live_123'`,
  'public/hello.txt': 'hello public',
  'public/index.html': '<h1>should not shadow pages</h1>',
  'components/Widget.js': `export const w = 1`,
  '.env': 'SECRET=1',
  'package.json': '{"name":"x","secret":"yes"}',
};

describe('server: pages, loaders, SSR', async () => {
  const root = makeApp(appFiles);
  const { app } = await createNev({ root, silent: true });
  const prod = app;
  const dev = (await createNev({ root, silent: true, dev: true })).app;
  const get = (p, init) => prod.request(p, init);

  test('SSR renders inside the layout with title, head tags, import map and boot data', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.match(html, /<title>Home · T<\/title>/);
    assert.match(html, /<div id="nev-root"><div class="layout"><h1>Home<\/h1><\/div><\/div>/);
    assert.match(html, /<link rel="stylesheet" href="\/s\.css">/);
    assert.match(html, /"nevf":"\/__nev\/pkg\/nevf\/index\.js"/);
    assert.match(html, /<script type="module" src="\/__nev\/client\.js">/);
    const boot = JSON.parse(/id="__NEV_DATA__">([^<]*)</.exec(html)[1]);
    assert.equal(boot.page.page, '/__nev/app/pages/index.js');
    assert.equal(boot.dev, false);
    assert.ok(boot.routes.some((r) => r.pattern === '/users/:id' && r.load === true));
  });

  test('loader receives params and query; result reaches the page and the boot data', async () => {
    const html = await (await get('/users/42?q=hi')).text();
    assert.match(html, /user 42 q=hi data=server-42/);
    const boot = JSON.parse(/id="__NEV_DATA__">([^<]*)</.exec(html)[1]);
    assert.deepEqual(boot.page.data, { who: 'server-42' });
    assert.deepEqual(boot.page.params, { id: '42' });
  });

  test('state does not leak between requests (location, query)', async () => {
    const a = await (await get('/users/1?q=aaa')).text();
    const b = await (await get('/users/2')).text();
    assert.match(a, /user 1 q=aaa/);
    assert.match(b, /user 2 q=-/);
  });

  test('loader data cannot break out of the embedded JSON', async () => {
    const html = await (await get('/xss')).text();
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw payload must not appear');
    const boot = JSON.parse(/id="__NEV_DATA__">([^<]*)</.exec(html)[1]);
    assert.equal(boot.page.data.text, '</script><script>alert(1)</script>');
    assert.match(html, /&lt;\/script&gt;&lt;script&gt;alert\(1\)/, 'text content is escaped');
  });

  test('catch-all route gets the rest of the path', async () => {
    assert.match(await (await get('/docs/a/b/c')).text(), /docs:a\/b\/c/);
  });

  test('a loader may redirect', async () => {
    const res = await get('/secret');
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/login');
  });

  test('loader-set cookies reach the response', async () => {
    const res = await get('/cookie');
    assert.match(res.headers.get('set-cookie'), /^seen=1/);
  });

  test('404: real status, layout kept, HTML for pages, plain text for missing files', async () => {
    const res = await get('/nope');
    assert.equal(res.status, 404);
    const html = await res.text();
    assert.match(html, /class="layout"/);
    assert.match(html, /404/);
    assert.equal((await get('/nope.png')).status, 404);
    assert.match((await get('/nope.png')).headers.get('content-type'), /text\/plain/);
    assert.equal((await get('/missing')).status, 404, 'loader HttpError(404) → 404 page');
  });

  test('HttpError from a loader shows its status and message', async () => {
    const res = await get('/forbidden');
    assert.equal(res.status, 403);
    assert.match(await res.text(), /Members only/);
  });

  test('unexpected errors: generic in production, detailed in dev', async () => {
    const p = await get('/boom');
    assert.equal(p.status, 500);
    const ptext = await p.text();
    assert.match(ptext, /Internal Server Error/);
    assert.ok(!ptext.includes('hunter2'), 'internal message must not leak in production');

    const d = await dev.request('/boom');
    assert.equal(d.status, 500);
    assert.match(await d.text(), /hunter2/);

    const r = await get('/render-fail');
    assert.equal(r.status, 500);
    assert.ok(!(await r.text()).includes('render exploded'));
  });

  test('non-GET to a page path is not a page', async () => {
    const res = await get('/', { method: 'POST' });
    assert.equal(res.status, 404);
  });

  test('HEAD works for pages', async () => {
    const res = await get('/', { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '');
  });

  test('security headers are set', async () => {
    const res = await get('/');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  });

  test('public files are served, but never shadow pages or leak dotfiles', async () => {
    assert.equal(await (await get('/hello.txt')).text(), 'hello public');
    assert.match(await (await get('/')).text(), /<h1>Home<\/h1>/);
    assert.equal((await get('/.env')).status, 404);
  });
});

describe('server: data endpoint (client-side navigation)', async () => {
  const root = makeApp(appFiles);
  const { app } = await createNev({ root, silent: true });
  const data = (p) => app.request('/__nev/data?path=' + encodeURIComponent(p));

  test('returns loader data as JSON, never cached', async () => {
    const res = await data('/users/7?q=x');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await json(res), { data: { who: 'server-7' } });
  });

  test('pages without a loader return data: null', async () => {
    assert.deepEqual(await json(await data('/')), { data: null });
  });

  test('redirect, notFound and error shapes', async () => {
    assert.deepEqual(await json(await data('/secret')), { redirect: '/login' });
    const nf = await data('/nothing/here');
    assert.equal(nf.status, 404);
    assert.deepEqual(await json(nf), { notFound: true });
    assert.deepEqual(await json(await data('/missing')), { notFound: true });
    const forbidden = await data('/forbidden');
    assert.equal(forbidden.status, 403);
    assert.deepEqual((await json(forbidden)).error, { status: 403, message: 'Members only' });
    const boom = await data('/boom');
    assert.equal(boom.status, 500);
    assert.equal((await json(boom)).error.message, 'Internal Server Error');
  });

  test('rejects absolute / protocol-relative / malformed paths', async () => {
    for (const p of ['//evil.com/x', 'https://evil.com/', 'users/1', '/a\\b']) {
      assert.equal((await data(p)).status, 400, p);
    }
    assert.equal((await app.request('/__nev/data')).status, 400);
  });

  test('loader cookies are forwarded', async () => {
    assert.match((await data('/cookie')).headers.get('set-cookie'), /seen=1/);
  });
});

describe('server: API routes', async () => {
  const root = makeApp(appFiles);
  const { app } = await createNev({ root, silent: true });
  const req = (p, init) => app.request(p, init);
  const post = (p, body) => req(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  test('named method exports, module middleware, JSON responses', async () => {
    const res = await req('/api/echo?a=1');
    assert.deepEqual(await json(res), { q: { a: '1' } });
    assert.equal(res.headers.get('x-mw'), 'yes');
  });

  test('a method export can be [middleware..., handler]', async () => {
    assert.equal((await post('/api/echo', { ok: false })).status, 400);
    const ok = await post('/api/echo', { ok: true, n: 5 });
    assert.equal(ok.status, 201);
    assert.deepEqual(await json(ok), { got: { ok: true, n: 5 } });
    assert.equal(ok.headers.get('x-mw'), 'yes');
  });

  test('del export handles DELETE', async () => {
    assert.equal((await req('/api/echo', { method: 'DELETE' })).status, 204);
  });

  test('unsupported method → 405 with Allow; OPTIONS lists methods', async () => {
    const res = await req('/api/echo', { method: 'PUT' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET, POST, DELETE');
    const opt = await req('/api/echo', { method: 'OPTIONS' });
    assert.equal(opt.status, 204);
    assert.equal(opt.headers.get('allow'), 'GET, POST, DELETE');
  });

  test('default export handles every method; params are available', async () => {
    assert.deepEqual(await json(await req('/api/users/9', { method: 'PATCH' })), { id: '9', method: 'PATCH' });
  });

  test('unknown API path → JSON 404 (not the HTML page); handler errors are hidden', async () => {
    const nf = await req('/api/nope');
    assert.equal(nf.status, 404);
    assert.match(nf.headers.get('content-type'), /json/);
    const boom = await req('/api/throws');
    assert.equal(boom.status, 500);
    assert.deepEqual(await json(boom), { error: 'Internal Server Error', status: 500 });
  });
});

describe('server: what the browser may download', async () => {
  const root = makeApp(appFiles);
  const { app } = await createNev({ root, silent: true });
  const status = async (p) => (await app.request(p)).status;

  test('client-safe modules are served', async () => {
    assert.equal(await status('/__nev/app/pages/index.js'), 200);
    assert.equal(await status('/__nev/app/pages/users/%5Bid%5D.js'), 200);
    assert.equal(await status('/__nev/app/pages/_layout.js'), 200);
    assert.equal(await status('/__nev/app/components/Widget.js'), 200);
    assert.equal(await status('/__nev/app/lib/util.js'), 200);
    assert.equal(await status('/__nev/client.js'), 200);
    assert.equal(await status('/__nev/tree.js'), 200);
    assert.equal(await status('/__nev/pkg/nevf/index.js'), 200);
    assert.equal(await status('/__nev/pkg/nevf/reactive.js'), 200);
    assert.equal(await status('/__nev/pkg/nevg/index.js'), 200);
  });

  test('server code, config, API files and secrets are refused', async () => {
    for (const p of [
      '/__nev/app/pages/users/%5Bid%5D.server.js',
      '/__nev/app/lib/secret.server.js',
      '/__nev/app/api/echo.js',
      '/__nev/app/nev.config.js',
      '/__nev/app/package.json',
      '/__nev/app/.env',
      '/__nev/app/public/hello.txt',
      '/__nev/app/../package.json',
      '/__nev/app/%2e%2e/package.json',
      '/__nev/pkg/nevf/../../package.json',
      '/__nev/pkg/nevf/package.json',
      '/__nev/pkg/nevb/index.js', // not a browser package
      '/__nev/nev.js',
      '/__nev/package.json',
    ]) {
      assert.equal(await status(p), 404, `${p} must not be served`);
    }
  });

  test('unknown /__nev paths never render an HTML page', async () => {
    const res = await app.request('/__nev/whatever');
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /text\/plain/);
  });

  test('dev mode adds live-reload endpoints; production does not', async () => {
    const dev = (await createNev({ root, silent: true, dev: true })).app;
    const res = await dev.request('/__nev/reload');
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    await res.body.cancel();
    assert.equal(await status('/__nev/reload'), 404);
    assert.equal(await status('/__nev/ping'), 200);
  });
});

describe('config', () => {
  test('setup(app) runs before Nev and can add routes and middleware', async () => {
    const root = makeApp({
      'nev.config.js': `export default { setup(app) { app.use((c, next) => { c.header('x-custom', '1'); return next() }); app.get('/health', () => ({ ok: true })) } }`,
      'pages/index.js': `import { h } from 'nevf'; export default () => h('p', null, 'x')`,
    });
    const { app } = await createNev({ root, silent: true });
    const res = await app.request('/health');
    assert.deepEqual(await json(res), { ok: true });
    assert.equal(res.headers.get('x-custom'), '1');
    assert.equal((await app.request('/')).headers.get('x-custom'), '1');
  });

  test('a page without a default component gives a helpful error', async () => {
    const root = makeApp({ 'pages/index.js': `export const x = 1` });
    const { app } = await createNev({ root, silent: true, dev: true });
    const res = await app.request('/');
    assert.equal(res.status, 500);
    assert.match(await res.text(), /must export a component/);
  });

  test('a project with no pages still starts (built-in 404)', async () => {
    const root = makeApp({ 'public/a.txt': 'a' });
    const { app } = await createNev({ root, silent: true });
    assert.equal((await app.request('/')).status, 404);
    assert.equal(await (await app.request('/a.txt')).text(), 'a');
  });
});

describe('cli', () => {
  test('parseArgs', () => {
    assert.deepEqual(parseArgs(['site', '--port', '4000', '--host=0.0.0.0', '-p', '5']), {
      flags: { port: '5', host: '0.0.0.0' },
      positional: ['site'],
    });
    assert.throws(() => parseArgs(['--port']), /Missing value/);
  });

  test('create scaffolds a project, renames _gitignore, fills in the name', () => {
    const dir = path.join(os.tmpdir(), `nev-create-${process.pid}`, 'My Cool_App');
    const log = console.log;
    console.log = () => {};
    try {
      create(dir);
    } finally {
      console.log = log;
    }
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      assert.equal(pkg.name, 'my-cool_app');
      assert.ok(pkg.dependencies.nevjs);
      assert.ok(fs.existsSync(path.join(dir, '.gitignore')));
      assert.ok(!fs.existsSync(path.join(dir, '_gitignore')));
      assert.ok(fs.existsSync(path.join(dir, 'pages', 'blog', '[slug].server.js')));
      assert.ok(!fs.readFileSync(path.join(dir, 'README.md'), 'utf8').includes('{{name}}'));
      assert.throws(() => create(dir), /not empty/);
      assert.throws(() => create(path.join(dir, 'x'), 'nope'), /Unknown template/);
    } finally {
      fs.rmSync(path.join(os.tmpdir(), `nev-create-${process.pid}`), { recursive: true, force: true });
    }
  });
});
