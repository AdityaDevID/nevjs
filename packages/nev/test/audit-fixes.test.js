import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createNev, fileToPattern, parseEnv, exportSite, buildVercel, buildNetlify } from '../src/index.js';
import { create } from '../src/cli.js';
import { assertSafeOut, copyFiltered } from '../src/export.js';
import { makeApp, cleanup, TMP } from './helpers.js';

after(cleanup);

const page = `import { h } from '@adityadevid/nevf';
export default (p) => h('main', null, 'data=' + JSON.stringify(p.data) + ' action=' + JSON.stringify(p.actionData));`;
const form = (obj) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(obj).toString(),
});
const dataReq = (app, p, headers = { 'x-nev-data': '1' }) =>
  app.request('/__nev/data?path=' + encodeURIComponent(p), { headers });
const json = async (res) => JSON.parse(await res.text());

// ---------------------------------------------------------------- fix 1
describe('audit fix 1: loaders run with the real middleware context', () => {
  const files = {
    'pages/index.js': page,
    'pages/index.server.js': `export const load = (c) => ({ state: c.state.marker ?? null, sess: c.session?.user ?? null });
      export const action = () => ({ saved: 1 });`,
    'pages/protected/page.js': page,
    'pages/protected/page.server.js': `export const load = (c) => ({ state: c.state.marker ?? null });`,
    'pages/open.js': page,
    'pages/open.server.js': `export const load = (c) => ({ state: c.state.marker ?? null });`,
    'middleware.js': `export default (c, next) => { c.state.marker = 'mw-state'; return next(); };`,
    'nev.config.js': `import { session } from '@adityadevid/nevjs';
      export default { setup(app) {
        app.use(session({ secret: 'audit-secret-0123456789abcdef' }));
        app.use((c, next) => { c.session.user = 'ada'; return next(); });
      } };`,
  };

  test('/__nev/data loader sees c.state and c.session set upstream', async () => {
    const { app } = await createNev({ root: makeApp(files), silent: true });
    const res = await dataReq(app, '/');
    assert.equal(res.status, 200);
    assert.deepEqual((await json(res)).data, { state: 'mw-state', sess: 'ada' });
  });

  test('middleware matcher is evaluated against the TARGET path for /__nev/data', async () => {
    const root = makeApp({
      'pages/protected/page.js': page,
      'pages/protected/page.server.js': `export const load = (c) => ({ state: c.state.marker ?? null });`,
      'pages/open.js': page,
      'pages/open.server.js': `export const load = (c) => ({ state: c.state.marker ?? null });`,
      'middleware.js': `export const matcher = ['/protected/*'];
        export default (c, next) => { c.state.marker = 'mw-state'; return next(); };`,
    });
    const { app } = await createNev({ root, silent: true });
    assert.deepEqual((await json(await dataReq(app, '/protected/page'))).data, { state: 'mw-state' });
    assert.deepEqual((await json(await dataReq(app, '/open'))).data, { state: null }, 'matcher does not cover /open');
  });

  test('post-action re-render loader sees middleware state (no fresh context)', async () => {
    const { app } = await createNev({ root: makeApp(files), silent: true });
    const res = await app.request('/', form({ x: '1' }));
    assert.equal(res.status, 200);
    const html = await res.text();
    const boot = JSON.parse(/id="__NEV_DATA__">([^<]*)</.exec(html)[1]);
    assert.equal(boot.page.data.state, 'mw-state');
    assert.equal(boot.page.data.sess, 'ada');
    assert.deepEqual(boot.page.actionData, { saved: 1 });
  });
});

// ---------------------------------------------------------------- fix 2
describe('audit fix 2: streaming SSR returns the real status', () => {
  const mk = (load) =>
    makeApp({
      'pages/index.js': page,
      'pages/index.server.js': `export const streaming = true; ${load}`,
    });

  test('streamed loader 404 → HTTP 404, 403 → HTTP 403, throw → HTTP 500', async () => {
    const nf = await createNev({ root: mk(`import { notFound } from '@adityadevid/nevjs'; export const load = () => notFound();`), silent: true });
    assert.equal((await nf.app.request('/')).status, 404);
    const fb = await createNev({ root: mk(`import { HttpError } from '@adityadevid/nevjs'; export const load = () => { throw new HttpError(403, 'Members only'); };`), silent: true });
    const fbRes = await fb.app.request('/');
    assert.equal(fbRes.status, 403);
    assert.match(await fbRes.text(), /Members only/);
    const boom = await createNev({ root: mk(`export const load = () => { throw new Error('kaboom secret'); };`), silent: true });
    const boomRes = await boom.app.request('/');
    assert.equal(boomRes.status, 500);
    assert.ok(!(await boomRes.text()).includes('kaboom secret'));
  });

  test('streamed loader success still streams with status 200', async () => {
    const nev = await createNev({ root: mk(`export const load = () => ({ ok: 1 });`), silent: true });
    const res = await nev.app.request('/');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /"ok":1/);
  });
});

