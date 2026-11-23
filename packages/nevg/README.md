# nevg — NevG.js

Tiny 2D game framework: fixed-timestep loop, scenes, entities, collisions, tweens, tilemaps, input. Canvas 2D, **zero dependencies**, headless-testable.

```bash
npm install @adityadevid/nevg
```

```js
import { Game, Scene, Rect } from '@adityadevid/nevg';

class Play extends Scene {
  init() { this.add(new Rect({ x: 10, y: 10, w: 16, h: 16, color: '#6ee7b7', vx: 30 })); }
}
new Game({ canvas: '#game', width: 320, height: 180 }).start(new Play());
```

## What's inside
`Game Scene Entity Rect Circle Label Sprite Camera Input Tilemap Tweens Assets Sound Emitter` + math/RNG helpers, plus:

| Module | |
|---|---|
| `ParticleEmitter` | rate/burst, gravity, drag, color lists, seeded RNG |
| `findPath` · `gridFromTilemap` · `lineOfSight` · `reachable` | A* (4/8-way, no corner cutting, tile costs), BFS |
| `Body` | arcade physics: gravity, drag, bounce, coyote time, jump buffering |
| `StateMachine` · `Cooldown` · `Pool` | game-logic building blocks |
| `Button` · `ProgressBar` · `transition` | HUD widgets and scene fades |
| `SaveData` | versioned localStorage saves with migrations |
| `Gamepads` | gamepad → bindable key codes |
| `vec*` helpers | 2D vector math, segment/rect/circle tests |

Headless mode (no canvas): call `game.step()` — that's how the test-suite runs games.

Part of the [Nev.js](https://github.com/AdityaDevID/nevjs) family. MIT.
