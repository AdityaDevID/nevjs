import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  App, v, validate, session, MemoryStore, jwtAuth, signJWT, verifyJWT, compress, csrf, requestId, basicAuth,
  bearerAuth, timeout, cacheControl, etag, health, sign, unsign, hashPassword, verifyPassword, randomId, safeEqual,
} from '../src/index.js';

const SECRET = 'a-very-long-test-secret-value';
const cookieOf = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
const json = async (r) => JSON.parse(await r.text());

describe('crypto helpers', () => {
  test('sign/unsign, rotation and tampering', async () => {
    const s = await sign('hello', SECRET);
    assert.equal(await unsign(s, SECRET), 'hello');
    assert.equal(await unsign(s, ['other-secret-other-secret', SECRET]), 'hello');
    assert.equal(await unsign(s + 'x', SECRET), null);
    assert.equal(await unsign('nodots', SECRET), null);
    assert.equal(await unsign(s, 'a-different-secret-entirely'), null);
  });

  test('JWT: roundtrip, expiry, wrong secret, alg none, claims', async () => {
    const t = await signJWT({ sub: 'u1' }, SECRET, { expiresIn: '1h', issuer: 'nev' });
    const p = await verifyJWT(t, SECRET, { issuer: 'nev' });
    assert.equal(p.sub, 'u1');
    assert.equal(await verifyJWT(t, 'wrong-secret-wrong-secret'), null);
    assert.equal(await verifyJWT(t, SECRET, { issuer: 'someone-else' }), null);
    const expired = await signJWT({ sub: 'u1' }, SECRET, { expiresIn: -10 });
    assert.equal(await verifyJWT(expired, SECRET), null);
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"x"}').toString('base64url')}.`;
    assert.equal(await verifyJWT(none, SECRET), null);
    assert.equal(await verifyJWT('garbage', SECRET), null);
    assert.equal(await verifyJWT(undefined, SECRET), null);
  });

  test('password hashing', async () => {
    const h = await hashPassword('hunter2', { iterations: 2000 });
    assert.match(h, /^pbkdf2\$sha256\$2000\$/);
    assert.equal(await verifyPassword('hunter2', h), true);
    assert.equal(await verifyPassword('hunter3', h), false);
    assert.equal(await verifyPassword('x', 'not-a-hash'), false);
    assert.notEqual(await hashPassword('hunter2', { iterations: 2000 }), h); // random salt
  });

  test('randomId / safeEqual', () => {
    assert.notEqual(randomId(), randomId());
    assert.equal(randomId(16).length, 22);
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
  });
});

describe('session()', () => {
  test('requires a real secret', () => {
    assert.throws(() => session(), /secret/);
    assert.throws(() => session({ secret: 'short' }), /secret/);
  });

  test('cookie mode: persists, tamper-proof, destroy', async () => {
    const app = new App({ silent: true });
    app.use(session({ secret: SECRET }));
    app.get('/hit', (c) => {
      c.session.count = (c.session.count ?? 0) + 1;
      return { count: c.session.count };
    });
    app.get('/peek', (c) => ({ keys: Object.keys(c.session) }));
    app.get('/logout', (c) => {
      c.session.destroy();
      return 'bye';
    });

    const r1 = await app.request('/hit');
    assert.deepEqual(await json(r1), { count: 1 });
    const cookie = cookieOf(r1);
    assert.match(r1.headers.getSetCookie()[0], /HttpOnly/);
    const r2 = await app.request('/hit', { headers: { cookie } });
    assert.deepEqual(await json(r2), { count: 2 });

    // untouched request does not rewrite the cookie
    const r3 = await app.request('/peek', { headers: { cookie: cookieOf(r2) } });
    assert.equal(r3.headers.getSetCookie().length, 0);
    assert.deepEqual(await json(r3), { keys: ['count'] });

    // tampered cookie → fresh empty session
    const bad = await app.request('/peek', { headers: { cookie: cookie.slice(0, -2) + 'xx' } });
    assert.deepEqual(await json(bad), { keys: [] });

    const out = await app.request('/logout', { headers: { cookie: cookieOf(r2) } });
    assert.match(out.headers.getSetCookie()[0], /Max-Age=0/);
  });

  test('cookie mode: too-large data is rejected loudly', async () => {
    const app = new App({ silent: true });
    app.use(session({ secret: SECRET }));
    app.get('/big', (c) => {
      c.session.blob = 'x'.repeat(5000);
      return 'ok';
    });
    assert.equal((await app.request('/big')).status, 500);
  });

  test('store mode: cookie only holds an id; regenerate; Secure on https', async () => {
    const store = new MemoryStore();
    const app = new App({ silent: true });
    app.use(session({ secret: SECRET, store }));
    app.get('/login', (c) => {
      c.session.user = 'ada';
      return 'in';
    });
    app.get('/me', (c) => ({ user: c.session.user ?? null }));
    app.get('/regen', async (c) => {
      await c.session.regenerate();
      c.session.user = 'ada';
      return 'ok';
    });

    const r1 = await app.request('/login');
    const cookie = cookieOf(r1);
    assert.ok(cookie.length < 120, 'cookie holds only a signed id');
    assert.equal(store.size, 1);
    assert.deepEqual(await json(await app.request('/me', { headers: { cookie } })), { user: 'ada' });
    assert.deepEqual(await json(await app.request('/me')), { user: null });
    assert.equal(store.size, 1, 'reading without data does not create sessions');

    const r2 = await app.request('/regen', { headers: { cookie } });
    assert.notEqual(cookieOf(r2), cookie);
    assert.equal(store.size, 1, 'old session removed');
    assert.deepEqual(await json(await app.request('/me', { headers: { cookie } })), { user: null });

    const https = await app.request('https://example.com/login');
    assert.match(https.headers.getSetCookie()[0], /Secure/);
  });
});

