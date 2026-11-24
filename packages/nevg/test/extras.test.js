import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, Scene, Rect, Tilemap, createRng,
  vec, vadd, vsub, vscale, vdot, vlen, vdist, vnorm, vrotate, vangle, vfromAngle, vlerp, angleDiff, turnToward, segmentRect, circleRectOverlap,
  ParticleEmitter, findPath, gridFromTilemap, pathToWorld, simplifyPath, lineOfSight, reachable,
  StateMachine, Cooldown, Pool, SaveData, Button, ProgressBar, Body, transition, Gamepads,
} from '../src/index.js';

const mkGame = (opts = {}) => new Game({ raf: () => 0, caf: () => {}, ...opts });
const run = (game, seconds) => {
  const n = Math.round(seconds * game.fps);
  for (let i = 0; i < n; i++) game.step();
};
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);
const fakeCtx = () => {
  const calls = [];
  return new Proxy({ calls }, { get: (t, k) => (k in t ? t[k] : (...a) => calls.push([String(k), ...a])), set: (t, k, v) => (calls.push(['set:' + String(k), v]), true) });
};

describe('vec helpers', () => {
  test('arithmetic', () => {
    assert.deepEqual(vadd(vec(1, 2), vec(3, 4)), { x: 4, y: 6 });
    assert.deepEqual(vsub(vec(3, 4), vec(1, 2)), { x: 2, y: 2 });
    assert.deepEqual(vscale(vec(1, 2), 3), { x: 3, y: 6 });
    assert.equal(vdot(vec(1, 2), vec(3, 4)), 11);
    assert.equal(vlen(vec(3, 4)), 5);
    assert.equal(vdist(vec(0, 0), vec(3, 4)), 5);
    near(vlen(vnorm(vec(10, 0))), 1);
    assert.deepEqual(vnorm(vec(0, 0)), { x: 0, y: 0 }, 'no NaN for zero vectors');
    const r = vrotate(vec(1, 0), Math.PI / 2);
    near(r.x, 0);
    near(r.y, 1);
    near(vangle(vec(0, 1)), Math.PI / 2);
    near(vfromAngle(0, 5).x, 5);
    assert.deepEqual(vlerp(vec(0, 0), vec(10, 20), 0.5), { x: 5, y: 10 });
  });

  test('angleDiff / turnToward take the short way around', () => {
    near(angleDiff(0, Math.PI / 2), Math.PI / 2);
    near(angleDiff(Math.PI * 0.9, -Math.PI * 0.9), Math.PI * 0.2);
    near(turnToward(0, 1, 0.25), 0.25);
    assert.equal(turnToward(0, 0.1, 0.25), 0.1);
    near(turnToward(Math.PI * 0.9, -Math.PI * 0.9, 0.1), Math.PI * 0.9 + 0.1);
  });

  test('segmentRect and circleRectOverlap', () => {
    const r = { x: 10, y: 0, w: 10, h: 10 };
    near(segmentRect({ x: 0, y: 5 }, { x: 30, y: 5 }, r), 1 / 3);
    assert.equal(segmentRect({ x: 0, y: 50 }, { x: 30, y: 50 }, r), null);
    assert.equal(segmentRect({ x: 0, y: 5 }, { x: 5, y: 5 }, r), null, 'stops short');
    assert.equal(segmentRect({ x: 12, y: 5 }, { x: 15, y: 5 }, r), 0, 'starts inside');
    assert.equal(circleRectOverlap({ x: 8, y: 5, r: 3 }, r), true);
    assert.equal(circleRectOverlap({ x: 5, y: 5, r: 3 }, r), false);
    assert.equal(circleRectOverlap({ x: 8, y: -8, r: 3 }, r), false, 'corner distance counts');
  });
});

