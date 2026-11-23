import { HttpError } from '../http-error.js';
import { signJWT, verifyJWT } from '../crypto.js';

export { signJWT, verifyJWT };

/**
 * Bearer-token authentication with HS256 JWTs.
 *   app.use('/api', jwtAuth({ secret }))       // c.state.user = payload, 401 when missing/invalid
 *   jwtAuth({ secret, required: false })        // optional login
 * Options: secret (string | string[]), key ('user'), required (true), cookie (cookie name to read as well),
 *          issuer, audience, getToken(c).
 */
export function jwtAuth(options = {}) {
  if (!options.secret) throw new TypeError('jwtAuth({ secret }) is required');
  const key = options.key ?? 'user';
  const required = options.required ?? true;
  return async (c, next) => {
    let token = options.getToken?.(c);
    if (!token) {
      const h = c.headers.get('authorization') || '';
      const m = /^Bearer\s+(.+)$/i.exec(h);
      if (m) token = m[1].trim();
    }
    if (!token && options.cookie) token = c.cookies[options.cookie];
    const payload = token ? await verifyJWT(token, options.secret, { issuer: options.issuer, audience: options.audience }) : null;
    if (!payload && required) {
      c.header('www-authenticate', 'Bearer');
      throw new HttpError(401, token ? 'Invalid or expired token' : 'Authentication required');
    }
    if (payload) c.state[key] = payload;
    return next();
  };
}
