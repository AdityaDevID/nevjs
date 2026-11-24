import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@adityadevid/nevf';
import { Game3D } from '../src/index.js';
import { SaveData } from '@adityadevid/nevg';
import { Island } from '../../nev/templates/game3d/components/crystal-run.js';

const memStore = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
};

test('game3d template: Crystal Run plays a full round headlessly', () => {
  const hud = { state: signal('loading'), score: signal(0), time: signal(45), combo: signal(1), best: signal(0), dash: signal(1) };
  const save = new SaveData('t', { best: 0 }, { storage: memStore() });
  const game = new Game3D({ raf: () => 0, caf: () => {} });
  const scene = new Island(hud, save);
  game.start(scene);
  assert.equal(hud.state(), 'ready');
  for (let i = 0; i < 30; i++) game.step();
  scene.begin();
  assert.equal(hud.state(), 'playing');

  let collected = false;
  for (let i = 0; i < 60 * 25 && !collected; i++) {
    const crystals = scene.withTag('crystal');
    const p = scene.player.position;
    const t = crystals.sort((a, b) => a.distanceTo(scene.player) - b.distanceTo(scene.player))[0];
    const dx = t.position.x - p.x;
    const dz = t.position.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    scene.body.walk(dx / l, dz / l, 8);
    scene.controls.setStick(0, 0);
    const f = scene.rig.forward;
    const my = (dx / l) * f.x + (dz / l) * f.z;
    const mx = (dx / l) * -f.z + (dz / l) * f.x;
    scene.controls.setStick(mx, my);
    game.step();
    collected = scene.score > 0;
  }
  assert.ok(collected, 'collected a crystal');
  assert.ok(hud.score() >= 10);
  assert.equal(scene.withTag('crystal').length, 12, 'a new crystal respawns');

  for (let i = 0; i < 60 * 70 && hud.state() === 'playing'; i++) game.step();
  assert.equal(hud.state(), 'over');
  assert.ok(save.data.best >= 10, 'best score saved');
  assert.ok(Math.hypot(scene.player.position.x, scene.player.position.z) < 60, 'stayed on the island');
  game.destroy();
});
