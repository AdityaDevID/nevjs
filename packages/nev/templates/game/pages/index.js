import { h, onMount } from '@adityadevid/nevf';
import { createCoinDash } from '../components/coin-dash.js';

export const head = () => ({ title: 'Coin Dash' });

export default function Home() {
  onMount(() => {
    const game = createCoinDash(document.getElementById('game'));
    return () => game.destroy();
  });
  return h('main', null,
    h('canvas', { id: 'game' }),
    h('p', null, 'Arrow keys / WASD to move, Space to jump. Collect coins!'));
}
