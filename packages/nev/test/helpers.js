import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const TMP = path.join(here, '.tmp');

let counter = 0;
const created = [];

export function makeApp(files, name = 'app') {
  const root = path.join(TMP, `${name}-${process.pid}-${++counter}`);
  fs.mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  created.push(root);
  return root;
}

export async function makeTemplateApp() {
  const { create } = await import('../src/cli.js');
  const root = path.join(TMP, `template-${process.pid}-${++counter}`);
  const log = console.log;
  console.log = () => {};
  try {
    create(root);
  } finally {
    console.log = log;
  }
  created.push(root);
  return root;
}

export function cleanup() {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  try {
    fs.rmdirSync(TMP);
  } catch {
  }
}