describe('jwtAuth()', () => {
  const make = (opts) => {
    const app = new App({ silent: true });
    app.get('/me', jwtAuth({ secret: SECRET, ...opts }), (c) => ({ user: c.state.user?.sub ?? null }));
    return app;
  };

  test('accepts a valid bearer token, rejects others', async () => {
    const app = make();
    const token = await signJWT({ sub: 'u9' }, SECRET, { expiresIn: 60 });
    assert.deepEqual(await json(await app.request('/me', { headers: { authorization: `Bearer ${token}` } })), { user: 'u9' });
    const none = await app.request('/me');
    assert.equal(none.status, 401);
    assert.equal(none.headers.get('www-authenticate'), 'Bearer');
    assert.equal((await app.request('/me', { headers: { authorization: 'Bearer nope' } })).status, 401);
  });

  test('optional mode and cookie source', async () => {
    const token = await signJWT({ sub: 'u2' }, SECRET, { expiresIn: 60 });
    const optional = make({ required: false });
    assert.deepEqual(await json(await optional.request('/me')), { user: null });
    const viaCookie = make({ cookie: 'jwt' });
    assert.deepEqual(await json(await viaCookie.request('/me', { headers: { cookie: `jwt=${token}` } })), { user: 'u2' });
  });

  test('needs a secret', () => assert.throws(() => jwtAuth(), /secret/));
});

describe('compress()', () => {
  const big = 'hello world '.repeat(500);
  const build = (opts) => {
    const app = new App({ silent: true });
    app.use(compress(opts));
    app.get('/big', (c) => c.text(big));
    app.get('/small', (c) => c.text('tiny'));
    app.get('/json', (c) => c.json({ big }));
    app.get('/bin', () => new Response(new Uint8Array(5000), { headers: { 'content-type': 'application/octet-stream' } }));
    app.get('/sse', (c) => c.sse(({ send }) => send('x')));
    app.get('/encoded', () => new Response(big, { headers: { 'content-type': 'text/plain', 'content-encoding': 'br' } }));
    return app;
  };
  const get = (app, path, enc = 'gzip') => app.request(path, { headers: enc ? { 'accept-encoding': enc } : {} });

  test('gzips big text and json', async () => {
    const app = build();
    const r = await get(app, '/big');
    assert.equal(r.headers.get('content-encoding'), 'gzip');
    assert.match(r.headers.get('vary'), /Accept-Encoding/i);
    assert.equal(zlib.gunzipSync(Buffer.from(await r.arrayBuffer())).toString(), big);
    const j = await get(app, '/json');
    assert.equal(JSON.parse(zlib.gunzipSync(Buffer.from(await j.arrayBuffer())).toString()).big, big);
  });

  test('supports deflate and honours q=0', async () => {
    const app = build();
    const d = await get(app, '/big', 'deflate');
    assert.equal(d.headers.get('content-encoding'), 'deflate');
    assert.equal(zlib.inflateSync(Buffer.from(await d.arrayBuffer())).toString(), big);
    const none = await get(app, '/big', 'gzip;q=0, deflate;q=0');
    assert.equal(none.headers.get('content-encoding'), null);
    assert.equal(await none.text(), big);
    assert.equal((await get(app, '/big', '')).headers.get('content-encoding'), null);
  });

  test('skips small, binary, event-stream and already-encoded bodies', async () => {
    const app = build();
    for (const p of ['/small', '/bin']) assert.equal((await get(app, p)).headers.get('content-encoding'), null, p);
    assert.equal(await (await get(app, '/small')).text(), 'tiny');
    assert.equal((await get(app, '/sse')).headers.get('content-encoding'), null);
    assert.equal((await get(app, '/encoded')).headers.get('content-encoding'), 'br');
  });

  test('threshold option and HEAD', async () => {
    const app = build({ threshold: 1 });
    assert.equal((await get(app, '/small')).headers.get('content-encoding'), 'gzip');
    const head = await app.request('/big', { method: 'HEAD', headers: { 'accept-encoding': 'gzip' } });
    assert.equal(head.headers.get('content-encoding'), null);
  });
});

