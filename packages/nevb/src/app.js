import { Context, toResponse } from './context.js';
import { HttpError, STATUS_TEXT } from './http-error.js';
import { compile, matchSegs, splitPath } from './router.js';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

function defaultNotFound(c) {
  return c.json({ error: 'Not Found', status: 404 }, 404);
}

function defaultError(err, c) {
  let status = 500;
  if (err instanceof HttpError) status = err.status;
  else if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) status = err.status;
  if (status >= 500 && !c.app.options.silent) console.error('[nevb] unhandled error:', err);
  const expose = status < 500 || c.app.options.exposeErrors;
  const body = { error: expose ? err?.message || STATUS_TEXT[status] : STATUS_TEXT[status] ?? 'Error', status };
  if (expose && err?.details !== undefined) body.details = err.details;
  return c.json(body, status);
}

/** Copy headers set via c.header()/c.setCookie() onto the outgoing response. */
function withContextHeaders(res, extra) {
  if (extra.keys().next().done) return res;
  const apply = (target) => {
    for (const [k, v] of extra) {
      if (k === 'set-cookie' || k === 'vary') target.headers.append(k, v);
      else if (!target.headers.has(k)) target.headers.set(k, v);
    }
  };
  try {
    apply(res);
    return res;
  } catch {
    // immutable headers (e.g. a Response from fetch()) → clone
    const copy = new Response(res.body, { status: res.status, statusText: res.statusText, headers: new Headers(res.headers) });
    apply(copy);
    return copy;
  }
}

/**
 * The application: a list of middleware + routes, executed in registration order.
 *
 *   const app = new App()
 *   app.use(logger())
 *   app.get('/users/:id', (c) => ({ id: c.params.id }))
 *   app.listen(3000)
 *
 * Handlers are `(c, next) => value`. A route handler is final: return a
 * Response, object (→ JSON), string (→ text), or nothing (→ 204). Middleware
 * may `await next()` to run the rest of the chain and get its Response back.
 */
export class App {
  constructor(options = {}) {
    this.options = { trustProxy: false, maxBodySize: 1024 * 1024, exposeErrors: false, silent: false, ...options };
    this.entries = [];
    this.errorHandler = defaultError;
    this.notFoundHandler = defaultNotFound;
  }

  /** app.use(mw...)  or  app.use('/prefix', mw...) */
  use(...args) {
    let path = '/';
    if (typeof args[0] === 'string') path = args.shift();
    const segs = compile(path);
    for (const fn of args.flat()) {
      if (typeof fn !== 'function') throw new TypeError('app.use() expects functions');
      this.entries.push({ kind: 'mw', method: null, segs, prefix: true, fn });
    }
    return this;
  }

  /** app.on('GET', '/path', ...handlers). Use 'ALL' for every method. */
  on(method, path, ...handlers) {
    const list = handlers.flat();
    if (!list.length) throw new TypeError(`app.${method.toLowerCase()}('${path}') needs a handler`);
    const segs = compile(path);
    const m = method.toUpperCase() === 'ALL' ? null : method.toUpperCase();
    list.forEach((fn, i) => {
      if (typeof fn !== 'function') throw new TypeError('handlers must be functions');
      this.entries.push({ kind: i === list.length - 1 ? 'route' : 'mw', method: m, segs, prefix: false, fn });
    });
    return this;
  }

  all(path, ...handlers) {
    return this.on('ALL', path, ...handlers);
  }

  /** Mount another App under a prefix (define the sub-app's routes first). */
  route(prefix, sub) {
    const base = compile(prefix);
    for (const e of sub.entries) this.entries.push({ ...e, segs: [...base, ...e.segs] });
    return this;
  }

  onError(fn) {
    this.errorHandler = fn;
    return this;
  }

  notFound(fn) {
    this.notFoundHandler = fn;
    return this;
  }

  /** Web-standard entry point: Request in, Response out. */
  async fetch(request, env) {
    const c = new Context(request, env, this);
    const parts = splitPath(c.path);
    const chain = [];
    for (const e of this.entries) {
      if (e.method && e.method !== c.method && !(e.method === 'GET' && c.method === 'HEAD')) continue;
      const params = matchSegs(e.segs, parts, e.prefix);
      if (params) chain.push({ fn: e.fn, params, isRoute: e.kind === 'route' });
    }

    const run = async (i) => {
      if (i >= chain.length) return toResponse(c, await this.notFoundHandler(c));
      const item = chain[i];
      c.params = item.params;
      let called = false;
      let downstream;
      const next = () => {
        if (called) throw new Error('next() called more than once');
        called = true;
        downstream = run(i + 1);
        return downstream;
      };
      const out = await item.fn(c, next);
      if (out === undefined) {
        if (called) return downstream;
        if (item.isRoute) return new Response(null, { status: 204 });
        return next(); // middleware that returned nothing: continue automatically
      }
      return toResponse(c, out);
    };

    let res;
    try {
      res = await run(0);
    } catch (err) {
      try {
        res = toResponse(c, await this.errorHandler(err, c));
      } catch (err2) {
        console.error('[nevb] error handler failed:', err2);
        res = new Response('Internal Server Error', { status: 500 });
      }
    }
    res = withContextHeaders(res, c._headers);
    if (c.method === 'HEAD' && res.body) {
      res = new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    return res;
  }

  /** Test helper: app.request('/path', { method: 'POST', body: ... }) */
  request(pathOrUrl, init) {
    const url = new URL(pathOrUrl, 'http://localhost');
    return this.fetch(new Request(url, init));
  }

  /**
   * Start a Node HTTP server. Resolves with the http.Server once listening.
   *   const server = await app.listen(3000)
   */
  async listen(port = 3000, hostname, callback) {
    if (typeof hostname === 'function') {
      callback = hostname;
      hostname = undefined;
    }
    const { listen } = await import('./node.js');
    const server = await listen(this, port, hostname);
    if (callback) callback(server);
    return server;
  }
}

for (const m of METHODS) {
  App.prototype[m] = function (path, ...handlers) {
    return this.on(m, path, ...handlers);
  };
}

export const createApp = (options) => new App(options);
