export function publicEnv(key, fallback) {
  const env = globalThis.__NEV_ENV__;
  const value = env && Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined;
  return value === undefined ? fallback : value;
}

export function setPublicEnv(values) {
  globalThis.__NEV_ENV__ = Object.freeze({ ...values });
}
