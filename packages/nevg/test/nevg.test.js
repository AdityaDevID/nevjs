import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, Scene, Entity, Rect, Sprite, Label, Camera, Input, Tilemap, Assets, Tweens, ease,
  clamp, lerp, approach, rectsOverlap, createRng, damp, remap,
} from '../src/index.js';

const mkGame = (opts = {}) => new Game({ raf: () => 0, caf: () => {}, ...opts });
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);
const run = (game, seconds) => {
  const n = Math.round(seconds * game.fps);
  for (let i = 0; i < n; i++) game.step();
};

function fakeCtx() {
  const calls = [];
  const ctx = new Proxy(
    { calls },
    {
      get(t, k) {
        if (k in t) return t[k];
        return (...args) => calls.push([String(k), ...args]);
      },
      set(t, k, v) {
        calls.push(['set:' + String(k), v]);
        return true;
      },
    },
  );
  return ctx;
}

describe('math', () => {
  test('helpers', () => {
    assert.equal(clamp(5, 0, 3), 3);
    assert.equal(lerp(0, 10, 0.25), 2.5);
    assert.equal(approach(0, 10, 3), 3);
    assert.equal(approach(9, 10, 3), 10);
    assert.equal(approach(0, -10, 3), -3);
    assert.equal(remap(5, 0, 10, 100, 200), 150);
    assert.equal(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 }), false, 'touching is not overlap');
    assert.equal(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 }), true);
    near(damp(0, 10, 5, 100), 10, 1e-3);
  });

  test('seeded rng is deterministic and in range', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    assert.deepEqual(seqA, seqB);
    assert.ok(seqA.every((n) => n >= 0 && n < 1));
    const r = createRng(1);
    for (let i = 0; i < 200; i++) {
      const n = r.int(3, 5);
      assert.ok(n >= 3 && n <= 5 && Number.isInteger(n));
    }
  });
});

describe('tweens', () => {
  test('interpolates, eases, completes and resolves', async () => {
    const tw = new Tweens();
    const o = { x: 0, y: 10 };
    let completed = false;
    const t = tw.to(o, { x: 100, y: 0 }, { duration: 1, onComplete: () => (completed = true) });
    tw.update(0.5);
    near(o.x, 50);
    near(o.y, 5);
    tw.update(0.5);
    assert.equal(o.x, 100);
    assert.equal(completed, true);
    assert.equal(await t.finished, true);
    assert.equal(tw.list.length, 0);
  });

  test('delay, yoyo + repeat, stop, killTweensOf', () => {
    const tw = new Tweens();
    const o = { v: 0 };
    tw.to(o, { v: 10 }, { duration: 1, delay: 0.5, repeat: 1, yoyo: true });
    tw.update(0.4);
    assert.equal(o.v, 0, 'still delayed');
    tw.update(0.6);
    near(o.v, 5);
    tw.update(0.5);
    near(o.v, 10);
    tw.update(0.5);
    near(o.v, 5);
    tw.update(0.5);
    near(o.v, 0);
    assert.equal(tw.list.length, 0);

    const p = { a: 0 };
    tw.to(p, { a: 1 }, { duration: 1 });
    tw.killTweensOf(p);
    tw.update(1);
    assert.equal(p.a, 0);
  });

  test('easing endpoints', () => {
    for (const name of Object.keys(ease)) {
      near(ease[name](0), 0, 1e-9);
      near(ease[name](1), 1, 1e-9);
    }
  });

  test('wait() resolves after game time', async () => {
    const tw = new Tweens();
    let ok = false;
    tw.wait(1).then(() => (ok = true));
    tw.update(0.5);
    await Promise.resolve();
    assert.equal(ok, false);
    tw.update(0.6);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(ok, true);
  });
});

