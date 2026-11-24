import { defineConfig } from '@adityadevid/nevjs';

export default defineConfig({
  title: 'My Nev App',
  titleTemplate: '%s · My Nev App',
  lang: 'en',
  head: {
    meta: [{ name: 'description', content: 'Built with Nev.js' }],
    links: [{ rel: 'stylesheet', href: '/style.css' }],
  },
});
