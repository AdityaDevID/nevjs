# Contributing

```bash
npm install
npm test        # unit + HTTP + (optional) Chromium tests
```

- Keep packages dependency-free (jsdom is a dev-only dependency of the monorepo).
- Every bug fix needs a regression test in the package's `test/` folder.
- Anything that serves files to browsers must keep the rules in `packages/nev/test/nev.test.js` ("what the browser may download") passing.
