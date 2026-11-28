import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Game3D, Scene3D, Entity3D, Terrain, Particles3D } from '../src/index.js';

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);
const mkGame = (o = {}) => new Game3D({ raf: () => 0, caf: () => {}, ...o });

describe('regressions: scene3d children', () => {
  const setup = () => {
    const game = mkGame();
    const s = new Scene3D();
    game.start(s);
    const parent = s.add(new Entity3D({ position: [0, 0, 0], size: [1, 1, 1] }));
    // Child at x=1.1 (not 1.0) so its box [0.6, 1.6] does not merely touch
    // the parent's box [-0.5, 0.5] — Box3.intersectsBox counts touching.
    const child = parent.add(new Entity3D({ position: [1.1, 0, 0], size: [1, 1, 1] }));
    return { game, s, parent, child };
  };

  test('queryBox() finds child entities at their world position', () => {
    const { s, child } = setup();
    const box = new THREE.Box3(new THREE.Vector3(0.6, -0.4, -0.4), new THREE.Vector3(1.4, 0.6, 0.6));
    const found = s.queryBox(box);
    assert.equal(found.length, 1);
    assert.equal(found[0], child);
  });

  test('children receive collision events in world space', () => {
    const { game, s, child } = setup();
    const hits = [];
    child.on('collide', (o) => hits.push(['child', o]));
    const other = s.add(new Entity3D({ position: [1.2, 0, 0], size: [1, 1, 1] }));
    other.on('collide', (o) => hits.push(['other', o]));
    game.step();
    // Identity assertions, not deepEqual: deep-comparing Entity3D object
    // graphs (scene ↔ entities ↔ THREE objects, circular) is pathological.
    assert.equal(hits.length, 2);
    assert.equal(hits[0][0], 'child');
    assert.equal(hits[0][1], other);
    assert.equal(hits[1][0], 'other');
    assert.equal(hits[1][1], child);
  });
});

describe('regressions: moveAndCollide3 snapDown', () => {
  test('the snapDown branch reports hit.y like the primary ground branch', () => {
    const s = new Scene3D();
    const e = s.add(new Entity3D({ position: [0, 0.3, 0], size: [1, 1, 1] }));
    const hit = s.moveAndCollide3(e, 0, -0.1, 0, { snapDown: 0.5 });
    near(e.position.y, 0);
    assert.equal(hit.bottom, true);
    assert.equal(hit.ground, true);
    assert.equal(hit.y, true, 'hit.y is set so Body3D zeroes vel.y');
  });
});

describe('regressions: Entity3D box and options', () => {
  test('box incorporates object.scale', () => {
    const e = new Entity3D({ position: [0, 0, 0], size: [2, 2, 2], scale: 2 });
    near(e.box.min.x, -2);
    near(e.box.max.x, 2);
    near(e.box.min.y, 0);
    near(e.box.max.y, 4);
    near(e.box.min.z, -2);
    near(e.box.max.z, 2);
    const plain = new Entity3D({ position: [0, 0, 0], size: [2, 2, 2] });
    near(plain.box.max.x, 1, 1e-9);
    near(plain.box.max.y, 2, 1e-9);
  });

  test('size accepts a THREE.Vector3', () => {
    const e = new Entity3D({ position: [0, 0, 0], size: new THREE.Vector3(3, 1, 2) });
    assert.deepEqual([e.size.x, e.size.y, e.size.z], [3, 1, 2]);
    near(e.box.max.x - e.box.min.x, 3);
    near(e.box.max.z - e.box.min.z, 2);
  });

  test('types: Entity3DOptions.size accepts THREE.Vector3', () => {
    const dts = readFileSync(new URL('../types/index.d.ts', import.meta.url), 'utf8');
    assert.ok(dts.includes('size?: [number, number, number] | THREE.Vector3'), 'size union is typed');
  });
});

describe('regressions: zero guards', () => {
  test('Particles3D with max: 0 does not crash and can burst', () => {
    const fx = new Particles3D({ max: 0 });
    assert.ok(fx.max >= 1);
    assert.equal(fx.p.length, fx.max);
    fx.burst(new THREE.Vector3(0, 0, 0), { count: 3 });
    fx.update(0.1);
    assert.ok(fx.p.every((p) => Number.isFinite(p.life)));
  });

  test('Terrain with segments: 0 is clamped and stays usable', () => {
    const t = new Terrain({ size: 10, segments: 0, seed: 1 });
    assert.ok(t.segments >= 1);
    assert.ok(Number.isFinite(t.heightAt(0, 0)));
  });
});
