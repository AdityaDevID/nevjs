import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { App, Context, HttpError, logger, secureHeaders, serveStatic, matchSegs, splitPath, compile } from '@adityadevid/nevb';
import { renderToString, setLocation, parseQuery, setPublicEnv } from '@adityadevid/nevf';
import { buildTree } from '../client/tree.js';
import { loadConfig } from './config.js';
import { scanPages, scanApi } from './routes.js';
import { renderDocument, renderDocumentParts, formatTitle } from './html.js';
import { expandHead } from '../client/head.js';
import { loadEnv, publicEnvOf } from './env.js';
import { ruleMiddlewares } from './rules.js';
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

export function redirect(location, status = 302) {
  return new Response(null, { status, headers: { location: String(location) } });
}

export function notFound(message = 'Not Found') {
  throw new HttpError(404, message);
}

export class ActionFailure {
  constructor(status, data) {
    this.status = status;
    this.data = data;
  }
}

/** Return from a page `action` to re-render the page with `actionData` and a 4xx status (e.g. validation errors). */
export function fail(status = 400, data = null) {
  if (!Number.isInteger(status) || status < 400 || status > 599) throw new RangeError('[nev] fail() needs a 4xx/5xx status code');
  return new ActionFailure(status, data);
}

const ACTION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_CACHE_ENTRIES = 500;

