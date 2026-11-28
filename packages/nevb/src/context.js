import { HttpError } from './http-error.js';
import { parseCookies, serializeCookie } from './cookies.js';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function addValue(obj, key, value) {
  if (key === '__proto__') return;
  if (hasOwn(obj, key)) obj[key] = [].concat(obj[key], value);
  else obj[key] = value;
}

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

  async _readBodyBytes() {
    const limit = this.app?.options?.maxBodySize;
    const hasLimit = typeof limit === 'number' && Number.isFinite(limit);
    if (hasLimit) {
      const declared = this.req.headers.get('content-length');
      if (declared != null && declared !== '') {
        const n = Number(declared);
        if (Number.isFinite(n) && n > limit) throw new HttpError(413, 'Payload Too Large');
      }
    }
    if (!this.req.body) return new Uint8Array(0);
    // Stream the body chunk-by-chunk so chunked/streaming bodies without a
    // content-length are also cut off as soon as they exceed the limit.
    if (typeof this.req.body.getReader === 'function') {
      const reader = this.req.body.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        total += chunk.byteLength;
        if (hasLimit && total > limit) {
          try { await reader.cancel(); } catch { /* ignore */ }
          throw new HttpError(413, 'Payload Too Large');
        }
        chunks.push(chunk);
      }
      const out = new Uint8Array(total);
      let off = 0;
      for (const chunk of chunks) { out.set(chunk, off); off += chunk.byteLength; }
      return out;
    }
    const buf = new Uint8Array(await this.req.arrayBuffer());
    if (hasLimit && buf.byteLength > limit) throw new HttpError(413, 'Payload Too Large');
    return buf;
  }

  async body() {
    if (this._body !== undefined) return this._body;
    const type = (this.req.headers.get('content-type') || '').toLowerCase();
    try {
      const bytes = await this._readBodyBytes();
      const text = new TextDecoder().decode(bytes);
      if (type.includes('json')) {
        this._body = text ? JSON.parse(text) : {};
      } else if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
        const clone = new Request(this.req.url, {
          method: this.req.method,
          headers: this.req.headers,
          body: bytes.byteLength ? bytes : undefined,
        });
        const form = await clone.formData();
        const obj = {};
        for (const [k, v] of form) addValue(obj, k, v);
        this._body = obj;
      } else {
        this._body = text;
      }
    } catch (err) {
      if (err instanceof HttpError || (Number.isInteger(err?.status) && err.status >= 400)) throw err;
      throw new HttpError(400, 'Invalid request body');
    }
    return this._body;
  }


  header(name, value, options = {}) {
    if (options.append) this._headers.append(name, value);
    else this._headers.set(name, value);
    return this;
  }

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

  send(value, status, headers) {
    return toResponse(this, value, status, headers);
  }

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
          }
        };
        closeFn = close;
        const send = (data, event, id, retry) => {
          if (closed) return;
          const payload = typeof data === 'string' ? data : JSON.stringify(data);
          // Sanitize single-line fields: any event/id containing CR/LF is
          // dropped entirely (rather than emitted with the newlines
          // stripped and the fragments joined), so a crafted value can
          // never inject forged SSE events or fields.
          const clean = (v) => (/[\r\n]/.test(String(v)) ? null : String(v));
          let msg = '';
          const eventClean = event ? clean(event) : null;
          if (eventClean) msg += `event: ${eventClean}\n`;
          const idClean = id != null ? clean(id) : null;
          if (idClean != null) msg += `id: ${idClean}\n`;
          if (retry != null && Number.isFinite(Number(retry)) && Number(retry) >= 0) {
            msg += `retry: ${Math.floor(Number(retry))}\n`;
          }
          for (const line of payload.split(/\r\n|\r|\n/)) msg += `data: ${line}\n`;
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

export function toResponse(c, out, status, headers) {
  if (out instanceof Response) return out;
  if (out === null || out === undefined) return c._make(null, status ?? 204, {}, headers);
  if (typeof out === 'string') return c.text(out, status, headers);
  if (out instanceof ReadableStream || out instanceof Blob || out instanceof ArrayBuffer || ArrayBuffer.isView(out)) {
    return c._make(out, status, { 'content-type': out.type || 'application/octet-stream' }, headers);
  }
  return c.json(out, status, headers);
}