describe('ParticleEmitter', () => {
  test('emits at `rate`, particles expire, count is capped by max', () => {
    const e = new ParticleEmitter({ rate: 60, life: [0.5, 0.5], speed: [0, 0], rng: createRng(1) });
    e.update(0.5);
    assert.equal(e.count, 30);
    e.update(0.6);
    assert.ok(e.count > 0 && e.count <= 36);
    const capped = new ParticleEmitter({ rate: 1000, max: 10, life: [5, 5] });
    capped.update(1);
    assert.equal(capped.count, 10);
  });

  test('burst + physics: gravity, speed and angle', () => {
    const e = new ParticleEmitter({ rate: 0, life: [10, 10], speed: [100, 100], angle: [0, 0], gravity: 200, rng: createRng(1) });
    e.burst(1);
    const p = e.particles[0];
    const x0 = p.x;
    e.update(1);
    near(p.x - x0, 100);
    near(p.vy, 200);
    assert.ok(p.y > e.h / 2);
    e.clearParticles();
    assert.equal(e.count, 0);
  });

  test('same seed → same effect', () => {
    const make = () => {
      const e = new ParticleEmitter({ rate: 0, rng: createRng(42), colors: ['a', 'b', 'c'] });
      e.burst(5);
      e.update(0.1);
      return e.particles.map((p) => [p.x, p.y, p.color]);
    };
    assert.deepEqual(make(), make());
  });

  test('once-emitters remove themselves; drag slows particles', () => {
    const game = mkGame();
    const scene = new Scene();
    game.setScene(scene);
    const e = scene.add(new ParticleEmitter({ rate: 0, once: true, life: [0.2, 0.2] }));
    e.burst(10);
    run(game, 0.1);
    assert.equal(scene.entities.includes(e), true);
    run(game, 0.5);
    assert.equal(scene.entities.includes(e), false);
    const d = new ParticleEmitter({ rate: 0, drag: 2, speed: [100, 100], angle: [0, 0], life: [5, 5] });
    d.burst(1);
    d.update(0.1);
    near(d.particles[0].vx, 80);
  });

  test('draws every particle (rect + circle), respects shrinking size, is never culled', () => {
    const ctx = fakeCtx();
    const e = new ParticleEmitter({ rate: 0, size: [4, 4], colors: ['red'] });
    e.burst(3);
    e.draw(ctx);
    assert.equal(ctx.calls.filter((c) => c[0] === 'fillRect').length, 3);
    const c = new ParticleEmitter({ rate: 0, shape: 'circle', size: [4, 4] });
    c.burst(2);
    const ctx2 = fakeCtx();
    c.draw(ctx2);
    assert.equal(ctx2.calls.filter((x) => x[0] === 'arc').length, 2);
    assert.equal(e.noCull, true);
    const dead = new ParticleEmitter({ rate: 0, size: [4, 0] });
    dead.burst(1);
    dead.particles[0].age = dead.particles[0].life * 0.999;
    const ctx3 = fakeCtx();
    dead.draw(ctx3);
    assert.equal(ctx3.calls.filter((x) => x[0] === 'fillRect').length, 1);
  });

  test('scene does not cull an off-screen emitter whose particles are visible', () => {
    const game = mkGame({ width: 100, height: 100 });
    const scene = new Scene();
    game.setScene(scene);
    scene.add(new ParticleEmitter({ x: -50, y: 50, rate: 0, w: 1, h: 1 })).burst(1);
    const ctx = fakeCtx();
    game.step();
    scene._draw(ctx);
    assert.ok(ctx.calls.some((c) => c[0] === 'set:globalAlpha'));
  });
});

