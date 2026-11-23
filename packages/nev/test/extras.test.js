import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createNev, exportSite } from '../src/index.js';
import { create } from '../src/cli.js';
import { findLinks, pathToFile } from '../src/export.js';
import { buildSitemap, buildRobots, siteOrigin } from '../src/seo.js';
import { makeApp, cleanup, TMP } from './helpers.js';

after(cleanup);
const page = (text) => `import { h } from 'nevf'; export default () => h('main', null, ${JSON.stringify(text)});`;

describe('middleware.js', () => {
  test('runs before pages and APIs; matcher limits it; never touches /__nev', async () => {
    const root = makeApp({
      'pages/index.js': page('home'),
      'pages/admin/index.js': page('admin'),
      'api/x.js': 'export const get = () => ({ ok: true })',
      'middleware.js': `export const matcher = ['/admin/*'];
        export default (c, next) => c.headers.get('x-key') === 'k' ? next() : c.json({ blocked: true }, 401);`,
    });
    const { app } = await createNev({ root, silent: true });
    assert.equal((await app.request('/')).status, 200);
    assert.equal((await app.request('/admin/')).status, 401);
    assert.equal((await app.request('/admin/', { headers: { 'x-key': 'k' } })).status, 200);
    assert.equal((await app.request('/__nev/ping')).status, 200);
    assert.equal((await app.request('/api/x')).status, 200);
  });

  test('array export, runs for everything without matcher, and rejects bad exports', async () => {
    const root = makeApp({
      'pages/index.js': page('home'),
      'middleware.js': `export default [(c, n) => { c.header('x-a', '1'); return n(); }, (c, n) => { c.header('x-b', '2'); return n(); }];`,
    });
    const res = await (await createNev({ root, silent: true })).app.request('/');
    assert.equal(res.headers.get('x-a'), '1');
    assert.equal(res.headers.get('x-b'), '2');
    const bad = makeApp({ 'pages/index.js': page('x'), 'middleware.js': 'export default 5;' });
    await assert.rejects(createNev({ root: bad, silent: true }), /middleware\.js must export/);
  });
});

describe('sitemap + robots', () => {
  const files = {
    'pages/index.js': page('home'),
    'pages/about.js': page('about'),
    'pages/blog/[slug].js': page('post'),
    'pages/private/index.js': page('secret'),
  };
  test('only when `site` is configured', async () => {
    const root = makeApp(files);
    const { app } = await createNev({ root, silent: true });
    assert.equal((await app.request('/sitemap.xml')).status, 404);
    assert.equal((await app.request('/robots.txt')).status, 404);
  });

  test('static routes + sitemapPaths, exclusions, escaping, robots', async () => {
    const root = makeApp({
      ...files,
      'nev.config.js': `export default { site: 'https://example.com/', sitemapExclude: ['/private*'],
        sitemapPaths: async () => ['/blog/a&b', { path: '/blog/hello', lastmod: '2026-01-01', priority: 0.8 }, 'nope'] };`,
    });
    const { app } = await createNev({ root, silent: true });
    const res = await app.request('/sitemap.xml');
    assert.match(res.headers.get('content-type'), /xml/);
    const xml = await res.text();
    assert.match(xml, /<loc>https:\/\/example\.com\/<\/loc>/);
    assert.match(xml, /<loc>https:\/\/example\.com\/about<\/loc>/);
    assert.match(xml, /a&amp;b/);
    assert.match(xml, /<lastmod>2026-01-01<\/lastmod>/);
    assert.match(xml, /<priority>0.8<\/priority>/);
    assert.doesNotMatch(xml, /private/);
    assert.doesNotMatch(xml, /nope|:slug/);
    const robots = await (await app.request('/robots.txt')).text();
    assert.match(robots, /Sitemap: https:\/\/example\.com\/sitemap\.xml/);
  });

  test('public/ files win; helpers', async () => {
    const root = makeApp({ ...files, 'nev.config.js': `export default { site: 'https://e.com' };`, 'public/robots.txt': 'custom' });
    const { app } = await createNev({ root, silent: true });
    assert.equal(await (await app.request('/robots.txt')).text(), 'custom');
    assert.equal(siteOrigin({ site: 'ftp://x' }), null);
    assert.equal(siteOrigin({ site: 'not a url' }), null);
    assert.match(buildRobots({ robots: { disallow: ['/admin'] } }, 'https://e.com'), /Disallow: \/admin/);
    assert.equal(buildRobots({ robots: 'raw' }, null), 'raw');
    assert.match(buildSitemap('https://e.com', [{ path: '/x y' }]), /x%20y/);
  });
});

