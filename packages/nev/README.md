# @adityadevid/nevjs — Nev.js

Zero-build fullstack framework: file-based routing, SSR, server loaders, API routes, client-side navigation, static export. Built on [NevF](https://www.npmjs.com/package/nevf) + [NevB](https://www.npmjs.com/package/nevb) (+ [NevG](https://www.npmjs.com/package/nevg)).

```bash
npx @adityadevid/nevjs create my-site            # templates: default, api, game
cd my-site && npm install && npm run dev
```

```
pages/index.js            → /
pages/blog/[slug].js      → /blog/:slug       (+ [slug].server.js: export load(c) — server only)
api/guestbook.js          → /api/guestbook    (export get / post / put / patch / del)
middleware.js             → runs before every route (optional matcher)
public/  components/  lib/  nev.config.js
```

## Commands
`nev create` · `nev dev` (restart + live reload) · `nev start` · `nev routes` · `nev info` · `nev export` (static HTML for GitHub Pages / Netlify / S3)

## Highlights
- SSR + client takeover, loader data, redirects, real 404/500 status codes
- `middleware.js`, `/sitemap.xml` + `/robots.txt` (set `site` in `nev.config.js`)
- Everything from NevB re-exported for API routes (`session`, `jwtAuth`, `validate`, `rateLimit`, `compress`, `csrf`, …)
- 0.3: `.env` files + `NEV_PUBLIC_*`, route groups `(group)/`, config `redirects` / `headers` / `trailingSlash`, rich SEO `head` (Open Graph, canonical, JSON-LD), `notFound()`, `createHandler()` for serverless/edge (not yet tested on real platforms)
- Secure by default: `*.server.js`, `api/`, config and dotfiles are never sent to browsers; traversal and open-proxy attempts are refused

Full documentation: https://github.com/AdityaDevID/nevjs#readme — MIT.
