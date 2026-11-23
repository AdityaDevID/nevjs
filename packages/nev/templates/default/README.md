# {{name}}

Created with [Nev.js](https://github.com/) — a zero-build fullstack JavaScript framework.

```bash
npm install
npm run dev      # http://localhost:3000 — restarts and live-reloads the browser on every save
npm start        # production mode
npm run routes   # list every page and API route
```

## Project layout

| Path | What it does |
| --- | --- |
| `pages/index.js` | the `/` page — default export is a component |
| `pages/blog/[slug].js` | `/blog/:slug` — `props.params.slug` |
| `pages/docs/[...path].js` | catch-all — `props.params.path` |
| `pages/_layout.js` | wraps every page in that folder and below (`props.children`) |
| `pages/_404.js`, `pages/_error.js` | optional custom 404 / error pages |
| `pages/blog/[slug].server.js` | `export function load(c)` — runs **only** on the server, result arrives as `props.data` |
| `api/guestbook.js` | `/api/guestbook` — export `get`, `post`, `put`, `patch`, `del` (and optional `middleware`) |
| `public/` | static files, served from `/` |
| `components/`, `lib/`, `shared/` | modules the browser may import |
| `lib/*.server.js` | server-only code (databases, secrets) — never sent to the browser |
| `nev.config.js` | title, `<head>` tags, `setup(app)` to add your own middleware |

### Rules of thumb

* Files under `pages/`, `components/`, `lib/` and `shared/` can run in the browser — import from `@adityadevid/nevf` there, never from `nevjs`.
* Anything secret goes in a `*.server.js` file. Those files are refused when the browser asks for them.
* Use `Link` from `@adityadevid/nevf` for navigation; plain `<a>` tags do a full page load.
