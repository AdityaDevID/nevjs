import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { mimeFor } from '../mime.js';
import { safeDecode } from '../router.js';

export function serveStatic(options) {
  const { root, prefix = '/', index = 'index.html', maxAge = 0, immutable = false, dotfiles = 'deny', filter } = options;
  const absRoot = path.resolve(root);
  let realRoot;

  const statSafe = async (p) => {
    try {
      return await fs.promises.stat(p);
    } catch {
      return null;
    }
  };

  return async (c, next) => {
    if (c.method !== 'GET' && c.method !== 'HEAD') return next();

    let p = safeDecode(c.path);
    if (prefix !== '/') {
      if (p !== prefix && !p.startsWith(prefix.endsWith('/') ? prefix : prefix + '/')) return next();
      p = p.slice(prefix.length);
    }
    if (p.includes('\0')) return next();

    const rel = path.normalize(p).replace(/^([/\\])+/, '');
    let file = path.join(absRoot, rel);
    if (file !== absRoot && !file.startsWith(absRoot + path.sep)) return next();

    if (dotfiles === 'deny') {
      const segs = rel.split(path.sep).filter(Boolean);
      if (segs.some((s) => s.startsWith('.') && s !== '.well-known')) return next();
    }

    let stat = await statSafe(file);
    if (stat?.isDirectory()) {
      if (!index) return next();
      file = path.join(file, index);
      stat = await statSafe(file);
    }
    if (!stat || !stat.isFile()) return next();

    realRoot ??= await fs.promises.realpath(absRoot).catch(() => absRoot);
    const real = await fs.promises.realpath(file).catch(() => null);
    if (!real || (real !== realRoot && !real.startsWith(realRoot + path.sep))) return next();

    if (filter && !filter(path.relative(absRoot, file).split(path.sep).join('/'))) return next();

    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const lastModified = stat.mtime.toUTCString();
    const headers = {
      'content-type': mimeFor(file),
      'last-modified': lastModified,
      etag,
      'accept-ranges': 'bytes',
      'cache-control': maxAge > 0 ? `public, max-age=${maxAge}${immutable ? ', immutable' : ''}` : 'no-cache',
    };

    const inm = c.req.headers.get('if-none-match');
    const ims = c.req.headers.get('if-modified-since');
    if ((inm && inm.split(',').map((s) => s.trim()).includes(etag)) || (!inm && ims && new Date(ims) >= new Date(Math.floor(stat.mtimeMs / 1000) * 1000))) {
      return new Response(null, { status: 304, headers });
    }

    let start = 0;
    let end = stat.size - 1;
    let status = 200;
    const range = c.req.headers.get('range');
    if (range && stat.size > 0) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m && (m[1] || m[2])) {
        if (m[1] === '') {
          start = Math.max(0, stat.size - Number(m[2]));
        } else {
          start = Number(m[1]);
          if (m[2]) end = Math.min(end, Number(m[2]));
        }
        if (start > end || start >= stat.size) {
          return new Response(null, { status: 416, headers: { 'content-range': `bytes */${stat.size}` } });
        }
        status = 206;
        headers['content-range'] = `bytes ${start}-${end}/${stat.size}`;
      }
    }
    headers['content-length'] = String(stat.size === 0 ? 0 : end - start + 1);

    if (c.method === 'HEAD' || stat.size === 0) return new Response(null, { status, headers });
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end }));
    return new Response(stream, { status, headers });
  };
}