describe('entities and scenes', () => {
  test('velocity integrates, update hooks run, tags work', () => {
    const game = mkGame({ width: 100, height: 100 });
    const scene = new Scene();
    game.start(scene);
    const e = scene.add(new Entity({ x: 0, y: 0, vx: 60, vy: -30, tags: ['mover'] }));
    run(game, 1);
    near(e.x, 60, 1e-6);
    near(e.y, -30, 1e-6);
    assert.deepEqual(scene.withTag('mover'), [e]);
    assert.equal(scene.first('nothing'), null);
  });

  test('destroy removes at end of frame and fires hooks', () => {
    const game = mkGame();
    const scene = new Scene();
    game.start(scene);
    let destroyed = 0;
    const e = scene.add(new Entity({ onDestroy: () => destroyed++ }));
    e.destroy();
    assert.equal(scene.entities.length, 1, 'still present until the frame ends');
    game.step();
    assert.equal(scene.entities.length, 0);
    assert.equal(destroyed, 1);
    game.step();
    assert.equal(destroyed, 1);
  });

  test('children follow the parent; destroying the parent destroys children', () => {
    const game = mkGame();
    const scene = new Scene();
    game.start(scene);
    const parent = scene.add(new Entity({ x: 10, y: 20, vx: 10 }));
    const child = parent.add(new Entity({ x: 5, y: 5 }));
    run(game, 1);
    near(child.worldX, 25);
    near(child.worldY, 25);
    assert.equal(scene.withTag('x').length, 0);
    parent.destroy();
    game.step();
    assert.equal(scene.entities.length, 0);
    assert.equal(child.dead, true);
  });

  test('entity and scene timers use game time and can be cancelled', () => {
    const game = mkGame();
    const scene = new Scene();
    game.start(scene);
    const log = [];
    const e = scene.add(new Entity());
    e.after(0.5, () => log.push('after'));
    const cancel = e.every(0.25, () => log.push('tick'));
    scene.after(1.1, () => {
      log.push('scene');
      cancel();
    });
    run(game, 1.5);
    assert.equal(log.filter((x) => x === 'after').length, 1);
    assert.equal(log.filter((x) => x === 'tick').length, 4);
    assert.equal(log.filter((x) => x === 'scene').length, 1);
  });

  test('collision events fire for overlapping entities only', () => {
    const game = mkGame();
    const scene = new Scene();
    game.start(scene);
    const hits = [];
    const a = scene.add(new Entity({ x: 0, y: 0, w: 10, h: 10, onCollide: (o) => hits.push(['a', o.name]) , name: 'A'}));
    scene.add(new Entity({ x: 5, y: 5, w: 10, h: 10, name: 'B', onCollide: (o) => hits.push(['b', o.name]) }));
    scene.add(new Entity({ x: 100, y: 100, w: 10, h: 10, name: 'C', onCollide: (o) => hits.push(['c', o.name]) }));
    game.step();
    assert.deepEqual(hits.sort(), [['a', 'B'], ['b', 'A']].sort());
    a.collides = false;
    hits.length = 0;
    game.step();
    assert.deepEqual(hits, []);
  });

  test('collision detection scales (sweep-and-prune finds every pair)', () => {
    const game = mkGame();
    const scene = new Scene();
    game.start(scene);
    let pairs = 0;
    for (let i = 0; i < 200; i++) scene.add(new Entity({ x: i * 6, y: 0, w: 10, h: 10, onCollide: () => pairs++ }));
    game.step();
    assert.equal(pairs, 2 * 199);
  });

  test('scene switching happens at the end of the frame, exit/init run once', () => {
    const game = mkGame();
    const log = [];
    const mk = (name) =>
      new Scene({
        init: () => log.push(name + ':init'),
        exit: () => log.push(name + ':exit'),
        update: () => log.push(name + ':update'),
      });
    const a = mk('a');
    const b = mk('b');
    game.start(a);
    game.step();
    a.after(0, () => game.setScene(b));
    game.step();
    game.step();
    assert.deepEqual(log, ['a:init', 'a:update', 'a:update', 'a:exit', 'b:init', 'b:update']);
  });

  test('pause freezes the scene', () => {
    const game = mkGame();
    const scene = new Scene();
    game.start(scene);
    const e = scene.add(new Entity({ vx: 10 }));
    scene.paused = true;
    run(game, 1);
    assert.equal(e.x, 0);
    scene.paused = false;
    run(game, 1);
    near(e.x, 10);
  });

  test('sprite animations advance and loop / end', () => {
    const image = { width: 64, height: 16 };
    const s = new Sprite({
      image, frameW: 16, frameH: 16,
      animations: { run: { frames: [0, 1, 2, 3], fps: 4 }, die: { frames: [4, 5], fps: 2, loop: false } },
    });
    s.play('run');
    s.update(0.3);
    assert.equal(s.frame, 1);
    s.update(0.7);
    assert.equal(s.frame, 0, 'wrapped');
    let ended = 0;
    s.on('animationend', () => ended++);
    s.play('die');
    s.update(2);
    assert.equal(s.frame, 5);
    s.update(1);
    assert.equal(ended, 1, 'animationend fires once');
    assert.throws(() => s.play('nope'), /Unknown animation/);
  });

  test('drawing: z-order, camera culling, HUD space, transforms', () => {
    const game = mkGame({ width: 100, height: 100 });
    const ctx = fakeCtx();
    game.ctx = ctx;
    game.canvas = { width: 100, height: 100 };
    const drawn = [];
    const scene = new Scene();
    game.start(scene);
    const mk = (name, props) => new Entity({ w: 10, h: 10, draw: () => drawn.push(name), ...props });
    scene.add(mk('top', { z: 5 }), mk('bottom', { z: 1 }), mk('offscreen', { x: 500 }), mk('hud', { screenSpace: true, x: 500 }));
    game.step();
    game.render();
    assert.deepEqual(drawn, ['bottom', 'top', 'hud']);
    assert.ok(ctx.calls.some((c) => c[0] === 'clearRect'));
  });
});

