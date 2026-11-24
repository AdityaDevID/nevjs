import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
dom.window.scrollTo = () => {};
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const {
  signal, effect, batch, computed, createRoot, onCleanup, h, render, renderToString, Show, For,
  createContext, useContext, createStore, unwrap, snapshot,
  persisted, debounced, throttled, interval, timeout, listen, mediaQuery, toggle, previous, lazy, Portal, Dynamic, createForm,
} = await import('../src/index.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mount = (vnode) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const dispose = render(vnode, root);
  return { root, dispose };
};

describe('context', () => {
  const Theme = createContext('light');

  test('default value, provider, nesting and override', () => {
    function Show1() {
      return h('span', null, useContext(Theme));
    }
    assert.equal(renderToString(h(Show1)), '<span>light</span>');
    assert.equal(renderToString(h(Theme.Provider, { value: 'dark' }, h(Show1))), '<span>dark</span>');
    const nested = h(Theme.Provider, { value: 'a' }, h(Show1), h(Theme.Provider, { value: 'b' }, h(Show1)), h(Show1));
    assert.equal(renderToString(nested), '<span>a</span><span>b</span><span>a</span>');
  });

  test('works in the DOM, through Show/For and with a signal value', () => {
    const color = signal('red');
    const Color = createContext(() => 'none');
    function Leaf() {
      const c = useContext(Color);
      return h('i', null, () => c());
    }
    const { root, dispose } = mount(
      h(Color.Provider, { value: color }, h(Show, { when: true }, h('b', null, h(Leaf))), h(For, { each: [1, 2] }, () => h(Leaf))),
    );
    assert.equal(root.textContent, 'redredred');
    color.set('blue');
    assert.equal(root.textContent, 'blueblueblue');
    dispose();
  });

  test('two contexts do not collide', () => {
    const A = createContext('a0');
    const B = createContext('b0');
    function Leaf() {
      return h('p', null, `${useContext(A)}/${useContext(B)}`);
    }
    assert.equal(renderToString(h(A.Provider, { value: 'a1' }, h(Leaf))), '<p>a1/b0</p>');
    assert.equal(renderToString(h(B.Provider, { value: 'b1' }, h(A.Provider, { value: 'a2' }, h(Leaf)))), '<p>a2/b1</p>');
  });
});

