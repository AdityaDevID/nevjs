const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    let value = part.slice(i + 1).trim();
    if (!key || key === '__proto__') continue;
    if (value.startsWith('"') && value.endsWith('"') && value.length > 1) value = value.slice(1, -1);
    if (!hasOwn(out, key)) out[key] = safeDecode(value);
  }
  return out;
}

const TOKEN = /^[\w!#$%&'*+.^`|~-]+$/;
const UNSAFE = /[;\r\n]/;

/**
 * Serialize a Set-Cookie value.
 * Options: maxAge (s), expires (Date), path ('/'), domain, secure, httpOnly, sameSite ('lax'|'strict'|'none')
 */
export function serializeCookie(name, value, opts = {}) {
  if (!TOKEN.test(name)) throw new TypeError(`Invalid cookie name: ${name}`);
  const path = opts.path ?? '/';
  if (UNSAFE.test(path) || (opts.domain && UNSAFE.test(opts.domain))) throw new TypeError('Invalid cookie attribute');
  let s = `${name}=${encodeURIComponent(value)}`;
  if (opts.maxAge != null) s += `; Max-Age=${Math.floor(opts.maxAge)}`;
  if (opts.domain) s += `; Domain=${opts.domain}`;
  s += `; Path=${path}`;
  if (opts.expires) s += `; Expires=${opts.expires.toUTCString()}`;
  if (opts.httpOnly) s += '; HttpOnly';
  if (opts.secure) s += '; Secure';
  if (opts.sameSite) {
    const v = String(opts.sameSite).toLowerCase();
    if (!['lax', 'strict', 'none'].includes(v)) throw new TypeError('Invalid SameSite');
    s += `; SameSite=${v[0].toUpperCase()}${v.slice(1)}`;
  }
  return s;
}
