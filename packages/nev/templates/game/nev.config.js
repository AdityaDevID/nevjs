import { defineConfig } from 'nevjs';

export default defineConfig({
  title: 'Coin Dash',
  head: { links: [{ rel: 'stylesheet', href: '/style.css' }] },
  browserPackages: ['@adityadevid/nevg'],
});
