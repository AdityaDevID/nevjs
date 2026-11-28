import { HttpError } from '../http-error.js';

// Constant-time string comparison (length is not treated as secret).
function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length === y.length ? 0 : 1;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

// Static API-key auth: the client sends the key in a header (default
// `x-api-key`), optionally also accepted as `Authorization: ApiKey <key>`
// with { bearer: true }. `keys` is an array/Set of accepted keys, or a
// (possibly async) lookup function `(key) => boolean | id` — when the lookup
// returns a non-boolean truthy value it is exposed as `c.state.apiKeyId`,
// which is handy for per-client keys. Comparisons are constant-time.
export function keyAuth(options = {}) {
  const header = (options.header ?? 'x-api-key').toLowerCase();
  const allowBearer = options.bearer ?? false;
  const lookup = typeof options.keys === 'function' ? options.keys : null;
  const accepted = lookup ? null : new Set([...(options.keys ?? [])].map(String));
  if (!lookup && !accepted.size) throw new Error('[nevb] keyAuth needs at least one key (options.keys)');
  const fail = () => {
    throw new HttpError(401, 'Invalid or missing API key');
  };
  return async (c, next) => {
    let key = c.headers.get(header);
    if (!key && allowBearer) {
      const auth = c.headers.get('authorization') ?? '';
      const m = /^ApiKey\s+(.+)$/i.exec(auth);
      if (m) key = m[1];
    }
    if (!key) fail();
    if (lookup) {
      const result = await lookup(key);
      if (!result) fail();
      if (result !== true) c.state.apiKeyId = result;
    } else {
      let ok = false;
      for (const k of accepted) ok = safeEqual(key, k) || ok;
      if (!ok) fail();
    }
    return next();
  };
}
