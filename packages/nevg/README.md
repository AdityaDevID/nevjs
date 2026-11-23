# nevg — NevG.js

Tiny 2D game framework: fixed-timestep loop, scenes, entities, collisions, tweens, tilemaps, input. Canvas 2D, zero dependencies.

```js
import { Game, Scene, Rect } from 'nevg';

class Play extends Scene {
  init() { this.add(new Rect({ x: 10, y: 10, w: 16, h: 16, color: '#6ee7b7', vx: 30 })); }
}
new Game({ canvas: '#game', width: 320, height: 180 }).start(new Play());
```

Full API reference: see the repository README (`../../README.md`).
