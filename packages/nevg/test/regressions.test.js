import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  Game, Scene, Entity, Sprite, Tilemap, Assets, Input,
  findPath, transition,
} from '../src/index.js';

const mkGame = (opts = {}) => new Game({ raf: () => 0, caf: () => {}, ...opts });
const run = (game, seconds) => {
  const n = Math.round(seconds * game.fps);
  for (let i = 0; i < n; i++) game.step();
};
const fakeCtx = () => {
  const calls = [];
  return new Proxy({ calls }, { get: (t, k) => (k in t ? t[k] : (...a) => calls.push([String(k), ...a])), set: (t, k, v) => (calls.push(['set:' + String(k), v]), true) });
};

describe('regressions: pathfinding with sub-1 costs', () => {
  test('A* stays optimal when cost() returns values below 1', () => {
    // Direct middle row is expensive (0.9/step); the rows above/below are
    // cheap (0.1/step). Optimal route detours: 6 cheap steps = 0.6 total,
    // versus 2.8 straight through the middle.
    const grid = { cols: 5, rows: 3, blocked: () => false };
    const cost = (c, r) => (r === 1 && c >= 1 && c <= 3 ? 0.9 : 0.1);
    const path = findPath(grid, { col: 0, row: 1 }, { col: 4, row: 1 }, { cost });
    assert.ok(path, 'a path exists');
    assert.deepEqual(path[0], { col: 0, row: 1 });
    assert.deepEqual(path.at(-1), { col: 4, row: 1 });
    const total = path.slice(1).reduce((sum, p) => sum + cost(p.col, p.row), 0);
    assert.ok(Math.abs(total - 0.6) < 1e-9, `optimal cost 0.6, got ${total} via ${JSON.stringify(path)}`);
    assert.equal(path.length, 7, 'detour has 6 steps');
  });

  test('uniform sub-1 costs still find the shortest route', () => {
    const grid = { cols: 4, rows: 4, blocked: () => false };
    const path = findPath(grid, { col: 0, row: 0 }, { col: 3, row: 3 }, { cost: () => 0.5 });
    assert.equal(path.length, 7);
  });
});

describe('regressions: assets retry', () => {
  test('a failed asset stays queued and a later load() retries it', async () => {
    let attempts = 0;
    const assets = new Assets({
      json: async () => {
        attempts++;
        if (attempts === 1) throw new Error('HTTP 500');
        return { ok: true };
      },
    });
    assets.json('data', 'data.json');
    await assert.rejects(assets.load(), /json "data".*500/);
    assert.equal(assets.has('data'), false);
    assert.equal(assets.queue.length, 1, 'failed job is still queued');
    await assets.load();
    assert.deepEqual(assets.get('data'), { ok: true });
    assert.equal(assets.queue.length, 0);
    assert.equal(attempts, 2);
  });

  test('successful jobs are dequeued even when a sibling fails', async () => {
    const assets = new Assets({
      json: async (url) => {
        if (url.includes('bad')) throw new Error('HTTP 404');
        return { url };
      },
    });
    assets.json('good', 'good.json').json('bad', 'bad.json');
    await assert.rejects(assets.load(), /json "bad"/);
    assert.equal(assets.has('good'), true, 'the good asset loaded');
    assert.deepEqual(assets.queue.map((j) => j.key), ['bad']);
  });
});

describe('regressions: scene children collide and query', () => {
  const setup = () => {
    const game = mkGame();
    const scene = new Scene();
    game.start(scene);
    const parent = scene.add(new Entity({ x: 10, y: 10, w: 4, h: 4 }));
    const child = parent.add(new Entity({ x: 20, y: 20, w: 10, h: 10 }));
    return { game, scene, parent, child };
  };

  test('query() finds child entities at their world position', () => {
    const { scene, child } = setup();
    assert.deepEqual(scene.query({ x: 29, y: 29, w: 5, h: 5 }), [child]);
    assert.deepEqual(scene.query({ x: 200, y: 200, w: 5, h: 5 }), []);
  });

  test('children receive collision events in world space', () => {
    const { game, scene, child } = setup();
    const hits = [];
    child.on('collide', (o) => hits.push(['child', o]));
    const other = scene.add(new Entity({ x: 32, y: 32, w: 10, h: 10 }));
    other.on('collide', (o) => hits.push(['other', o]));
    game.step();
    assert.deepEqual(hits, [['child', other], ['other', child]]);
  });
});

