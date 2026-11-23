// A tiny platformer built with NevG: tilemap, Body physics, particles, save data, buttons, transitions.
import { Game, Scene, Rect, Label, Tilemap, Body, ParticleEmitter, SaveData, Button, transition, createRng } from '@adityadevid/nevg';

const LEVEL = `
####################
#..................#
#..................#
#......c...c.......#
#.....###.###......#
#..c...........c...#
#.###.........###..#
#..................#
#.c...####.####..c.#
####################
`;

export class Play extends Scene {
  constructor(save, rng) {
    super();
    this.save = save;
    this.rng = rng;
    this.score = 0;
  }

  init() {
    this.background = '#10131a';
    this.tilemap = Tilemap.fromString(LEVEL.replaceAll('c', '.'), { '#': 1 }, { tileSize: 16, solid: [1], colors: { 1: '#334155' } });
    LEVEL.trim().split('\n').forEach((line, row) => {
      [...line].forEach((ch, col) => {
        if (ch === 'c') this.add(new Rect({ x: col * 16 + 4, y: row * 16 + 4, w: 8, h: 8, color: '#facc15', tags: ['coin'] }));
      });
    });
    this.me = this.add(new Rect({ x: 24, y: 130, w: 10, h: 12, color: '#6ee7b7' }));
    this.me.body = new Body(this.me, { gravity: 700, maxFall: 400, drag: 12, airDrag: 2, maxSpeed: 90 });
    this.hud = this.add(new Label({ x: 6, y: 4, font: '10px monospace', screenSpace: true, text: () => `coins ${this.score}  best ${this.save.get('best', 0)}` }));
  }

  update(dt) {
    const input = this.input;
    const body = this.me.body;
    body.vx += input.axis('left', 'right') * 600 * dt;
    if (input.pressed('jump') || input.pressed('up')) body.jump(250);
    if (input.released('jump')) body.cutJump();
    body.step(dt);
    for (const coin of this.query(this.me.rect, 'coin')) {
      coin.destroy();
      this.score++;
      this.add(new ParticleEmitter({ x: coin.x, y: coin.y, rate: 0, once: true, life: [0.3, 0.6], speed: [30, 80], gravity: 150, colors: ['#facc15', '#fde68a'], rng: this.rng })).burst(12);
    }
    if (!this.withTag('coin').length) this.finish();
  }

  finish() {
    if (this.score > this.save.get('best', 0)) this.save.set('best', this.score);
    transition(this.game, new Menu(this.save, this.rng, `You got all ${this.score} coins!`));
  }
}

export class Menu extends Scene {
  constructor(save, rng, message = 'Coin Dash') {
    super();
    this.save = save;
    this.rng = rng;
    this.message = message;
  }
  init() {
    this.background = '#0b1020';
    this.add(new Label({ x: 160, y: 50, font: '16px monospace', align: 'center', text: this.message, screenSpace: true }));
    this.add(new Button({ x: 120, y: 90, w: 80, h: 22, text: 'Play', onClick: () => transition(this.game, new Play(this.save, this.rng)) }));
  }
}

export function createCoinDash(canvas) {
  const save = new SaveData('coin-dash', { best: 0 });
  const game = new Game({ canvas, width: 320, height: 160, pixelArt: true });
  game.input.bind('jump', ['Space', 'KeyW', 'ArrowUp']);
  game.start(new Menu(save, createRng()));
  return game;
}
