import { defineConfig } from 'nevjs';

export default defineConfig({
  title: 'My Nev App',
  titleTemplate: '%s · My Nev App',
  lang: 'en',
  head: {
    meta: [{ name: 'description', content: 'Built with Nev.js' }],
    links: [{ rel: 'stylesheet', href: '/style.css' }],
  },
  // Add your own middleware / routes (runs before Nev's own):
  // setup(app) {
  //   app.use(cors({ origin: ['https://example.com'] }))
  // },
});
