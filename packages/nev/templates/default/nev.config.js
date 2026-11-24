import { defineConfig } from '@adityadevid/nevjs';

export default defineConfig({
  title: 'My Nev App',
  titleTemplate: '%s · My Nev App',
  lang: 'en',
  head: {
    meta: [{ name: 'description', content: 'Built with Nev.js' }],
    links: [{ rel: 'stylesheet', href: '/style.css' }],
  },
  // site: 'https://example.com',            // → /sitemap.xml, /robots.txt and absolute canonical / og:url
  // trailingSlash: 'never',                  // one canonical URL per page (308 redirect)
  // redirects: [{ source: '/old/:slug', destination: '/blog/:slug', permanent: true }],
  // headers: [{ source: '/api/*', headers: { 'cache-control': 'no-store' } }],
  // Add your own middleware / routes (runs before Nev's own):
  // setup(app) {
  //   app.use(cors({ origin: ['https://example.com'] }))
  // },
});