describe('createStore', () => {
  test('nested property reads are fine-grained', () => {
    const [s] = createStore({ user: { name: 'Ada', age: 30 }, other: 1 });
    let nameRuns = 0;
    let ageRuns = 0;
    effect(() => {
      s.user.name;
      nameRuns++;
    });
    effect(() => {
      s.user.age;
      ageRuns++;
    });
    s.user.name = 'Grace';
    assert.deepEqual([nameRuns, ageRuns], [2, 1]);
    s.user.age = 31;
    assert.deepEqual([nameRuns, ageRuns], [2, 2]);
    s.user.age = 31; // no change
    s.other = 2; // unrelated
    assert.deepEqual([nameRuns, ageRuns], [2, 2]);
  });

  test('arrays: push, pop, splice, index set, length, iteration', () => {
    const [s] = createStore({ list: [1, 2, 3] });
    const seen = [];
    effect(() => seen.push(s.list.map((x) => x * 2).join(',')));
    const lengths = [];
    effect(() => lengths.push(s.list.length));
    s.list.push(4);
    s.list[0] = 10;
    s.list.pop();
    s.list.splice(1, 1);
    assert.deepEqual(unwrap(s).list, [10, 3]);
    assert.equal(seen.at(-1), '20,6');
    assert.equal(lengths.at(-1), 2);
    s.list.length = 0;
    assert.equal(seen.at(-1), '');
    assert.equal(lengths.at(-1), 0);
    s.list.push(7, 8);
    assert.deepEqual([...s.list], [7, 8]);
    assert.equal(s.list.includes(8), true);
    assert.equal(s.list.indexOf(7), 0);
  });

  test('adding / deleting keys notifies key readers, `in` and Object.keys', () => {
    const [s] = createStore({ a: 1 });
    const keys = [];
    effect(() => keys.push(Object.keys(s).join(',')));
    const hasB = [];
    effect(() => hasB.push('b' in s));
    const readB = [];
    effect(() => readB.push(s.b));
    s.b = 2;
    delete s.a;
    assert.deepEqual(keys, ['a', 'a,b', 'b']);
    assert.deepEqual(hasB, [false, true]);
    assert.deepEqual(readB, [undefined, 2]);
    delete s.b;
    assert.equal(readB.at(-1), undefined);
  });

  test('setState: merge, function mutation, batching, returned patch', () => {
    const [s, set] = createStore({ a: 1, b: 2, list: [] });
    let runs = 0;
    effect(() => {
      s.a;
      s.b;
      runs++;
    });
    set({ a: 10, b: 20 });
    assert.equal(runs, 2, 'merge is one batch');
    set((st) => {
      st.a = 1;
      st.b = 1;
      st.list.push('x');
    });
    assert.equal(runs, 3);
    set((st) => ({ a: 99 }));
    assert.equal(s.a, 99);
  });

  test('works with computed and in the DOM', () => {
    const [s] = createStore({ todos: [{ t: 'a', done: false }] });
    const left = computed(() => s.todos.filter((x) => !x.done).length);
    const { root, dispose } = mount(
      h('div', null, h('p', null, () => `left:${left()}`), h('ul', null, h(For, { each: () => s.todos }, (t) => h('li', null, () => `${t.t}${t.done ? '✓' : ''}`)))),
    );
    assert.equal(root.querySelector('p').textContent, 'left:1');
    s.todos.push({ t: 'b', done: false });
    assert.equal(root.querySelectorAll('li').length, 2);
    s.todos[0].done = true;
    assert.equal(root.querySelector('p').textContent, 'left:1');
    assert.equal(root.querySelector('li').textContent, 'a✓');
    dispose();
  });

  test('proxies are never written into the raw data; Dates/Maps stay untouched', () => {
    const [s] = createStore({ a: { n: 1 }, when: new Date(0), map: new Map() });
    const other = { n: 2 };
    s.b = s.a; // assigning a proxy
    assert.equal(unwrap(s).b, unwrap(s).a, 'raw object stored, not the proxy');
    assert.ok(s.when instanceof Date);
    assert.equal(s.when.getTime(), 0);
    s.map.set('k', 1);
    assert.equal(s.map.get('k'), 1);
    s.c = other;
    assert.equal(unwrap(s).c, other);
  });

  test('snapshot gives a plain deep copy', () => {
    const [s] = createStore({ a: { b: [1, { c: 2 }] } });
    const snap = snapshot(s);
    assert.deepEqual(snap, { a: { b: [1, { c: 2 }] } });
    s.a.b[1].c = 3;
    assert.equal(snap.a.b[1].c, 2);
    assert.equal(JSON.stringify(s), '{"a":{"b":[1,{"c":3}]}}');
    assert.throws(() => createStore(5), TypeError);
  });

  test('same proxy for same object; nested identity is stable', () => {
    const [s] = createStore({ a: { n: 1 } });
    assert.equal(s.a, s.a);
  });
});

