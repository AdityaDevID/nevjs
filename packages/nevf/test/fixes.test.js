import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
dom.window.scrollTo = () => {};
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const {
  signal, computed, createSelector, effect, createRoot, h, render, hydrate,
  Router, navigate, setLocation, useQuery,
  createStore, snapshot, persisted,
} = await import('../src/index.js');

const mount = (vnode) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const dispose = render(vnode, root);
  return { root, dispose };
};

const fakeStorage = () => {
  const m = new Map();
  const st = {
    writes: 0,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      st.writes++;
      m.set(k, String(v));
    },
    m,
  };
  return st;
};

function fireStorage(key, storageArea, newValue) {
  const e = new window.Event('storage');
  Object.defineProperties(e, {
    key: { value: key },
    storageArea: { value: storageArea },
    newValue: { value: newValue },
  });
  window.dispatchEvent(e);
}

describe('fix: persisted cross-tab loop', () => {
  test('storage event value is not written back, and identical serializations are skipped', () => {
    const storage = fakeStorage();
    createRoot((dispose) => {
      const s = persisted('sync-obj', { a: 1 }, { storage });
      assert.deepEqual(s(), { a: 1 });
      const afterInit = storage.writes;
      assert.ok(afterInit >= 1, 'initial value is persisted');

      fireStorage('sync-obj', storage, JSON.stringify({ a: 2 }));
      assert.deepEqual(s(), { a: 2 }, 'value from other tab is applied');
      assert.equal(storage.writes, afterInit, 'applying a storage event must not write back (would loop across tabs)');

      s.set({ a: 2 });
      assert.equal(storage.writes, afterInit, 'writing a value whose serialization is unchanged is skipped');

      s.set({ a: 3 });
      assert.equal(storage.writes, afterInit + 1, 'genuine changes still persist');
      assert.equal(storage.m.get('sync-obj'), '{"a":3}');
      dispose();
    });
  });
});

describe('fix: computed ownership', () => {
  test('disposing the owner unsubscribes the computed from its sources', () => {
    const src = signal(1);
    let evals = 0;
    let c;
    let disposeRoot;
    createRoot((d) => {
      disposeRoot = d;
      c = computed(() => (evals++, src() * 10));
    });
    assert.equal(c(), 10);
    assert.equal(evals, 1);

    let runs = 0;
    let seen;
    const stop = effect(() => {
      runs++;
      seen = c();
    });
    assert.deepEqual([runs, seen], [1, 10]);
    src.set(2);
    assert.deepEqual([runs, seen, evals], [2, 20, 2]);

    disposeRoot();
    src.set(3);
    assert.deepEqual([runs, seen], [2, 20], 'disposed computed no longer propagates source changes');
    stop();
  });
});

describe('fix: Router fallback / routes default', () => {
  test('Router without routes renders the fallback instead of throwing', () => {
    setLocation('/nowhere');
    const Fallback = () => h('h1', null, 'fallback page');
    const { root, dispose } = mount(h(Router, { fallback: Fallback }));
    assert.equal(root.querySelector('h1').textContent, 'fallback page');
    dispose();
  });

  test('Router accepts a fallback VNode and prefers fallback over legacy notFound', () => {
    setLocation('/missing');
    const NotFound = () => h('h1', null, 'not found');
    const a = mount(h(Router, { routes: [{ path: '/', component: () => h('p', null, 'home') }], fallback: h('h1', null, 'fb vnode') }));
    assert.equal(a.root.querySelector('h1').textContent, 'fb vnode');
    a.dispose();

    const b = mount(
      h(Router, {
        routes: [{ path: '/', component: () => h('p', null, 'home') }],
        fallback: () => h('h1', null, 'fallback wins'),
        notFound: NotFound,
      }),
    );
    assert.equal(b.root.querySelector('h1').textContent, 'fallback wins');
    b.dispose();

    const c = mount(h(Router, { routes: [{ path: '/', component: () => h('p', null, 'home') }], notFound: NotFound }));
    assert.equal(c.root.querySelector('h1').textContent, 'not found', 'legacy notFound alias still works');
    c.dispose();
    setLocation('/');
  });
});

