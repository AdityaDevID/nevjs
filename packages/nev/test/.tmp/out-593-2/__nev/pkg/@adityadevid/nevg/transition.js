import { Rect } from './entity.js';

/**
 * Fade out → switch scene → fade in.
 *   transition(game, new GameOver(), { duration: 0.6, color: '#000' })
 * Returns a promise that resolves when the new scene is fully visible.
 */
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
