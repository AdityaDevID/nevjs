export function cors(options = {}) {
  const {
    origin = '*',
    methods = 'GET,HEAD,PUT,PATCH,POST,DELETE',
    exposedHeaders,
    credentials = false,
    maxAge,
  } = options;
  // `headers` is accepted as an alias for `allowedHeaders`.
  const allowedHeaders = options.allowedHeaders ?? options.headers;

  const resolve = (requestOrigin) => {
    if (typeof origin === 'function') {
      const r = origin(requestOrigin);
      // A function returning true means "allow this origin": echo the
      // request origin back, never the literal string "true".
      if (r === true) return requestOrigin || false;
      if (typeof r === 'string') return r;
      return r ? requestOrigin || false : false;
    }
    if (origin === '*') return credentials ? requestOrigin || false : '*';
    if (Array.isArray(origin)) return origin.includes(requestOrigin) ? requestOrigin : false;
    return origin;
  };

  return async (c, next) => {
    const requestOrigin = c.req.headers.get('origin') ?? '';
    const allow = resolve(requestOrigin);
    if (allow) {
      c.header('access-control-allow-origin', allow);
      if (allow !== '*') c.header('vary', 'Origin', { append: true });
      if (credentials) c.header('access-control-allow-credentials', 'true');
      if (exposedHeaders) c.header('access-control-expose-headers', [].concat(exposedHeaders).join(','));
    }
    if (c.method === 'OPTIONS' && c.req.headers.get('access-control-request-method')) {
      c.header('access-control-allow-methods', [].concat(methods).join(','));
      const wanted = allowedHeaders
        ? [].concat(allowedHeaders).join(',')
        : c.req.headers.get('access-control-request-headers');
      if (wanted) c.header('access-control-allow-headers', wanted);
      if (maxAge != null) c.header('access-control-max-age', String(maxAge));
      return new Response(null, { status: 204 });
    }
    return next();
  };
}
