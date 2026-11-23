import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  App, HttpError, abort, cors, logger, rateLimit, secureHeaders, serveStatic, v, validate,
  parseCookies, serializeCookie, matchSegs, compile,
} from '../src/index.js';

const json = async (res) => JSON.parse(await res.text());

describe('routing', () => {
  test('methods, params, query, wildcard, optional params', async () => {
    const app = new App();
    app.get('/', () => 'home');
    app.get('/users/:id', (c) => ({ id: c.params.id, q: c.query }));
    app.post('/users', async (c) => c.json(await c.body(), 201));
    app.get('/files/*path', (c) => c.params.path);
    app.get('/blog/:slug?', (c) => c.params.slug ?? 'index');

    assert.equal(await (await app.request('/')).text(), 'home');
    assert.deepEqual(await json(await app.request('/users/42?a=1&b=2&b=3')), { id: '42', q: { a: '1', b: ['2', '3'] } });
    const created = await app.request('/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":"Ada"}',
    });
    assert.equal(created.status, 201);
    assert.deepEqual(await json(created), { name: 'Ada' });
    assert.equal(await (await app.request('/files/a/b%20c.txt')).text(), 'a/b c.txt');
    assert.equal(await (await app.request('/blog')).text(), 'index');
    assert.equal(await (await app.request('/blog/hello')).text(), 'hello');
  });

  test('404 and unmatched methods', async () => {
    const app = new App();
    app.get('/only-get', () => 'ok');
    const r = await app.request('/only-get', { method: 'POST' });
    assert.equal(r.status, 404);
    assert.deepEqual(await json(r), { error: 'Not Found', status: 404 });
    assert.equal((await app.request('/nope')).status, 404);
  });

  test('HEAD uses GET routes without a body', async () => {
    const app = new App();
    app.get('/x', () => 'hello');
    const r = await app.request('/x', { method: 'HEAD' });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), '');
  });

  test('response conversion: objects, strings, null, binary, Response', async () => {
    const app = new App();
    app.get('/obj', () => ({ a: 1 }));
    app.get('/arr', () => [1, 2]);
    app.get('/str', () => 'text');
    app.get('/none', () => {});
    app.get('/bin', () => new Uint8Array([1, 2, 3]));
    app.get('/raw', () => new Response('x', { status: 418 }));
    app.get('/html', (c) => c.html('<b>x</b>'));
    app.get('/redir', (c) => c.redirect('/obj', 301));
    assert.equal((await app.request('/obj')).headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await json(await app.request('/arr')), [1, 2]);
    assert.equal((await app.request('/str')).headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal((await app.request('/none')).status, 204);
    assert.deepEqual([...new Uint8Array(await (await app.request('/bin')).arrayBuffer())], [1, 2, 3]);
    assert.equal((await app.request('/raw')).status, 418);
    assert.equal((await app.request('/html')).headers.get('content-type'), 'text/html; charset=utf-8');
    const redir = await app.request('/redir');
    assert.equal(redir.status, 301);
    assert.equal(redir.headers.get('location'), '/obj');
  });

  test('sub-apps are mounted under a prefix', async () => {
    const api = new App();
    api.use((c, next) => {
      c.state.api = true;
      return next();
    });
    api.get('/ping/:n', (c) => ({ n: c.params.n, api: c.state.api }));
    const app = new App();
    app.route('/api/v1', api);
    assert.deepEqual(await json(await app.request('/api/v1/ping/7')), { n: '7', api: true });
    assert.equal((await app.request('/ping/7')).status, 404);
  });

  test('matchSegs prefix + params', () => {
    assert.deepEqual(matchSegs(compile('/a/:b'), ['a', 'x', 'y'], true), { b: 'x' });
    assert.equal(matchSegs(compile('/a/:b'), ['a', 'x', 'y']), null);
  });
});