describe('physics and tilemaps', () => {
  const map = () =>
    Tilemap.fromString(
      `
##########
#........#
#........#
#...##...#
##########
`,
      { '#': 1 },
      { tileSize: 10, solid: [1] },
    );

  test('fromString and queries', () => {
    const m = map();
    assert.equal(m.cols, 10);
    assert.equal(m.rows, 5);
    assert.equal(m.width, 100);
    assert.equal(m.get(0, 0), 1);
    assert.equal(m.get(1, 1), 0);
    assert.equal(m.solidAt(5, 5), true);
    assert.equal(m.solidAt(15, 15), false);
    assert.equal(m.rectHitsSolid({ x: 10, y: 10, w: 10, h: 10 }), false, 'exactly filling a free tile');
    assert.equal(m.rectHitsSolid({ x: 10, y: 10, w: 10.5, h: 10 }), false);
    assert.equal(m.rectHitsSolid({ x: 9, y: 10, w: 10, h: 10 }), true);
    assert.equal(m.solidAt(-5, 5), false);
    m.edgesSolid = true;
    assert.equal(m.solidAt(-5, 5), true);
  });

  test('moveAndCollide stops flush against walls, slides along them', () => {
    const game = mkGame({ width: 100, height: 50 });
    const scene = new Scene();
    scene.tilemap = map();
    game.start(scene);
    const p = scene.add(new Entity({ x: 20, y: 20, w: 8, h: 8 }));

    let hit = scene.moveAndCollide(p, 500, 0);
    assert.equal(hit.right, true);
    near(p.x, 90 - 8, 0.07);
    assert.ok(p.x + p.w <= 90 + 1e-6, 'never inside the wall');

    p.x = 20;
    p.y = 12;
    hit = scene.moveAndCollide(p, 6, 30);
    assert.equal(hit.bottom, true);
    assert.equal(hit.x, false);
    near(p.x, 26);
    assert.ok(p.y + p.h <= 40 + 1e-6);

    hit = scene.moveAndCollide(p, 0, -500);
    assert.equal(hit.top, true);
    assert.ok(p.y >= 10 - 1e-6);
  });

  test('fast movers cannot tunnel through a one-tile wall', () => {
    const game = mkGame({ width: 100, height: 50 });
    const scene = new Scene();
    scene.tilemap = new Tilemap({ tileSize: 10, data: [[0, 0, 1, 0, 0, 0, 0, 0, 0, 0]], solid: [1] });
    game.start(scene);
    const p = scene.add(new Entity({ x: 0, y: 0, w: 5, h: 5 }));
    const hit = scene.moveAndCollide(p, 80, 0);
    assert.equal(hit.right, true);
    assert.ok(p.x + p.w <= 20 + 1e-6, `stopped at the wall, x=${p.x}`);
  });

  test('solid entities block movement and are reported', () => {
    const game = mkGame();
    const scene = new Scene();
    game.start(scene);
    const wall = scene.add(new Entity({ x: 50, y: 0, w: 10, h: 100, solid: true }));
    const p = scene.add(new Entity({ x: 0, y: 10, w: 10, h: 10 }));
    const hit = scene.moveAndCollide(p, 100, 0);
    assert.equal(hit.right, true);
    assert.equal(hit.entity, wall);
    assert.ok(p.x + p.w <= 50 + 1e-6);
  });

  test('platformer loop: gravity lands on the floor and the player can jump', () => {
    const game = mkGame({ width: 100, height: 50 });
    const scene = new Scene();
    scene.tilemap = map();
    game.start(scene);
    const p = scene.add(new Entity({ x: 20, y: 11, w: 8, h: 8 }));
    let grounded = false;
    let vel = 0;
    p.update = function (dt) {
      vel += 900 * dt;
      const hit = scene.moveAndCollide(this, 0, vel * dt);
      if (hit.y) {
        grounded = hit.bottom;
        vel = 0;
      }
    };
    run(game, 1);
    assert.equal(grounded, true);
    near(p.y + p.h, 40, 0.07);
  });
});

