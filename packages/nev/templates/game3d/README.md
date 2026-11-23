# {{name}}

A 3D game starter: **Nev.js + NevG + NevGThree (three.js)**. Collect crystals on a low-poly island before time runs out.

```bash
npm install
npm run dev        # http://localhost:3000  (open it on your phone too: touch joystick included)
npm run export     # static site in ./out
```

- `components/crystal-run.js` — the whole game (terrain, trees, character, camera, physics, particles).
- `pages/index.js` — page + HUD (NevF signals).

Controls: WASD / arrows, Space = jump, Shift = dash, mouse drag = look. Phone: left thumb joystick, drag the right side to look, buttons bottom-right.
