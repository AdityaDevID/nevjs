import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  App, v, cors, session, verifyPassword, hashPassword, signJWT, verifyJWT,
} from '../src/index.js';

const SECRET = 'a-very-long-test-secret-value';
const cookieOf = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
const json = async (r) => JSON.parse(await r.text());

describe('audit fix 1: maxBodySize enforced in Context.body()', () => {
  test('content-length larger than limit -> 413 via app.request (no Node adapter)', async () => {
    const app = new App({ maxBodySize: 10, silent: true });
    app.post('/echo', async (c) => c.json(await c.body()));
    const r = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: 'x'.repeat(100) }),
    });
    assert.equal(r.status, 413);
  });

  test('chunked/streaming body without content-length -> 413 while reading', async () => {
    const app = new App({ maxBodySize: 50, silent: true });
    app.post('/echo', async (c) => c.text(String(await c.body())));
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('y'.repeat(40)));
        controller.enqueue(new TextEncoder().encode('z'.repeat(40)));
        controller.close();
      },
    });
    const r = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: stream,
      duplex: 'half',
    });
    assert.equal(r.status, 413);
  });

  test('body at/under limit still works (json, text, form)', async () => {
    const app = new App({ maxBodySize: 1000, silent: true });
    app.post('/echo', async (c) => c.json(await c.body()));
    const ok = await app.request('/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await json(ok), { a: 1 });
    const form = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'a=1&b=2',
    });
    assert.deepEqual(await json(form), { a: '1', b: '2' });
  });
});

describe('audit fix 2: SSE field sanitization', () => {
  test('event/id/retry cannot inject forged events', async () => {
    const app = new App({ silent: true });
    app.get('/sse', (c) => c.sse(({ send }) => {
      send('hello', 'evil\nevent: forged', '1\r\ndata: forged', 1500);
      send('second', 'ok', 2, 'bad\nretry: 0');
    }));
    const r = await app.request('/sse');
    const text = await r.text();
    assert.ok(!text.includes('event: forged'), text);
    assert.ok(!text.includes('data: forged'), text);
    assert.ok(!text.includes('evil'), text, 'tainted event field is dropped');
    assert.ok(!/^id: 1$/m.test(text), 'tainted id field is dropped');
    assert.ok(text.includes('retry: 1500'), text);
    assert.ok(text.includes('event: ok'), text);
    assert.ok(text.includes('id: 2'), text);
    // Exactly the two real data lines for our payloads, no forged ones.
    assert.equal(text.match(/^data: /gm).length, 2);
  });
});