describe('pathfinding', () => {
  const gridOf = (rows) => ({
    cols: rows[0].length,
    rows: rows.length,
    blocked: (c, r) => rows[r][c] === '#',
  });
  const check = (path, grid) => {
    for (const p of path) assert.equal(grid.blocked(p.col, p.row), false);
    for (let i = 1; i < path.length; i++) {
      const d = Math.abs(path[i].col - path[i - 1].col) + Math.abs(path[i].row - path[i - 1].row);
      assert.ok(d >= 1 && d <= 2);
    }
  };

  test('straight line, start == goal, out of bounds', () => {
    const g = gridOf(['.....']);
    assert.deepEqual(findPath(g, { col: 0, row: 0 }, { col: 4, row: 0 }).length, 5);
    assert.deepEqual(findPath(g, { col: 2, row: 0 }, { col: 2, row: 0 }), [{ col: 2, row: 0 }]);
    assert.equal(findPath(g, { col: 0, row: 0 }, { col: 9, row: 0 }), null);
    assert.equal(findPath(g, { col: -1, row: 0 }, { col: 1, row: 0 }), null);
  });

  test('goes around walls with the shortest 4-way route', () => {
    const g = gridOf([
      '.....',
      '.###.',
      '.....',
    ]);
    const path = findPath(g, { col: 2, row: 0 }, { col: 2, row: 2 });
    check(path, g);
    assert.equal(path.length, 7);
    assert.deepEqual(path[0], { col: 2, row: 0 });
    assert.deepEqual(path.at(-1), { col: 2, row: 2 });
  });

  test('no route / blocked goal / allowGoalBlocked', () => {
    const g = gridOf([
      '..#..',
      '..#..',
    ]);
    assert.equal(findPath(g, { col: 0, row: 0 }, { col: 4, row: 0 }), null);
    assert.equal(findPath(g, { col: 0, row: 0 }, { col: 2, row: 0 }), null);
    const near = findPath(g, { col: 0, row: 0 }, { col: 2, row: 0 }, { allowGoalBlocked: true });
    assert.deepEqual(near.at(-1), { col: 1, row: 0 });
  });

  test('diagonal moves are shorter but never cut corners', () => {
    const open = gridOf(['....', '....', '....', '....']);
    const straight = findPath(open, { col: 0, row: 0 }, { col: 3, row: 3 });
    const diag = findPath(open, { col: 0, row: 0 }, { col: 3, row: 3 }, { diagonal: true });
    assert.equal(straight.length, 7);
    assert.equal(diag.length, 4);
    const corner = gridOf([
      '.#',
      '#.',
    ]);
    assert.equal(findPath(corner, { col: 0, row: 0 }, { col: 1, row: 1 }, { diagonal: true }), null, 'squeezing between two walls is not allowed');
  });

  test('tile costs steer the route; Infinity blocks; maxNodes gives up', () => {
    const g = gridOf(['.....', '.....', '.....']);
    const mud = (c, r) => (r === 0 ? 10 : 1);
    const path = findPath(g, { col: 0, row: 0 }, { col: 4, row: 0 }, { cost: mud });
    assert.ok(path.some((p) => p.row > 0), 'detours around the mud');
    const wall = (c) => (c === 2 ? Infinity : 1);
    assert.equal(findPath(g, { col: 0, row: 1 }, { col: 4, row: 1 }, { cost: wall }), null);
    const big = { cols: 200, rows: 200, blocked: () => false };
    assert.equal(findPath(big, { col: 0, row: 0 }, { col: 199, row: 199 }, { maxNodes: 50 }), null);
    assert.ok(findPath(big, { col: 0, row: 0 }, { col: 60, row: 60 }, { diagonal: true }).length > 1);
  });

  test('finds optimal paths on random mazes (vs BFS) and every step is legal', () => {
    const rng = createRng(7);
    for (let n = 0; n < 40; n++) {
      const rows = Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => (rng() < 0.28 ? '#' : '.')).join(''));
      const g = gridOf(rows);
      const s = { col: 0, row: 0 };
      const t = { col: 11, row: 11 };
      const reach = reachable(g, s);
      const expected = reach.find((p) => p.col === t.col && p.row === t.row);
      const path = g.blocked(0, 0) || g.blocked(11, 11) ? null : findPath(g, s, t);
      if (g.blocked(0, 0) || g.blocked(11, 11)) continue;
      if (!expected) assert.equal(path, null);
      else {
        check(path, g);
        assert.equal(path.length - 1, expected.steps, 'A* length equals BFS distance');
      }
    }
  });

  test('works with a Tilemap, converts to world space, simplifies, line of sight, reachable', () => {
    const map = Tilemap.fromString(
      `
.....
.###.
.....
`,
      { '#': 1, '.': 0 },
      { tileSize: 10, solid: [1] },
    );
    const grid = gridFromTilemap(map);
    assert.equal(grid.blocked(1, 1), true);
    assert.equal(grid.blocked(-1, 0), true, 'outside counts as blocked');
    const path = findPath(grid, { col: 0, row: 0 }, { col: 4, row: 2 });
    assert.deepEqual(pathToWorld(map, [path[0]]), [{ x: 5, y: 5 }]);
    const simple = simplifyPath(path);
    assert.ok(simple.length < path.length);
    assert.deepEqual(simple[0], path[0]);
    assert.deepEqual(simple.at(-1), path.at(-1));
    assert.equal(lineOfSight(grid, { col: 0, row: 0 }, { col: 4, row: 0 }), true);
    assert.equal(lineOfSight(grid, { col: 0, row: 1 }, { col: 4, row: 1 }), false);
    assert.equal(lineOfSight(grid, { col: 0, row: 0 }, { col: 4, row: 2 }), false);
    const within2 = reachable(grid, { col: 0, row: 0 }, 2);
    assert.deepEqual(within2.map((p) => p.steps).sort(), [0, 1, 1, 2, 2]);
    assert.equal(within2.every((p) => p.steps <= 2), true);
    assert.deepEqual(simplifyPath([{ col: 0, row: 0 }, { col: 1, row: 0 }]), [{ col: 0, row: 0 }, { col: 1, row: 0 }]);
  });
});

