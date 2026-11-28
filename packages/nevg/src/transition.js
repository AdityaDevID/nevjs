import { Rect } from './entity.js';

export function transition(game, next, { duration = 0.4, color = '#000' } = {}) {
  const half = Math.max(duration, 0.0001) / 2;
  const cover = () =>
    new Rect({ x: 0, y: 0, w: game.width, h: game.height, color, alpha: 0, z: 1e9, screenSpace: true, collides: false });
  return new Promise((resolve) => {
    const current = game.scene;
    if (!current) {
      game.setScene(next);
      resolve();
      return;
    }
    // A paused scene never steps its tweens (Scene#_step returns early),
    // so a fade driven by either scene's tweens would hang forever.
    // When either side is paused, skip the animation and switch at once.
    if (current.paused || next.paused) {
      game.setScene(next);
      resolve();
      return;
    }
    const out = current.add(cover());
    current.tween(out, { alpha: 1 }, {
      duration: half,
      onComplete: () => {
        const inn = cover();
        inn.alpha = 1;
        next.add(inn);
        game.setScene(next);
        next.tween(inn, { alpha: 0 }, {
          duration: half,
          onComplete: () => {
            inn.destroy();
            resolve();
          },
        });
      },
    });
  });
}