describe('hooks', () => {
  const fakeStorage = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
  };

  test('persisted: loads, saves, survives corrupt data', () => {
    const storage = fakeStorage();
    storage.m.set('n', '5');
    createRoot((dispose) => {
      const n = persisted('n', 0, { storage });
      assert.equal(n(), 5);
      n.set(6);
      assert.equal(storage.m.get('n'), '6');
      dispose();
    });
    storage.m.set('bad', '{oops');
    createRoot((dispose) => {
      assert.equal(persisted('bad', 'fallback', { storage })(), 'fallback');
      dispose();
    });
    createRoot((dispose) => {
      assert.deepEqual(persisted('obj', { a: 1 }, { storage })(), { a: 1 });
      assert.equal(storage.m.get('obj'), '{"a":1}');
      dispose();
    });
  });

  test('debounced / throttled', async () => {
    await createRoot(async (dispose) => {
      const src = signal(0);
      const d = debounced(src, 30);
      const t = throttled(src, 40);
      src.set(1);
      src.set(2);
      src.set(3);
      assert.equal(d(), 0);
      assert.equal(t(), 1, 'leading edge is immediate');
      await sleep(110);
      assert.equal(d(), 3);
      assert.equal(t(), 3, 'trailing edge delivers the latest value');
      src.set(4);
      src.set(5);
      await sleep(110);
      assert.equal(t(), 5);
      dispose();
    });
  });

  test('interval / timeout / listen stop with their owner', async () => {
    let ticks = 0;
    let fired = 0;
    let clicks = 0;
    const el = document.createElement('div');
    createRoot((dispose) => {
      interval(() => ticks++, 5);
      timeout(() => fired++, 5);
      listen(el, 'click', () => clicks++);
      el.click();
      assert.equal(clicks, 1);
      dispose();
    });
    el.click();
    assert.equal(clicks, 1, 'listener removed');
    await sleep(30);
    assert.equal(ticks, 0);
    assert.equal(fired, 0);
  });

  test('mediaQuery, toggle, previous', () => {
    const listeners = [];
    window.matchMedia = (q) => ({
      matches: q === '(max-width: 600px)',
      addEventListener: (_, fn) => listeners.push(fn),
      removeEventListener: (_, fn) => listeners.splice(listeners.indexOf(fn), 1),
    });
    createRoot((dispose) => {
      const small = mediaQuery('(max-width: 600px)');
      assert.equal(small(), true);
      listeners[0]({ matches: false });
      assert.equal(small(), false);
      dispose();
      assert.equal(listeners.length, 0);
    });
    const [on, flip, setOn] = toggle(false);
    flip();
    assert.equal(on(), true);
    setOn(0);
    assert.equal(on(), false);
    const n = signal(1);
    const p = previous(n, 'none');
    assert.equal(p(), 'none');
    n.set(2);
    assert.equal(p(), 1);
    n.set(3);
    assert.equal(p(), 2);
  });

  test('lazy: fallback → component; loader runs once; preload', async () => {
    let calls = 0;
    const Late = lazy(async () => {
      calls++;
      await sleep(10);
      return { default: (p) => h('b', null, `hi ${p.name}`) };
    });
    const { root, dispose } = mount(h('div', null, h(Late, { name: 'a', fallback: h('i', null, '…') }), h(Late, { name: 'b', fallback: '…' })));
    assert.equal(root.textContent, '……');
    await sleep(40);
    assert.equal(root.textContent, 'hi ahi b');
    assert.equal(calls, 1);
    dispose();
    assert.equal(renderToString(h(Late, { name: 'c' })), '<b>hi c</b>', 'already loaded → SSR renders it');
    const Bad = lazy(() => Promise.reject(new Error('boom')));
    await Bad.preload().catch(() => {});
  });

  test('Portal renders elsewhere and is removed on dispose', () => {
    const target = document.createElement('section');
    document.body.appendChild(target);
    const { root, dispose } = mount(h('div', null, h('p', null, 'in place'), h(Portal, { mount: target }, h('dialog', null, 'modal'))));
    assert.equal(root.textContent, 'in place');
    assert.equal(target.textContent, 'modal');
    dispose();
    assert.equal(target.textContent, '');
    assert.equal(renderToString(h('div', null, h(Portal, null, 'x'))), '<div></div>');
  });

  test('Portal sees context of where it is declared', () => {
    const Ctx = createContext('none');
    const target = document.createElement('section');
    document.body.appendChild(target);
    function Inner() {
      return h('span', null, useContext(Ctx));
    }
    const { dispose } = mount(h(Ctx.Provider, { value: 'yes' }, h(Portal, { mount: target }, h(Inner))));
    assert.equal(target.textContent, 'yes');
    dispose();
  });

  test('Dynamic swaps components and supports tags', () => {
    const which = signal('a');
    const A = (p) => h('a', null, p.label);
    const B = (p) => h('b', null, p.label);
    const { root, dispose } = mount(h(Dynamic, { component: () => (which() === 'a' ? A : B), label: 'x' }));
    assert.equal(root.innerHTML.includes('<a>x</a>'), true);
    which.set('b');
    assert.equal(root.innerHTML.includes('<b>x</b>'), true);
    assert.equal(renderToString(h(Dynamic, { component: 'em' }, 'hey')), '<em>hey</em>');
    assert.equal(renderToString(h(Dynamic, { component: null })), '');
    dispose();
  });
});

