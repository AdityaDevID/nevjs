import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { App, Context, HttpError, logger, secureHeaders, serveStatic, matchSegs, splitPath, compile } from '@adityadevid/nevb';
import { renderToString, setLocation, parseQuery } from '@adityadevid/nevf';
import { buildTree } from '../client/tree.js';
import { loadConfig } from './config.js';
import { scanPages, scanApi } from './routes.js';
import { renderDocument, formatTitle } from './html.js';
import { siteOrigin, collectSitemapEntries, buildSitemap, buildRobots } from './seo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(here, '..', 'client');
const SERVER_FILE = /\.server\.m?js$/;
const ASSET_EXT = /\.(?:m?js|css|json|svg|png|jpe?g|gif|webp|avif|ico|woff2?|txt)$/i;

const importModule = (file) => import(pathToFileURL(file).href);

function resolvePackage(name, root) {
  let entry;
  try {
    entry = fileURLToPath(import.meta.resolve(name));
  } catch {
    try {
      entry = createRequire(path.join(root, 'package.json')).resolve(name);
    } catch {
      return null;
    }
  }
  return { name, dir: path.dirname(entry), file: path.basename(entry) };
}

/** Throw/return this from a loader to send the visitor elsewhere. */
export function redirect(location, status = 302) {
  return new Response(null, { status, headers: { location: String(location) } });
}

/**
 * Build a Nev application (a NevB App you can still extend).
 *
 *   const { app } = await createNev({ root: './my-site', dev: false })
 *   await app.listen(3000)
 */
