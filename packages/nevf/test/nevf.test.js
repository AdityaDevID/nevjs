import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/',
});
dom.window.scrollTo = () => {};
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const nevf = await import('../src/index.js');
const {
  signal, computed, memo, effect, batch, untrack, onCleanup, onMount, createRoot,
  h, Fragment, render, createRef, Show, For, Switch, Match, ErrorBoundary,
  renderToString, Router, Link, navigate, location, matchPath, sortRoutes, parseQuery, resource,
} = nevf;

const tick = () => new Promise((r) => setTimeout(r, 0));
function mount(vnode) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const dispose = render(vnode, root);
  return { root, dispose };
}

describe('reactivity', () => {
  test('signal + effect re-run on change, dispose stops it', () => {
    const n = signal(1);
    const seen = [];
    const stop = effect(() => seen.push(n()));
    n.set(2);
    n.update((x) => x + 1);
    n.set(3);
    assert.deepEqual(seen, [1, 2, 3]);
    stop();
    n.set(10);
    assert.deepEqual(seen, [1, 2, 3]);
  });

  test('batch runs effects once', () => {
    const a = signal(1);
    const b = signal(1);
    let runs = 0;
    effect(() => {
      a();
      b();
      runs++;
    });
    batch(() => {
      a.set(2);
      b.set(2);
    });
    assert.equal(runs, 2);
  });

  test('computed is lazy, cached and glitch-free', () => {
    const a = signal(2);
    let evals = 0;
    const double = computed(() => (evals++, a() * 2));
    assert.equal(evals, 0);
    assert.equal(double(), 4);
    assert.equal(double(), 4);
    assert.equal(evals, 1);
    const seen = [];
    effect(() => seen.push(double()));
    a.set(5);
    assert.deepEqual(seen, [4, 10]);
  });

  test('memo cuts off unchanged values', () => {
    const n = signal(1);
    const isOdd = memo(() => n() % 2 === 1);
    let runs = 0;
    effect(() => {
      isOdd();
      runs++;
    });
    n.set(3);
    n.set(5);
    assert.equal(runs, 1);
    n.set(4);
    assert.equal(runs, 2);
  });

  test('untrack does not subscribe', () => {
    const n = signal(0);
    let runs = 0;
    effect(() => {
      untrack(n);
      runs++;
    });
    n.set(1);
    assert.equal(runs, 1);
  });

  test('effect cleanup runs before re-run and on dispose', () => {
    const n = signal(0);
    const log = [];
    const stop = effect(() => {
      const v = n();
      onCleanup(() => log.push('clean ' + v));
    });
    n.set(1);
    stop();
    assert.deepEqual(log, ['clean 0', 'clean 1']);
  });

  test('nested effects are disposed when the parent re-runs', () => {
    const outer = signal(0);
    const inner = signal(0);
    let innerRuns = 0;
    effect(() => {
      outer();
      effect(() => {
        inner();
        innerRuns++;
      });
    });
    outer.set(1);
    innerRuns = 0;
    inner.set(1);
    assert.equal(innerRuns, 1);
  });

  test('createRoot dispose cleans everything inside', () => {
    const n = signal(0);
    let runs = 0;
    let dispose;
    createRoot((d) => {
      dispose = d;
      effect(() => {
        n();
        runs++;
      });
    });
    dispose();
    n.set(1);
    assert.equal(runs, 1);
  });

  test('runaway effect loops are detected', () => {
    const n = signal(0);
    assert.throws(() => {
      effect(() => {
        n();
        n.set(n.peek() + 1);
      });
    }, /infinite loop/);
  });

  test('resource tracks loading/data/error', async () => {
    const ok = resource(async () => 42);
    assert.equal(ok.loading(), true);
    await tick();
    assert.equal(ok.data(), 42);
    assert.equal(ok.loading(), false);
    const bad = resource(async () => {
      throw new Error('boom');
    });
    await tick();
    assert.equal(bad.error().message, 'boom');
  });
});

