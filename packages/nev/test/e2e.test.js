// End-to-end tests: a real server, a real Chromium (Playwright) and the real `nev dev` CLI.
// The browser tests are skipped automatically when Playwright is not installed.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/index.js';
import { makeApp, makeTemplateApp, cleanup } from './helpers.js';

after(cleanup);

const here = path.dirname(fileURLToPath(import.meta.url));
const binFile = path.join(here, '..', 'bin', 'nev.js');

let playwright = null;
try {
  playwright = createRequire(import.meta.url)('playwright');
} catch {
  /* not installed */
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 10_000, interval = 100 } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      last = err;
    }
    await sleep(interval);
  }
  throw new Error('waitFor timed out' + (last ? `: ${last.message}` : ''));
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

describe('browser (Chromium)', { skip: playwright ? false : 'playwright is not installed' }, () => {
  test('template app: SSR, hydration, client navigation, loaders, API form, game', { timeout: 90_000 }, async () => {
    const root = await makeTemplateApp();
    const nev = await startServer({ root, port: 0, host: '127.0.0.1', silent: true });
    const base = `http://127.0.0.1:${nev.port}`;
    const browser = await playwright.chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      const problems = [];
      page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
      page.on('console', (m) => {
        // 404/422 responses are provoked on purpose below; Chromium logs every failed request.
        if (m.type() === 'error' && !/status of (404|422)/.test(m.text())) problems.push('console: ' + m.text());
      });
      const ready = () => page.waitForFunction(() => window.__NEV_READY__ === true, null, { timeout: 10_000 });

      // SSR content exists before any script runs
      const raw = await (await fetch(base + '/')).text();
      assert.match(raw, /<h1>Welcome to Nev\.js<\/h1>/);

      await page.goto(base + '/');
      await ready();
      await page.evaluate(() => (window.__marker = 'same-document'));

      // reactive counter
      await page.click('#inc');
      await page.click('#inc');
      assert.equal(await page.textContent('#count'), '2');

      // client-side navigation + loader
      await page.click('a.nav[href="/blog"]');
      await page.waitForSelector('article.card');
      assert.ok(page.url().endsWith('/blog'));
      assert.equal(await page.evaluate(() => window.__marker), 'same-document', 'no full page reload');
      assert.equal(await page.title(), 'Blog · My Nev App');
      assert.equal(await page.textContent('a.nav.active'), 'Blog');
      assert.equal(await page.locator('article.card').count(), 3);

      await page.click('article.card a >> nth=1');
      await page.waitForSelector('h1:has-text("File-based routing")');
      assert.equal(await page.title(), 'File-based routing · My Nev App');

      await page.goBack();
      await page.waitForSelector('h1:has-text("Blog")');
      assert.ok(page.url().endsWith('/blog'));
      await page.goForward();
      await page.waitForSelector('h1:has-text("File-based routing")');

      // 404 handled in the client
      await page.evaluate(async () => (await import('nevf')).navigate('/blog/nope'));
      await page.waitForSelector('h1:has-text("404")');
      await page.evaluate(async () => (await import('nevf')).navigate('/no/such/page'));
      await page.waitForSelector('h1:has-text("404")');
      assert.equal(await page.evaluate(() => window.__marker), 'same-document');

      // API form: validation errors, then a real post that appears in the list
      await page.click('a.nav[href="/guestbook"]');
      await page.waitForSelector('.entry');
      await page.click('#send');
      await page.waitForSelector('.error');
      await page.fill('#name', 'Tester');
      await page.fill('#message', 'hello from chromium');
      await page.click('#send');
      await page.waitForSelector('.entry:has-text("hello from chromium")');
      assert.equal(await page.inputValue('#message'), '');
      assert.equal(await page.locator('.error').count(), 0);

      // NevG running inside a Nev page
      await page.click('a.nav[href="/game"]');
      await page.waitForFunction(() => window.__game && window.__game.frame > 5, null, { timeout: 10_000 });
      const painted = await page.evaluate(() => {
        const c = document.getElementById('game');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++;
        return n;
      });
      assert.ok(painted > 50, 'canvas has content');
      const x0 = await page.evaluate(() => window.__game.scene.player.x);
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(400);
      await page.keyboard.up('ArrowRight');
      assert.ok((await page.evaluate(() => window.__game.scene.player.x)) > x0 + 10, 'keyboard moves the player');
      await page.click('a.nav[href="/about"]');
      await page.waitForSelector('h1:has-text("About")');
      assert.equal(await page.evaluate(() => window.__game), undefined, 'game is destroyed when leaving the page');

      // a hard load of a dynamic URL
      await page.goto(base + '/blog/signals');
      await ready();
      assert.equal(await page.textContent('h1'), 'Signals in 5 minutes');

      assert.deepEqual(problems, []);
    } finally {
      await browser.close();
      nev.server.closeAllConnections?.();
      await new Promise((r) => nev.server.close(r));
    }
  });

  test('a loader redirect is followed by client-side navigation', { timeout: 60_000 }, async () => {
    const root = makeApp({
      'pages/index.js': `import { h, Link } from 'nevf'; export default () => h(Link, { href: '/old', id: 'old' }, 'old')`,
      'pages/old.js': `import { h } from 'nevf'; export default () => h('p', null, 'never shown')`,
      'pages/old.server.js': `import { redirect } from 'nevjs'; export const load = () => redirect('/new')`,
      'pages/new.js': `import { h } from 'nevf'; export default () => h('h1', null, 'new page')`,
    });
    const nev = await startServer({ root, port: 0, host: '127.0.0.1', silent: true });
    const browser = await playwright.chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${nev.port}/`);
      await page.waitForFunction(() => window.__NEV_READY__ === true);
      await page.evaluate(() => (window.__marker = 1));
      await page.click('#old');
      await page.waitForSelector('h1:has-text("new page")');
      assert.ok(page.url().endsWith('/new'));
      assert.equal(await page.evaluate(() => window.__marker), 1, 'redirect did not reload the page');
    } finally {
      await browser.close();
      nev.server.closeAllConnections?.();
      await new Promise((r) => nev.server.close(r));
    }
  });
});

describe('nev dev (auto-restart + live reload)', () => {
  test('editing a file restarts the server and drops the live-reload stream', { timeout: 60_000 }, async () => {
    const root = makeApp({
      'pages/index.js': `import { h } from 'nevf'; export default () => h('h1', null, 'version one')`,
    });
    const port = await freePort();
    const child = spawn(process.execPath, [binFile, 'dev', root, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const base = `http://127.0.0.1:${port}`;
    try {
      const text = () => fetch(base + '/').then((r) => r.text());
      await waitFor(async () => /version one/.test(await text()), { timeout: 15_000 });

      // open the live-reload stream; it must end when the server restarts
      const ac = new AbortController();
      const stream = await fetch(base + '/__nev/reload', { signal: ac.signal });
      const reader = stream.body.getReader();
      const first = new TextDecoder().decode((await reader.read()).value);
      assert.match(first, /event: hello/);
      const ended = reader.read().then(
        (r) => (r.done ? 'closed' : 'data'),
        () => 'closed',
      );

      fs.writeFileSync(path.join(root, 'pages', 'index.js'), `import { h } from 'nevf'; export default () => h('h1', null, 'version two')`);
      await waitFor(async () => /version two/.test(await text()), { timeout: 20_000 });
      const state = await Promise.race([ended, sleep(5000).then(() => 'still open')]);
      assert.equal(state === 'data' ? 'closed' : state, 'closed', 'the SSE connection must drop so the browser can reload');
      ac.abort();
      assert.match(output, /restarting/);
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => child.once('exit', r));
    }
  });

  test('a syntax error does not kill the supervisor; fixing the file recovers', { timeout: 60_000 }, async () => {
    const good = (n) => `import { h } from 'nevf'; export default () => h('h1', null, '${n}')`;
    const root = makeApp({ 'pages/index.js': good('ok one') });
    const port = await freePort();
    const child = spawn(process.execPath, [binFile, 'dev', root, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    const base = `http://127.0.0.1:${port}`;
    const text = () => fetch(base + '/').then((r) => r.text());
    try {
      await waitFor(async () => /ok one/.test(await text()), { timeout: 15_000 });
      fs.writeFileSync(path.join(root, 'pages', 'index.js'), 'export default () => {{{ broken');
      // The page module is only imported on request, so the server keeps running and reports the error.
      await sleep(1500);
      const broken = await fetch(base + '/');
      assert.equal(broken.status, 500);
      fs.writeFileSync(path.join(root, 'pages', 'index.js'), good('ok two'));
      await waitFor(async () => /ok two/.test(await text()), { timeout: 20_000 });
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => child.once('exit', r));
    }
  });
});