export async function createNev(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const dev = !!options.dev;
  const config = await loadConfig(root, options.config ?? {});
  const pages = scanPages(root);
  const apiRoutes = scanApi(root);

  const app = new App({
    trustProxy: !!config.trustProxy,
    silent: !!options.silent,
    exposeErrors: dev,
    maxBodySize: config.maxBodySize ?? 1024 * 1024,
  });

  // 1. the user's own middleware and routes come first
  if (typeof config.setup === 'function') await config.setup(app);

  if (dev && !options.silent) app.use(logger());
  app.use(secureHeaders());

  // 2. static files and framework assets ------------------------------------------------
  app.use(serveStatic({ root: path.join(root, 'public'), index: false, maxAge: dev ? 0 : 3600 }));

  const importMap = {};
  const packages = [];
  const pkgNames = ['@adityadevid/nevf', ...config.browserPackages.filter((n) => n !== '@adityadevid/nevf')];
  for (const name of pkgNames) {
    const pkg = resolvePackage(name, root);
    if (!pkg) {
      if (name === '@adityadevid/nevf') throw new Error('[nev] Cannot find the "@adityadevid/nevf" package. Run `npm install`.');
      console.warn(`[nev] browserPackages: cannot resolve "${name}" — skipped`);
      continue;
    }
    const prefix = `/__nev/pkg/${name}`;
    importMap[name] = `${prefix}/${pkg.file}`;
    packages.push({ name, dir: pkg.dir, prefix });
    if (name === '@adityadevid/nevf') {
      importMap['@adityadevid/nevf/jsx-runtime'] = `${prefix}/jsx-runtime.js`;
      importMap['@adityadevid/nevf/jsx-dev-runtime'] = `${prefix}/jsx-dev-runtime.js`;
    }
    app.use(serveStatic({ root: pkg.dir, prefix, maxAge: dev ? 0 : 3600, filter: (p) => /\.m?js$/.test(p) }));
  }

  const clientDirs = config.clientDirs;
  app.use(
    serveStatic({
      root,
      prefix: '/__nev/app',
      filter: (rel) =>
        clientDirs.some((d) => rel.startsWith(d + '/')) &&
        ASSET_EXT.test(rel) &&
        !SERVER_FILE.test(rel) &&
        !rel.split('/').includes('node_modules'),
    }),
  );
  app.use(serveStatic({ root: clientDir, prefix: '/__nev', filter: (rel) => /\.js$/.test(rel) }));

  // 3. dev helpers -----------------------------------------------------------------------
  app.get('/__nev/ping', (c) => c.text('ok'));
  if (dev) {
    app.get('/__nev/reload', (c) =>
      c.sse(({ send, onClose }) => {
        send('connected', 'hello');
        const timer = setInterval(() => send('ping', 'ping'), 15_000);
        timer.unref?.();
        onClose(() => clearInterval(timer));
        return new Promise(() => {}); // stay open until the client goes away
      }),
    );
  }

  // 4. special pages ---------------------------------------------------------------------
  const notFoundSpec = pages.notFound ?? {
    file: path.join(clientDir, 'not-found.js'),
    url: '/__nev/not-found.js',
    layouts: pages.rootLayouts,
  };
  const errorSpec = pages.error ?? {
    file: path.join(clientDir, 'error.js'),
    url: '/__nev/error.js',
    layouts: pages.rootLayouts,
  };

  const manifest = {
    routes: pages.routes.map((r) => ({
      pattern: r.pattern,
      page: r.url,
      layouts: r.layouts.map((l) => l.url),
      load: !!r.serverFile,
    })),
    notFound: { page: notFoundSpec.url, layouts: notFoundSpec.layouts.map((l) => l.url) },
    error: { page: errorSpec.url, layouts: errorSpec.layouts.map((l) => l.url) },
    site: { title: config.title, titleTemplate: config.titleTemplate || '%s' },
  };

  // 5. rendering ---------------------------------------------------------------------------
  async function renderSpec(c, spec, { status = 200, params = {}, data = null, error = null }) {
    const mods = await Promise.all([spec.file, ...spec.layouts.map((l) => l.file)].map(importModule));
    const Page = mods[0].default;
    if (typeof Page !== 'function') {
      throw new Error(`[nev] ${path.relative(root, spec.file)} must export a component as its default export`);
    }
    const layouts = mods.slice(1).map((m, i) => {
      if (typeof m.default !== 'function') {
        throw new Error(`[nev] ${path.relative(root, spec.layouts[i].file)} must export a component as its default export`);
      }
      return m.default;
    });
    const props = { url: c.path, query: parseQuery(c.url.search), params, data, error };

    let head = {};
    try {
      head = (typeof mods[0].head === 'function' ? mods[0].head(props) : null) ?? {};
    } catch (err) {
      if (dev) throw err;
    }

    setLocation(c.path + c.url.search);
    const bodyHtml = renderToString(buildTree(layouts, Page, props));

    const doc = renderDocument({
      bodyHtml,
      title: formatTitle(head.title, config),
      lang: head.lang ?? config.lang,
      meta: [...config.head.meta, ...(head.meta ?? [])],
      links: [...config.head.links, ...(head.links ?? [])],
      scripts: config.head.scripts,
      importMap,
      boot: {
        ...manifest,
        dev,
        static: !!options.static,
        page: { page: spec.url, layouts: spec.layouts.map((l) => l.url), params, data, error },
      },
    });
    return c.html(doc, status, { 'cache-control': 'no-cache' });
  }

  function describeError(err) {
    const status = err instanceof HttpError ? err.status : Number.isInteger(err?.status) && err.status >= 400 ? err.status : 500;
    const expose = status < 500 || dev;
    const info = { status, message: expose ? err?.message || 'Error' : 'Internal Server Error' };
    if (dev && status >= 500 && err?.stack) info.stack = err.stack;
    return info;
  }

  async function renderFailure(c, err) {
    if (err instanceof HttpError && err.status === 404) return renderSpec(c, notFoundSpec, { status: 404 });
    const info = describeError(err);
    if (info.status >= 500 && !options.silent) console.error('[nev] error while rendering', c.path, '\n', err);
    try {
      return await renderSpec(c, errorSpec, { status: info.status, error: info });
    } catch (err2) {
      console.error('[nev] the error page itself failed:', err2);
      return c.text(info.message, info.status);
    }
  }

  async function runLoader(c, route, params) {
    const mod = await importModule(route.serverFile);
    if (typeof mod.load !== 'function') return null;
    c.params = params;
    const out = await mod.load(c);
    return out === undefined ? null : out;
  }

  function matchPage(pathname) {
    const parts = splitPath(pathname);
    for (const route of pages.routes) {
      const params = matchSegs(route.segs, parts);
      if (params) return { route, params };
    }
    return null;
  }

  // 5b. project-level middleware: <root>/middleware.js ------------------------------------------------
  //   export default (c, next) => { ... }            // or an array of them
  //   export const matcher = ['/admin/*', '/api/*']   // optional: only run for these paths
  const mwFile = ['middleware.js', 'middleware.mjs'].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  if (mwFile) {
    const mod = await importModule(mwFile);
    const list = [].concat(mod.default ?? mod.middleware ?? []);
    if (!list.length || !list.every((f) => typeof f === 'function')) {
      throw new Error('[nev] middleware.js must export a function (or an array of functions) as its default export');
    }
    const matchers = mod.matcher ? [].concat(mod.matcher).map((p) => compile(p.replace(/\/\*$/, '/*rest'))) : null;
    for (const fn of list) {
      app.use((c, next) => {
        if (c.path.startsWith('/__nev/')) return next();
        if (matchers && !matchers.some((m) => matchSegs(m, splitPath(c.path), true))) return next();
        return fn(c, next);
      });
    }
  }

  // 5c. sitemap.xml + robots.txt (only when `site` is configured; files in public/ win) ------------------------
  const origin = siteOrigin(config);
  if (origin && config.sitemap !== false) {
    app.get('/sitemap.xml', async (c) => {
      const entries = await collectSitemapEntries(config, pages);
      return c.text(buildSitemap(origin, entries), 200, { 'content-type': 'application/xml; charset=utf-8' });
    });
  }
  if (origin && config.robots !== false) {
    app.get('/robots.txt', (c) => c.text(buildRobots(config, origin)));
  }

  // 6. loader data for client-side navigation ---------------------------------------------------
  app.get('/__nev/data', async (c) => {
    const bad = (message) => c.json({ error: { status: 400, message } }, 400, { 'cache-control': 'no-store' });
    const target = c.query.path;
    if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') || target.includes('\\')) {
      return bad('Invalid path');
    }
    const url = new URL(target, c.url.origin);
    if (url.origin !== c.url.origin) return bad('Invalid path');

    const found = matchPage(url.pathname);
    const headers = { 'cache-control': 'no-store' };
    if (!found) return c.json({ notFound: true }, 404, headers);

    const c2 = new Context(new Request(url, { headers: c.req.headers }), c.env, app);
    try {
      const out = found.route.serverFile ? await runLoader(c2, found.route, found.params) : null;
      for (const [k, v] of c2._headers) c._headers.append(k, v); // cookies etc. set by the loader
      if (out instanceof Response) {
        const location = out.headers.get('location');
        if (out.status >= 300 && out.status < 400 && location) return c.json({ redirect: location }, 200, headers);
        return c.json({ error: { status: out.status, message: 'Unsupported loader response' } }, out.status >= 400 ? out.status : 500, headers);
      }
      return c.json({ data: out }, 200, headers);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return c.json({ notFound: true }, 404, headers);
      const info = describeError(err);
      if (info.status >= 500 && !options.silent) console.error('[nev] loader error for', url.pathname, '\n', err);
      return c.json({ error: info }, info.status, headers);
    }
  });

  // 7. API routes ----------------------------------------------------------------------------------
  app.use(async (c, next) => {
    if (c.path !== '/api' && !c.path.startsWith('/api/')) return next();
    const parts = splitPath(c.path);
    for (const route of apiRoutes) {
      const params = matchSegs(route.segs, parts);
      if (!params) continue;
      route.mod ??= await importModule(route.file);
      const mod = route.mod;
      const method = c.method === 'HEAD' ? 'GET' : c.method;
      // An export may be a function or an array of functions [...middleware, handler].
      const exported = (name) => {
        const value = name === 'DELETE' ? (mod.del ?? mod.delete) : mod[name.toLowerCase()];
        const list = [].concat(value ?? []);
        return list.length && list.every((f) => typeof f === 'function') ? list : null;
      };
      const handlers = exported(method) ?? exported('ALL') ?? exported('DEFAULT');
      if (!handlers) {
        const allow = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((m) => exported(m)).join(', ');
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow } });
        return new Response(JSON.stringify({ error: 'Method Not Allowed', status: 405 }), {
          status: 405,
          headers: { 'content-type': 'application/json; charset=utf-8', allow },
        });
      }
      c.params = params;
      const fn = handlers[handlers.length - 1];
      const chain = [...(Array.isArray(mod.middleware) ? mod.middleware : []), ...handlers.slice(0, -1)];
      const run = async (i) => {
        if (i >= chain.length) return c.send(await fn(c));
        let downstream;
        const out = await chain[i](c, () => (downstream = run(i + 1)));
        if (out === undefined) return downstream ?? run(i + 1);
        return c.send(out);
      };
      return run(0);
    }
    return c.json({ error: 'Not Found', status: 404 }, 404);
  });

  // 8. pages -----------------------------------------------------------------------------------------
  app.get('*', async (c) => {
    if (c.path.startsWith('/__nev/')) return c.text('Not Found', 404);
    const found = matchPage(c.path);
    if (!found) {
      // "/logo.png" that does not exist should not return an HTML page
      if (/\.[a-z0-9]{1,8}$/i.test(c.path)) return c.text('Not Found', 404);
      return renderSpec(c, notFoundSpec, { status: 404 });
    }
    try {
      let data = null;
      if (found.route.serverFile) {
        const out = await runLoader(c, found.route, found.params);
        if (out instanceof Response) return out;
        data = out;
      }
      return await renderSpec(c, found.route, { params: found.params, data });
    } catch (err) {
      return renderFailure(c, err);
    }
  });

  return { app, config, pages, api: apiRoutes, importMap, packages, clientDir, root, dev };
}

/** createNev() + listen. Resolves { app, server, port, ... }. */
export async function startServer(options = {}) {
  const nev = await createNev(options);
  const requested = options.port ?? nev.config.port;
  const server = await nev.app.listen(requested, options.host);
  return { ...nev, server, port: server.address().port };
}
