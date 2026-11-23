// Node.js adapter: IncomingMessage/ServerResponse <-> web-standard Request/Response.

import http from 'node:http';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from './http-error.js';

function toRequest(req, signal, options) {
  const trust = options.trustProxy;
  const proto =
    (trust && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()) ||
    (req.socket.encrypted ? 'https' : 'http');
  const host = (trust && req.headers['x-forwarded-host']) || req.headers.host || 'localhost';
  const url = new URL(req.url, `${proto}://${host}`);

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const item of v) headers.append(k, item);
    else if (v !== undefined) headers.set(k, v);
  }
  const init = { method: req.method, headers, signal };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    let size = 0;
    const limit = options.maxBodySize;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        size += chunk.length;
        if (size > limit) cb(new HttpError(413, 'Payload Too Large'));
        else cb(null, chunk);
      },
    });
    req.on('error', (err) => counter.destroy(err));
    init.body = Readable.toWeb(req.pipe(counter));
    init.duplex = 'half';
  }
  return new Request(url, init);
}

async function writeResponse(res, response, method) {
  res.statusCode = response.status;
  for (const [k, v] of response.headers) {
    if (k !== 'set-cookie') res.setHeader(k, v);
  }
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  if (cookies.length) res.setHeader('set-cookie', cookies);
  if (method === 'HEAD' || !response.body) {
    res.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(response.body), res);
  } catch {
    res.destroy(); // client went away or the stream failed mid-flight
  }
}

/** (req, res) => void — usable with http.createServer(), or as Express-style middleware. */
export function createNodeHandler(app) {
  return async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    let request;
    try {
      request = toRequest(req, controller.signal, app.options);
    } catch {
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }
    let response;
    try {
      const declared = Number(req.headers['content-length']);
      if (declared > app.options.maxBodySize) {
        response = new Response(JSON.stringify({ error: 'Payload Too Large', status: 413 }), {
          status: 413,
          headers: { 'content-type': 'application/json; charset=utf-8', connection: 'close' },
        });
      } else {
        response = await app.fetch(request, { incoming: req, outgoing: res });
      }
    } catch (err) {
      console.error('[nevb] fatal error:', err);
      response = new Response('Internal Server Error', { status: 500 });
    }
    await writeResponse(res, response, req.method);
  };
}

/** Start listening; resolves with the http.Server. Port 0 picks a free port. */
export function listen(app, port = 3000, hostname) {
  const server = http.createServer(createNodeHandler(app));
  server.keepAliveTimeout = 65_000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    const done = () => {
      server.off('error', reject);
      resolve(server);
    };
    if (hostname) server.listen(port, hostname, done);
    else server.listen(port, done);
  });
}
