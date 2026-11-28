const enc = new TextEncoder();
const dec = new TextDecoder();

export function bytesToB64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const utf8ToB64url = (s) => bytesToB64url(enc.encode(s));
export const b64urlToUtf8 = (s) => dec.decode(b64urlToBytes(s));

export function safeEqual(a, b) {
  const x = typeof a === 'string' ? enc.encode(a) : a;
  const y = typeof b === 'string' ? enc.encode(b) : b;
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const keyCache = new Map();
async function hmacKey(secret) {
  const k = typeof secret === 'string' ? secret : bytesToB64url(secret);
  let key = keyCache.get(k);
  if (!key) {
    key = crypto.subtle.importKey('raw', typeof secret === 'string' ? enc.encode(secret) : secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keyCache.set(k, key);
    if (keyCache.size > 50) keyCache.delete(keyCache.keys().next().value);
  }
  return key;
}

export async function hmac(secret, data) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return bytesToB64url(new Uint8Array(sig));
}

export async function sign(value, secret) {
  return `${value}.${await hmac(secret, value)}`;
}

export async function unsign(signed, secret) {
  if (typeof signed !== 'string') return null;
  const i = signed.lastIndexOf('.');
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const sig = signed.slice(i + 1);
  for (const s of [].concat(secret)) {
    if (safeEqual(sig, await hmac(s, value))) return value;
  }
  return null;
}

export function randomId(bytes = 16) {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(bytes)));
}


const parseDuration = (d) => {
  if (typeof d === 'number') return d;
  const m = /^(\d+)\s*(s|m|h|d|w)?$/.exec(String(d).trim());
  if (!m) throw new TypeError(`Invalid duration: ${d}`);
  return Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[m[2] ?? 's'];
};

export async function signJWT(payload, secret, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iat: now, ...payload };
  if (options.expiresIn != null) body.exp = now + parseDuration(options.expiresIn);
  if (options.notBefore != null) body.nbf = now + parseDuration(options.notBefore);
  if (options.issuer) body.iss = options.issuer;
  if (options.audience) body.aud = options.audience;
  if (options.subject) body.sub = options.subject;
  const head = utf8ToB64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = `${head}.${utf8ToB64url(JSON.stringify(body))}`;
  return `${data}.${await hmac(secret, data)}`;
}

export async function verifyJWT(token, secret, options = {}) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64urlToUtf8(parts[0]));
    if (header.alg !== 'HS256') return null;
    let ok = false;
    for (const s of [].concat(secret)) if (safeEqual(parts[2], await hmac(s, `${parts[0]}.${parts[1]}`))) ok = true;
    if (!ok) return null;
    const payload = JSON.parse(b64urlToUtf8(parts[1]));
    const now = Math.floor(Date.now() / 1000);
    const tol = typeof options.clockTolerance === 'number' && Number.isFinite(options.clockTolerance) ? options.clockTolerance : 0;
    // clockTolerance loosens both checks: a token is expired once
    // now - tolerance reaches exp (RFC 7519: a token must not be accepted
    // on or after exp), and not-yet-valid only while now + tolerance is
    // still before nbf. Non-numeric claims are invalid.
    if (payload.exp != null) {
      if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
      if (now - tol >= payload.exp) return null;
    }
    if (payload.nbf != null) {
      if (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf)) return null;
      if (now + tol < payload.nbf) return null;
    }
    if (options.issuer && payload.iss !== options.issuer) return null;
    if (options.audience) {
      const aud = [].concat(payload.aud ?? []);
      if (!aud.includes(options.audience)) return null;
    }
    return payload;
  } catch {
    return null;
  }
}


export async function hashPassword(password, { iterations = 210_000 } = {}) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return `pbkdf2$sha256$${iterations}$${bytesToB64url(salt)}$${bytesToB64url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, hash, iter, salt, digest] = String(stored).split('$');
    if (scheme !== 'pbkdf2' || hash !== 'sha256' || !iter || !salt || !digest) return false;
    const iterations = Number(iter);
    if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 10_000_000) return false;
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64urlToBytes(salt), iterations }, key, 256);
    return safeEqual(bytesToB64url(new Uint8Array(bits)), digest);
  } catch {
    // A malformed stored hash (bad base64url, bad salt, ...) is simply a
    // failed verification, never an exception.
    return false;
  }
}
