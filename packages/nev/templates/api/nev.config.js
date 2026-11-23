import { defineConfig, compress, requestId, csrf } from '@adityadevid/nevjs';

export default defineConfig({
  title: 'My Nev API',
  setup(app) {
    app.use(requestId(), compress(), csrf());
  },
});
