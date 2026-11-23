const COMPRESSIBLE = /^(?:text\/|application\/(?:json|javascript|ecmascript|xml|x-www-form-urlencoded|manifest\+json|ld\+json|wasm)|image\/svg\+xml)/i;

function pickEncoding(header, allowed) {
  if (!header) return null;
  const accepted = new Map();
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    accepted.set(name.trim(), q ? Number(q.slice(2)) : 1);
  }
  let best = null;
  let bestQ = 0;
  for (const enc of allowed) {
    const q = accepted.get(enc) ?? accepted.get('*') ?? 0;
    if (q > bestQ) {
      best = enc;
      bestQ = q;
    }
  }
  return best;
}

/**
 * gzip / deflate response compression using the web-standard CompressionStream.
 *   app.use(compress())                         // threshold 1 KB
 * Skipped for: HEAD, non-compressible types, already-encoded bodies, event streams,
 * `cache-control: no-transform`, partial (206) responses, and bodies below `threshold`.
 * Responses without a content-length are buffered to decide, so keep streaming endpoints
 * on `text/event-stream` or add `cache-control: no-transform`.
 */
export function compress(options = {}) {
  const threshold = options.threshold ?? 1024;
  const encodings = options.encodings ?? ['gzip', 'deflate'];
  return async (c, next) => {
    const res = await next();
    if (!res || !res.body || c.method === 'HEAD' || res.status < 200 || res.status === 204 || res.status === 206 || res.status === 304) return res;
    const type = res.headers.get('content-type') || '';
    if (!COMPRESSIBLE.test(type) || /event-stream/i.test(type)) return res;
    if (res.headers.has('content-encoding') || /no-transform/i.test(res.headers.get('cache-control') || '')) return res;
    const encoding = pickEncoding(c.headers.get('accept-encoding'), encodings);
    const vary = (r) => {
      const cur = r.headers.get('vary');
      if (!cur) r.headers.set('vary', 'Accept-Encoding');
      else if (!/accept-encoding/i.test(cur)) r.headers.set('vary', `${cur}, Accept-Encoding`);
    };
    if (!encoding) {
      try {
        vary(res);
      } catch {
        /* immutable headers */
      }
      return res;
    }
    const declared = Number(res.headers.get('content-length'));
    if (declared && declared < threshold) return res;

    let body;
    if (declared) {
      body = res.body;
    } else {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length < threshold) return new Response(buf, { status: res.status, statusText: res.statusText, headers: res.headers });
      body = new Blob([buf]).stream();
    }
    const headers = new Headers(res.headers);
    headers.set('content-encoding', encoding);
    headers.delete('content-length');
    vary({ headers });
    const etag = headers.get('etag');
    if (etag && !etag.startsWith('W/')) headers.set('etag', `W/${etag}`);
    return new Response(body.pipeThrough(new CompressionStream(encoding)), { status: res.status, statusText: res.statusText, headers });
  };
}