describe('StateMachine / Cooldown / Pool', () => {
  test('transitions run exit → enter, track time, history, guards, events', () => {
    const log = [];
    const fsm = new StateMachine(
      {
        idle: { enter: (from) => log.push(`idle<-${from}`), exit: (to) => log.push(`idle->${to}`), update: (dt) => log.push(`idle:${dt}`) },
        run: { enter: (from, speed) => log.push(`run<-${from}@${speed}`), can: (from) => from !== 'dead' },
        dead: {},
      },
      'idle',
    );
    const changes = [];
    fsm.on('change', (to, from) => changes.push([from, to]));
    fsm.update(0.5);
    fsm.update(0.25);
    assert.equal(fsm.time, 0.75);
    assert.equal(fsm.go('run', 99), true);
    assert.equal(fsm.go('run'), false, 'same state is a no-op');
    assert.equal(fsm.time, 0);
    assert.deepEqual(log, ['idle<-null', 'idle:0.5', 'idle:0.25', 'idle->run', 'run<-idle@99']);
    assert.deepEqual(changes, [['idle', 'run']]);
    fsm.go('dead');
    assert.equal(fsm.go('run'), false, 'guard refuses');
    assert.equal(fsm.is('dead'), true);
    assert.equal(fsm.back(), false, 'the guard applies to back() too');
    assert.equal(fsm.is('dead'), true);
    assert.throws(() => fsm.go('nope'), /Unknown state/);
    assert.deepEqual(fsm.history, ['idle', 'run', 'dead']);
    const free = new StateMachine({ a: {}, b: {} }, 'a');
    assert.equal(free.back(), false, 'nothing to go back to');
    free.go('b');
    assert.equal(free.back(), true);
    assert.equal(free.is('a'), true);
  });

  test('context binds `this`', () => {
    const ctx = { hits: 0 };
    const fsm = new StateMachine({ a: { update() { this.hits++; } } }, 'a', ctx);
    fsm.update(1);
    assert.equal(ctx.hits, 1);
  });

  test('Cooldown', () => {
    const c = new Cooldown(1);
    assert.equal(c.ready, true);
    assert.equal(c.use(), true);
    assert.equal(c.use(), false);
    c.update(0.5);
    near(c.progress, 0.5);
    c.update(0.6);
    assert.equal(c.ready, true);
    assert.equal(c.use(), true);
    c.reset();
    assert.equal(c.ready, true);
    assert.equal(new Cooldown(1, { ready: false }).ready, false);
  });

  test('Pool reuses, resets, caps and ignores strangers', () => {
    let made = 0;
    const pool = new Pool(() => ({ id: ++made, dirty: false }), (o) => (o.dirty = false), { max: 2, prewarm: 1 });
    assert.equal(pool.size, 1);
    const a = pool.get();
    const b = pool.get();
    assert.equal(pool.get(), null, 'max reached');
    a.dirty = true;
    assert.equal(pool.release(a), true);
    assert.equal(pool.release(a), false, 'double release ignored');
    assert.equal(pool.release({}), false);
    const again = pool.get();
    assert.equal(again, a);
    assert.equal(again.dirty, false, 'reset ran');
    assert.equal(made, 2);
    pool.releaseAll();
    assert.equal(pool.active, 0);
    assert.equal(b && pool.size, 2);
    assert.throws(() => new Pool(), TypeError);
  });
});

