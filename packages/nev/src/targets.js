import { fillDestination } from './rules.js';

// Config patterns use ":name" and a trailing "/*" (= "*rest"); Netlify and Cloudflare Pages use ":name" and "*" / ":splat".
const sourceOf = (source) => source.replace(/\/\*[A-Za-z_]\w*$/, '/*');
const destinationOf = (destination) => destination.replace(/\*[A-Za-z_]\w*/g, ':splat');

export function redirectsFile(config) {
  const lines = [];
  for (const r of config.redirects ?? []) {
    const status = Number.isInteger(r.statusCode) ? r.statusCode : r.permanent ? 308 : 307;
    lines.push(`${sourceOf(r.source)} ${destinationOf(r.destination)} ${status}`);
  }
  return lines.length ? lines.join('\n') + '\n' : '';
}

export function headersFile(config) {
  const blocks = [];
  for (const rule of config.headers ?? []) {
    const pairs = Array.isArray(rule.headers) ? rule.headers.map((h) => [h.key, h.value]) : Object.entries(rule.headers ?? {});
    blocks.push([sourceOf(rule.source), ...pairs.map(([k, v]) => `  ${k}: ${String(v).replace(/[\r\n]+/g, ' ')}`)].join('\n'));
  }
  return blocks.length ? blocks.join('\n\n') + '\n' : '';
}

export const STATIC_TARGETS = ['netlify', 'cloudflare'];
export { fillDestination };
