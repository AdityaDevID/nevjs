# nevgthree — NevGThree

3D layer for [NevG.js](../nevg) on top of **three.js**. Same loop, scenes, entities, input, tweens and timers you already know from NevG — but the world is 3D. Zero build, headless-testable.

```bash
npm install @adityadevid/nevgthree @adityadevid/nevg three
```

```js
import { Game3D, Scene3D, Mesh3D, Body3D, Terrain, OrbitRig, Controls3D } from '@adityadevid/nevgthree';

class Play extends Scene3D {
  init() {
    this.background = '#bfe3ff';
    this.lights();                                             // sun + sky light + shadows
    this.add(new Terrain({ seed: 7 }));                        // low-poly island, becomes scene.ground
    this.me = this.add(new Mesh3D({ shape: 'capsule', size: [0.8, 1.8, 0.8], color: '#6ee7b7', position: [0, 5, 0] }));
    new Body3D(this.me);                                       // gravity, jump, slopes, solid blocking
    this.controls = new Controls3D(this.game);                 // keyboard + mouse + phone joystick
    this.rig = new OrbitRig(this.camera, { target: this.me, scene: this });
  }
  update(dt) {
    const look = this.controls.consumeLook();
    this.rig.rotate(look.x, look.y);
    const m = this.controls.move, d = this.rig.relative(m.x, m.y);
    this.me.body.walk(d.x, d.z, 7);
    if (this.input.pressed('jump')) this.me.body.jump(12);
  }
}
new Game3D({ canvas: '#game', shadows: true }).start(new Play());
```

## What's inside

| | |
|---|---|
| `Game3D` | NevG `Game` + `WebGLRenderer`: canvas fills its parent, DPR cap, **adaptive resolution** (drops on slow phones), `setQuality('low'\|'medium'\|'high')`, context-loss handling |
| `Scene3D` | `Scene` with a three.js scene + `PerspectiveCamera`: `lights()`, `fog`, `background`, `pick()` / `raycast()`, `moveAndCollide3()`, camera `shake()`, auto-dispose on exit |
| `Entity3D` · `Mesh3D` · `Model3D` | NevG entities backed by `Object3D`: collision boxes, tags, children, `spin`/`bob`, auto-removal + GPU cleanup |
| `Body3D` | arcade physics: gravity, acceleration walking, coyote time, jump buffer, step-up, slope snapping |
| `OrbitRig` · `TopDownRig` · `FirstPersonRig` | camera controllers; `rig.relative(x, y)` gives camera-relative movement |
| `Controls3D` | one API for WASD, mouse drag / pointer lock and a **touch joystick + buttons** on phones |
| `Terrain` · `createWater` · `createSky` · `props` | procedural low-poly world: exact `heightAt()`, `scatter()`, trees, rocks, crystals, clouds, a blocky character |
| `Particles3D` | pooled additive particles (one draw call) |
| `extendAssets` | `assets.texture()` and `assets.gltf()` (pass `GLTFLoader` from `three/addons`) |

`THREE` is re-exported, so `import { THREE } from '@adityadevid/nevgthree'` always matches the version the engine uses.

## With Nev (fullstack)

```bash
npx @adityadevid/nevjs create my-3d-game --template game3d
```

Set `browserPackages: ['@adityadevid/nevg', '@adityadevid/nevgthree', 'three']` in `nev.config.js`. Nev serves three.js (and `three/addons/…`) to the browser through its import map — no bundler.

## Notes

- Units are meters, Y is up, entity `position` = feet (`anchor: 0`; use `anchor: 0.5` for a center origin).
- Tests run headless: `new Game3D()` without a canvas, `game.step()`; inject a fake `renderer` to assert on rendering.
- Pre-1.0: the API may still change.

MIT.
