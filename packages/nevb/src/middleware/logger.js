/** Logs "METHOD /path status 12ms" for every request. */
export function logger(options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  return async (c, next) => {
    const start = performance.now();
    let status = 500;
    try {
      const res = await next();
      status = res.status;
      return res;
    } catch (err) {
      status = Number.isInteger(err?.status) ? err.status : 500;
      throw err;
    } finally {
      const ms = performance.now() - start;
      log(`${c.method} ${c.path} ${status} ${ms < 10 ? ms.toFixed(1) : Math.round(ms)}ms`);
    }
  };
}
