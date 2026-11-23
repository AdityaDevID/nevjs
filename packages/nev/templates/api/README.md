# {{name}}

A Nev.js API starter (NevB under the hood).

```bash
npm install
npm run dev
curl localhost:3000/api/todos
curl -X POST localhost:3000/api/todos -H 'content-type: application/json' -d '{"title":"hi"}'
```

`middleware.js` rate-limits `/api/*`, `nev.config.js` adds compression, request ids and CSRF protection.
Docker: `docker build -t {{name}} . && docker run -p 3000:3000 {{name}}`.
