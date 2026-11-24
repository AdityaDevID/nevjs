import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createNev, fail, exportSite } from '../src/index.js';
import { fillPattern } from '../src/routes.js';
import { makeApp, cleanup } from './helpers.js';

after(cleanup);

const page = `import { h } from '@adityadevid/nevf';
export default (p) => h('main', null, 'data=' + JSON.stringify(p.data) + ' action=' + JSON.stringify(p.actionData));`;

const form = (obj) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(obj).toString(),
});

describe('page actions', () => {
  const root = () =>
    makeApp({
      'pages/index.js': page,
      'pages/index.server.js': `import { fail } from '@adityadevid/nevjs';
        let count = 0;
        export const load = () => ({ count });
        export async function action(c) {
          const body = await c.body();
          if (!body.name) return fail(400, { error: 'name required' });
          if (body.name === 'go') return new Response(null, { status: 303, headers: { location: '/done' } });
          count++;
          return { saved: body.name };
        }`,
      'pages/plain.js': page,
      'pages/done.js': page,
    });

  test('POST re-renders with actionData and fresh loader data', async () => {
    const nev = await createNev({ root: root(), silent: true });
    const res = await nev.app.request('/', form({ name: 'ada' }));
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /data=\{&quot;count&quot;:1\}|data=\{"count":1\}/);
    assert.match(html, /saved/);
    assert.match(html, /"actionData":\{"saved":"ada"\}/, 'actionData is sent to the browser for hydration');
  });

  test('fail() sets the status and passes data to the page', async () => {
    const nev = await createNev({ root: root(), silent: true });
    const res = await nev.app.request('/', form({}));
    assert.equal(res.status, 400);
    assert.match(await res.text(), /name required/);
  });

  test('returning a Response (redirect after POST) is passed through', async () => {
    const nev = await createNev({ root: root(), silent: true });
    const res = await nev.app.request('/', { ...form({ name: 'go' }), redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/done');
  });

  test('pages without an action keep answering 404 to POST (unchanged from 0.3)', async () => {
    const nev = await createNev({ root: root(), silent: true });
    assert.equal((await nev.app.request('/plain', form({ a: '1' }))).status, 404);
    assert.equal((await nev.app.request('/nope', form({ a: '1' }))).status, 404);
  });

  test('an action that throws renders the error page with the right status', async () => {
    const r = makeApp({
      'pages/index.js': page,
      'pages/index.server.js': `import { notFound } from '@adityadevid/nevjs'; export const action = () => notFound();`,
    });
    const nev = await createNev({ root: r, silent: true });
    const res = await nev.app.request('/', form({}));
    assert.equal(res.status, 404);
  });

  test('fail() rejects non-error status codes', () => {
    assert.throws(() => fail(200), RangeError);
    assert.equal(fail(422, { a: 1 }).status, 422);
  });
});

describe('loader revalidate cache', () => {
  const files = (extra = '') => ({
    'pages/index.js': page,
    'pages/index.server.js': `let n = 0; export const revalidate = 60; export const load = () => ({ n: ++n });${extra}`,
  });

  test('cached in production, per URL, bypassed with cookies, never in dev', async () => {
    const nev = await createNev({ root: makeApp(files()), silent: true });
    const a = await (await nev.app.request('/')).text();
    const b = await (await nev.app.request('/')).text();
    assert.equal(a, b, 'second request served from cache');
    const c = await (await nev.app.request('/?x=1')).text();
    assert.notEqual(c, a, 'different query = different cache entry');
    const d = await (await nev.app.request('/', { headers: { cookie: 'sid=1' } })).text();
    assert.notEqual(d, a, 'requests with cookies skip the cache');

    const dev = await createNev({ root: makeApp(files()), silent: true, dev: true });
    const e1 = await (await dev.app.request('/')).text();
    const e2 = await (await dev.app.request('/')).text();
    assert.notEqual(e1, e2, 'dev never caches');
  });

  test('a successful action clears the cache', async () => {
    const root = makeApp(files('\nexport const action = () => ({ ok: true });'));
    const nev = await createNev({ root, silent: true });
    const a = await (await nev.app.request('/')).text();
    await nev.app.request('/', form({ x: '1' }));
    const b = await (await nev.app.request('/')).text();
    assert.notEqual(a, b);
  });
});

describe('staticPaths', () => {
  const files = {
    'pages/index.js': page,
    'pages/blog/[slug].js': page,
    'pages/blog/[slug].server.js': `export const load = (c) => ({ slug: c.params.slug });
      export const staticPaths = async () => [{ slug: 'hello' }, { slug: 'a b' }, {}];`,
    'pages/docs/[...rest].js': page,
    'pages/docs/[...rest].server.js': `export const staticPaths = () => ['/docs/intro/start'];`,
  };

  test('fillPattern builds and encodes URLs', () => {
    assert.equal(fillPattern('/blog/:slug', { slug: 'a b' }), '/blog/a%20b');
    assert.equal(fillPattern('/f/*rest', { rest: 'x/y z' }), '/f/x/y%20z');
    assert.throws(() => fillPattern('/blog/:slug', {}), /missing param/);
  });

  test('sitemap lists staticPaths entries', async () => {
    const nev = await createNev({ root: makeApp(files), silent: true, config: { site: 'https://example.com' } });
    const xml = await (await nev.app.request('/sitemap.xml')).text();
    assert.match(xml, /https:\/\/example\.com\/blog\/hello/);
    assert.match(xml, /\/blog\/a%20b/);
    assert.match(xml, /\/docs\/intro\/start/);
  });

  test('nev export renders dynamic pages from staticPaths and warns about bad entries', async () => {
    const root = makeApp(files);
    const out = path.join(root, 'out');
    const result = await exportSite({ root, out });
    assert.ok(fs.existsSync(path.join(out, 'blog/hello/index.html')));
    assert.ok(fs.existsSync(path.join(out, 'blog/a b/index.html')));
    assert.ok(fs.existsSync(path.join(out, 'docs/intro/start/index.html')));
    assert.ok(result.warnings.some((w) => /skipped an entry/.test(w)));
    assert.deepEqual(result.errors, []);
  });
});