describe('audit fix 3: fire-and-forget next()', () => {
  test('downstream error propagates even when middleware returns its own response', async () => {
    const app = new App({ silent: true });
    app.use((c, next) => {
      next(); // fire-and-forget, deliberately not awaited/returned
      return c.text('middleware response');
    });
    app.get('/', () => { throw new Error('downstream boom'); });
    const r = await app.request('/');
    assert.equal(r.status, 500);
  });

  test('downstream async rejection propagates (no unhandledRejection, no hang)', async () => {
    const app = new App({ silent: true });
    let unhandled = null;
    const onUnhandled = (e) => { unhandled = e; };
    process.on('unhandledRejection', onUnhandled);
    try {
      app.use((c, next) => { next(); return 'own'; });
      app.get('/', async () => { await new Promise((r) => setTimeout(r, 5)); throw new Error('late boom'); });
      const r = await app.request('/');
      assert.equal(r.status, 500);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(unhandled, null);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('middleware own response wins when downstream succeeds', async () => {
    const app = new App({ silent: true });
    app.use((c, next) => { next(); return c.text('own'); });
    app.get('/', () => 'downstream');
    const r = await app.request('/');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'own');
  });

  test('middleware error wins over downstream error', async () => {
    const app = new App({ silent: true });
    app.onError((err, c) => c.json({ error: err.message }, 500));
    app.use((c, next) => { next(); throw new Error('middleware boom'); });
    app.get('/', () => { throw new Error('downstream boom'); });
    const r = await app.request('/');
    assert.deepEqual(await json(r), { error: 'middleware boom' });
  });
});

describe('audit fix 4: verifyPassword malformed hashes', () => {
  test('malformed stored hashes return false, never throw', async () => {
    const good = await hashPassword('hunter2', { iterations: 2000 });
    assert.equal(await verifyPassword('hunter2', good), true);
    for (const bad of [
      'pbkdf2$sha256$2000$!!!invalid-b64!!!$abc',
      'pbkdf2$sha256$2000$%%%%$@@@@',
      'pbkdf2$sha256$notanumber$AAAA$BBBB',
      'pbkdf2$sha256$2000$$',
      '',
      null,
      undefined,
      12345,
      {},
    ]) {
      assert.equal(await verifyPassword('x', bad), false, String(bad));
    }
  });
});

describe('audit fix 5+7: validation', () => {
  test('/g pattern does not alternate verdicts', () => {
    const s = v.string({ pattern: /^a+$/g });
    for (let i = 0; i < 4; i++) assert.equal(s.safeParse('aaa').ok, true, `run ${i}`);
    for (let i = 0; i < 4; i++) assert.equal(s.safeParse('bbb').ok, false, `run ${i}`);
    const sticky = v.string({ pattern: /^a+$/y });
    assert.equal(sticky.safeParse('aaa').ok, true);
    assert.equal(sticky.safeParse('aaa').ok, true);
  });

  test('throwing refine/transform become safeParse errors, parse still throws HttpError', () => {
    const boomRefine = v.string().refine(() => { throw new Error('refine exploded'); });
    const r1 = boomRefine.safeParse('x');
    assert.equal(r1.ok, false);
    assert.equal(r1.errors.length, 1);
    assert.match(r1.errors[0].message, /refine exploded/);
    const boomTransform = v.number().transform(() => { throw new Error('transform exploded'); });
    const r2 = boomTransform.safeParse(3);
    assert.equal(r2.ok, false);
    assert.match(r2.errors[0].message, /transform exploded/);
    const nested = v.object({ a: boomRefine });
    const r3 = nested.safeParse({ a: 'x' });
    assert.equal(r3.ok, false);
    assert.equal(r3.errors[0].path, 'a');
    assert.throws(() => boomRefine.parse('x'), (e) => e.status === 422);
  });
});

describe('audit fix 6: verifyJWT clockTolerance', () => {
  test('tolerance loosens exp and nbf; non-numeric claims rejected', async () => {
    // Expired 5s ago: invalid without tolerance, valid with 60s tolerance.
    const expired = await signJWT({ sub: 'u' }, SECRET, { expiresIn: -5 });
    assert.equal(await verifyJWT(expired, SECRET), null);
    assert.ok(await verifyJWT(expired, SECRET, { clockTolerance: 60 }));
    // Not valid for another hour: invalid without tolerance, still invalid
    // with 60s tolerance, valid with a tolerance covering the gap.
    const future = await signJWT({ sub: 'u' }, SECRET, { notBefore: 3600 });
    assert.equal(await verifyJWT(future, SECRET), null);
    assert.equal(await verifyJWT(future, SECRET, { clockTolerance: 60 }), null);
    assert.ok(await verifyJWT(future, SECRET, { clockTolerance: 7200 }));
    // Non-numeric exp / nbf are invalid (hand-crafted, properly signed).
    const { signJWT: _s, ...rest } = await import('../src/index.js');
    void rest; void _s;
    const badExp = await signJWT({ sub: 'u', exp: 'tomorrow' }, SECRET);
    assert.equal(await verifyJWT(badExp, SECRET, { clockTolerance: 99999999 }), null);
    const badNbf = await signJWT({ sub: 'u', nbf: 'later' }, SECRET);
    assert.equal(await verifyJWT(badNbf, SECRET, { clockTolerance: 99999999 }), null);
  });
});

describe('audit fix 8+9: session robustness', () => {
  test('unserializable session data (BigInt / circular) does not 500 a successful response', async () => {
    for (const mode of ['cookie', 'store']) {
      const app = new App({ silent: true });
      app.use(session(mode === 'store' ? { secret: SECRET, store: undefined } : { secret: SECRET }));
      // store mode is covered separately below; this loop uses cookie mode twice intentionally for BigInt+circular
      app.get('/big', (c) => { c.session.n = 10n; return 'ok'; });
      app.get('/circ', (c) => { const o = { a: 1 }; o.self = o; c.session.o = o; return 'ok'; });
      assert.equal((await app.request('/big')).status, 200, mode);
      assert.equal((await app.request('/circ')).status, 200, mode);
    }
  });

  test('unserializable data with a store still succeeds', async () => {
    const { MemoryStore } = await import('../src/index.js');
    const app = new App({ silent: true });
    app.use(session({ secret: SECRET, store: new MemoryStore() }));
    app.get('/big', (c) => { c.session.n = 10n; return 'ok'; });
    assert.equal((await app.request('/big')).status, 200);
  });

  test('cookie session regenerate() revokes the old cookie', async () => {
    const app = new App({ silent: true });
    app.use(session({ secret: SECRET }));
    app.get('/login', (c) => { c.session.user = 'ada'; return 'in'; });
    app.get('/me', (c) => ({ user: c.session.user ?? null }));
    app.get('/regen', async (c) => { await c.session.regenerate(); c.session.user = 'ada'; return 'ok'; });

    const r1 = await app.request('/login');
    const oldCookie = cookieOf(r1);
    assert.deepEqual(await json(await app.request('/me', { headers: { cookie: oldCookie } })), { user: 'ada' });

    const r2 = await app.request('/regen', { headers: { cookie: oldCookie } });
    const newCookie = cookieOf(r2);
    assert.ok(newCookie);
    assert.notEqual(newCookie, oldCookie);
    // Old cookie is revoked; the regenerated one works.
    assert.deepEqual(await json(await app.request('/me', { headers: { cookie: oldCookie } })), { user: null });
    assert.deepEqual(await json(await app.request('/me', { headers: { cookie: newCookie } })), { user: 'ada' });
    // Internal claims are not leaked into c.session keys.
    const peek = new App({ silent: true });
    peek.use(session({ secret: SECRET }));
    peek.get('/keys', (c) => ({ keys: Object.keys(c.session) }));
    assert.deepEqual(await json(await peek.request('/keys', { headers: { cookie: newCookie } })), { keys: ['user'] });
  });
});

describe('audit fix edge cases (completion pass)', () => {
  test('fix 1: body exactly at the limit passes, one byte over -> 413', async () => {
    const app = new App({ maxBodySize: 7, silent: true });
    app.post('/e', async (c) => c.text(await c.body()));
    const ok = await app.request('/e', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '1234567' });
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '1234567');
    const over = await app.request('/e', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '12345678' });
    assert.equal(over.status, 413);
  });

  test('fix 2: CRLF inside data is split into data lines; negative/NaN retry dropped', async () => {
    const app = new App({ silent: true });
    app.get('/sse', (c) => c.sse(({ send }) => {
      send('a\r\nb', 'ok', 1, -5);
      send('x', 'ok', 2, Number.NaN);
    }));
    const text = await (await app.request('/sse')).text();
    assert.ok(!text.includes('\r'), text);
    assert.equal((text.match(/^retry:/gm) || []).length, 0);
    assert.equal((text.match(/^data: /gm) || []).length, 3);
  });

  test('fix 3: fire-and-forget next() with undefined return still serves downstream response', async () => {
    const app = new App({ silent: true });
    app.use((c, next) => { next(); });
    app.get('/', () => 'downstream-body');
    const r = await app.request('/');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'downstream-body');
  });

  test('fix 6: exp boundary — rejected at exp, and at exp + tolerance', async () => {
    const realNow = Date.now;
    const base = 1_800_000_000;
    try {
      Date.now = () => base * 1000;
      const tok = await signJWT({ sub: 'u' }, SECRET, { expiresIn: 10 });
      Date.now = () => (base + 9) * 1000;
      assert.ok(await verifyJWT(tok, SECRET));
      Date.now = () => (base + 10) * 1000; // now == exp
      assert.equal(await verifyJWT(tok, SECRET), null);
      Date.now = () => (base + 14) * 1000;
      assert.ok(await verifyJWT(tok, SECRET, { clockTolerance: 5 }));
      Date.now = () => (base + 15) * 1000; // now == exp + tolerance
      assert.equal(await verifyJWT(tok, SECRET, { clockTolerance: 5 }), null);
    } finally {
      Date.now = realNow;
    }
  });

  test('fix 8: store session with uncloneable (function) value does not 500', async () => {
    const { MemoryStore } = await import('../src/index.js');
    const app = new App({ silent: true });
    app.use(session({ secret: SECRET, store: new MemoryStore() }));
    app.get('/fn', (c) => { c.session.fn = () => 1; return 'ok'; });
    const r = await app.request('/fn');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'ok');
  });

  test('fix 9: cookie session destroy() also revokes the old cookie', async () => {
    const app = new App({ silent: true });
    app.use(session({ secret: SECRET }));
    app.get('/login', (c) => { c.session.user = 'ada'; return 'in'; });
    app.get('/me', (c) => ({ user: c.session.user ?? null }));
    app.get('/out', (c) => { c.session.destroy(); return 'bye'; });
    const c1 = cookieOf(await app.request('/login'));
    assert.deepEqual(await json(await app.request('/me', { headers: { cookie: c1 } })), { user: 'ada' });
    await app.request('/out', { headers: { cookie: c1 } });
    assert.deepEqual(await json(await app.request('/me', { headers: { cookie: c1 } })), { user: null });
  });

  test('fix 10: allowedHeaders takes precedence over the `headers` alias', async () => {
    const app = new App({ silent: true });
    app.use(cors({ allowedHeaders: 'x-win', headers: ['x-lose'] }));
    app.get('/', () => 'x');
    const pre = await app.request('/', {
      method: 'OPTIONS',
      headers: { origin: 'https://a.com', 'access-control-request-method': 'POST' },
    });
    assert.equal(pre.headers.get('access-control-allow-headers'), 'x-win');
  });
});