describe('DOM rendering', () => {
  test('static tree, props and children', () => {
    const { root } = mount(
      h('div', { id: 'x', class: ['a', { b: true, c: false }], 'data-n': 5 }, h('span', null, 'hi'), ' ', 7),
    );
    assert.equal(root.innerHTML, '<div id="x" class="a b" data-n="5"><span>hi</span> 7</div>');
  });

  test('counter: reactive text, events, minimal updates', () => {
    const count = signal(0);
    let renders = 0;
    function Counter() {
      renders++;
      return h('button', { onClick: () => count.update((n) => n + 1) }, 'Count: ', count);
    }
    const { root } = mount(h(Counter));
    const btn = root.querySelector('button');
    assert.equal(btn.textContent, 'Count: 0');
    const textNode = btn.lastChild.previousSibling;
    btn.click();
    btn.click();
    assert.equal(btn.textContent, 'Count: 2');
    assert.equal(renders, 1, 'component body runs once');
    assert.equal(btn.lastChild.previousSibling, textNode, 'text node is updated in place');
  });

  test('reactive attributes, class and style', () => {
    const on = signal(false);
    const w = signal(10);
    const { root } = mount(
      h('div', {
        class: { active: on },
        title: () => (on() ? 'yes' : null),
        style: { width: w, color: 'red', opacity: 0.5 },
        hidden: () => !on(),
      }),
    );
    const el = root.firstChild;
    assert.equal(el.className, '');
    assert.equal(el.hasAttribute('title'), false);
    assert.equal(el.hasAttribute('hidden'), true);
    assert.equal(el.style.width, '10px');
    on.set(true);
    w.set(20);
    assert.equal(el.className, 'active');
    assert.equal(el.getAttribute('title'), 'yes');
    assert.equal(el.hasAttribute('hidden'), false);
    assert.equal(el.style.width, '20px');
    assert.equal(el.style.opacity, '0.5');
  });

  test('two-way input binding', () => {
    const text = signal('hello');
    const { root } = mount(
      h('div', null, h('input', { value: text, onInput: (e) => text.set(e.target.value) }), h('p', null, text)),
    );
    const input = root.querySelector('input');
    assert.equal(input.value, 'hello');
    input.value = 'world';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(root.querySelector('p').textContent, 'world');
    text.set('reset');
    assert.equal(input.value, 'reset');
  });

  test('select value is applied after options exist', () => {
    const { root } = mount(h('select', { value: 'b' }, h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B')));
    assert.equal(root.querySelector('select').value, 'b');
  });

  test('Show toggles and passes the value to render-props', () => {
    const user = signal(null);
    const { root } = mount(
      h(Show, { when: user, fallback: h('i', null, 'anon') }, (u) => h('b', null, 'Hi ', u.name)),
    );
    assert.equal(root.innerHTML.includes('<i>anon</i>'), true);
    user.set({ name: 'Ada' });
    assert.equal(root.querySelector('b').textContent, 'Hi Ada');
    user.set(null);
    assert.equal(root.querySelector('b'), null);
    assert.equal(root.querySelector('i').textContent, 'anon');
  });

  test('Show render-prop re-renders when the value is replaced (e.g. refetch), plain children do not', () => {
    const data = signal({ n: 1 });
    let plainRuns = 0;
    function Plain() {
      plainRuns++;
      return h('i', null, 'plain');
    }
    const { root } = mount(
      h('div', null,
        h(Show, { when: data }, (d) => h('b', null, 'n=', d.n)),
        h(Show, { when: data }, h(Plain)),
      ),
    );
    assert.equal(root.querySelector('b').textContent, 'n=1');
    data.set({ n: 2 });
    assert.equal(root.querySelector('b').textContent, 'n=2');
    assert.equal(plainRuns, 1, 'plain children are not rebuilt when only the value changes');
    const same = data.peek();
    data.set(same);
    assert.equal(root.querySelector('b').textContent, 'n=2');
  });

  test('Switch/Match picks the first truthy branch', () => {
    const s = signal('a');
    const { root } = mount(
      h(
        Switch,
        { fallback: h('em', null, 'none') },
        h(Match, { when: () => s() === 'a' }, h('p', null, 'A')),
        h(Match, { when: () => s() === 'b' }, h('p', null, 'B')),
      ),
    );
    assert.equal(root.textContent, 'A');
    s.set('b');
    assert.equal(root.textContent, 'B');
    s.set('z');
    assert.equal(root.textContent, 'none');
  });

  test('For: keyed reuse, reorder, insert, remove, index accessor', () => {
    const a = { n: 'a' };
    const b = { n: 'b' };
    const c = { n: 'c' };
    const list = signal([a, b, c]);
    const { root } = mount(h('ul', null, h(For, { each: list }, (it, i) => h('li', null, () => `${i()}:${it.n}`))));
    const text = () => [...root.querySelectorAll('li')].map((x) => x.textContent).join(',');
    assert.equal(text(), '0:a,1:b,2:c');
    const liB = root.querySelectorAll('li')[1];

    list.set([c, b, a]);
    assert.equal(text(), '0:c,1:b,2:a');
    assert.equal(root.querySelectorAll('li')[1], liB, 'DOM node reused, not recreated');

    const d = { n: 'd' };
    list.set([c, d, b]);
    assert.equal(text(), '0:c,1:d,2:b');

    list.set([]);
    assert.equal(text(), '');
    list.set([a]);
    assert.equal(text(), '0:a');
  });

  test('For disposes removed items (cleanups run)', () => {
    const x = { id: 1 };
    const y = { id: 2 };
    const list = signal([x, y]);
    const cleaned = [];
    function Row(p) {
      onCleanup(() => cleaned.push(p.item.id));
      return h('li', null, p.item.id);
    }
    mount(h('ul', null, h(For, { each: list }, (item) => h(Row, { item }))));
    list.set([y]);
    assert.deepEqual(cleaned, [1]);
  });

  test('components: props, children, Fragment, lifecycle', async () => {
    const log = [];
    function Card(props) {
      onMount(() => {
        log.push('mounted');
        return () => log.push('unmounted');
      });
      return h('section', null, h('h2', null, props.title), props.children);
    }
    const { root, dispose } = mount(h(Fragment, null, h(Card, { title: 'T' }, h('p', null, 'body')), h('hr')));
    assert.equal(root.innerHTML, '<section><h2>T</h2><p>body</p></section><hr>');
    await tick();
    assert.deepEqual(log, ['mounted']);
    dispose();
    assert.deepEqual(log, ['mounted', 'unmounted']);
    assert.equal(root.innerHTML, '');
  });

  test('ref (function and object)', () => {
    const r = createRef();
    let got;
    mount(h('div', null, h('a', { ref: r }), h('b', { ref: (el) => (got = el) })));
    assert.equal(r.current.tagName, 'A');
    assert.equal(got.tagName, 'B');
  });

  test('svg elements get the SVG namespace', () => {
    const { root } = mount(h('svg', { viewBox: '0 0 10 10' }, h('circle', { r: 5 })));
    assert.equal(root.querySelector('circle').namespaceURI, 'http://www.w3.org/2000/svg');
  });

  test('ErrorBoundary shows fallback and can reset', () => {
    const origError = console.error;
    console.error = () => {};
    try {
      let shouldThrow = true;
      function Bomb() {
        if (shouldThrow) throw new Error('kaboom');
        return h('p', null, 'safe');
      }
      const { root } = mount(
        h(ErrorBoundary, { fallback: (err, reset) => h('button', { onClick: reset }, err.message) }, h(Bomb)),
      );
      const btn = root.querySelector('button');
      assert.equal(btn.textContent, 'kaboom');
      shouldThrow = false;
      btn.click();
      assert.equal(root.textContent, 'safe');
    } finally {
      console.error = origError;
    }
  });

  test('errors inside reactive updates are caught by the boundary too', () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const bad = signal(false);
      const { root } = mount(
        h(ErrorBoundary, { fallback: () => h('p', null, 'fallback') }, h('div', null, () => {
          if (bad()) throw new Error('late');
          return 'fine';
        })),
      );
      assert.equal(root.textContent, 'fine');
      bad.set(true);
      assert.equal(root.textContent, 'fallback');
    } finally {
      console.error = origError;
    }
  });
});

