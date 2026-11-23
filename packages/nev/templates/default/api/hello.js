// GET /api/hello?name=Ada   — return an object and Nev sends it as JSON.
export function get(c) {
  return { message: `Hello, ${c.query.name ?? 'world'}!`, time: new Date().toISOString() };
}
