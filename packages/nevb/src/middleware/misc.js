import { HttpError } from '../http-error.js';
import { safeEqual } from '../crypto.js';

/** Attach a request id (reuses a sane incoming `x-request-id`). Available as c.state.requestId. */
export function requestId({ header = 'x-request-id' } = {}) {
  return (c, next) => {
    const incoming = c.headers.get(header);
    const id = incoming && /^[\w.:-]{1,128}$/.test(incoming) ? incoming : crypto.randomUUID();
    c.state.requestId = id;
    c.header(header, id);
    return next();
  };
}

/**
 * HTTP Basic auth.
 *   basicAuth({ users: { admin: 'secret' } })   or   basicAuth({ verify: async (user, pass, c) => boolean })
 */
export function basicAuth(options = {}) {
  const realm = options.realm ?? 'Restricted';
  const verify =
    options.verify ??
    ((user, pass) => {
      const users = options.users ?? {};
      return Object.prototype.hasOwnProperty.call(users, user) && safeEqual(String(users[user]), pass);
    });
  const challenge = (c) => c.json({ error: 'Unauthorized', status: 401 }, 401, { 'www-authenticate': `Basic realm="${realm}", charset="UTF-8"` });
  return async (c, next) => {
    const m = /^Basic\s+(.+)$/i.exec(c.headers.get('authorization') || '');
    if (!m) return challenge(c);
    let user;
    let pass;
    try {
      const bin = atob(m[1].trim());
      const text = new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
      const i = text.indexOf(':');
      if (i < 0) return challenge(c);
      user = text.slice(0, i);
      pass = text.slice(i + 1);
    } catch {
      return challenge(c);
    }
    if (!(await verify(user, pass, c))) return challenge(c);
    c.state.user = { name: user };
    return next();
  };
}

/**
 * Static API-token auth: bearerAuth({ token: 'abc' }) / bearerAuth({ tokens: [...] }) / bearerAuth({ verify }).
 */
export function bearerAuth(options = {}) {
  const tokens = [].concat(options.token ?? options.tokens ?? []);
  if (!options.verify && !tokens.length) throw new TypeError('bearerAuth() needs token, tokens or verify');
  return async (c, next) => {
    const m = /^Bearer\s+(.+)$/i.exec(c.headers.get('authorization') || '');
    const token = m?.[1].trim();
    let ok = false;
    if (token) ok = options.verify ? !!(await options.verify(token, c)) : tokens.some((t) => safeEqual(String(t), token));
    if (!ok) {
      c.header('www-authenticate', 'Bearer');
      throw new HttpError(401, 'Invalid or missing token');
    }
    return next();
  };
}

/** Fail with 504 when the rest of the chain takes longer than `ms` (the handler itself is not cancelled). */
export function timeout(ms, message = 'Gateway Timeout') {
  return async (c, next) => {
    let timer;
    const limit = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new HttpError(504, message)), ms);
      timer.unref?.();
    });
    try {
      return await Promise.race([next(), limit]);
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Set Cache-Control on responses that do not set their own.
 *   cacheControl({ maxAge: 3600, public: true, staleWhileRevalidate: 60 })   cacheControl({ noStore: true })
 */
export function cacheControl(o = {}) {
  const parts = [];
  if (o.noStore) parts.push('no-store');
  else {
    if (o.noCache) parts.push('no-cache');
    parts.push(o.private ? 'private' : o.public ? 'public' : '');
    if (o.maxAge != null) parts.push(`max-age=${o.maxAge}`);
    if (o.sMaxAge != null) parts.push(`s-maxage=${o.sMaxAge}`);
    if (o.staleWhileRevalidate != null) parts.push(`stale-while-revalidate=${o.staleWhileRevalidate}`);
    if (o.immutable) parts.push('immutable');
  }
  const value = parts.filter(Boolean).join(', ');
  return async (c, next) => {
    const res = await next();
    if (res && !res.headers.has('cache-control') && c.method !== 'POST') c.header('cache-control', value);
    return res;
  };
}

/** Weak ETag for dynamic GET responses + 304 handling (If-None-Match). */
export function etag() {
  return async (c, next) => {
    const res = await next();
    if (!res?.body || (c.method !== 'GET' && c.method !== 'HEAD') || res.status !== 200 || res.headers.has('etag')) return res;
    if (/event-stream/i.test(res.headers.get('content-type') || '')) return res;
    const buf = await res.arrayBuffer();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', buf));
    let hex = '';
    for (const b of digest) hex += b.toString(16).padStart(2, '0');
    const tag = `W/"${buf.byteLength.toString(16)}-${hex.slice(0, 20)}"`;
    const headers = new Headers(res.headers);
    headers.set('etag', tag);
    const inm = c.headers.get('if-none-match');
    if (inm && inm.split(',').some((t) => t.trim() === tag || t.trim() === '*')) {
      headers.delete('content-length');
      headers.delete('content-type');
      return new Response(null, { status: 304, headers });
    }
    return new Response(c.method === 'HEAD' ? null : buf, { status: res.status, statusText: res.statusText, headers });
  };
}

/** GET /health (or custom path) → { status: 'ok', uptime }. Optional async `check()` → 503 when it throws / returns false. */
export function health({ path = '/health', check } = {}) {
  return async (c, next) => {
    if (c.path !== path || (c.method !== 'GET' && c.method !== 'HEAD')) return next();
    try {
      if (check && (await check()) === false) throw new Error('unhealthy');
    } catch {
      return c.json({ status: 'unavailable' }, 503, { 'cache-control': 'no-store' });
    }
    return c.json({ status: 'ok', uptime: Math.round(process.uptime?.() ?? 0) }, 200, { 'cache-control': 'no-store' });
  };
}
