// Public environment variables: Nev.js (fullstack) fills `globalThis.__NEV_ENV__` on the server and in the browser
// with every variable whose name starts with NEV_PUBLIC_. Nothing else is ever exposed.

/** publicEnv('NEV_PUBLIC_API_URL', 'http://localhost:3000')  — same call works in SSR and in the browser. */
export function publicEnv(key, fallback) {
  const env = globalThis.__NEV_ENV__;
  const value = env && Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined;
  return value === undefined ? fallback : value;
}

/** Called by the framework. Replaces the public env object. */
export function setPublicEnv(values) {
  globalThis.__NEV_ENV__ = Object.freeze({ ...values });
}