describe('SaveData', () => {
  const mem = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m };
  };

  test('defaults, save/load roundtrip, independent defaults', () => {
    const storage = mem();
    const defaults = { coins: 0, settings: { sound: true } };
    const a = new SaveData('g', defaults, { storage });
    assert.deepEqual(a.data, defaults);
    a.data.coins = 5;
    a.data.settings.sound = false;
    assert.deepEqual(defaults, { coins: 0, settings: { sound: true } }, 'defaults untouched');
    assert.equal(a.save(), true);
    const b = new SaveData('g', defaults, { storage });
    assert.deepEqual(b.data, { coins: 5, settings: { sound: false } });
    b.set('coins', 9);
    assert.equal(new SaveData('g', defaults, { storage }).get('coins'), 9);
    assert.equal(b.get('missing', 'fb'), 'fb');
    b.reset();
    assert.equal(b.data.coins, 0);
    assert.equal(storage.m.has('g'), false);
  });

  test('new default keys appear in old saves; migrations run in order', () => {
    const storage = mem();
    storage.setItem('g', JSON.stringify({ version: 1, data: { coins: 3 } }));
    const s = new SaveData('g', { coins: 0, gems: 7, nested: { a: 1, b: 2 } }, {
      storage,
      version: 3,
      migrate: { 2: (d) => ({ ...d, coins: d.coins * 10 }), 3: (d) => ({ ...d, nested: { a: 9 } }) },
    });
    assert.deepEqual(s.data, { coins: 30, gems: 7, nested: { a: 9, b: 2 } });
  });

  test('corrupt data and broken storage never throw', () => {
    const storage = mem();
    storage.setItem('g', '{not json');
    assert.deepEqual(new SaveData('g', { a: 1 }, { storage }).data, { a: 1 });
    storage.setItem('g', '"a string"');
    assert.deepEqual(new SaveData('g', { a: 1 }, { storage }).data, { a: 1 });
    const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    const s = new SaveData('g', { a: 1 }, { storage: full });
    assert.equal(s.save(), false);
    const noStorage = new SaveData('g', { a: 1 }, { storage: null });
    noStorage.data.a = 2;
    assert.equal(noStorage.save(), true);
    assert.equal(noStorage.load(), true);
    assert.equal(noStorage.data.a, 2, 'memory fallback');
  });
});

