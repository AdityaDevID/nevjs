import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Game3D, Scene3D, Entity3D, Mesh3D, Body3D, OrbitRig, FirstPersonRig, Controls3D, Terrain, Particles3D, props, createSky, extendAssets } from '../src/index.js';
import { Assets } from '@adityadevid/nevg';

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);
const fakeRenderer = () => {
  const r = { renders: 0, size: null, ratio: null, disposed: false, shadowMap: {}, info: { render: { calls: 3, triangles: 12 } } };
  r.render = () => r.renders++;
  r.setSize = (w, h) => (r.size = [w, h]);
  r.setPixelRatio = (v) => (r.ratio = v);
  r.dispose = () => (r.disposed = true);
  return r;
};
const mkGame = (o = {}) => new Game3D({ raf: () => 0, caf: () => {}, ...o });
const run = (g, s) => {
  for (let i = 0, n = Math.round(s * g.fps); i < n; i++) g.step();
};

describe('Game3D + Scene3D', () => {
  test('headless loop runs scene lifecycle, timers and tweens', () => {
    const game = mkGame();
    const log = [];
    class S extends Scene3D {
      init() {
        log.push('init');
        this.box = this.add(new Mesh3D({ shape: 'box', position: [0, 0, 0] }));
        this.after(0.5, () => log.push('timer'));
        this.tween(this.box.position, { x: 10 }, { duration: 1 });
      }
      update() {
        log.push('u');
      }
    }
    game.start(new S());
    run(game, 1.1);
    assert.equal(log[0], 'init');
    assert.ok(log.includes('timer'));
    near(game.scene.box.position.x, 10, 0.01);
    assert.ok(game.scene.camera.isPerspectiveCamera);
  });

  test('renders through the renderer and reports stats; resize updates the camera', () => {
    const renderer = fakeRenderer();
    const game = mkGame({ renderer });
    const scene = new Scene3D();
    game.start(scene);
    game.render();
    assert.equal(renderer.renders, 1);
    assert.equal(game.stats.drawCalls, 3);
    scene.onResize(1000, 500);
    near(scene.camera.aspect, 2);
    game.setQuality('low');
    assert.equal(game.maxDpr, 1);
    game.destroy();
    assert.ok(renderer.disposed);
  });

  test('background and fog setters', () => {
    const s = new Scene3D({ background: '#112233' });
    assert.ok(s.three.background.isColor);
    s.fog = ['#fff', 10, 50];
    assert.ok(s.three.fog.isFog);
    s.fog = { color: '#fff', density: 0.02 };
    assert.ok(s.three.fog.isFogExp2);
    s.fog = null;
    assert.equal(s.three.fog, null);
  });

  test('destroy removes the object from the scene and disposes geometry', () => {
    const game = mkGame();
    const s = new Scene3D();
    game.start(s);
    const m = s.add(new Mesh3D({ shape: 'sphere' }));
    let disposed = false;
    m.mesh.geometry.addEventListener('dispose', () => (disposed = true));
    assert.equal(m.object.parent, s.three);
    m.destroy();
    game.step();
    assert.equal(m.object.parent, null);
    assert.ok(disposed);
    assert.equal(s.entities.length, 0);
  });

  test('child entities follow their parent object', () => {
    const game = mkGame();
    const s = new Scene3D();
    game.start(s);
    const parent = s.add(new Entity3D({ position: [5, 0, 0] }));
    const child = parent.add(new Mesh3D({ position: [1, 0, 0] }));
    assert.equal(child.object.parent, parent.object);
    near(child.object.getWorldPosition(new THREE.Vector3()).x, 6);
  });

  test('raw three objects and lights', () => {
    const s = new Scene3D();
    const { sun, hemi } = s.lights({ shadows: true });
    assert.ok(sun.castShadow && hemi.isHemisphereLight);
    s.shadowFollow({ x: 12.4, y: 0, z: -3.6 });
    assert.equal(s.sun.target.position.x, 12);
    const mesh = s.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    assert.equal(mesh.parent, s.three);
  });
});

