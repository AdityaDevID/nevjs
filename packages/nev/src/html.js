export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const LS = new RegExp(String.fromCharCode(0x2028), 'g');
const PS = new RegExp(String.fromCharCode(0x2029), 'g');

export function safeJSON(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LS, '\\u2028')
    .replace(PS, '\\u2029');
}

function attrs(obj) {
  let out = '';
  for (const [k, v] of Object.entries(obj)) {
    if (v === false || v == null) continue;
    if (!/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(k)) continue;
    out += v === true ? ` ${k}` : ` ${k}="${esc(v)}"`;
  }
  return out;
}

export function formatTitle(title, config) {
  const t = title ?? config.title;
  const tpl = config.titleTemplate || '%s';
  return title && tpl.includes('%s') ? tpl.replace('%s', () => t) : t;
}

export function renderDocumentParts(o) {
  const meta = (o.meta ?? []).map((m) => `<meta${attrs(m)}>`).join('\n    ');
  const links = (o.links ?? []).map((l) => `<link${attrs(l)}>`).join('\n    ');
  const jsonLd = (o.jsonLd ?? []).map((j) => `<script type="application/ld+json" data-nev>${safeJSON(j)}</script>`).join('\n    ');
  const scripts = (o.scripts ?? [])
    .map((s) => (typeof s === 'string' ? `<script src="${esc(s)}"></script>` : `<script${attrs(s)}></script>`))
    .join('\n    ');
  const preload = [...new Set(o.preload ?? [])].map((href) => `<link rel="modulepreload" href="${esc(href)}">`).join('\n    ');
  const head = `<!doctype html>
<html lang="${esc(o.lang ?? 'en')}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(o.title)}</title>
    ${meta}
    ${links}
    ${jsonLd}
    <script type="importmap">${safeJSON({ imports: o.importMap })}</script>
    ${preload}
    ${scripts}
  </head>
  <body>
    <div id="nev-root">`;
  const close = '</div>\n    <script type="module" src="/__nev/client.js"></script>\n  </body>\n</html>\n';
  return {
    head,
    tail: (bodyHtml, boot) => `${bodyHtml}</div>\n    <script type="application/json" id="__NEV_DATA__">${safeJSON(boot)}</script>\n    <script type="module" src="/__nev/client.js"></script>\n  </body>\n</html>\n`,
    redirectTail: (location) => `<p><a href="${esc(location)}">Redirecting…</a></p><script>location.replace(${safeJSON(String(location))})</script>${close}`,
    plainTail: (message) => `<p>${esc(message)}</p>${close}`,
  };
}

export function renderDocument(o) {
  const parts = renderDocumentParts(o);
  return parts.head + parts.tail(o.bodyHtml, o.boot);
}
