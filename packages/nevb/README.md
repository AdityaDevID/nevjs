# nevb — NevB.js

Tiny web-standard backend framework: router, middleware, validation, static files, SSE. Zero dependencies.

```js
import { App } from 'nevb';

const app = new App();
app.get('/hello/:name', (c) => ({ hello: c.params.name }));
await app.listen(3000);
```

Full API reference: see the repository README (`../../README.md`).
