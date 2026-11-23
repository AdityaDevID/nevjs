import { HttpError } from './http-error.js';
import { parseCookies, serializeCookie } from './cookies.js';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function addValue(obj, key, value) {
  if (key === '__proto__') return;
  if (hasOwn(obj, key)) obj[key] = [].concat(obj[key], value);
  else obj[key] = value;
}

/**
 * Per-request context passed to every handler.
 *
 *   c.req        the web-standard Request
 *   c.url        parsed URL        c.path   pathname      c.method
 *   c.params     route params      c.query  query object  c.cookies
 *   c.state      scratch space for middleware (e.g. c.state.user)
 *   c.valid      validated input   (see validate())
 *   await c.body()                 parsed JSON / form / text body
 *   c.json() c.text() c.html() c.redirect() c.send() c.sse()  → Response
 *   c.header() c.status() c.setCookie() c.deleteCookie()
 */
export class Context {
  constructor(req, env, app) {
    this.req = req;
    this.env = env ?? {};
    this.app = app;
    this.url = new URL(req.url);
    this.method = req.method.toUpperCase();
    this.path = this.url.pathname;
    this.params = {};
    this.state = {};
    this.valid = {};
    this._headers = new Headers();
    this._status = undefined;
  }

  get headers() {
    return this.req.headers;
  }

  get query() {
    if (!this._query) {
      const q = {};
      for (const [k, v] of this.url.searchParams) addValue(q, k, v);
      this._query = q;
    }
    return this._query;
  }

  get cookies() {
    if (!this._cookies) this._cookies = parseCookies(this.req.headers.get('cookie'));
    return this._cookies;
  }

  get ip() {
    if (this.app?.options?.trustProxy) {
      const xff = this.req.headers.get('x-forwarded-for');
      if (xff) return xff.split(',')[0].trim();
    }
    return this.env.incoming?.socket?.remoteAddress ?? '';
  }

  /** Parse the request body by content-type: JSON → object, forms → object, else text. */
  async body() {
    if (this._body !== undefined) return this._body;
    const type = (this.req.headers.get('content-type') || '').toLowerCase();
    try {
      if (type.includes('json')) {
        const text = await this.req.text();
        this._body = text ? JSON.parse(text) : {};
      } else if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
        const form = await this.req.formData();
        const obj = {};
        for (const [k, v] of form) addValue(obj, k, v);
        this._body = obj;
      } else {
        this._body = await this.req.text();
      }
    } catch (err) {
      if (err instanceof HttpError || (Number.isInteger(err?.status) && err.status >= 400)) throw err;
      throw new HttpError(400, 'Invalid request body');
    }
    return this._body;
  }

  // ---- response building ------------------------------------------------

  /** Set a response header (applied to whatever Response is returned). */
  header(name, value, options = {}) {
    if (options.append) this._headers.append(name, value);
    else this._headers.set(name, value);
    return this;
  }

  /** Default status for the next response helper. */
  status(code) {
    this._status = code;
    return this;
  }

  setCookie(name, value, options = {}) {
    this._headers.append('set-cookie', serializeCookie(name, value, { httpOnly: true, sameSite: 'lax', ...options }));
    return this;
  }

  deleteCookie(name, options = {}) {
    return this.setCookie(name, '', { ...options, maxAge: 0, expires: new Date(0) });
  }

  json(data, status, headers) {
    const body = JSON.stringify(data === undefined ? null : data);
    return this._make(body, status, { 'content-type': 'application/json; charset=utf-8' }, headers);
  }

  text(text, status, headers) {
    return this._make(String(text), status, { 'content-type': 'text/plain; charset=utf-8' }, headers);
  }

  html(html, status, headers) {
    return this._make(String(html), status, { 'content-type': 'text/html; charset=utf-8' }, headers);
  }

  redirect(location, status = 302) {
    return new Response(null, { status, headers: { location: String(location) } });
  }

  notFound(message = 'Not Found') {
    return this.json({ error: message, status: 404 }, 404);
  }

  /** Turn any supported value into a Response (objects → JSON, strings → text, ...). */
  send(value, status, headers) {
    return toResponse(this, value, status, headers);
  }

  /**
   * Server-Sent Events.
   *   return c.sse(async ({ send, onClose }) => { send({ hello: 1 }); ... })
   * `send(data, event?, id?)`; the stream ends when the handler's promise settles
   * (return a never-ending promise to keep it open) or the client disconnects.
   */
  sse(handler, headers) {
    const enc = new TextEncoder();
    const signal = this.req.signal;
    let closeFn = () => {};
    const stream = new ReadableStream({
      start: (controller) => {
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        closeFn = close;
        const send = (data, event, id) => {
          if (closed) return;
          const payload = typeof data === 'string' ? data : JSON.stringify(data);
          let msg = '';
          if (event) msg += `event: ${event}\n`;
          if (id != null) msg += `id: ${id}\n`;
          for (const line of payload.split('\n')) msg += `data: ${line}\n`;
          controller.enqueue(enc.encode(msg + '\n'));
        };
        const closeHandlers = [];
        const onClose = (fn) => closeHandlers.push(fn);
        const finish = () => {
          close();
          for (const fn of closeHandlers) {
            try {
              fn();
            } catch {
              /* ignore */
            }
          }
        };
        if (signal) {
          if (signal.aborted) finish();
          else signal.addEventListener('abort', finish, { once: true });
        }
        Promise.resolve(handler({ send, close: finish, onClose, signal })).then(finish, (err) => {
          console.error('[nevb] sse handler error:', err);
          finish();
        });
      },
      cancel: () => closeFn(),
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        ...headers,
      },
    });
  }

  _make(body, status, defaults, headers) {
    const code = status ?? this._status ?? 200;
    const h = new Headers(defaults);
    if (headers) for (const [k, v] of Object.entries(headers)) h.set(k, v);
    const nullBody = code === 204 || code === 205 || code === 304;
    return new Response(nullBody ? null : body, { status: code, headers: h });
  }
}

/** Normalise whatever a handler returned into a Response. */
export function toResponse(c, out, status, headers) {
  if (out instanceof Response) return out;
  if (out === null || out === undefined) return c._make(null, status ?? 204, {}, headers);
  if (typeof out === 'string') return c.text(out, status, headers);
  if (out instanceof ReadableStream || out instanceof Blob || out instanceof ArrayBuffer || ArrayBuffer.isView(out)) {
    return c._make(out, status, { 'content-type': out.type || 'application/octet-stream' }, headers);
  }
  return c.json(out, status, headers); // objects, arrays, numbers, booleans
}
