/**
 * Sensible security headers. Opt in to the stricter ones:
 *   secureHeaders({ hsts: true, csp: "default-src 'self'" })
 */
export function secureHeaders(options = {}) {
  const headers = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': options.frameOptions ?? 'SAMEORIGIN',
    'referrer-policy': options.referrerPolicy ?? 'strict-origin-when-cross-origin',
    'cross-origin-opener-policy': 'same-origin',
    'x-dns-prefetch-control': 'off',
  };
  if (options.hsts) {
    headers['strict-transport-security'] = typeof options.hsts === 'string' ? options.hsts : 'max-age=15552000; includeSubDomains';
  }
  if (options.csp) headers['content-security-policy'] = options.csp;
  if (options.permissionsPolicy) headers['permissions-policy'] = options.permissionsPolicy;

  return (c, next) => {
    for (const [k, v] of Object.entries(headers)) c.header(k, v);
    return next();
  };
}