// ---------------------------------------------------------------- fix 3
describe('audit fix 3: /__nev/app symlink bypass is closed', () => {
  test('symlinks to banned files are 404; symlinks to legit client files still serve', async () => {
    const root = makeApp({
      'pages/index.js': page,
      'pages/real.js': `export const real = 1;`,
      'secret.server.js': `export const KEY = 'TOP-SECRET';`,
      'nev.config.js': `export default {};`,
      'package.json': '{"name":"x","secret":"yes"}',
      'api/echo.js': `export const get = () => ({ ok: true });`,
      '.hidden/secret.js': `export const s = 1;`,
    });
    const link = (target, name) => fs.symlinkSync(path.join(root, target), path.join(root, 'pages', name));
    link('secret.server.js', 'evil-server.js');
    link('nev.config.js', 'evil-config.js');
    link('package.json', 'evil-pkg.js');
    link('api/echo.js', 'evil-api.js');
    link('.hidden/secret.js', 'evil-dot.js');
    link('pages/real.js', 'alias.js');

    const { app } = await createNev({ root, silent: true });
    const status = async (p) => (await app.request(p)).status;
    for (const p of ['evil-server.js', 'evil-config.js', 'evil-pkg.js', 'evil-api.js', 'evil-dot.js']) {
      assert.equal(await status('/__nev/app/pages/' + p), 404, `${p} must not be served through a symlink`);
    }
    assert.equal(await status('/__nev/app/pages/real.js'), 200);
    assert.equal(await status('/__nev/app/pages/alias.js'), 200, 'symlink to a legit client file is fine');
  });
});

// ---------------------------------------------------------------- fix 4
describe('audit fix 4: --out guard refuses filesystem root and project ancestors', () => {
  const files = { 'pages/index.js': page, 'package.json': '{"name":"x","dependencies":{}}' };

  test('assertSafeOut: root, project root and ancestors throw; a child is fine', () => {
    const root = makeApp(files);
    const fsRoot = path.parse(root).root;
    assert.throws(() => assertSafeOut(fsRoot, root), /cannot be the project folder/);
    assert.throws(() => assertSafeOut(root, root), /cannot be the project folder/);
    assert.throws(() => assertSafeOut(path.dirname(root), root), /cannot be the project folder/);
    assert.doesNotThrow(() => assertSafeOut(path.join(root, 'out'), root));
    assert.doesNotThrow(() => assertSafeOut(path.join(path.dirname(root), 'elsewhere'), root));
  });

  test('exportSite / buildVercel / buildNetlify all refuse out = filesystem root', async () => {
    const root = makeApp(files);
    const fsRoot = path.parse(root).root;
    await assert.rejects(exportSite({ root, out: fsRoot }), /cannot be the .* folder/);
    await assert.rejects(buildVercel({ root, out: fsRoot }), /cannot be the .* folder/);
    await assert.rejects(buildNetlify({ root, out: fsRoot }), /cannot be the .* folder/);
    await assert.rejects(exportSite({ root, out: path.dirname(root) }), /cannot be the .* folder/);
  });
});