describe('csrf()', () => {
  const app = new App({ silent: true });
  app.use(csrf({ origins: ['https://admin.example.com'] }));
  app.get('/x', () => 'get');
  app.post('/x', () => 'post');
  const post = (headers) => app.request('http://app.test/x', { method: 'POST', headers });

  test('safe methods always pass', async () => assert.equal((await app.request('http://app.test/x', { headers: { origin: 'https://evil.com' } })).status, 200));
  test('same origin passes', async () => assert.equal((await post({ origin: 'http://app.test' })).status, 200));
  test('cross origin blocked', async () => {
    assert.equal((await post({ origin: 'https://evil.com' })).status, 403);
    assert.equal((await post({ origin: 'null' })).status, 403);
  });
  test('allow-listed origin passes', async () => assert.equal((await post({ origin: 'https://admin.example.com' })).status, 200));
  test('referer fallback and Sec-Fetch-Site', async () => {
    assert.equal((await post({ referer: 'http://app.test/page' })).status, 200);
    assert.equal((await post({ referer: 'https://evil.com/page' })).status, 403);
    assert.equal((await post({ 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await post({ 'sec-fetch-site': 'same-origin' })).status, 200);
    assert.equal((await post({ 'sec-fetch-site': 'same-site' })).status, 403);
  });
  test('headerless requests pass unless allowMissing:false', async () => {
    assert.equal((await post({})).status, 200);
    const strict = new App({ silent: true });
    strict.use(csrf({ allowMissing: false }));
    strict.post('/x', () => 'ok');
    assert.equal((await strict.request('/x', { method: 'POST' })).status, 403);
  });
});

describe('small middleware', () => {
  test('requestId reuses valid ids and rejects junk', async () => {
    const app = new App();
    app.use(requestId());
    app.get('/', (c) => c.state.requestId);
    const a = await app.request('/', { headers: { 'x-request-id': 'abc-123' } });
    assert.equal(await a.text(), 'abc-123');
    assert.equal(a.headers.get('x-request-id'), 'abc-123');
    const b = await app.request('/', { headers: { 'x-request-id': 'bad id\twith<script>' } });
    assert.match(b.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  });

  test('basicAuth', async () => {
    const app = new App({ silent: true });
    app.use(basicAuth({ users: { ada: 's3cret:with:colons' }, realm: 'Admin' }));
    app.get('/', (c) => c.state.user.name);
    const hdr = (u, p) => ({ authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') });
    const nope = await app.request('/');
    assert.equal(nope.status, 401);
    assert.match(nope.headers.get('www-authenticate'), /Basic realm="Admin"/);
    assert.equal(await (await app.request('/', { headers: hdr('ada', 's3cret:with:colons') })).text(), 'ada');
    assert.equal((await app.request('/', { headers: hdr('ada', 'wrong') })).status, 401);
    assert.equal((await app.request('/', { headers: hdr('constructor', 'x') })).status, 401);
    assert.equal((await app.request('/', { headers: { authorization: 'Basic !!!' } })).status, 401);
  });

  test('bearerAuth (static token, list, verify fn)', async () => {
    const mk = (opts) => {
      const app = new App({ silent: true });
      app.use(bearerAuth(opts));
      app.get('/', () => 'ok');
      return app;
    };
    const auth = (t) => ({ headers: { authorization: `Bearer ${t}` } });
    assert.equal((await mk({ token: 'k1' }).request('/', auth('k1'))).status, 200);
    assert.equal((await mk({ token: 'k1' }).request('/', auth('k2'))).status, 401);
    assert.equal((await mk({ tokens: ['a', 'b'] }).request('/', auth('b'))).status, 200);
    assert.equal((await mk({ verify: async (t) => t === 'dyn' }).request('/', auth('dyn'))).status, 200);
    assert.equal((await mk({ token: 'k1' }).request('/')).status, 401);
    assert.throws(() => bearerAuth(), /needs/);
  });

  test('timeout', async () => {
    const app = new App({ silent: true });
    app.use(timeout(30));
    app.get('/slow', async () => {
      await new Promise((r) => setTimeout(r, 200));
      return 'late';
    });
    app.get('/fast', () => 'ok');
    assert.equal((await app.request('/slow')).status, 504);
    assert.equal(await (await app.request('/fast')).text(), 'ok');
  });

  test('cacheControl only fills in missing headers', async () => {
    const app = new App();
    app.use(cacheControl({ public: true, maxAge: 60, staleWhileRevalidate: 10 }));
    app.get('/a', () => 'a');
    app.get('/b', (c) => c.text('b', 200, { 'cache-control': 'no-store' }));
    assert.equal((await app.request('/a')).headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=10');
    assert.equal((await app.request('/b')).headers.get('cache-control'), 'no-store');
    const ns = new App();
    ns.use(cacheControl({ noStore: true }));
    ns.get('/', () => 'x');
    assert.equal((await ns.request('/')).headers.get('cache-control'), 'no-store');
  });

  test('etag + 304', async () => {
    const app = new App();
    app.use(etag());
    app.get('/', () => ({ a: 1 }));
    const r1 = await app.request('/');
    const tag = r1.headers.get('etag');
    assert.match(tag, /^W\/"/);
    assert.deepEqual(await json(r1), { a: 1 });
    const r2 = await app.request('/', { headers: { 'if-none-match': tag } });
    assert.equal(r2.status, 304);
    assert.equal(await r2.text(), '');
    assert.equal((await app.request('/', { headers: { 'if-none-match': 'W/"other"' } })).status, 200);
  });

  test('health', async () => {
    let ok = true;
    const app = new App();
    app.use(health({ check: () => ok }));
    app.get('/', () => 'home');
    const r = await app.request('/health');
    assert.equal(r.status, 200);
    assert.equal((await json(r)).status, 'ok');
    ok = false;
    assert.equal((await app.request('/health')).status, 503);
    assert.equal(await (await app.request('/')).text(), 'home');
  });
});

describe('validation extras', () => {
  test('union / literal / record / tuple', () => {
    const u = v.union([v.number(), v.literal('auto')]);
    assert.equal(u.safeParse(5).ok, true);
    assert.equal(u.safeParse('auto').ok, true);
    assert.equal(u.safeParse('nope').ok, false);
    const r = v.record(v.number({ min: 0 }));
    assert.deepEqual(r.safeParse({ a: 1, b: 2 }).value, { a: 1, b: 2 });
    assert.equal(r.safeParse({ a: -1 }).ok, false);
    assert.equal(r.safeParse(JSON.parse('{"__proto__": 1, "a": 1}')).value.__proto__, Object.prototype);
    const t = v.tuple([v.number(), v.string()]);
    assert.equal(t.safeParse([1, 'a']).ok, true);
    assert.equal(t.safeParse([1]).ok, false);
  });

  test('date / url / uuid', () => {
    assert.ok(v.date().safeParse('2026-01-02').value instanceof Date);
    assert.equal(v.date().safeParse('not a date').ok, false);
    assert.equal(v.date({ min: '2026-01-01' }).safeParse('2025-01-01').ok, false);
    assert.equal(v.url().safeParse('https://nevjs.dev/x').ok, true);
    assert.equal(v.url().safeParse('javascript:alert(1)').ok, false);
    assert.equal(v.url({ protocols: ['https:'] }).safeParse('http://x.com').ok, false);
    assert.equal(v.uuid().safeParse(crypto.randomUUID()).ok, true);
    assert.equal(v.uuid().safeParse('123').ok, false);
  });

  test('nullable / refine / transform compose with optional + defaults', () => {
    assert.deepEqual(v.object({ a: v.string().nullable() }).safeParse({ a: null }).value, { a: null });
    assert.equal(v.string().safeParse(null).ok, false);
    const even = v.number().refine((n) => n % 2 === 0, 'must be even');
    assert.deepEqual(even.safeParse(3).errors, [{ path: '', message: 'must be even' }]);
    assert.equal(even.safeParse(4).ok, true);
    const slug = v.string({ trim: true }).transform((s) => s.toLowerCase().replace(/\s+/g, '-'));
    assert.equal(slug.safeParse('  Hello World ').value, 'hello-world');
    const lazyDefault = v.string().transform((s) => s.length).default(0);
    assert.equal(lazyDefault.safeParse(undefined).value, 0);
  });

  test('works through validate() middleware', async () => {
    const app = new App({ silent: true });
    app.post(
      '/e',
      validate({ body: v.object({ email: v.string({ email: true }).transform((s) => s.toLowerCase()), when: v.date().optional() }) }),
      (c) => c.valid.body,
    );
    const ok = await app.request('/e', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"A@B.CO"}' });
    assert.deepEqual(await json(ok), { email: 'a@b.co' });
  });
});
