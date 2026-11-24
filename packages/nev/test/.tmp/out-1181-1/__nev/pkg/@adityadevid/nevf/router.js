// NevF.js — client/server router: location signal, navigate(), <Link>, <Router>.

import { signal, memo } from './reactive.js';
import { h } from './dom.js';

const hasWindow = () => typeof window !== 'undefined' && typeof window.history !== 'undefined';

function parseURL(to) {
  const u = new URL(to, 'http://nev.local');
  return { pathname: u.pathname, search: u.search, hash: u.hash };
}

function browserLocation() {
  return hasWindow()
    ? { pathname: window.location.pathname, search: window.location.search, hash: window.location.hash }
    : { pathname: '/', search: '', hash: '' };
}

/** Reactive { pathname, search, hash }. */
export const location = signal(browserLocation());
export const useLocation = () => location;

let listening = false;
function listen() {
  if (listening || !hasWindow()) return;
  listening = true;
  window.addEventListener('popstate', () => location.set(browserLocation()));
}
listen();

/** Server-side: set the location before rendering. */
export function setLocation(url) {
  location.set(parseURL(url));
}

/** Go to a URL (pushState). On the server this only updates `location`. */
export function navigate(to, options = {}) {
  const loc = parseURL(to);
  if (!hasWindow()) {
    location.set(loc);
    return;
  }
  listen();
  const href = loc.pathname + loc.search + loc.hash;
  if (options.replace) window.history.replaceState({}, '', href);
  else window.history.pushState({}, '', href);
  location.set(loc);
  if (options.scroll !== false) {
    if (loc.hash) {
      const el = document.getElementById(decodeURIComponent(loc.hash.slice(1)));
      if (el && el.scrollIntoView) el.scrollIntoView();
    } else if (window.scrollTo) {
      try {
        window.scrollTo(0, 0);
      } catch {
        /* jsdom: not implemented */
      }
    }
  }
}

export function parseQuery(search) {
  const out = {};
  const sp = new URLSearchParams(search);
  for (const [k, v] of sp) {
    if (k === '__proto__') continue;
    if (Object.prototype.hasOwnProperty.call(out, k)) out[k] = [].concat(out[k], v);
    else out[k] = v;
  }
  return out;
}

/** Reactive query object for the current location. */
export function useQuery() {
  return memo(() => parseQuery(location().search), shallowEqual);
}

function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => String(a[k]) === String(b[k]));
}

// ----------------------------------------------------------------- matching

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function segmentsOf(pattern) {
  return pattern
    .split('/')
    .filter(Boolean)
    .map((s) => {
      if (s[0] === ':') return { t: 'param', name: s.slice(1), score: 2 };
      if (s[0] === '*') return { t: 'wild', name: s.slice(1) || '*', score: 1 };
      return { t: 'static', v: s, score: 3 };
    });
}

/**
 * Match "/users/:id" or "/files/*path" against a pathname.
 * Returns the params object, or null when it does not match.
 */
export function matchPath(pattern, pathname) {
  const segs = segmentsOf(pattern);
  const parts = pathname.split('/').filter(Boolean).map(safeDecode);
  const params = {};
  let i = 0;
  for (const s of segs) {
    if (s.t === 'wild') {
      params[s.name] = parts.slice(i).join('/');
      return params;
    }
    if (i >= parts.length) return null;
    if (s.t === 'static') {
      if (parts[i] !== s.v) return null;
    } else {
      params[s.name] = parts[i];
    }
    i++;
  }
  return i === parts.length ? params : null;
}

/**
 * Most specific first: static > :param > "pattern ends here" > *wildcard.
 * (A wildcard also matches an empty rest, so "/" and "/docs" must be tried before "/*" and "/docs/*".)
 */
export function sortRoutes(routes, getPattern = (r) => r.path ?? r.pattern ?? r) {
  const key = (r) => segmentsOf(getPattern(r));
  return [...routes].sort((a, b) => {
    const A = key(a);
    const B = key(b);
    const n = Math.max(A.length, B.length);
    for (let i = 0; i < n; i++) {
      const sa = A[i]?.score ?? 1.5;
      const sb = B[i]?.score ?? 1.5;
      if (sa !== sb) return sb - sa;
    }
    return 0;
  });
}

// --------------------------------------------------------------- components

const isExternal = (href) => /^[a-z][a-z0-9+.-]*:|^\/\//i.test(href);

/** <a> that navigates without a page load. */
export function Link(props) {
  const { href, children, replace, scroll, onClick, ...rest } = props;
  listen();
  return h(
    'a',
    {
      ...rest,
      href,
      onClick: (e) => {
        if (typeof onClick === 'function') onClick(e);
        if (e.defaultPrevented) return;
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (rest.target && rest.target !== '_self') return;
        if (rest.download != null) return;
        const target = typeof href === 'function' ? href() : href;
        if (!target || isExternal(target)) return;
        e.preventDefault();
        navigate(target, { replace, scroll });
      },
    },
    children,
  );
}

/**
 * Minimal SPA router.
 *   h(Router, { routes: [{ path: '/', component: Home }, { path: '/u/:id', component: User }],
 *               notFound: NotFound })
 * Components receive { params, query } props.
 */
export function Router(props) {
  listen();
  const routes = sortRoutes(props.routes);
  const match = memo(
    () => {
      const { pathname } = location();
      for (const route of routes) {
        const params = matchPath(route.path, pathname);
        if (params) return { route, params };
      }
      return null;
    },
    (a, b) => a === b || (!!a && !!b && a.route === b.route && shallowEqual(a.params, b.params)),
  );
  const query = useQuery();
  return () => {
    const m = match();
    if (!m) return props.notFound ? h(props.notFound, {}) : null;
    return h(m.route.component, { params: m.params, query: query.peek() });
  };
}
