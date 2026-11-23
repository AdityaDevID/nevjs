# nevb — NevB.js

Tiny web-standard backend framework: router, middleware, validation, sessions, JWT, static files, SSE. **Zero dependencies**, Node ≥ 20, runs anywhere `fetch(Request) → Response` does.

```bash
npm install nevb
```

```js
import { App, logger, compress, session, validate, v } from 'nevb';

const app = new App();
app.use(logger(), compress(), session({ secret: process.env.SESSION_SECRET }));

app.get('/hello/:name', (c) => ({ hello: c.params.name }));
app.post('/users', validate({ body: v.object({ name: v.string({ min: 2 }) }) }), (c) => c.json(c.valid.body, 201));

await app.listen(3000);
```

Handlers are `(c, next)`. Return a `Response`, an object (→ JSON), a string, or nothing (→ 204). `app.fetch(request)` is the standard entry point; `app.request('/path')` is a test helper.

## Built in
| | |
|---|---|
| Routing | params, optional params, wildcards, sub-apps (`app.route`), `app.use('/prefix', mw)` |
| Context `c` | `params query cookies body() json() text() html() redirect() header() setCookie() sse() ip state valid` |
| Middleware | `logger cors rateLimit secureHeaders serveStatic compress csrf session requestId basicAuth bearerAuth jwtAuth timeout cacheControl etag health` |
| Validation | `v.string/number/boolean/enum/array/object/literal/union/record/tuple/date/url/uuid/any` + `.optional() .default() .nullable() .refine() .transform()` |
| Crypto | `sign/unsign`, `signJWT/verifyJWT` (HS256), `hashPassword/verifyPassword` (PBKDF2), `randomId`, `safeEqual` — WebCrypto only |

```js
// sessions: signed cookie, or server-side with a store
app.use(session({ secret, store: new MemoryStore() }));
app.get('/login', (c) => { c.session.user = 'ada'; return 'ok'; });

// JWT
const token = await signJWT({ sub: 'u1' }, secret, { expiresIn: '1h' });
app.get('/me', jwtAuth({ secret }), (c) => c.state.user);

// passwords
const hash = await hashPassword('hunter2');
await verifyPassword('hunter2', hash); // true
```

Security defaults: body size limit (413), safe cookies, constant-time secret comparison, `alg` header never trusted, anti-traversal static files. `rateLimit` and `MemoryStore` are per-process — use a shared store for several instances.

Part of the [Nev.js](https://github.com/AdityaDevID/nevjs) family. MIT.