describe('SSR', () => {
  test('renders html with escaping, attrs, style, void tags', () => {
    const html = renderToString(
      h('div', { class: ['a', { b: true }], style: { backgroundColor: 'red', width: 5 }, 'data-x': '"q"', hidden: true, onClick: () => {} },
        h('img', { src: '/a.png', alt: 'x<y' }),
        h('p', null, '<script>alert(1)</script> & more'),
        h('input', { value: 'v', disabled: false }),
      ),
    );
    assert.equal(
      html,
      '<div class="a b" style="background-color:red;width:5px" data-x="&quot;q&quot;" hidden>' +
        '<img src="/a.png" alt="x&lt;y"><p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; more</p><input value="v"></div>',
    );
  });

  test('components, signals, Show, For and Fragment', () => {
    const n = signal(3);
    function Item(p) {
      return h('li', null, p.i(), ':', p.item);
    }
    const html = renderToString(
      h(Fragment, null,
        h('h1', null, 'n=', n),
        h(Show, { when: () => n() > 2, fallback: 'small' }, 'big'),
        h('ul', null, h(For, { each: ['x', 'y'] }, (item, i) => h(Item, { item, i }))),
      ),
    );
    assert.equal(html, '<h1>n=3</h1>big<ul><li>0:x</li><li>1:y</li></ul>');
  });

  test('effects run once on the server and never subscribe to shared signals', () => {
    const shared = signal(0);
    let runs = 0;
    function C() {
      effect(() => {
        shared();
        runs++;
      });
      onMount(() => {
        throw new Error('onMount must not run on the server');
      });
      return h('p', null, 'ok');
    }
    renderToString(h(C));
    shared.set(1);
    assert.equal(runs, 1);
  });

  test('script/style content is not escaped but cannot close the tag', () => {
    assert.equal(renderToString(h('script', null, 'if (a<b) x="</script>"')), '<script>if (a<b) x="<\\/script>"</script>');
  });
});