describe('fix: useQuery shallowEqual', () => {
  test("'a,b' string does not collide with ['a','b'] array", () => {
    setLocation('/?x=a,b');
    const q = useQuery();
    let runs = 0;
    let latest;
    const stop = effect(() => {
      runs++;
      latest = q();
    });
    assert.deepEqual(latest, { x: 'a,b' });
    setLocation('/?x=a&x=b');
    assert.deepEqual(latest, { x: ['a', 'b'] });
    assert.equal(runs, 2, 'query subscribers are notified when the shape changes from string to array');
    stop();
    setLocation('/');
  });
});

describe('fix: snapshot clones Date/Map/Set', () => {
  test('Date, Map and Set (and their values) are deep-copied, not shared', () => {
    const when = new Date(1000);
    const mapVal = { n: 1 };
    const setVal = { n: 2 };
    const [s] = createStore({ when, map: new Map([['k', mapVal]]), set: new Set([setVal]), nested: { at: new Date(5) } });
    const snap = snapshot(s);

    assert.ok(snap.when instanceof Date);
    assert.notEqual(snap.when, when);
    assert.equal(snap.when.getTime(), 1000);
    assert.notEqual(snap.nested.at, s.nested.at);
    assert.equal(snap.nested.at.getTime(), 5);

    assert.ok(snap.map instanceof Map);
    assert.notEqual(snap.map, s.map);
    assert.deepEqual(snap.map.get('k'), { n: 1 });
    assert.notEqual(snap.map.get('k'), mapVal);

    assert.ok(snap.set instanceof Set);
    assert.notEqual(snap.set, s.set);
    const [snapSetVal] = [...snap.set];
    assert.deepEqual(snapSetVal, { n: 2 });
    assert.notEqual(snapSetVal, setVal);

    when.setTime(9999);
    mapVal.n = 99;
    setVal.n = 99;
    assert.equal(snap.when.getTime(), 1000, 'mutating the original Date does not leak into the snapshot');
    assert.equal(snap.map.get('k').n, 1);
    assert.equal([...snap.set][0].n, 2);
  });
});

describe('fix: navigate with malformed hash', () => {
  test('does not throw URIError on an undecodable hash fragment', () => {
    assert.doesNotThrow(() => navigate('/somewhere#%E0%A4%A'));
    assert.equal(window.location.hash, '#%E0%A4%A');
    navigate('/');
  });
});

describe('fix: hydrate dev warning', () => {
  test('warns in dev mode that hydrate is a client takeover, and stays silent otherwise', () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      const a = mount(h('p', null, 'ssr'));
      a.dispose();
      const host = document.createElement('div');
      host.innerHTML = '<p>ssr</p>';
      document.body.appendChild(host);

      globalThis.__NEV_DEV__ = true;
      const dispose = hydrate(h('p', null, 'client'), host);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /client takeover/);
      assert.equal(host.textContent, 'client');
      dispose();

      delete globalThis.__NEV_DEV__;
      const dispose2 = hydrate(h('p', null, 'again'), host);
      assert.equal(warnings.length, 1, 'no warning outside dev mode');
      dispose2();
    } finally {
      console.warn = origWarn;
      delete globalThis.__NEV_DEV__;
    }
  });
});

describe('feature: createSelector', () => {
  test('only observers of keys whose match changed re-run', () => {
    let runsA = 0;
    let runsB = 0;
    let runsC = 0;
    createRoot((dispose) => {
      const selected = signal('a');
      const isActive = createSelector(selected);
      effect(() => { isActive('a'); runsA++; });
      effect(() => { isActive('b'); runsB++; });
      effect(() => { isActive('c'); runsC++; });
      assert.deepEqual([runsA, runsB, runsC], [1, 1, 1]);
      selected.set('b');
      assert.deepEqual([runsA, runsB, runsC], [2, 2, 1], 'a lost match, b gained it, c untouched');
      selected.set('b');
      assert.deepEqual([runsA, runsB, runsC], [2, 2, 1], 'same value: nobody re-runs');
      selected.set('c');
      assert.deepEqual([runsA, runsB, runsC], [2, 3, 2]);
      dispose();
    });
  });

  test('returns the current match outside an observer', () => {
    const selected = signal(2);
    const isSel = createSelector(selected);
    assert.equal(isSel(2), true);
    assert.equal(isSel(3), false);
    selected.set(3);
    assert.equal(isSel(3), true);
  });
});