describe('camera', () => {
  test('follow, bounds clamping, world/screen conversion, zoom', () => {
    const cam = new Camera(100, 50);
    cam.setBounds(0, 0, 400, 200);
    const target = { x: 0, y: 0, w: 0, h: 0 };
    cam.follow(target);
    cam.update(0.016);
    assert.equal(cam.left, 0, 'clamped to the left edge');
    assert.equal(cam.top, 0);
    target.x = 200;
    target.y = 100;
    cam.update(0.016);
    assert.equal(cam.x, 200);
    near(cam.worldToScreen(200, 100).x, 50);
    near(cam.screenToWorld(50, 25).x, 200);
    target.x = 1000;
    cam.update(0.016);
    assert.equal(cam.left + cam.width, 400, 'clamped to the right edge');
    cam.zoom = 2;
    cam.update(0.016);
    near(cam.view.w, 50);
  });

  test('world smaller than the view is centered; shake decays to zero', () => {
    const cam = new Camera(100, 100);
    cam.setBounds(0, 0, 40, 40);
    cam.update(0.016);
    assert.equal(cam.x, 20);
    cam.shake(10, 0.2);
    cam.update(0.1);
    assert.ok(Math.abs(cam._shake.x) <= 5);
    cam.update(0.2);
    cam.update(0.016);
    assert.equal(cam._shake.x, 0);
  });

  test('smoothing moves partway toward the target', () => {
    const cam = new Camera(100, 100);
    cam.x = 0;
    cam.y = 0;
    cam.follow({ x: 100, y: 0 }, { smoothing: 5 });
    cam.update(0.1);
    assert.ok(cam.x > 0 && cam.x < 100);
  });
});

