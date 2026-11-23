import { HttpError } from '../http-error.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated apps, based on the Origin / Referer / Sec-Fetch-Site
 * headers browsers attach to every unsafe request (no tokens to manage).
 *
 *   app.use(csrf())                                       // same-origin only
 *   app.use(csrf({ origins: ['https://admin.example.com'] }))
 *
 * Requests without any of those headers (curl, server-to-server) pass unless `allowMissing: false`.
 */
export function csrf(options = {}) {
  const extra = new Set((options.origins ?? []).map((o) => o.replace(/\/$/, '')));
  const allowMissing = options.allowMissing ?? true;
  const allowSameSite = options.allowSameSite ?? false;
  const deny = () => {
    throw new HttpError(403, 'Cross-site request blocked');
  };
  return (c, next) => {
    if (SAFE.has(c.method)) return next();
    const sameHost = (o) => {
      try {
        const u = new URL(o);
        return u.origin === c.url.origin || u.host === c.headers.get('host') || extra.has(u.origin);
      } catch {
        return false;
      }
    };
    const site = c.headers.get('sec-fetch-site');
    const origin = c.headers.get('origin');
    if (origin) return origin !== 'null' && sameHost(origin) ? next() : deny();
    const referer = c.headers.get('referer');
    if (referer) return sameHost(referer) ? next() : deny();
    if (site) {
      if (site === 'same-origin' || site === 'none') return next();
      if (site === 'same-site' && allowSameSite) return next();
      return deny();
    }
    return allowMissing ? next() : deny();
  };
}