describe('audit fix 10: cors', () => {
  test('origin function returning true echoes the request origin', async () => {
    const app = new App({ silent: true });
    app.use(cors({ origin: () => true }));
    app.get('/', () => 'x');
    const r = await app.request('/', { headers: { origin: 'https://example.com' } });
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://example.com');
  });

  test('origin function returning a string / false still works', async () => {
    const app = new App({ silent: true });
    app.use(cors({ origin: (o) => (o === 'https://ok.com' ? o : false) }));
    app.get('/', () => 'x');
    assert.equal((await app.request('/', { headers: { origin: 'https://ok.com' } })).headers.get('access-control-allow-origin'), 'https://ok.com');
    assert.equal((await app.request('/', { headers: { origin: 'https://no.com' } })).headers.get('access-control-allow-origin'), null);
  });

  test('`headers` works as alias for `allowedHeaders` in preflight', async () => {
    const app = new App({ silent: true });
    app.use(cors({ headers: ['x-custom', 'content-type'] }));
    app.get('/', () => 'x');
    const pre = await app.request('/', {
      method: 'OPTIONS',
      headers: { origin: 'https://a.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-other' },
    });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-headers'), 'x-custom,content-type');
    // allowedHeaders itself still wins / works.
    const app2 = new App({ silent: true });
    app2.use(cors({ allowedHeaders: 'x-a' }));
    app2.get('/', () => 'x');
    const pre2 = await app2.request('/', {
      method: 'OPTIONS',
      headers: { origin: 'https://a.com', 'access-control-request-method': 'POST' },
    });
    assert.equal(pre2.headers.get('access-control-allow-headers'), 'x-a');
  });
});

describe('feature: keyAuth middleware', () => {
  test('accepts a listed key, rejects missing/wrong keys with 401', async () => {
    const { keyAuth } = await import('../src/index.js');
    const app = new App({ silent: true });
    app.use(keyAuth({ keys: ['k1-secret', 'k2-secret'] }));
    app.get('/x', () => ({ ok: true }));
    assert.equal((await app.request('/x', { headers: { 'x-api-key': 'k1-secret' } })).status, 200);
    assert.equal((await app.request('/x', { headers: { 'x-api-key': 'nope' } })).status, 401);
    assert.equal((await app.request('/x')).status, 401);
  });

  test('lookup function can name the key (c.state.apiKeyId) and bearer scheme works', async () => {
    const { keyAuth } = await import('../src/index.js');
    const app = new App({ silent: true });
    app.use(keyAuth({ keys: async (k) => (k === 'good' ? 'client-7' : false), bearer: true }));
    app.get('/x', (c) => ({ id: c.state.apiKeyId ?? null }));
    const res = await app.request('/x', { headers: { authorization: 'ApiKey good' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await json(res), { id: 'client-7' });
    assert.equal((await app.request('/x', { headers: { authorization: 'ApiKey bad' } })).status, 401);
  });
});