describe('entities & collisions', () => {
  test('anchor decides the collision box', () => {
    const feet = new Entity3D({ position: [0, 2, 0], size: [2, 4, 2] });
    assert.equal(feet.box.min.y, 2);
    assert.equal(feet.box.max.y, 6);
    const mid = new Entity3D({ position: [0, 2, 0], size: [2, 4, 2], anchor: 0.5 });
    assert.equal(mid.box.min.y, 0);
    assert.equal(mid.box.max.y, 4);
  });

  test('overlap events fire both ways, and not for far-apart entities', () => {
    const game = mkGame();
    const s = new Scene3D();
    game.start(s);
    const hits = [];
    const a = s.add(new Entity3D({ position: [0, 0, 0], size: [1, 1, 1], tags: ['player'] }));
    const b = s.add(new Entity3D({ position: [0.5, 0, 0], size: [1, 1, 1], tags: ['coin'] }));
    const c = s.add(new Entity3D({ position: [20, 0, 0], size: [1, 1, 1] }));
    a.on('collide', (o) => hits.push(['a', o.id]));
    b.on('collide', (o) => hits.push(['b', o.id]));
    c.on('collide', () => hits.push('c'));
    game.step();
    assert.deepEqual(hits, [['a', b.id], ['b', a.id]]);
  });

  test('spin and bob animate', () => {
    const game = mkGame();
    const s = new Scene3D();
    game.start(s);
    const e = s.add(new Mesh3D({ position: [0, 1, 0], spin: [0, 2, 0], bob: { amp: 0.5, speed: 2 } }));
    run(game, 0.5);
    near(e.rot.y, 1, 0.05);
    assert.ok(Math.abs(e.position.y - 1) > 0.05 && Math.abs(e.position.y - 1) <= 0.5);
  });

  test('pick() finds the entity under a screen point', () => {
    const game = mkGame({ width: 400, height: 300 });
    const s = new Scene3D();
    game.start(s);
    const target = s.add(new Mesh3D({ shape: 'box', size: [2, 2, 2], position: [0, 0, 0], tags: ['target'] }));
    s.camera.position.set(0, 1, 8);
    s.camera.lookAt(0, 1, 0);
    const hit = s.pick(200, 150);
    assert.equal(hit.entity, target);
    assert.equal(s.pick(5, 5), null);
  });
});

describe('Body3D physics', () => {
  const setup = (ground) => {
    const game = mkGame();
    const s = new Scene3D();
    if (ground) s.ground = ground;
    game.start(s);
    return { game, s };
  };

  test('falls onto the flat ground and can jump (coyote + buffer)', () => {
    const { game, s } = setup();
    const p = s.add(new Entity3D({ position: [0, 5, 0], size: [0.8, 1.8, 0.8] }));
    const body = new Body3D(p, { gravity: 30 });
    run(game, 1.5);
    near(p.position.y, 0, 0.001);
    assert.ok(body.onGround);
    assert.equal(body.jump(10), true);
    run(game, 0.2);
    assert.ok(p.position.y > 0.5);
    run(game, 2);
    assert.ok(body.onGround);
    body.vel.set(0, 0, 0);
    // buffered: press slightly before landing
    p.position.y = 0.3;
    body.onGround = false;
    body.jump(10);
    run(game, 0.2);
    assert.ok(p.position.y > 0.3 || body.vel.y > 0);
  });

  test('walks with acceleration and stops with friction', () => {
    const { game, s } = setup();
    const p = s.add(new Entity3D({ position: [0, 0, 0] }));
    const body = new Body3D(p, { accel: 40 });
    run(game, 0.3);
    body.walk(1, 0, 6);
    game.step();
    assert.ok(body.vel.x > 0 && body.vel.x < 6);
    run(game, 1);
    near(body.vel.x, 6, 0.01);
    body.stop();
    run(game, 0.5);
    near(body.vel.x, 0, 0.01);
  });

  test('solid entities block movement, small ledges can be stepped up, tall walls cannot', () => {
    const { game, s } = setup();
    const wall = s.add(new Entity3D({ position: [3, 0, 0], size: [1, 3, 10], solid: true }));
    const p = s.add(new Entity3D({ position: [0, 0, 0], size: [0.8, 1.8, 0.8] }));
    const body = new Body3D(p);
    run(game, 0.2);
    body.walk(1, 0, 6);
    run(game, 1);
    assert.ok(p.position.x <= 2.1 && p.position.x > 2.0, `x=${p.position.x}`);
    wall.destroy();
    s.add(new Entity3D({ position: [6, 0, 0], size: [2, 0.3, 10], solid: true }));
    run(game, 0.8);
    assert.ok(p.position.x > 5.4 && p.position.x < 7, `on the ledge, x=${p.position.x}`);
    near(p.position.y, 0.3, 0.05);
    run(game, 1.5);
    assert.ok(p.position.x > 7.5, 'walked off the far side');
    near(p.position.y, 0, 0.05);
  });

  test('stands on the terrain and slides the same surface it renders', () => {
    const t = new Terrain({ size: 60, segments: 30, seed: 5, height: 6 });
    const { game, s } = setup(t);
    s.add(t);
    const p = s.add(new Entity3D({ position: [4, 20, 4], size: [0.6, 1.8, 0.6] }));
    new Body3D(p);
    run(game, 3);
    near(p.position.y, t.heightAt(4, 4), 0.01);
  });
});

