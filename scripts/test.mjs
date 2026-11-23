// Runs the test files of every package (or only the named ones): node scripts/test.mjs [nevg nevb ...]
// `node --test "glob"` only expands globs on Node >= 21, so we list the files ourselves (works on Node 20+).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgsDir = path.join(root, 'packages');
const only = process.argv.slice(2);
const names = fs.readdirSync(pkgsDir).filter((n) => !only.length || only.includes(n));
const files = [];
for (const n of names) {
  const dir = path.join(pkgsDir, n, 'test');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).sort()) if (f.endsWith('.test.js')) files.push(path.join(dir, f));
}
if (!files.length) {
  console.error('No test files found' + (only.length ? ` for: ${only.join(', ')}` : ''));
  process.exit(1);
}
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: root });
process.exit(r.status ?? 1);