describe('UI', () => {
  test('Button: click on release inside; no click when dragged off, disabled, or only hovering', () => {
    const game = mkGame();
    const scene = new Scene();
    game.setScene(scene);
    let clicks = 0;
    const btn = scene.add(new Button({ x: 10, y: 10, w: 50, h: 20, text: 'Go', onClick: () => clicks++ }));
    const events = [];
    btn.on('click', () => events.push('click'));
    const input = game.input;

    input.pointerMove(20, 15);
    game.step();
    assert.equal(btn.hover, true);
    assert.equal(clicks, 0);

    input.pointerDown(20, 15);
    game.step();
    assert.equal(btn.pressed, true);
    input.pointerUp(20, 15);
    game.step();
    assert.equal(clicks, 1);
    assert.deepEqual(events, ['click']);

    input.pointerDown(20, 15);
    game.step();
    input.pointerUp(200, 150);
    game.step();
    assert.equal(clicks, 1);

    input.pointerDown(200, 150);
    game.step();
    input.pointerUp(20, 15);
    game.step();
    assert.equal(clicks, 1);

    btn.disabled = true;
    input.pointerDown(20, 15);
    game.step();
    input.pointerUp(20, 15);
    game.step();
    assert.equal(clicks, 1);
  });

  test('Button draws text centred; ProgressBar ratio clamps and accepts functions', () => {
    const b = new Button({ w: 40, h: 10, text: () => 'dyn' });
    const ctx = fakeCtx();
    b.draw(ctx);
    assert.deepEqual(ctx.calls.find((c) => c[0] === 'fillText'), ['fillText', 'dyn', 20, 5]);
    const bar = new ProgressBar({ value: 5, max: 10, w: 100 });
    near(bar.ratio, 0.5);
    bar.value = 50;
    assert.equal(bar.ratio, 1);
    bar.value = () => -3;
    assert.equal(bar.ratio, 0);
    bar.value = 5;
    const c2 = fakeCtx();
    bar.draw(c2);
    assert.deepEqual(c2.calls.find((c) => c[0] === 'fillRect'), ['fillRect', 0, 0, 50, 6]);
    assert.equal(new ProgressBar({ max: 0 }).ratio, 0);
  });
});

describe('Body (arcade physics)', () => {
  const world = () => {
    const game = mkGame({ width: 160, height: 90 });
    const scene = new Scene();
    scene.tilemap = Tilemap.fromString(
      `
##########
#........#
#........#
#........#
##########
`,
      { '#': 1 },
      { tileSize: 16, solid: [1] },
    );
    game.setScene(scene);
    const player = scene.add(new Rect({ x: 40, y: 20, w: 10, h: 10 }));
    return { game, scene, player };
  };

  test('falls, lands, reports onGround and events', () => {
    const { scene, player } = world();
    const body = new Body(player, { gravity: 600, maxFall: 300 });
    const events = [];
    player.on('land', () => events.push('land'));
    for (let i = 0; i < 90; i++) body.step(1 / 60);
    assert.equal(body.onGround, true);
    near(player.y + player.h, 64, 0.05);
    assert.equal(body.vy, 0);
    assert.deepEqual(events, ['land']);
    assert.ok(scene);
  });

  test('maxFall caps the speed', () => {
    const { player } = world();
    const body = new Body(player, { gravity: 10000, maxFall: 50 });
    body.step(0.01);
    body.step(0.01);
    assert.equal(body.vy, 50);
  });

  test('jump works on the ground, with coyote time, and is buffered when early', () => {
    const { player } = world();
    const body = new Body(player, { gravity: 600, coyote: 0.1, jumpBuffer: 0.15 });
    for (let i = 0; i < 90; i++) body.step(1 / 60);
    assert.equal(body.jump(200), true);
    assert.ok(body.vy < 0);
    assert.equal(body.onGround, false);
    assert.equal(body.jump(200), false, 'no double jump');
    for (let i = 0; i < 200; i++) body.step(1 / 60);
    assert.equal(body.onGround, true);

    player.y = 30;
    body.vy = 0;
    body.onGround = false;
    body._coyoteLeft = 0;
    for (let i = 0; i < 10; i++) body.step(1 / 60);
    body.jump(250);
    let jumped = false;
    for (let i = 0; i < 40 && !jumped; i++) {
      body.step(1 / 60);
      jumped = body.vy < -100;
    }
    assert.equal(jumped, true, 'buffered jump fired on landing');
  });

  test('cutJump shortens a jump; walls stop horizontal speed; bounce reverses it', () => {
    const { player } = world();
    const body = new Body(player, { gravity: 0 });
    body.vy = -200;
    body.cutJump(0.5);
    assert.equal(body.vy, -100);
    body.vy = 100;
    body.cutJump(0.5);
    assert.equal(body.vy, 100);

    body.vx = 1000;
    body.vy = 0;
    body.step(0.5);
    assert.equal(body.vx, 0);
    near(player.x + player.w, 144);

    const bouncy = new Body(player, { gravity: 0, bounce: 0.5 });
    bouncy.vx = -1000;
    bouncy.step(0.5);
    assert.equal(bouncy.vx, 500, 'reflected with half the energy');
  });

  test('drag slows horizontal movement on the ground and clamps maxSpeed', () => {
    const { player } = world();
    const body = new Body(player, { gravity: 600, drag: 5, maxSpeed: 80 });
    for (let i = 0; i < 90; i++) body.step(1 / 60);
    body.vx = 500;
    body.step(1 / 60);
    assert.ok(body.vx <= 80);
    for (let i = 0; i < 90; i++) body.step(1 / 60);
    assert.equal(body.vx, 0);
  });

  test('works without a scene (plain integration)', () => {
    const lone = new Rect({ x: 0, y: 0 });
    const body = new Body(lone, { gravity: 100 });
    body.vx = 10;
    body.step(1);
    near(lone.x, 10);
    near(lone.y, 100);
  });
});