describe('nev export', () => {
  const site = () =>
    makeApp({
      'pages/_layout.js': `import { h, Link } from 'nevf'; export default (p) => h('div', null, h(Link, { href: '/about' }, 'about'), h(Link, { href: '/blog/hello' }, 'post'), p.children);`,
      'pages/index.js': page('home'),
      'pages/about.js': page('about'),
      'pages/blog/[slug].js': `import { h } from 'nevf'; export default (p) => h('article', null, p.data.title);`,
      'pages/blog/[slug].server.js': `import { HttpError } from 'nevjs'; export const load = (c) => { if (c.params.slug === 'nope') throw new HttpError(404); return { title: 'Post ' + c.params.slug }; };`,
      'pages/old.js': page('old'),
      'pages/old.server.js': `import { redirect } from 'nevjs'; export const load = () => redirect('/about');`,
      'components/widget.js': `export const w = 1;`,
      'lib/secret.server.js': `export const k = 'TOP-SECRET';`,
      'public/hello.txt': 'hi',
      'nev.config.js': `export default { site: 'https://example.com', export: { paths: ['/blog/extra'] } };`,
    });

  test('renders pages, crawls links, handles loaders/redirects/404, copies only browser-safe assets', async () => {
    const root = site();
    const out = path.join(TMP, 'out-' + process.pid + '-1');
    const result = await exportSite({ root, out });
    const read = (f) => fs.readFileSync(path.join(out, f), 'utf8');
    const exists = (f) => fs.existsSync(path.join(out, f));

    assert.deepEqual(result.errors, [], JSON.stringify(result.errors));
    assert.ok(result.pages.includes('/') && result.pages.includes('/about'));
    assert.ok(result.pages.includes('/blog/hello'), 'found by crawling');
    assert.ok(result.pages.includes('/blog/extra'), 'from export.paths');
    assert.match(read('blog/hello/index.html'), /Post hello/);
    assert.match(read('blog/hello/index.html'), /"static":true/);
    assert.match(read('old/index.html'), /http-equiv="refresh" content="0; url=\/about"/);
    assert.match(read('404.html'), /<html/);
    assert.match(read('sitemap.xml'), /example\.com\/about/);
    assert.equal(read('hello.txt'), 'hi');
    assert.ok(exists('.nojekyll'));
    assert.ok(exists('__nev/client.js'));
    assert.ok(exists('__nev/app/components/widget.js'));
    assert.ok(exists('__nev/app/pages/index.js'));
    assert.ok(exists('__nev/pkg/nevf/index.js'));
    assert.equal(exists('__nev/app/lib/secret.server.js'), false, 'server files never exported');
    const everything = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : everything.push(fs.readFileSync(path.join(d, e.name), 'utf8')); })(out);
    assert.equal(everything.some((t) => t.includes('TOP-SECRET')), false);
  });

  test('reports failing pages and can disable crawling', async () => {
    const root = site();
    const out = path.join(TMP, 'out-' + process.pid + '-2');
    const bad = await exportSite({ root, out, paths: ['/blog/nope'] });
    assert.equal(bad.errors.length, 1);
    assert.equal(bad.errors[0].path, '/blog/nope');
    const flat = await exportSite({ root, out, crawl: false, config: { export: {} } });
    assert.equal(flat.pages.includes('/blog/hello'), false);
  });

  test('refuses to wipe the project folder', async () => {
    const root = site();
    await assert.rejects(exportSite({ root, out: root }), /cannot be the project folder/);
    await assert.rejects(exportSite({ root, out: path.dirname(root) }), /cannot be the project folder/);
  });

  test('helpers: findLinks, pathToFile', () => {
    assert.deepEqual(
      findLinks('<a href="/a">x</a><a class="c" href="/b/?q=1#h">y</a><a href="//evil.com">z</a><a href="https://x.com">w</a><a href="/f.pdf">f</a><a href="/__nev/x">n</a><a href="/api/x">p</a><a href="/a">dup</a>'),
      ['/a', '/b'],
    );
    assert.equal(pathToFile('/'), 'index.html');
    assert.equal(pathToFile('/a/b/'), 'a/b/index.html');
    assert.throws(() => pathToFile('/a/%2e%2e/b'), /Unsafe/);
  });
});

describe('templates', () => {
  for (const name of ['default', 'api', 'game']) {
    test(`"${name}" scaffolds a project that boots`, async () => {
      const dest = path.join(TMP, `tpl-${name}-${process.pid}`);
      const log = console.log;
      console.log = () => {};
      try { create(dest, name); } finally { console.log = log; }
      assert.ok(fs.existsSync(path.join(dest, '.gitignore')), 'dotfile restored');
      assert.ok(fs.existsSync(path.join(dest, '.dockerignore')));
      assert.ok(fs.existsSync(path.join(dest, 'Dockerfile')));
      const pkg = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'));
      assert.match(pkg.name, /^tpl-/);
      assert.equal(pkg.dependencies.nevjs, '^0.2.0');
      const { app } = await createNev({ root: dest, silent: true });
      assert.equal((await app.request('/')).status, 200);
      if (name === 'api') {
        const post = await app.request('/api/todos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"title":"x"}' });
        assert.equal(post.status, 201);
        assert.equal((await app.request('/api/todos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 422);
        assert.equal((await app.request('/api/todos/1')).status, 200);
        assert.equal((await app.request('/api/todos/999')).status, 404);
      }
      fs.rmSync(dest, { recursive: true, force: true });
    });
  }

  test('the game template plays headlessly (menu → play → collect coins)', async () => {
    const dest = path.join(TMP, `tpl-game-run-${process.pid}`);
    const log = console.log;
    console.log = () => {};
    try { create(dest, 'game'); } finally { console.log = log; }
    const { Menu, Play } = await import(path.join(dest, 'components/coin-dash.js'));
    const { Game, SaveData, createRng } = await import('nevg');
    const game = new Game({ raf: () => 0, caf: () => {}, width: 320, height: 160 });
    const store = new Map();
    const save = new SaveData('t', { best: 0 }, { storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) } });
    game.setScene(new Menu(save, createRng(1)));
    game.step();
    const play = new Play(save, createRng(1));
    game.setScene(play);
    game.step();
    for (let i = 0; i < 600; i++) {
      game.input.keyDown(i % 90 < 45 ? 'ArrowRight' : 'ArrowLeft');
      if (i % 40 === 0) game.input.keyDown('Space');
      game.step();
      game.input.keyUp('Space');
    }
    assert.ok(play.me.body.onGround !== undefined);
    assert.ok(play.me.y > 0 && play.me.y < 160, 'player stays inside the level');
    fs.rmSync(dest, { recursive: true, force: true });
  });
});