// ---------------------------------------------------------------- fix 5
describe('audit fix 5: revalidate cache isolation', () => {
  test('cached data is structuredClone-isolated: rendering mutation cannot poison the cache', async () => {
    const root = makeApp({
      'pages/index.js': `import { h } from '@adityadevid/nevf';
        export default (p) => { const n = p.data.n; p.data.n = 999; return h('main', null, 'VAL=' + n); };`,
      'pages/index.server.js': `export const revalidate = 60; export const load = () => ({ n: 1 });`,
    });
    const { app } = await createNev({ root, silent: true });
    assert.match(await (await app.request('/')).text(), /VAL=1/);
    assert.match(await (await app.request('/')).text(), /VAL=1/, 'second serve must be a pristine clone');
    assert.match(await (await app.request('/')).text(), /VAL=1/);
  });

  test('accept-language is part of the cache key', async () => {
    const root = makeApp({
      'pages/index.js': `import { h } from '@adityadevid/nevf';
        export default (p) => h('main', null, 'n=' + p.data.n + ' lang=' + p.data.lang);`,
      'pages/index.server.js': `let n = 0; export const revalidate = 60;
        export const load = (c) => ({ n: ++n, lang: c.headers.get('accept-language') ?? '-' });`,
    });
    const { app } = await createNev({ root, silent: true });
    const get = (lang) => app.request('/', { headers: { 'accept-language': lang } }).then((r) => r.text());
    assert.match(await get('en'), /n=1 lang=en/);
    assert.match(await get('id'), /n=2 lang=id/, 'different language = different cache entry');
    assert.match(await get('en'), /n=1 lang=en/, 'same language = cached entry');
  });
});

// ---------------------------------------------------------------- fix 6
describe('audit fix 6: export crawl survives unsafe paths', () => {
  test('an unsafe crawled/extra path is skipped with a warning, the export completes', async () => {
    const root = makeApp({
      'pages/index.js': page,
      'pages/about.js': page,
      'pages/[...rest].js': page,
    });
    const out = path.join(TMP, `audit-export-${process.pid}`);
    const result = await exportSite({ root, out, paths: ['/x/%2e%2e/y', '/about'] });
    assert.ok(result.pages.includes('/'), JSON.stringify(result));
    assert.ok(result.pages.includes('/about'), 'export continues after the bad path');
    assert.ok(result.warnings.some((w) => /skipped/.test(w) && /Unsafe/.test(w)), JSON.stringify(result.warnings));
    assert.ok(fs.existsSync(path.join(out, 'about', 'index.html')));
  });
});

// ---------------------------------------------------------------- fix 7
describe('audit fix 7: /__nev/data requires the x-nev-data header', () => {
  const files = {
    'pages/index.js': page,
    'pages/index.server.js': `export const load = () => ({ ok: 1 });`,
  };

  test('no header → 403, wrong header → 403, header "1" → 200', async () => {
    const { app } = await createNev({ root: makeApp(files), silent: true });
    const noHeader = await app.request('/__nev/data?path=' + encodeURIComponent('/'));
    assert.equal(noHeader.status, 403);
    assert.equal((await json(noHeader)).error.status, 403);
    assert.equal((await dataReq(app, '/', { 'x-nev-data': 'yes' })).status, 403);
    const ok = await dataReq(app, '/');
    assert.equal(ok.status, 200);
    assert.deepEqual((await json(ok)).data, { ok: 1 });
  });

  test('the browser client sends the header', () => {
    const src = fs.readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
    assert.match(src, /'x-nev-data': '1'/);
  });
});

// ---------------------------------------------------------------- fix 8
describe('audit fix 8: route-group files contribute no URL segment', () => {
  test('fileToPattern for group-named files', () => {
    assert.equal(fileToPattern('(group).js'), '/');
    assert.equal(fileToPattern('blog/(seo).js'), '/blog');
    assert.equal(fileToPattern('(marketing)/about.js'), '/about');
    assert.equal(fileToPattern('blog/(seo)/post.js'), '/blog/post');
    assert.equal(fileToPattern('index.js'), '/');
    assert.equal(fileToPattern('blog/index.js'), '/blog');
  });
});

// ---------------------------------------------------------------- fix 9
describe('audit fix 9: copyFiltered lets public/.well-known through', () => {
  test('.well-known is copied, other dot-dirs and dotfiles are not', async () => {
    const root = makeApp({
      'pages/index.js': page,
      'public/.well-known/security.txt': 'security-policy',
      'public/.hidden/secret.txt': 'nope',
      'public/.dotfile.txt': 'nope',
      'public/normal.txt': 'hi',
    });
    const dest = path.join(TMP, `audit-copy-${process.pid}`);
    const count = copyFiltered(path.join(root, 'public'), dest, () => true);
    assert.equal(count, 2);
    assert.equal(fs.readFileSync(path.join(dest, '.well-known', 'security.txt'), 'utf8'), 'security-policy');
    assert.equal(fs.readFileSync(path.join(dest, 'normal.txt'), 'utf8'), 'hi');
    assert.ok(!fs.existsSync(path.join(dest, '.hidden')));
    assert.ok(!fs.existsSync(path.join(dest, '.dotfile.txt')));

    const out = path.join(TMP, `audit-export-wk-${process.pid}`);
    await exportSite({ root, out });
    assert.equal(fs.readFileSync(path.join(out, '.well-known', 'security.txt'), 'utf8'), 'security-policy');
  });
});