describe('middleware chain', () => {
  test('runs in order, can post-process via next(), auto-continues on undefined', async () => {
    const order = [];
    const app = new App();
    app.use(async (c, next) => {
      order.push('a-in');
      const res = await next();
      order.push('a-out');
      res.headers.set('x-a', '1');
      return res;
    });
    app.use((c) => {
      order.push('b'); // returns nothing → continues
    });
    app.get('/', () => {
      order.push('handler');
      return 'ok';
    });
    const res = await app.request('/');
    assert.deepEqual(order, ['a-in', 'b', 'handler', 'a-out']);
    assert.equal(res.headers.get('x-a'), '1');
  });

  test('middleware can short-circuit; path-scoped middleware only runs for its prefix', async () => {
    const app = new App();
    app.use('/admin', (c) => c.json({ error: 'nope' }, 401));
    app.get('/admin/x', () => 'secret');
    app.get('/public', () => 'hi');
    assert.equal((await app.request('/admin/x')).status, 401);
    assert.equal(await (await app.request('/public')).text(), 'hi');
  });

  test('route-level middleware (multiple handlers)', async () => {
    const auth = (c, next) => {
      if (c.req.headers.get('authorization') !== 'Bearer t') abort(401, 'login required');
      c.state.user = 'ada';
      return next();
    };
    const app = new App();
    app.get('/me', auth, (c) => ({ user: c.state.user }));
    const bad = await app.request('/me');
    assert.equal(bad.status, 401);
    assert.equal((await json(bad)).error, 'login required');
    const ok = await app.request('/me', { headers: { authorization: 'Bearer t' } });
    assert.deepEqual(await json(ok), { user: 'ada' });
  });

  test('a route can fall through with next()', async () => {
    const app = new App();
    app.get('/x', (c, next) => next());
    app.get('/x', () => 'second');
    assert.equal(await (await app.request('/x')).text(), 'second');
  });

  test('c.header / cookies apply to returned responses', async () => {
    const app = new App();
    app.get('/', (c) => {
      c.header('x-test', 'yes').setCookie('sid', 'a b', { maxAge: 60 }).setCookie('t', '1');
      return new Response('hi'); // raw Response still gets the headers
    });
    const res = await app.request('/');
    assert.equal(res.headers.get('x-test'), 'yes');
    const cookies = res.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.match(cookies[0], /^sid=a%20b; Max-Age=60; Path=\/; HttpOnly; SameSite=Lax$/);
  });

  test('cookie parsing and serialization are safe', () => {
    assert.deepEqual(parseCookies('a=1; b=hello%20world; c="q"; __proto__=x'), { a: '1', b: 'hello world', c: 'q' });
    assert.throws(() => serializeCookie('bad name', 'x'));
    assert.throws(() => serializeCookie('ok', 'x', { path: '/;evil' }));
    assert.match(serializeCookie('ok', 'a;b'), /^ok=a%3Bb/);
  });

  test('next() twice is an error', async () => {
    const app = new App({ silent: true });
    app.use(async (c, next) => {
      await next();
      return next();
    });
    app.get('/', () => 'x');
    assert.equal((await app.request('/')).status, 500);
  });
});

describe('errors', () => {
  test('HttpError → status + JSON; unknown errors → generic 500', async () => {
    const app = new App({ silent: true });
    app.get('/teapot', () => abort(418, 'short and stout', { why: 'tea' }));
    app.get('/boom', () => {
      throw new Error('secret internals');
    });
    app.get('/async-boom', async () => {
      throw new TypeError('also secret');
    });
    const t = await app.request('/teapot');
    assert.equal(t.status, 418);
    assert.deepEqual(await json(t), { error: 'short and stout', status: 418, details: { why: 'tea' } });
    const b = await app.request('/boom');
    assert.equal(b.status, 500);
    assert.deepEqual(await json(b), { error: 'Internal Server Error', status: 500 });
    assert.equal((await app.request('/async-boom')).status, 500);
  });

  test('custom onError / notFound', async () => {
    const app = new App({ silent: true });
    app.onError((err, c) => c.json({ oops: err.message }, 500));
    app.notFound((c) => c.text('lost', 404));
    app.get('/e', () => {
      throw new Error('x');
    });
    assert.deepEqual(await json(await app.request('/e')), { oops: 'x' });
    assert.equal(await (await app.request('/zzz')).text(), 'lost');
  });

  test('invalid JSON body → 400', async () => {
    const app = new App();
    app.post('/', async (c) => c.body());
    const r = await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    assert.equal(r.status, 400);
  });

  test('form and text bodies', async () => {
    const app = new App();
    app.post('/', async (c) => c.json(await c.body()));
    const form = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'a=1&b=2&b=3',
    });
    assert.deepEqual(await json(form), { a: '1', b: ['2', '3'] });
    const txt = await app.request('/', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'plain' });
    assert.equal(await txt.text(), '"plain"');
  });
});

