import { defineConfig } from '@adityadevid/nevjs';

export default defineConfig({
  title: 'Crystal Run 3D',
  head: {
    meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no' }],
    links: [{ rel: 'stylesheet', href: '/style.css' }],
  },
  browserPackages: ['@adityadevid/nevg', '@adityadevid/nevgthree', 'three'],
});
