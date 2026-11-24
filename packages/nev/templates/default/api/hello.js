export function get(c) {
  return { message: `Hello, ${c.query.name ?? 'world'}!`, time: new Date().toISOString() };
}