// --------------------------------------------------------------- fix 10
describe('audit fix 10: cli template escape + parseEnv escaped quotes', () => {
  test('create() rejects templates escaping the templates directory', () => {
    const dest = path.join(TMP, `audit-create-${process.pid}`);
    for (const t of ['../default', '../../etc', 'default/../../etc', '/etc/passwd']) {
      assert.throws(() => create(dest, t), /Invalid template/, t);
    }
    assert.throws(() => create(dest, 'nope'), /Unknown template/, 'in-tree unknown names keep the old error');
  });

  test('parseEnv handles \\" escapes inside double-quoted values', () => {
    const out = parseEnv('A="say \\"hi\\" ok"\nB=plain\nC="a\\nb"\nD="x\\""\nE=\'single\'');
    assert.equal(out.A, 'say "hi" ok');
    assert.equal(out.B, 'plain');
    assert.equal(out.C, 'a\nb');
    assert.equal(out.D, 'x"');
    assert.equal(out.E, 'single');
  });
});

// --------------------------------------------------------------- fix 11
describe('audit fix 11: opt-in CSRF (config csrf: true)', () => {
  const files = (cfg) => ({
    ...(cfg ? { 'nev.config.js': cfg } : {}),
    'pages/index.js': page,
    'pages/index.server.js': `export const load = () => ({});
      export const action = () => ({ saved: 1 });`,
    'api/x.js': `export const post = () => ({ ok: true }); export const get = () => ({ ok: true });`,
  });
  const evil = { origin: 'https://evil.example' };
  const same = { origin: 'http://localhost' };

  test('csrf: true blocks cross-site page actions and API mutations, allows same-site/missing origin', async () => {
    const { app } = await createNev({ root: makeApp(files(`export default { csrf: true };`)), silent: true });
    const postForm = (headers) => app.request('/', { ...form({ x: '1' }), headers: { ...form({}).headers, ...headers } });
    assert.equal((await postForm(evil)).status, 403, 'cross-site action blocked');
    assert.equal((await postForm(same)).status, 200, 'same-origin action allowed');
    assert.equal((await postForm({})).status, 200, 'no origin (non-browser client) allowed by default');

    const postApi = (headers) => app.request('/api/x', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
    assert.equal((await postApi(evil)).status, 403, 'cross-site API mutation blocked');
    assert.equal((await postApi(same)).status, 200);
    assert.equal((await app.request('/api/x')).status, 200, 'safe methods are never blocked');
  });

  test('csrf is off by default: the same cross-site POSTs succeed without the config', async () => {
    const { app } = await createNev({ root: makeApp(files(null)), silent: true });
    const res = await app.request('/', { ...form({ x: '1' }), headers: { ...form({}).headers, ...evil } });
    assert.equal(res.status, 200);
    const api = await app.request('/api/x', { method: 'POST', headers: { 'content-type': 'application/json', ...evil }, body: '{}' });
    assert.equal(api.status, 200);
  });
});

describe('feature: nev check', () => {
  test('healthy project passes; server file in public/ is an error; orphan loader + missing site warn', async () => {
    const { checkProject } = await import('../src/cli.js');
    const good = makeApp({
      'package.json': '{"name":"x"}',
      'nev.config.js': `export default { site: 'https://example.com' }`,
      'pages/index.js': page,
      '.gitignore': 'node_modules\n.env\n',
      '.env': 'SECRET=1',
    });
    const ok = await checkProject(good);
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.pages, 1);

    const bad = makeApp({
      'package.json': '{"name":"x"}',
      'pages/index.js': page,
      'pages/orphan.server.js': 'export const load = () => ({})',
      'public/secret.server.js': 'export const KEY = 1',
    });
    const r = await checkProject(bad);
    assert.ok(r.errors.some((e) => e.includes('public/secret.server.js')), r.errors.join('; '));
    assert.ok(r.warnings.some((w) => w.includes('orphan.server.js')), r.warnings.join('; '));
    assert.ok(r.warnings.some((w) => w.includes('`site` is not set')), r.warnings.join('; '));
  });
});
