import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { buildVercel } from '../src/index.js';
import { makeApp, cleanup } from './helpers.js';

after(cleanup);

test('nev build --target vercel: output is self-contained and serves pages + APIs from a different folder', async () => {
  const root = makeApp({
    'package.json': JSON.stringify({ name: 'x', type: 'module', dependencies: { '@adityadevid/nevjs': '*', '@adityadevid/nevf': '*' } }),
    'pages/index.js': `import { h, publicEnv } from '@adityadevid/nevf'; export default () => h('main', null, 'hello vercel ', publicEnv('NEV_PUBLIC_V', 'unset'));`,
    'api/ping.js': 'export const get = () => ({ pong: true, secret: process.env.NEVT_VERCEL_SECRET ?? null })',
    'public/robots.txt': 'User-agent: *',
    '.env': 'NEVT_VERCEL_SECRET=must-not-ship',
  });
  const r = await buildVercel({ root });
  assert.deepEqual(r.warnings, []);
  assert.ok(r.packages.includes('@adityadevid/nevb') && r.packages.includes('@adityadevid/nevjs'));
  const out = path.join(root, '.vercel', 'output');
  const cfg = JSON.parse(fs.readFileSync(path.join(out, 'config.json'), 'utf8'));
  assert.equal(cfg.version, 3);
  assert.deepEqual(cfg.routes[0], { handle: 'filesystem' });
  assert.ok(fs.existsSync(path.join(out, 'static', 'robots.txt')));
  assert.ok(fs.existsSync(path.join(out, 'static', '__nev', 'client.js')));
  assert.ok(fs.existsSync(path.join(out, 'static', '__nev', 'pkg', '@adityadevid', 'nevf', 'index.js')));
  const vc = JSON.parse(fs.readFileSync(path.join(out, 'functions', 'index.func', '.vc-config.json'), 'utf8'));
  assert.equal(vc.handler, 'index.mjs');
  assert.ok(!fs.existsSync(path.join(out, 'functions', 'index.func', 'app', '.env')), '.env must not be copied');
  assert.ok(!fs.existsSync(path.join(out, 'functions', 'index.func', 'app', '.vercel')), 'no recursive copy of the output');

  // run the function from a folder OUTSIDE the repo (no access to the repo's node_modules)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nev-vercel-'));
  try {
    fs.cpSync(path.join(out, 'functions', 'index.func'), path.join(tmp, 'fn'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'run.mjs'), `import http from 'node:http';
      const handler = (await import('./fn/index.mjs')).default;
      const s = http.createServer(handler).listen(0, () => console.log('PORT=' + s.address().port));`);
    const child = spawn(process.execPath, [path.join(tmp, 'run.mjs')], { cwd: tmp, env: { ...process.env, NEV_PUBLIC_V: 'from-platform' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    const port = await new Promise((resolve, reject) => {
      let buf = '';
      child.stdout.on('data', (d) => {
        buf += d;
        const m = /PORT=(\d+)/.exec(buf);
        if (m) resolve(Number(m[1]));
      });
      child.on('exit', (code) => reject(new Error(`function exited ${code}: ${stderr}`)));
    });
    try {
      const home = await (await fetch(`http://localhost:${port}/`)).text();
      assert.match(home, /hello vercel/);
      assert.match(home, /from-platform/);
      const api = await (await fetch(`http://localhost:${port}/api/ping`)).json();
      assert.deepEqual(api, { pong: true, secret: null });
      assert.equal((await fetch(`http://localhost:${port}/nope`)).status, 404);
    } finally {
      child.kill();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('build: warns about missing dependencies and rejects a missing package.json', async () => {
  const noPkg = makeApp({ 'pages/index.js': 'export default () => null' });
  await assert.rejects(buildVercel({ root: noPkg }), /package\.json not found/);
  const root = makeApp({ 'package.json': '{"dependencies":{"does-not-exist-xyz":"1"}}', 'pages/index.js': 'export default () => null' });
  const r = await buildVercel({ root });
  assert.ok(r.warnings.some((w) => w.includes('does-not-exist-xyz')));
});

test('CLI: unknown --target is rejected', () => {
  const root = makeApp({ 'pages/index.js': 'export default () => null' });
  const bin = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'bin', 'nev.js');
  const r = spawnSync(process.execPath, [bin, 'build', root, '--target', 'heroku'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Unknown --target/);
});