describe('input', () => {
  test('pressed / down / released are edge-accurate across frames', () => {
    const input = new Input();
    input.keyDown('Space');
    assert.equal(input.pressed('jump'), true);
    assert.equal(input.down('jump'), true);
    input.endFrame();
    assert.equal(input.pressed('jump'), false);
    assert.equal(input.down('jump'), true);
    input.keyUp('Space');
    assert.equal(input.released('jump'), true);
    input.endFrame();
    assert.equal(input.released('jump'), false);
    assert.equal(input.down('jump'), false);
  });

  test('axis, normalised vector, rebinding, raw codes', () => {
    const input = new Input();
    input.keyDown('ArrowLeft');
    assert.equal(input.axis('left', 'right'), -1);
    input.keyDown('KeyD');
    assert.equal(input.axis('left', 'right'), 0, 'opposite keys cancel');
    input.keyUp('ArrowLeft');
    input.keyDown('KeyW');
    const v = input.vector();
    near(Math.hypot(v.x, v.y), 1);
    input.bind('fire', ['KeyF']);
    input.keyDown('KeyF');
    assert.equal(input.down('fire'), true);
    assert.equal(input.down('KeyF'), true);
    input.releaseAll();
    assert.equal(input.down('fire'), false);
  });

  test('pointer', () => {
    const input = new Input();
    input.pointerDown(10, 20);
    assert.deepEqual([input.pointer.x, input.pointer.y, input.pointer.down, input.pointer.pressed], [10, 20, true, true]);
    input.endFrame();
    assert.equal(input.pointer.pressed, false);
    input.pointerUp(11, 21);
    assert.equal(input.pointer.released, true);
    assert.equal(input.pointer.down, false);
  });

  test('scene sees input pressed during the step, cleared after', () => {
    const game = mkGame();
    const scene = new Scene();
    const seen = [];
    scene.update = () => seen.push(game.input.pressed('jump'));
    game.start(scene);
    game.input.keyDown('Space');
    game.step();
    game.step();
    assert.deepEqual(seen, [true, false]);
  });
});

describe('assets', () => {
  test('loads all, reports progress, rejects with the asset name', async () => {
    const assets = new Assets({
      image: async (url) => ({ url, width: 16, height: 16 }),
      json: async (url) => {
        if (url.includes('bad')) throw new Error('HTTP 404');
        return { ok: url };
      },
    });
    assets.baseURL = 'assets/';
    assets.image('hero', 'hero.png').json('level', 'lvl.json');
    const progress = [];
    await assets.load((p) => progress.push(p));
    assert.equal(assets.get('hero').url, 'assets/hero.png');
    assert.deepEqual(assets.get('level'), { ok: 'assets/lvl.json' });
    assert.equal(progress.at(-1), 1);
    assert.throws(() => assets.get('missing'), /not loaded/);

    assets.json('broken', 'bad.json');
    await assert.rejects(assets.load(), /json "broken".*404/);
  });
});

describe('game loop', () => {
  test('fixed timestep: variable frame times produce a constant step count', () => {
    let t = 0;
    const frames = [];
    const game = mkGame({ fps: 60, raf: (fn) => frames.push(fn) && frames.length, caf: () => {}, now: () => t });
    const scene = new Scene();
    let updates = 0;
    scene.update = () => updates++;
    game.start(scene);
    const advance = (ms) => {
      t += ms;
      frames.shift()(t);
    };
    advance(1000 / 60 / 2);
    assert.equal(updates, 0);
    advance(1000 / 60 / 2 + 1);
    assert.equal(updates, 1);
    advance(1000);
    assert.equal(updates, 1 + 15);
    game.stop();
    assert.equal(game.running, false);
  });

  test('timeScale slows the simulation', () => {
    let t = 0;
    const frames = [];
    const game = mkGame({ fps: 10, raf: (fn) => frames.push(fn) && 1, caf: () => {}, now: () => t });
    const scene = new Scene();
    let updates = 0;
    scene.update = () => updates++;
    game.start(scene);
    game.timeScale = 0.5;
    t += 1000;
    frames.shift()(t);
    assert.equal(updates, 1);
  });

  test('headless game works without a canvas', () => {
    const game = mkGame({ width: 64, height: 64 });
    assert.equal(game.ctx, null);
    const scene = new Scene();
    game.start(scene);
    game.step();
    game.render();
    assert.equal(game.frame, 1);
    near(game.time, 1 / 60);
  });
});
