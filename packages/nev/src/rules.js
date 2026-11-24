import { compile, matchSegs, splitPath, trailingSlash } from '@adityadevid/nevb';

const toSegs = (source, what) => {
  if (typeof source !== 'string' || !source.startsWith('/')) throw new Error(`[nev] ${what}: "source" must be a path starting with "/" (got ${JSON.stringify(source)})`);
  return compile(source.replace(/\/\*$/, '/*rest').replace(/^\/\*$/, '/*rest'));
};

const encodeSplat = (v) => String(v).split('/').map(encodeURIComponent).join('/');

export function fillDestination(destination, params) {
  const out = destination.replace(/([:*])([A-Za-z_]\w*)/g, (m, kind, name) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return m;
    return kind === '*' ? encodeSplat(params[name]) : encodeURIComponent(params[name]);
  });
  return out;
}

function checkDestination(d, i) {
  if (typeof d !== 'string' || !(d.startsWith('/') || /^https?:\/\//i.test(d))) {
    throw new Error(`[nev] redirects[${i}]: "destination" must start with "/" or http(s):// (got ${JSON.stringify(d)})`);
  }
}

export function redirectsMiddleware(list = []) {
  if (!Array.isArray(list)) throw new Error('[nev] config.redirects must be an array');
  const rules = list.map((r, i) => {
    checkDestination(r?.destination, i);
    return {
      segs: toSegs(r.source, `redirects[${i}]`),
      destination: r.destination,
      status: Number.isInteger(r.statusCode) ? r.statusCode : r.permanent ? 308 : 307,
    };
  });
  if (!rules.length) return null;
  return (c, next) => {
    if (c.path.startsWith('/__nev/')) return next();
    const parts = splitPath(c.path);
    for (const rule of rules) {
      const params = matchSegs(rule.segs, parts);
      if (!params) continue;
      let target = fillDestination(rule.destination, params);
      if (target.startsWith('//')) target = '/' + target.replace(/^\/+/, '');
      if (c.url.search && !target.includes('?')) target += c.url.search;
      return c.redirect(target, rule.status);
    }
    return next();
  };
}

export function headersMiddleware(list = []) {
  if (!Array.isArray(list)) throw new Error('[nev] config.headers must be an array');
  const rules = list.map((r, i) => {
    const pairs = Array.isArray(r?.headers) ? r.headers.map((h) => [h?.key, h?.value]) : Object.entries(r?.headers ?? {});
    if (!pairs.length) throw new Error(`[nev] headers[${i}]: "headers" is empty`);
    for (const [k] of pairs) if (typeof k !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k)) throw new Error(`[nev] headers[${i}]: invalid header name ${JSON.stringify(k)}`);
    return { segs: toSegs(r.source, `headers[${i}]`), pairs };
  });
  if (!rules.length) return null;
  return (c, next) => {
    if (c.path.startsWith('/__nev/')) return next();
    const parts = splitPath(c.path);
    for (const rule of rules) if (matchSegs(rule.segs, parts)) for (const [k, v] of rule.pairs) c.header(k, String(v));
    return next();
  };
}

export function ruleMiddlewares(config) {
  const out = [];
  const mode = config.trailingSlash ?? 'ignore';
  if (mode !== 'ignore') {
    const ts = trailingSlash(mode);
    out.push((c, next) => (c.path.startsWith('/__nev/') || c.path === '/api' || c.path.startsWith('/api/') ? next() : ts(c, next)));
  }
  const red = redirectsMiddleware(config.redirects);
  if (red) out.push(red);
  const hdr = headersMiddleware(config.headers);
  if (hdr) out.push(hdr);
  return out;
}