export async function createNev(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const dev = !!options.dev;
  const envInfo = options.env === false ? { loaded: {}, public: publicEnvOf(process.env) } : loadEnv(root, { dev });
  setPublicEnv(envInfo.public);
  const config = await loadConfig(root, options.config ?? {});
  const pages = scanPages(root);
  const apiRoutes = scanApi(root);

  const app = new App({
    trustProxy: !!config.trustProxy,
    silent: !!options.silent,
    exposeErrors: dev,
    maxBodySize: config.maxBodySize ?? 1024 * 1024,
  });

  if (typeof config.setup === 'function') await config.setup(app);

  if (dev && !options.silent) app.use(logger());
  app.use(secureHeaders());
  for (const mw of ruleMiddlewares(config)) app.use(mw);

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
    const filter = name === 'three' ? (p) => /\.m?js$/.test(p) && !/webgpu|tsl|\.cjs|\.min\./i.test(p) : (p) => /\.m?js$/.test(p);
    packages[packages.length - 1].filter = filter;
    app.use(serveStatic({ root: pkg.dir, prefix, maxAge: dev ? 0 : 3600, filter }));
    if (name === 'three') {
      const addons = path.join(pkg.dir, '..', 'examples', 'jsm');
      if (fs.existsSync(addons)) {
        importMap['three/addons/'] = `${prefix}/addons/`;
        packages.push({ name: 'three/addons', dir: addons, prefix: `${prefix}/addons`, filter: (p) => /\.m?js$/.test(p) });
        app.use(serveStatic({ root: addons, prefix: `${prefix}/addons`, maxAge: dev ? 0 : 3600, filter: (p) => /\.m?js$/.test(p) }));
      }
    }
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

  app.get('/__nev/ping', (c) => c.text('ok'));
  if (dev) {
    app.get('/__nev/reload', (c) =>
      c.sse(({ send, onClose }) => {
        send('connected', 'hello');
        const timer = setInterval(() => send('ping', 'ping'), 15_000);
        timer.unref?.();
        onClose(() => clearInterval(timer));
        return new Promise(() => {});
      }),
    );
  }

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
    site: { title: config.title, titleTemplate: config.titleTemplate || '%s', origin: siteOrigin(config) },
  };

  async function loadSpec(spec) {
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
    return { mod: mods[0], Page, layouts };
  }

  function headInfo(c, mod, props) {
    let head = {};
    try {
      head = (typeof mod.head === 'function' ? mod.head(props) : mod.head) ?? {};
    } catch (err) {
      if (dev) throw err;
    }
    return {
      head,
      title: formatTitle(head.title, config),
      extra: expandHead(head, { origin: siteOrigin(config), url: c.path, title: head.title ?? config.title }),
    };
  }

  const tagList = (list) => list.map((x) => ({ ...x, 'data-nev': true }));

  function docBase(spec, info) {
    return {
      title: info.title,
      lang: info.head.lang ?? config.lang,
      meta: [...config.head.meta, ...tagList(info.extra.meta)],
      links: [...config.head.links, ...tagList(info.extra.links)],
      jsonLd: info.extra.jsonLd,
      scripts: config.head.scripts,
      importMap,
      preload: ['/__nev/client.js', importMap['@adityadevid/nevf'], spec.url, ...spec.layouts.map((l) => l.url)],
    };
  }

  const bootFor = (spec, page) => ({
    ...manifest,
    dev,
    env: envInfo.public,
    static: !!options.static,
    page: { page: spec.url, layouts: spec.layouts.map((l) => l.url), ...page },
  });

  function renderBody(c, loaded, props) {
    setLocation(c.path + c.url.search);
    return renderToString(buildTree(loaded.layouts, loaded.Page, props));
  }

  const propsFor = (c, params, data, error, actionData) => ({ url: c.path, query: parseQuery(c.url.search), params, data, error, actionData });

  async function renderSpec(c, spec, { status = 200, params = {}, data = null, error = null, actionData = null }) {
    const loaded = await loadSpec(spec);
    const props = propsFor(c, params, data, error, actionData);
    const info = headInfo(c, loaded.mod, props);
    const doc = renderDocument({
      ...docBase(spec, info),
      bodyHtml: renderBody(c, loaded, props),
      boot: bootFor(spec, { params, data, error, actionData }),
    });
    return c.html(doc, status, { 'cache-control': 'no-cache' });
  }

  const STREAM_HEADERS = { 'cache-control': 'no-cache', 'x-accel-buffering': 'no' };

  async function streamPage(c, route, params) {
    const loaded = await loadSpec(route);
    if (typeof loaded.mod.head === 'function') return null;
    const info = headInfo(c, loaded.mod, propsFor(c, params, null, null, null));
    const parts = renderDocumentParts(docBase(route, info));
    const enc = new TextEncoder();

    const body = new ReadableStream({
      async start(controller) {
        const send = (text) => controller.enqueue(enc.encode(text));
        send(parts.head);
        try {
          let tail;
          try {
            const out = await runLoader(c, route, params);
            if (out instanceof Response) {
              const location = out.headers.get('location');
              if (out.status >= 300 && out.status < 400 && location) tail = parts.redirectTail(location);
              else throw new HttpError(out.status >= 400 ? out.status : 500, 'Unsupported loader response');
            } else {
              tail = parts.tail(renderBody(c, loaded, propsFor(c, params, out, null, null)), bootFor(route, { params, data: out, error: null, actionData: null }));
            }
          } catch (err) {
            const is404 = err instanceof HttpError && err.status === 404;
            const spec = is404 ? notFoundSpec : errorSpec;
            const info2 = describeError(err);
            if (!is404 && info2.status >= 500 && !options.silent) console.error('[nev] error while rendering', c.path, '\n', err);
            const l2 = await loadSpec(spec);
            const error = is404 ? null : info2;
            tail = parts.tail(renderBody(c, l2, propsFor(c, {}, null, error, null)), bootFor(spec, { params: {}, data: null, error, actionData: null }));
          }
          send(tail);
        } catch (err) {
          console.error('[nev] streaming render failed:', err);
          send(parts.plainTail('Internal Server Error'));
        }
        controller.close();
      },
    });
    return c._make(body, 200, { 'content-type': 'text/html; charset=utf-8', ...STREAM_HEADERS });
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

  const loaderCache = new Map();

  async function runLoader(c, route, params) {
    const mod = await importModule(route.serverFile);
    if (typeof mod.load !== 'function') return null;
    c.params = params;
    const ttl = Number(mod.revalidate);
    const cacheable =
      !dev &&
      ttl > 0 &&
      c.method === 'GET' &&
      !c.req.headers.get('cookie') &&
      !c.req.headers.get('authorization');
    const key = cacheable ? c.path + c.url.search : null;
    if (key) {
      const hit = loaderCache.get(key);
      if (hit && hit.expires > Date.now()) return hit.data;
      if (hit) loaderCache.delete(key);
    }
    const out = await mod.load(c);
    const data = out === undefined ? null : out;
    if (key && !(data instanceof Response)) {
      if (loaderCache.size >= MAX_CACHE_ENTRIES) loaderCache.delete(loaderCache.keys().next().value);
      loaderCache.set(key, { data, expires: Date.now() + ttl * 1000 });
    }
    return data;
  }

  function matchPage(pathname) {
    const parts = splitPath(pathname);
    for (const route of pages.routes) {
      const params = matchSegs(route.segs, parts);
      if (params) return { route, params };
    }
    return null;
  }

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
      for (const [k, v] of c2._headers) c._headers.append(k, v);
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

  app.use(async (c, next) => {
    if (c.path !== '/api' && !c.path.startsWith('/api/')) return next();
    const parts = splitPath(c.path);
    for (const route of apiRoutes) {
      const params = matchSegs(route.segs, parts);
      if (!params) continue;
      route.mod ??= await importModule(route.file);
      const mod = route.mod;
      const method = c.method === 'HEAD' ? 'GET' : c.method;
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

  app.use(async (c, next) => {
    if (!ACTION_METHODS.has(c.method)) return next();
    if (c.path.startsWith('/__nev/') || c.path === '/api' || c.path.startsWith('/api/')) return next();
    const found = matchPage(c.path);
    if (!found) return next();
    try {
      const mod = found.route.serverFile ? await importModule(found.route.serverFile) : null;
      if (!mod || typeof mod.action !== 'function') return next();
      c.params = found.params;
      const out = await mod.action(c);
      loaderCache.clear();
      if (out instanceof Response) return out;
      let status = 200;
      let actionData = out === undefined ? null : out;
      if (out instanceof ActionFailure) {
        status = out.status;
        actionData = out.data ?? null;
      }
      const data = await runLoader(new Context(new Request(c.url, { headers: c.req.headers }), c.env, app), found.route, found.params);
      if (data instanceof Response) return data;
      return await renderSpec(c, found.route, { status, params: found.params, data, actionData });
    } catch (err) {
      return renderFailure(c, err);
    }
  });

  app.get('*', async (c) => {
    if (c.path.startsWith('/__nev/')) return c.text('Not Found', 404);
    const found = matchPage(c.path);
    if (!found) {
      if (/\.[a-z0-9]{1,8}$/i.test(c.path)) return c.text('Not Found', 404);
      return renderSpec(c, notFoundSpec, { status: 404 });
    }
    try {
      if (found.route.serverFile && c.method === 'GET' && !options.static) {
        const mod = await importModule(found.route.serverFile);
        if (mod.streaming === true || (config.streaming === true && mod.streaming !== false)) {
          const res = await streamPage(c, found.route, found.params);
          if (res) return res;
        }
      }
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

export async function startServer(options = {}) {
  const nev = await createNev(options);
  const requested = options.port ?? nev.config.port;
  const server = await nev.app.listen(requested, options.host);
  return { ...nev, server, port: server.address().port };
}

export async function createHandler(options = {}) {
  const nev = await createNev({ silent: true, ...options });
  const handler = (request, env) => nev.app.fetch(request, env);
  handler.nev = nev;
  return handler;
}