describe('router', () => {
  test('matchPath', () => {
    assert.deepEqual(matchPath('/', '/'), {});
    assert.deepEqual(matchPath('/u/:id', '/u/42/'), { id: '42' });
    assert.deepEqual(matchPath('/u/:id', '/u/a%20b'), { id: 'a b' });
    assert.equal(matchPath('/u/:id', '/u'), null);
    assert.equal(matchPath('/u/:id', '/u/1/2'), null);
    assert.deepEqual(matchPath('/f/*path', '/f/a/b/c'), { path: 'a/b/c' });
    assert.deepEqual(matchPath('/f/*path', '/f'), { path: '' });
    assert.deepEqual(matchPath('*', '/any/thing'), { '*': 'any/thing' });
  });

  test('sortRoutes: static > param > wildcard', () => {
    const order = sortRoutes(['/*', '/a/:id', '/a/new', '/:x', '/'].map((path) => ({ path }))).map((r) => r.path);
    assert.deepEqual(order, ['/a/new', '/a/:id', '/:x', '/', '/*']);
    const docs = sortRoutes(['/docs/*rest', '/docs'].map((path) => ({ path }))).map((r) => r.path);
    assert.deepEqual(docs, ['/docs', '/docs/*rest']);
  });

  test('parseQuery', () => {
    assert.deepEqual(parseQuery('?a=1&b=2&b=3'), { a: '1', b: ['2', '3'] });
  });

  test('Router renders, navigates and Link intercepts clicks', async () => {
    const Home = () => h('h1', null, 'home');
    const User = (p) => h('h1', null, 'user ', p.params.id, p.query.tab ?? '');
    const NotFound = () => h('h1', null, '404');
    const { root } = mount(
      h('div', null,
        h(Link, { href: '/u/7?tab=x', id: 'go' }, 'go'),
        h(Router, { routes: [{ path: '/', component: Home }, { path: '/u/:id', component: User }], notFound: NotFound }),
      ),
    );
    assert.equal(root.querySelector('h1').textContent, 'home');
    root.querySelector('#go').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    assert.equal(window.location.pathname, '/u/7');
    assert.equal(root.querySelector('h1').textContent, 'user 7x');
    navigate('/nope');
    assert.equal(root.querySelector('h1').textContent, '404');
    navigate('/');
    assert.equal(root.querySelector('h1').textContent, 'home');
    assert.equal(location().pathname, '/');
  });

  test('Link ignores modified clicks and external URLs', () => {
    const { root } = mount(h('div', null, h(Link, { href: 'https://example.com', id: 'ext' }, 'x'), h(Link, { href: '/z', id: 'int' }, 'y')));
    const seen = [];
    root.addEventListener('click', (e) => {
      seen.push(e.defaultPrevented);
      e.preventDefault();
    });
    root.querySelector('#ext').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    root.querySelector('#int').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }),
    );
    assert.deepEqual(seen, [false, false], 'Link must not preventDefault for external or ctrl-clicks');
  });
});
