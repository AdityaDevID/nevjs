import { Game3D, Scene3D, Entity3D, Mesh3D, Body3D, OrbitRig, Controls3D, Terrain, Particles3D, props, createSky, createWater, THREE } from '@adityadevid/nevgthree';
import { createRng, SaveData, damp, clamp } from '@adityadevid/nevg';

const ROUND = 45;
const SPEED = 8;

export class Island extends Scene3D {
  constructor(hud, save) {
    super();
    this.hud = hud;
    this.save = save;
    this.state = 'ready';
    this.squash = 0;
    this.dashLeft = 0;
    this.lastPick = -99;
  }

  init() {
    const rng = createRng(7);
    this.rng = rng;
    this.fog = ['#cfeaff', 45, 150];
    this.sky = this.add(createSky({ top: '#3f8cff', horizon: '#d8f0ff' }));
    this.game.input.bind('jump', ['Space']);
    this.lights({ shadowSize: 28 });

    this.terrain = this.add(new Terrain({ size: 120, segments: 64, height: 7, seed: 7, island: true }));
    this.add(createWater({ level: this.terrain.waterLevel }));

    const spots = this.terrain.scatter(55, { rng, minHeight: 1.2, avoid: [{ x: 0, z: 0, r: 7 }] });
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.24, 1.3, 6).translate(0, 0.65, 0), new THREE.MeshStandardMaterial({ color: '#7a5230', flatShading: true }), spots.length);
    const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1.6, 7).translate(0, 0.8, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true }), spots.length * 3);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const green = new THREE.Color();
    spots.forEach((p, i) => {
      const s = 0.8 + rng() * 0.6;
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(s, s, s));
      trunk.setMatrixAt(i, m);
      green.set('#2f8f4e').offsetHSL((rng() - 0.5) * 0.06, 0, (rng() - 0.5) * 0.08);
      for (let k = 0; k < 3; k++) {
        const r = (1.1 - k * 0.28) * s;
        m.compose(new THREE.Vector3(p.x, p.y + (1 + k * 0.85) * s, p.z), q, new THREE.Vector3(r, s * 0.85, r));
        cone.setMatrixAt(i * 3 + k, m);
        cone.setColorAt(i * 3 + k, green);
      }
      this.add(new Entity3D({ position: [p.x, p.y, p.z], size: [0.5, 3, 0.5], solid: true, collides: false }));
    });
    trunk.castShadow = cone.castShadow = true;
    this.add(trunk, cone);

    for (const p of this.terrain.scatter(18, { rng, minHeight: 0.9, avoid: [{ x: 0, z: 0, r: 5 }] })) {
      const rock = props.rock({ rng, size: 0.8 + rng() * 1.2 });
      rock.position.set(p.x, p.y - 0.1, p.z);
      this.add(rock);
    }
    for (let i = 0; i < 6; i++) {
      const c = props.cloud({ rng });
      c.position.set(rng.range(-70, 70), rng.range(28, 40), rng.range(-70, 70));
      c.scale.setScalar(1.5 + rng());
      this.add(c);
    }

    const model = props.character();
    this.parts = model.userData.parts;
    this.player = this.add(new Entity3D({ object: model, position: [0, this.terrain.heightAt(0, 0) + 0.2, 0], size: [0.7, 1.9, 0.7] }));
    this.player.tags.add('player');
    this.body = new Body3D(this.player, { gravity: 32, accel: 55 });
    this.fx = this.add(new Particles3D({ max: 500, size: 0.3 }));

    this.controls = new Controls3D(this.game, { buttons: [{ code: 'Space', label: '⤒' }, { code: 'ShiftLeft', label: '⚡' }] });
    this.rig = new OrbitRig(this.camera, { target: this.player, distance: 8.5, height: 1.7, pitch: 0.4, scene: this });

    this.crystals = 0;
    for (let i = 0; i < 12; i++) this.spawnCrystal(true);
    this.setState('ready');
  }

  spawnCrystal(anywhere = false) {
    const pts = this.terrain.scatter(1, { rng: this.rng, minHeight: 1, avoid: anywhere ? [{ x: 0, z: 0, r: 4 }] : [{ x: this.player.position.x, z: this.player.position.z, r: 9 }] });
    const p = pts[0] ?? { x: 0, y: 2, z: 6 };
    const hue = this.rng.pick(['#7df9ff', '#ff7de9', '#ffd166', '#9bff7d']);
    const c = this.add(new Entity3D({ object: props.crystal({ color: hue }), position: [p.x, p.y + 0.4, p.z], size: [1.2, 1.6, 1.2], spin: [0, 2, 0], bob: { amp: 0.15, speed: 3 }, tags: ['crystal'], castShadow: false }));
    c.hue = hue;
    c.on('collide', (o) => o === this.player && this.state === 'playing' && this.collect(c));
  }

  collect(c) {
    if (c.dead) return;
    c.destroy();
    const gap = this.time - this.lastPick;
    this.lastPick = this.time;
    this.combo = gap < 3 ? Math.min(8, this.combo + 1) : 1;
    this.score += 10 * this.combo;
    this.left = Math.min(ROUND + 15, this.left + 2);
    this.fx.burst(c.position, { count: 28, colors: [c.hue, '#ffffff'], speed: 6, life: 0.9, up: 3 });
    this.shake(0.08, 0.15);
    this.spawnCrystal();
    this.sync();
  }

  setState(s) {
    this.state = s;
    this.hud.state.set(s);
  }

  begin() {
    this.score = 0;
    this.combo = 1;
    this.left = ROUND;
    this.lastPick = -99;
    this.player.position.set(0, this.terrain.heightAt(0, 0) + 0.2, 0);
    this.body.vel.set(0, 0, 0);
    this.rig.yaw = 0;
    this.setState('playing');
    this.sync();
  }

  sync() {
    this.hud.score.set(this.score ?? 0);
    this.hud.time.set(this.left ?? ROUND);
    this.hud.combo.set(this.combo ?? 1);
    this.hud.best.set(this.save.data.best);
  }

  update(dt) {
    const { input, controls, body, player, rig } = this;
    const look = controls.consumeLook();
    rig.rotate(look.x, look.y);
    this.shadowFollow(player);

    if (this.state === 'ready') {
      rig.yaw += dt * 0.25;
      this.parts.animate(this.time, 0);
      return;
    }
    if (this.state === 'over') {
      body.stop();
      this.parts.animate(this.time, 0);
      return;
    }

    this.left -= dt;
    if (this.time - this.lastPick > 3) this.combo = 1;
    if (this.left <= 0) {
      this.left = 0;
      if (this.score > this.save.data.best) this.save.set('best', this.score);
      this.setState('over');
    }
    this.hud.time.set(this.left);
    this.hud.combo.set(this.combo);

    const m = controls.move;
    const d = rig.relative(m.x, m.y);
    const inWater = this.terrain.heightAt(player.position.x, player.position.z) < this.terrain.waterLevel;
    const speed = SPEED * (inWater ? 0.55 : 1);
    body.walk(d.x, d.z, speed);
    if (m.x || m.y) player.rot.y += Math.atan2(Math.sin(Math.atan2(d.x, d.z) - player.rot.y), Math.cos(Math.atan2(d.x, d.z) - player.rot.y)) * Math.min(1, dt * 14);
    if (input.pressed('jump')) body.jump(13);
    if (input.released('jump')) body.cutJump(0.5);

    this.dashLeft = Math.max(0, this.dashLeft - dt);
    if (input.pressed('ShiftLeft') && this.dashLeft === 0) {
      const f = m.x || m.y ? d : { x: Math.sin(player.rot.y), z: Math.cos(player.rot.y) };
      body.impulse(f.x * 16, 2, f.z * 16);
      this.dashLeft = 1.5;
      this.fx.burst(player.position, { count: 12, color: '#ffffff', speed: 2, life: 0.4, up: 0.5 });
    }
    this.hud.dash.set(1 - this.dashLeft / 1.5);

    const r = Math.hypot(player.position.x, player.position.z);
    if (r > 54) {
      player.position.x *= 54 / r;
      player.position.z *= 54 / r;
    }

    const horiz = Math.hypot(body.vel.x, body.vel.z);
    this.parts.animate(this.time, body.onGround ? horiz : 0);
    this.squash = damp(this.squash, clamp(-body.vel.y * 0.012, -0.25, 0.25), 14, dt);
    player.scale3.set(1 + this.squash * 0.5, 1 - this.squash, 1 + this.squash * 0.5);
  }
}

export function createCrystalRun(canvas, hud) {
  const save = new SaveData('crystal-run-3d', { best: 0 });
  const game = new Game3D({ canvas, shadows: true, maxDpr: 2 });
  const scene = new Island(hud, save);
  game.start(scene);
  hud.best.set(save.data.best);
  return { game, begin: () => scene.begin(), destroy: () => (scene.controls?.destroy(), game.destroy()) };
}