describe('transition()', () => {
  test('fades out, swaps scene, fades in, resolves; overlay is cleaned up', async () => {
    const game = mkGame({ width: 100, height: 60 });
    const a = new Scene();
    const b = new Scene();
    game.setScene(a);
    let done = false;
    const p = transition(game, b, { duration: 0.4, color: '#123' }).then(() => (done = true));
    assert.equal(a.entities.length, 1);
    assert.equal(a.entities[0].screenSpace, true);
    run(game, 0.15);
    assert.equal(game.scene, a);
    run(game, 0.1);
    assert.equal(game.scene, b, 'swapped after the fade-out');
    assert.equal(b.entities.length, 1);
    assert.equal(b.entities[0].alpha <= 1, true);
    run(game, 0.3);
    await p;
    assert.equal(done, true);
    assert.equal(b.entities.length, 0, 'overlay removed');
  });

  test('without a running scene it just switches', async () => {
    const game = mkGame();
    const s = new Scene();
    await transition(game, s);
    assert.equal(game.scene, s);
  });
});

describe('Gamepads', () => {
  const pad = (buttons = [], axes = [0, 0, 0, 0]) => ({
    connected: true,
    buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: buttons.includes(i), value: buttons.includes(i) ? 1 : 0 })),
    axes,
  });

  test('buttons, d-pad and sticks become bindable key codes with pressed/released edges', () => {
    const game = mkGame();
    const input = game.input;
    input.bind('jump', ['Space', 'Pad0']).bind('left', ['ArrowLeft', 'PadLeft']);
    let current = [pad()];
    const pads = new Gamepads(input, { getGamepads: () => current });

    pads.poll();
    assert.equal(input.down('jump'), false);
    current = [pad([0])];
    pads.poll();
    assert.equal(input.pressed('jump'), true);
    assert.equal(input.down('jump'), true);
    input.endFrame();
    pads.poll();
    assert.equal(input.pressed('jump'), false, 'held, not re-pressed');
    current = [pad([], [-0.9, 0, 0, 0])];
    pads.poll();
    assert.equal(input.down('left'), true);
    assert.equal(input.released('jump'), true);
    current = [pad([], [-0.1, 0, 0, 0])];
    input.endFrame();
    pads.poll();
    assert.equal(input.down('left'), false);
    current = [pad([14])];
    pads.poll();
    assert.equal(input.down('left'), true);
    pads.release();
    assert.equal(input.down('left'), false);
  });

  test('handles missing/disconnected pads and exposes axis()', () => {
    const input = mkGame().input;
    const pads = new Gamepads(input, { getGamepads: () => [null, { ...pad([], [0.8, -0.2]), connected: false }] });
    pads.poll();
    assert.equal(input.keys.size, 0);
    const live = new Gamepads(input, { getGamepads: () => [null, pad([], [0.8, -0.2])] });
    assert.equal(live.axis(0), 0.8);
    assert.equal(live.axis(1), 0, 'deadzone');
    assert.equal(new Gamepads(input, { getGamepads: () => [] }).axis(0), 0);
    live.rumble();
  });
});