describe('built-in middleware', () => {
  test('cors: simple, allow-list and preflight', async () => {
    const app = new App();
    app.use(cors({ origin: ['https://a.com'], credentials: true, maxAge: 600 }));
    app.get('/', () => 'x');
    const ok = await app.request('/', { headers: { origin: 'https://a.com' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://a.com');
    assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(ok.headers.get('vary'), 'Origin');
    const denied = await app.request('/', { headers: { origin: 'https://evil.com' } });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    const pre = await app.request('/', {
      method: 'OPTIONS',
      headers: { origin: 'https://a.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-headers'), 'content-type');
    assert.equal(pre.headers.get('access-control-max-age'), '600');
  });

  test('cors wildcard', async () => {
    const app = new App();
    app.use(cors());
    app.get('/', () => 'x');
    assert.equal((await app.request('/')).headers.get('access-control-allow-origin'), '*');
  });

  test('rateLimit: counts per key and returns 429 with Retry-After', async () => {
    const app = new App({ silent: true });
    app.use(rateLimit({ windowMs: 60_000, max: 2, keyGenerator: (c) => c.req.headers.get('x-user') }));
    app.get('/', () => 'x');
    const hit = (u) => app.request('/', { headers: { 'x-user': u } });
    assert.equal((await hit('a')).status, 200);
    const second = await hit('a');
    assert.equal(second.status, 200);
    assert.equal(second.headers.get('ratelimit-remaining'), '0');
    const third = await hit('a');
    assert.equal(third.status, 429);
    assert.ok(Number(third.headers.get('retry-after')) > 0);
    assert.equal((await hit('b')).status, 200, 'other keys are unaffected');
  });

  test('secureHeaders + logger', async () => {
    const lines = [];
    const app = new App();
    app.use(logger({ log: (l) => lines.push(l) }));
    app.use(secureHeaders({ hsts: true, csp: "default-src 'self'" }));
    app.get('/', () => 'x');
    const r = await app.request('/');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('strict-transport-security'), /max-age/);
    assert.equal(r.headers.get('content-security-policy'), "default-src 'self'");
    assert.match(lines[0], /^GET \/ 200 [\d.]+ms$/);
  });

  test('validate: body, query coercion, params, 422 details', async () => {
    const app = new App({ silent: true });
    app.post(
      '/users/:id',
      validate({
        params: v.object({ id: v.number({ int: true }) }),
        query: v.object({ page: v.number({ min: 1 }).default(1), tags: v.array(v.string()).optional() }),
        body: v.object({
          name: v.string({ min: 2, trim: true }),
          email: v.string({ email: true }),
          role: v.enum(['admin', 'user']).default('user'),
          age: v.number({ int: true, min: 0 }).optional(),
        }),
      }),
      (c) => c.valid,
    );
    const post = (url, body) =>
      app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    const ok = await post('/users/5?page=3&tags=a', { name: '  Ada ', email: 'a@b.co', extra: 'dropped' });
    assert.deepEqual(await json(ok), {
      params: { id: 5 },
      query: { page: 3, tags: ['a'] },
      body: { name: 'Ada', email: 'a@b.co', role: 'user' },
    });

    const bad = await post('/users/x?page=0', { name: 'A', email: 'nope', role: 'root', age: 1.5 });
    assert.equal(bad.status, 422);
    const details = (await json(bad)).details;
    assert.deepEqual(
      details.map((d) => d.path).sort(),
      ['body.age', 'body.email', 'body.name', 'body.role', 'params.id', 'query.page'],
    );
  });

  test('v.object strict mode and nested arrays', () => {
    const schema = v.object({ items: v.array(v.object({ n: v.number() })) }, { strict: true });
    const r = schema.safeParse({ items: [{ n: 1 }, { n: 'x' }], oops: 1 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors.map((e) => e.path).sort(), ['items[1].n', 'oops']);
    assert.throws(() => v.string().parse(5), (e) => e instanceof HttpError && e.status === 422);
  });
});

describe('static files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nevb-static-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>hi</h1>');
  fs.writeFileSync(path.join(dir, 'a.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'data.txt'), '0123456789');
  fs.writeFileSync(path.join(dir, '.secret'), 'nope');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'x.server.js'), 'secret server code');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nevb-outside-'));
  fs.writeFileSync(path.join(outside, 'private.txt'), 'private');
  fs.symlinkSync(path.join(outside, 'private.txt'), path.join(dir, 'link.txt'));

  const app = new App();
  app.use(serveStatic({ root: dir, filter: (p) => !p.endsWith('.server.js') }));
  app.get('/api', () => 'api');
  const get = (p, init) => app.request(p, init);

  test('serves files with the right content-type, index.html for directories', async () => {
    const root = await get('/');
    assert.equal(root.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await root.text(), '<h1>hi</h1>');
    const js = await get('/a.js');
    assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(await js.text(), 'console.log(1)');
  });

  test('falls through to routes and 404', async () => {
    assert.equal(await (await get('/api')).text(), 'api');
    assert.equal((await get('/missing.png')).status, 404);
  });

  test('blocks traversal, dotfiles, filtered files and escaping symlinks', async () => {
    for (const p of ['/../package.json', '/%2e%2e/etc/passwd', '/..%2f..%2fetc/passwd', '/.secret', '/sub/x.server.js', '/link.txt']) {
      const r = await get(p);
      assert.equal(r.status, 404, `${p} must not be served`);
    }
  });

  test('ETag / 304 and Range', async () => {
    const first = await get('/data.txt');
    const etag = first.headers.get('etag');
    assert.ok(etag);
    const cached = await get('/data.txt', { headers: { 'if-none-match': etag } });
    assert.equal(cached.status, 304);

    const part = await get('/data.txt', { headers: { range: 'bytes=2-5' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await part.text(), '2345');
    const tail = await get('/data.txt', { headers: { range: 'bytes=-3' } });
    assert.equal(await tail.text(), '789');
    const bad = await get('/data.txt', { headers: { range: 'bytes=50-60' } });
    assert.equal(bad.status, 416);
  });

  test('HEAD has headers but no body', async () => {
    const r = await get('/data.txt', { method: 'HEAD' });
    assert.equal(r.headers.get('content-length'), '10');
    assert.equal(await r.text(), '');
  });
});

describe('real HTTP server (Node adapter)', () => {
  test('GET/POST, cookies, streaming SSE, 413, abort handling', async () => {
    const app = new App({ maxBodySize: 100, silent: true });
    app.get('/hello', (c) => c.json({ hi: c.query.name ?? 'world', ip: c.ip }));
    app.post('/echo', async (c) => c.json(await c.body()));
    app.get('/cookie', (c) => {
      c.setCookie('a', '1').setCookie('b', '2');
      return 'ok';
    });
    app.get('/sse', (c) =>
      c.sse(async ({ send }) => {
        send({ n: 1 });
        send('two', 'custom');
        send('line1\nline2');
      }),
    );
    const server = await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const hello = await fetch(`${base}/hello?name=Nev`);
      assert.deepEqual(await hello.json(), { hi: 'Nev', ip: '127.0.0.1' });

      const echo = await fetch(`${base}/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":[1,2]}' });
      assert.deepEqual(await echo.json(), { a: [1, 2] });

      const cookie = await fetch(`${base}/cookie`);
      assert.equal(cookie.headers.getSetCookie().length, 2);

      const sse = await fetch(`${base}/sse`);
      assert.equal(sse.headers.get('content-type'), 'text/event-stream; charset=utf-8');
      assert.equal(await sse.text(), 'data: {"n":1}\n\nevent: custom\ndata: two\n\ndata: line1\ndata: line2\n\n');

      const big = await fetch(`${base}/echo`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x'.repeat(500) });
      assert.equal(big.status, 413);

      const head = await fetch(`${base}/hello`, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), '');
    } finally {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
  });

  test('streamed body larger than the limit (no content-length) is rejected', async () => {
    const app = new App({ maxBodySize: 50, silent: true });
    app.post('/echo', async (c) => c.json(await c.body()));
    const server = await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('y'.repeat(200)));
          controller.close();
        },
      });
      const res = await fetch(`${base}/echo`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: stream, duplex: 'half' });
      assert.equal(res.status, 413);
    } finally {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
  });
});
