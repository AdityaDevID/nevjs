import { h, createRef, onMount } from 'nevf';
import { Game, Scene, Rect, Label, createRng } from 'nevg';

export const head = () => ({ title: 'Game' });

// A tiny NevG game: move with the arrow keys / WASD and collect the yellow coins.
class CoinScene extends Scene {
  init() {
    const rng = createRng(7);
    this.background = '#10131a';
    this.score = 0;
    this.player = this.add(new Rect({ x: 150, y: 80, w: 14, h: 14, color: '#6ee7b7', z: 2 }));
    const spawn = () => this.add(new Rect({ x: rng.range(10, 296), y: rng.range(20, 156), w: 8, h: 8, color: '#facc15', tags: ['coin'] }));
    for (let i = 0; i < 6; i++) spawn();
    this.hud = this.add(new Label({ x: 8, y: 6, font: '12px monospace', screenSpace: true, z: 9, text: () => `Score ${this.score}` }));
    this.player.onCollide = (other) => {
      if (!other.hasTag('coin') || other.dead) return;
      other.destroy();
      this.score++;
      spawn();
      this.camera.shake(2, 0.1);
    };
  }

  update(dt) {
    const speed = 110;
    const v = this.input.vector();
    const p = this.player;
    p.x = Math.min(this.width - p.w, Math.max(0, p.x + v.x * speed * dt));
    p.y = Math.min(this.height - p.h, Math.max(0, p.y + v.y * speed * dt));
  }
}

export default function GamePage() {
  const canvas = createRef();
  // onMount only runs in the browser, so the server never touches <canvas>.
  onMount(() => {
    const game = new Game({ canvas: canvas.current, width: 320, height: 180, pixelArt: true });
    game.start(new CoinScene());
    window.__game = game; // handy for debugging in the console
    return () => {
      game.destroy();
      delete window.__game;
    };
  });
  return h(
    'div',
    null,
    h('h1', null, 'Game'),
    h('p', { class: 'muted' }, 'Arrow keys or WASD. Built with NevG.'),
    h('div', { class: 'game-wrap' }, h('canvas', { ref: canvas, id: 'game' })),
  );
}
