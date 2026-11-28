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

// Revoked cookie-session ids (see __sid in session() below).
// Limitation: this set is in-memory and per-process — revocations are lost
// on restart and are not shared between multiple server instances. Use a
// store-backed session when cross-instance revocation matters.
const revokedCookieSessionIds = new Set();
function revokeCookieSessionId(sid) {
  if (!sid) return;
  revokedCookieSessionIds.add(sid);
  // Keep the set bounded: drop the oldest entries once it grows too large.
  while (revokedCookieSessionIds.size > 10_000) {
    revokedCookieSessionIds.delete(revokedCookieSessionIds.values().next().value);
  }
}

function tryStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
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
    let cookieSid = null;
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
              const sid = typeof parsed.__sid === 'string' ? parsed.__sid : null;
              if (!sid || !revokedCookieSessionIds.has(sid)) {
                cookieSid = sid;
                delete parsed.__exp;
                delete parsed.__sid;
                data = parsed;
              }
            }
          } catch {
          }
        }
      }
    }

    let destroyed = false;
    let forceSave = false;
    const before = tryStringify(data);
    Object.defineProperties(data, {
      destroy: {
        value() {
          destroyed = true;
          if (!store) revokeCookieSessionId(cookieSid);
          for (const k of Object.keys(data)) delete data[k];
        },
      },
      regenerate: {
        async value() {
          if (store && id) await store.delete(id);
          id = null;
          if (!store) {
            // Cookie sessions hold their data client-side, so there is no
            // server record to delete. Instead rotate the internal __sid
            // embedded in the signed payload and revoke the old one, so a
            // copy of the pre-regenerate cookie no longer loads.
            revokeCookieSessionId(cookieSid);
            cookieSid = randomId(24);
            forceSave = true;
          }
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
    // Unserializable data (BigInt, circular refs, ...) must not turn a
    // successful response into a 500: when stringify fails we cannot detect
    // changes, so fall back to always attempting a save below.
    const after = tryStringify(data);
    const unserializable = after === null;
    const changed = unserializable || forceSave || after !== before;
    const empty = after === '{}';
    if (store) {
      if (empty && !id) return res;
      if (changed || options.rolling || !id) {
        const first = !id;
        id ??= randomId(24);
        try {
          await store.set(id, { ...data });
        } catch {
          // Even the store cannot persist this data; skip saving rather
          // than failing the (already successful) response.
          return res;
        }
        if (first || options.rolling || forceSave) c.setCookie(name, await sign(id, secrets[0]), cookieOpts);
      }
    } else if (changed || (options.rolling && !empty)) {
      if (empty && !forceSave) {
        if (raw) c.deleteCookie(name, { path: cookieOpts.path, domain: cookieOpts.domain });
      } else if (!unserializable) {
        cookieSid ??= randomId(24);
        const value = await sign(utf8ToB64url(JSON.stringify({ ...data, __sid: cookieSid, __exp: Date.now() + maxAge * 1000 })), secrets[0]);
        if (value.length > 3800) throw new Error('[nevb] session data is too large for a cookie; use session({ store })');
        c.setCookie(name, value, cookieOpts);
      }
      // If unserializable and cookie-based, the payload cannot be encoded
      // as JSON at all: skip persisting it instead of throwing.
    }
    return res;
  };
}
