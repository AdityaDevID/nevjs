import { h, signal, onMount, Show } from '@adityadevid/nevf';

export const head = () => ({ title: 'Crystal Run 3D' });

export default function Home() {
  const hud = { state: signal('loading'), score: signal(0), time: signal(45), combo: signal(1), best: signal(0), dash: signal(1) };
  let api = null;

  onMount(() => {
    let dead = false;
    // Loaded in the browser only (three.js needs WebGL).
    import('../components/crystal-run.js').then((m) => {
      if (dead) return;
      api = m.createCrystalRun(document.getElementById('game'), hud);
    });
    return () => {
      dead = true;
      api?.destroy();
    };
  });

  const begin = () => api?.begin();
  return h('main', null,
    h('canvas', { id: 'game' }),
    h('div', { class: 'hud' },
      h('div', { class: 'row' },
        h('div', null, h('small', null, 'Skor'), () => hud.score()),
        h('div', null, h('small', null, 'Waktu'), () => Math.ceil(hud.time()) + 's'),
        h('div', { class: 'combo' }, h('small', null, 'Combo'), () => 'x' + hud.combo()),
        h('div', null, h('small', null, 'Terbaik'), () => hud.best())),
      h(Show, { when: () => hud.state() === 'ready' },
        h('div', { class: 'panel' },
          h('h1', null, 'Crystal Run 3D'),
          h('p', null, 'Kumpulkan kristal sebelum waktu habis. Ambil beruntun untuk combo!'),
          h('p', null, 'WASD / joystick · Spasi lompat · Shift dash'),
          h('button', { onClick: begin }, 'Main'))),
      h(Show, { when: () => hud.state() === 'over' },
        h('div', { class: 'panel' },
          h('h1', null, 'Waktu habis!'),
          h('p', null, () => `Skor ${hud.score()} · Terbaik ${hud.best()}`),
          h('button', { onClick: begin }, 'Main lagi')))));
}
