// Nev.js browser runtime: takes over the server-rendered page and handles
// client-side navigation (no full reloads), loader data and dev live-reload.

import { h, render, signal, batch, effect, untrack, location } from 'nevf';
import { buildTree } from '/__nev/tree.js';

const boot = JSON.parse(document.getElementById('__NEV_DATA__').textContent);
const root = document.getElementById('nev-root');

const modCache = new Map();
const load = (url) => {
  if (!modCache.has(url)) {
    modCache.set(
      url,
      import(url).catch((err) => {
        modCache.delete(url);
        throw err;
      }),
    );
  }
  return modCache.get(url);
};

// ---- route matching (same rules as the server) --------------------------------
function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
function match(pattern, pathname) {
  const segs = pattern.split('/').filter(Boolean);
  const parts = pathname.split('/').filter(Boolean).map(decode);
  const params = {};
  let i = 0;
  for (const s of segs) {
    if (s[0] === '*') {
      params[s.slice(1) || '*'] = parts.slice(i).join('/');
      return params;
    }
    if (i >= parts.length) return null;
    if (s[0] === ':') params[s.slice(1)] = parts[i];
    else if (s !== parts[i]) return null;
    i++;
  }
  return i === parts.length ? params : null;
}
function parseQuery(search) {
  const out = {};
  for (const [k, v] of new URLSearchParams(search)) {
    if (k === '__proto__') continue;
    out[k] = Object.prototype.hasOwnProperty.call(out, k) ? [].concat(out[k], v) : v;
  }
  return out;
}
// The manifest is already sorted most-specific-first by the server.
function findRoute(pathname) {
  for (const r of boot.routes) {
    const params = match(r.pattern, pathname);
    if (params) return { route: r, params };
  }
  return null;
}

// ---- views ------------------------------------------------------------------------
const view = signal(null);
let ticket = 0;
let currentKey = null;

function applyTitle(mod, props) {
  let title;
  try {
    const head = mod && mod.head ? mod.head(props) : null;
    title = head && head.title;
  } catch {
    /* ignore head errors in the browser */
  }
  const site = boot.site;
  const t = title ?? site.title;
  document.title = title && site.titleTemplate.includes('%s') ? site.titleTemplate.replace('%s', () => t) : t;
}

async function resolveView(loc) {
  const found = findRoute(loc.pathname);
  const base = { url: loc.pathname, query: parseQuery(loc.search) };

  const special = async (spec, extra) => {
    const [Page, ...layouts] = (await Promise.all([spec.page, ...spec.layouts].map(load))).map((m) => m.default);
    const props = { ...base, params: {}, data: null, ...extra };
    return { Page, layouts, props, mod: await load(spec.page) };
  };

  if (!found) return special(boot.notFound, {});

  const { route, params } = found;
  let data = null;
  if (route.load) {
    const res = await fetch('/__nev/data?path=' + encodeURIComponent(loc.pathname + loc.search), {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!res.ok && res.status !== 404 && res.status !== 500) throw new Error('data request failed: ' + res.status);
    const payload = await res.json();
    if (payload.redirect) return { redirect: payload.redirect };
    if (payload.notFound) return special(boot.notFound, {});
    if (payload.error) return special(boot.error, { error: payload.error });
    data = payload.data ?? null;
  }
  const mods = await Promise.all([route.page, ...route.layouts].map(load));
  const props = { ...base, params, data };
  return { Page: mods[0].default, layouts: mods.slice(1).map((m) => m.default), props, mod: mods[0] };
}

async function go(loc) {
  const key = loc.pathname + loc.search;
  if (key === currentKey) return; // hash-only change
  if (boot.static) {
    // statically exported site: there is no /__nev/data endpoint, so pages with a loader need a real page load
    const f = findRoute(loc.pathname);
    if (f && f.route.load) {
      window.location.assign(key + loc.hash);
      return;
    }
  }
  const mine = ++ticket;
  try {
    const next = await resolveView(loc);
    if (mine !== ticket) return; // a newer navigation won
    if (next.redirect) {
      const target = new URL(next.redirect, window.location.href);
      if (target.origin !== window.location.origin) {
        window.location.assign(target.href);
        return;
      }
      window.history.replaceState({}, '', target.pathname + target.search + target.hash);
      location.set({ pathname: target.pathname, search: target.search, hash: target.hash });
      return;
    }
    currentKey = key;
    batch(() => view.set(next));
    applyTitle(next.mod, next.props);
  } catch (err) {
    console.error('[nev] client navigation failed, falling back to a full page load:', err);
    if (mine === ticket) window.location.assign(key + location.peek().hash);
  }
}

// ---- start ----------------------------------------------------------------------------
async function start() {
  const initial = boot.page;
  const mods = await Promise.all([initial.page, ...initial.layouts].map(load));
  currentKey = window.location.pathname + window.location.search;
  view.set({
    Page: mods[0].default,
    layouts: mods.slice(1).map((m) => m.default),
    props: {
      url: window.location.pathname,
      query: parseQuery(window.location.search),
      params: initial.params,
      data: initial.data,
      error: initial.error,
    },
    mod: mods[0],
  });

  render(
    h(() => () => {
      const v = view();
      return v ? buildTree(v.layouts, v.Page, v.props) : null;
    }),
    root,
  );

  // Navigations (Link clicks, back/forward) all flow through the location signal.
  effect(() => {
    const loc = location();
    untrack(() => go(loc));
  });
  window.__NEV_READY__ = true;
  document.dispatchEvent(new CustomEvent('nev:ready'));
}

start().catch((err) => console.error('[nev] failed to start the client:', err));

// ---- dev live reload ------------------------------------------------------------------
if (boot.dev) {
  let opened = false;
  const es = new EventSource('/__nev/reload');
  es.addEventListener('open', () => (opened = true));
  es.addEventListener('error', () => {
    if (!opened) return;
    es.close();
    const poll = async () => {
      try {
        const r = await fetch('/__nev/ping', { cache: 'no-store' });
        if (r.ok) return window.location.reload();
      } catch {
        /* server is restarting */
      }
      setTimeout(poll, 300);
    };
    poll();
  });
}
