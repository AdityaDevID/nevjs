export function cors(options = {}) {
  const {
    origin = '*',
    methods = 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders,
    exposedHeaders,
    credentials = false,
    maxAge,
  } = options;

  const resolve = (requestOrigin) => {
    if (typeof origin === 'function') return origin(requestOrigin);
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