describe('createForm', () => {
  test('validation function, touched, submit flow', async () => {
    const saved = [];
    const form = createForm({
      initial: { email: '', name: 'Ada' },
      validate: (v) => ({ email: v.email.includes('@') ? '' : 'Invalid email' }),
      onSubmit: (v) => saved.push(v),
    });
    assert.equal(form.valid(), false);
    assert.equal(form.dirty(), false);
    assert.equal(await form.submit(), false);
    assert.deepEqual(form.errors(), { email: 'Invalid email' });
    assert.deepEqual(form.touched(), { email: true, name: true });
    assert.equal(form.submitCount(), 1);
    form.set('email', 'a@b.c');
    assert.deepEqual(form.errors(), {});
    assert.equal(form.dirty(), true);
    assert.equal(await form.submit({ preventDefault() {} }), true);
    assert.deepEqual(saved, [{ email: 'a@b.c', name: 'Ada' }]);
    form.reset();
    assert.deepEqual(form.values(), { email: '', name: 'Ada' });
    assert.equal(form.dirty(), false);
  });

  test('schema validation (safeParse) and submit errors', async () => {
    const schema = {
      safeParse: (v) => (v.age >= 18 ? { ok: true, value: v, errors: [] } : { ok: false, errors: [{ path: 'age', message: 'must be >= 18' }] }),
    };
    let attempts = 0;
    const form = createForm({
      initial: { age: 10 },
      validate: schema,
      onSubmit: () => {
        attempts++;
        throw new Error('server said no');
      },
    });
    assert.equal(await form.submit(), false);
    assert.equal(form.errors().age, 'must be >= 18');
    form.set('age', 20);
    assert.equal(await form.submit(), false);
    assert.equal(form.submitError().message, 'server said no');
    assert.equal(form.submitting(), false);
    assert.equal(attempts, 1);
  });

  test('prevents double submit', async () => {
    let calls = 0;
    const form = createForm({ initial: {}, onSubmit: () => (calls++, sleep(20)) });
    const [a, b] = await Promise.all([form.submit(), form.submit()]);
    assert.equal(calls, 1);
    assert.deepEqual([a, b], [true, false]);
  });

  test('field() binds inputs in the DOM (text, number, checkbox)', async () => {
    const form = createForm({ initial: { name: '', age: 0, agree: false } });
    const { root, dispose } = mount(
      h('form', null, h('input', form.field('name')), h('input', { ...form.field('age'), type: 'number' }), h('input', form.field('agree', { type: 'checkbox' }))),
    );
    const [name, age, agree] = root.querySelectorAll('input');
    name.value = 'Grace';
    name.dispatchEvent(new window.Event('input', { bubbles: true }));
    age.value = '42';
    age.dispatchEvent(new window.Event('input', { bubbles: true }));
    agree.checked = true;
    agree.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.deepEqual(form.values(), { name: 'Grace', age: 42, agree: true });
    form.set('name', 'Linus');
    assert.equal(name.value, 'Linus');
    name.dispatchEvent(new window.Event('blur'));
    dispose();
  });
});

import { publicEnv as _publicEnv, setPublicEnv as _setPublicEnv } from '../src/index.js';
test('publicEnv: reads NEV_PUBLIC_* values, falls back, is frozen', () => {
  _setPublicEnv({ NEV_PUBLIC_A: '1' });
  assert.equal(_publicEnv('NEV_PUBLIC_A'), '1');
  assert.equal(_publicEnv('NEV_PUBLIC_B', 'fb'), 'fb');
  assert.equal(_publicEnv('toString', 'safe'), 'safe');
  assert.throws(() => { 'use strict'; globalThis.__NEV_ENV__.X = 1; });
  _setPublicEnv({});
});
