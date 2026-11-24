import { HttpError } from '../http-error.js';

export function rateLimit(options = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 60;
  const keyGenerator = options.keyGenerator ?? ((c) => c.ip || 'unknown');
  const message = options.message ?? 'Too Many Requests';
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, Math.max(windowMs, 1000));
  sweep.unref?.();

  return async (c, next) => {
    const now = Date.now();
    const key = String(keyGenerator(c));
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    const remaining = Math.max(0, max - entry.count);
    const resetSec = Math.ceil((entry.reset - now) / 1000);
    c.header('ratelimit-limit', String(max));
    c.header('ratelimit-remaining', String(remaining));
    c.header('ratelimit-reset', String(resetSec));
    if (entry.count > max) {
      c.header('retry-after', String(resetSec));
      throw new HttpError(429, message);
    }
    return next();
  };
}
