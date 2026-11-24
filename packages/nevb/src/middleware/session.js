import { sign, unsign, randomId, utf8ToB64url, b64urlToUtf8 } from '../crypto.js';

export class MemoryStore {
  constructor({ ttl = 7 * 86400 } = {}) {
    this.ttl = ttl * 1000;
    this.map = new Map();
    const t = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.map) if (v.exp <= now) this.map.delete(k);
    }, 60_000);
    t.unref?.();
  }
  get(id) {
    const e = this.map.get(id);
    if (!e) return undefined;
    if (e.exp <= Date.now()) {
      this.map.delete(id);
      return undefined;
    }
    return structuredClone(e.data);
  }
  set(id, data) {
    this.map.set(id, { data: structuredClone(data), exp: Date.now() + this.ttl });
  }
  delete(id) {
    this.map.delete(id);
  }
  get size() {
    return this.map.size;
  }
}

export function session(options = {}) {
  const secrets = [].concat(options.secret ?? []);
  if (!secrets.length || secrets.some((s) => typeof s !== 'string' || s.length < 16)) {
    throw new TypeError('session({ secret }) needs a secret of at least 16 characters');
  }
  const name = options.name ?? 'nev.sid';
  const maxAge = options.maxAge ?? 7 * 86400;
  const store = options.store ?? null;

  return async (c, next) => {
    let data = {};
    let id = null;
    const raw = c.cookies[name];
    if (raw) {
      const value = await unsign(raw, secrets);
      if (value) {
        if (store) {
          const found = await store.get(value);
          if (found) {
            data = found;
            id = value;
          }
        } else {
          try {
            const parsed = JSON.parse(b64urlToUtf8(value));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (!parsed.__exp || parsed.__exp > Date.now())) {
              delete parsed.__exp;
              data = parsed;
            }
          } catch {
          }
        }
      }
    }

    let destroyed = false;
    const before = JSON.stringify(data);
    Object.defineProperties(data, {
      destroy: {
        value() {
          destroyed = true;
          for (const k of Object.keys(data)) delete data[k];
        },
      },
      regenerate: {
        async value() {
          if (store && id) await store.delete(id);
          id = null;
          for (const k of Object.keys(data)) delete data[k];
        },
      },
    });
    c.session = data;

    const res = await next();

    const cookieOpts = {
      maxAge,
      path: options.path ?? '/',
      domain: options.domain,
      sameSite: options.sameSite ?? 'lax',
      secure: options.secure ?? c.url.protocol === 'https:',
      httpOnly: true,
    };
    if (destroyed) {
      if (store && id) await store.delete(id);
      if (raw) c.deleteCookie(name, { path: cookieOpts.path, domain: cookieOpts.domain });
      return res;
    }
    const after = JSON.stringify(data);
    const empty = after === '{}';
    if (store) {
      if (empty && !id) return res;
      if (after !== before || options.rolling || !id) {
        const first = !id;
        id ??= randomId(24);
        await store.set(id, { ...data });
        if (first || options.rolling) c.setCookie(name, await sign(id, secrets[0]), cookieOpts);
      }
    } else if (after !== before || (options.rolling && !empty)) {
      if (empty) {
        if (raw) c.deleteCookie(name, { path: cookieOpts.path, domain: cookieOpts.domain });
      } else {
        const value = await sign(utf8ToB64url(JSON.stringify({ ...data, __exp: Date.now() + maxAge * 1000 })), secrets[0]);
        if (value.length > 3800) throw new Error('[nevb] session data is too large for a cookie; use session({ store })');
        c.setCookie(name, value, cookieOpts);
      }
    }
    return res;
  };
}