describe('regressions: misc nevg fixes', () => {
  test('empty tilemap draws without crashing', () => {
    const empty = new Tilemap({ data: [] });
    assert.equal(empty.cols, 0);
    assert.equal(empty.rows, 0);
    const ctx = fakeCtx();
    empty.draw(ctx, { x: 0, y: 0, w: 100, h: 100 });
    assert.equal(ctx.calls.length, 0);
    const noCols = new Tilemap({ data: [[]] });
    noCols.draw(ctx, { x: 0, y: 0, w: 100, h: 100 });
    assert.equal(ctx.calls.length, 0);
  });

  test('Sprite.play() resets the end flag so animationend fires per animation', () => {
    const image = { width: 128, height: 16 };
    const s = new Sprite({
      image, frameW: 16, frameH: 16,
      animations: {
        a: { frames: [0, 1], fps: 2, loop: false },
        b: { frames: [2, 3], fps: 2, loop: false },
      },
    });
    let ended = 0;
    s.on('animationend', () => ended++);
    s.play('a');
    s.update(2);
    assert.equal(ended, 1);
    s.play('b');
    s.update(2);
    assert.equal(ended, 2, 'animationend fires again for the new animation');
    s.update(1);
    assert.equal(ended, 2, 'but only once per animation');
  });

  test('transition() resolves instead of hanging when the scene is paused', async () => {
    const game = mkGame({ width: 100, height: 60 });
    const a = new Scene();
    const b = new Scene();
    game.setScene(a);
    a.paused = true;
    const outcome = await Promise.race([
      transition(game, b, { duration: 0.4 }).then(() => 'resolved'),
      new Promise((r) => setTimeout(() => r('hung'), 500)),
    ]);
    assert.equal(outcome, 'resolved');
    game.step();
    assert.equal(game.scene, b);
  });

  test('transition() resolves when the next scene is paused', async () => {
    const game = mkGame({ width: 100, height: 60 });
    const a = new Scene();
    const b = new Scene();
    b.paused = true;
    game.setScene(a);
    const outcome = await Promise.race([
      transition(game, b, { duration: 0.4 }).then(() => 'resolved'),
      new Promise((r) => setTimeout(() => r('hung'), 500)),
    ]);
    assert.equal(outcome, 'resolved');
    run(game, 0.1);
    assert.equal(game.scene, b);
  });

  test('input attach(): actions bound after attach still get preventDefault', () => {
    const mkTarget = () => {
      const listeners = new Map();
      return {
        addEventListener: (t, fn) => listeners.set(t, [...(listeners.get(t) ?? []), fn]),
        removeEventListener: (t, fn) => listeners.set(t, (listeners.get(t) ?? []).filter((f) => f !== fn)),
        dispatch: (t, e) => (listeners.get(t) ?? []).forEach((fn) => fn(e)),
      };
    };
    const input = new Input();
    const target = mkTarget();
    const canvas = mkTarget();
    input.attach(canvas, (x, y) => ({ x, y }), target);
    input.bind('fire', ['KeyF']); // bound AFTER attach
    let prevented = 0;
    target.dispatch('keydown', { code: 'KeyF', repeat: true, target: { tagName: 'DIV' }, preventDefault: () => prevented++ });
    assert.equal(prevented, 1, 'repeat keydown for a late-bound action is prevented');
    target.dispatch('keydown', { code: 'Space', target: { tagName: 'DIV' }, preventDefault: () => prevented++ });
    assert.equal(prevented, 2, 'default actions still work');
    input.detach();
  });

  test('types are in sync with the runtime surface', () => {
    const dts = readFileSync(new URL('../types/index.d.ts', import.meta.url), 'utf8');
    assert.ok(dts.includes("'none'"), "GameOptions.fit includes 'none'");
    assert.ok(dts.includes('finished: Promise<boolean>'), 'Tween.finished is typed');
    assert.ok(/class Tween \{[^}]*paused: boolean/.test(dts), 'Tween.paused is typed');
    assert.ok(/class Body \{[^]*?maxFall: number/.test(dts), 'Body.maxFall is typed');
    assert.ok(/class Body \{[^]*?hit:/.test(dts), 'Body.hit is typed');
    assert.ok(/class Body \{[^]*?gravity: number/.test(dts), 'Body.gravity is typed');
    assert.ok(/follow\(e: Entity, o\?: \{[^}]*\}\): this/.test(dts), 'Camera.follow returns this');
  });
});

describe('feature: Timer', () => {
  test('one-shot completes once, looping repeats, pause freezes', async () => {
    const { Timer } = await import('../src/index.js');
    let done = 0;
    const t = new Timer(0.5);
    t.on('complete', () => done++);
    t.update(0.3);
    assert.equal(done, 0);
    assert.ok(Math.abs(t.left - 0.2) < 1e-9);
    t.update(0.3);
    assert.equal(done, 1);
    assert.equal(t.done, true);
    t.update(1);
    assert.equal(done, 1, 'one-shot does not refire');

    let loops = 0;
    const l = new Timer(0.25, { loop: true });
    l.on('complete', () => loops++);
    l.update(1);
    assert.equal(loops, 4);
    l.pause();
    l.update(1);
    assert.equal(loops, 4, 'paused timer does not advance');
    l.restart();
    assert.equal(l.elapsed, 0);
    assert.equal(l.running, true);
  });
});