describe('Terrain', () => {
  test('heightAt equals the rendered mesh (raycast comparison)', () => {
    const t = new Terrain({ size: 40, segments: 20, seed: 11, height: 5 });
    t.updateMatrixWorld(true);
    const rc = new THREE.Raycaster();
    for (const [x, z] of [[0.3, 0.7], [-7.2, 5.1], [12.9, -3.3], [-15, -15.5], [3.14, 15.92]]) {
      rc.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
      const hit = rc.intersectObject(t)[0];
      assert.ok(hit, `no hit at ${x},${z}`);
      near(hit.point.y, t.heightAt(x, z), 1e-3);
    }
  });

  test('same seed → same terrain; different seed → different; outside is far below', () => {
    const a = new Terrain({ seed: 3 });
    const b = new Terrain({ seed: 3 });
    const c = new Terrain({ seed: 4 });
    assert.deepEqual([...a.H.slice(0, 50)], [...b.H.slice(0, 50)]);
    assert.notDeepEqual([...a.H.slice(0, 200)], [...c.H.slice(0, 200)]);
    assert.ok(a.heightAt(9999, 0) < -10);
  });

  test('scatter returns land points that respect avoid zones', () => {
    const t = new Terrain({ seed: 2 });
    const pts = t.scatter(25, { avoid: [{ x: 0, z: 0, r: 10 }] });
    assert.ok(pts.length > 10);
    for (const p of pts) {
      assert.ok(Math.hypot(p.x, p.z) >= 10);
      assert.ok(p.y > t.waterLevel);
    }
  });

  test('is added as scene.ground automatically', () => {
    const s = new Scene3D();
    const t = s.add(new Terrain({ seed: 1 }));
    assert.equal(s.ground, t);
    assert.equal(s.groundHeight(0, 0), t.heightAt(0, 0));
  });
});

describe('cameras, controls, fx, props', () => {
  test('OrbitRig follows a target and gives camera-relative movement', () => {
    const cam = new THREE.PerspectiveCamera();
    const target = new Entity3D({ position: [10, 0, 5] });
    const rig = new OrbitRig(cam, { target, distance: 6, height: 1, yaw: 0, pitch: 0, smoothing: 0 });
    rig.update(0.016);
    near(cam.position.x, 10);
    near(cam.position.z, 11); // camera sits behind (+z) looking toward -z
    near(rig.relative(0, 1).z, -1);
    near(rig.relative(1, 0).x, 1);
    rig.rotate(Math.PI / 2, 0); // yaw turns the view
    near(Math.abs(rig.forward.x), 1);
    rig.rotate(0, 10);
    assert.ok(rig.pitch <= rig.maxPitch);
  });

  test('OrbitRig keeps the camera above the ground', () => {
    const cam = new THREE.PerspectiveCamera();
    const scene = { groundHeight: () => 4 };
    const rig = new OrbitRig(cam, { target: new Entity3D({ position: [0, 4, 0] }), pitch: -0.1, minPitch: -1, scene, smoothing: 0 });
    rig.update(0.016);
    assert.ok(cam.position.y >= 4.6 - 1e-6);
  });

  test('FirstPersonRig sits at eye height', () => {
    const cam = new THREE.PerspectiveCamera();
    const rig = new FirstPersonRig(cam, { target: new Entity3D({ position: [1, 2, 3] }), eye: 1.5 });
    rig.update();
    near(cam.position.y, 3.5);
    rig.rotate(0, 99);
    assert.ok(rig.pitch >= -rig.limit);
  });

  test('Controls3D merges keyboard and stick, look accumulates and resets', () => {
    const game = mkGame();
    const c = new Controls3D(game);
    game.input.keyDown('KeyW');
    near(c.move.y, 1);
    game.input.keyDown('KeyD');
    near(Math.hypot(c.move.x, c.move.y), 1);
    game.input.keyUp('KeyW');
    game.input.keyUp('KeyD');
    c.setStick(0, -1);
    near(c.move.y, -1);
    c.addLook(0.1, 0.2);
    c.addLook(0.1, 0.2);
    assert.deepEqual(c.consumeLook(), { x: 0.2, y: 0.4 });
    assert.deepEqual(c.consumeLook(), { x: 0, y: 0 });
    c.destroy();
  });

  test('Particles3D bursts, fades and recycles', () => {
    const game = mkGame();
    const s = new Scene3D();
    game.start(s);
    const fx = s.add(new Particles3D({ max: 10 }));
    fx.burst(new THREE.Vector3(1, 1, 1), { count: 25, life: 0.3 }); // more than max: wraps around the pool
    game.step();
    assert.ok(fx.p.every((p) => p.life > 0));
    run(game, 1);
    assert.ok(fx.p.every((p) => p.life <= 0));
    assert.equal(fx.pos[1], -9999);
  });

  test('props build upright groups; character animates limbs', () => {
    const g = props.character();
    g.userData.parts.animate(0.1, 6);
    for (const p of [props.tree(), props.rock(), props.crystal(), props.cloud(), g]) assert.ok(p.isGroup);
    assert.ok(createSky().isMesh);
  });

  test('extendAssets adds texture/gltf types with injectable loaders', async () => {
    const assets = extendAssets(new Assets({}), { textureLoader: { load: (u, ok) => ok({ url: u }) } });
    assets.texture('t', 'a.png');
    assets.gltf('m', 'a.glb');
    await assert.rejects(assets.load(), /GLTFLoader missing/);
    const a2 = extendAssets(new Assets({}), { textureLoader: { load: (u, ok) => ok({ url: u }) } });
    a2.texture('t', 'a.png');
    await a2.load();
    assert.equal(a2.get('t').url, 'a.png');
  });
});
