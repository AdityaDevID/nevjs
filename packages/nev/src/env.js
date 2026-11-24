import fs from 'node:fs';
import path from 'node:path';

export const PUBLIC_PREFIX = 'NEV_PUBLIC_';

export function parseEnv(text, base = {}) {
  const out = {};
  const lookup = (k) => (k in out ? out[k] : base[k] ?? '');
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1];
    let raw = m[2];
    let value;
    const quote = raw[0];
    if (quote === '"' || quote === "'" || quote === '`') {
      let rest = raw.slice(1);
      let end = rest.indexOf(quote);
      while (end === -1 && i + 1 < lines.length) {
        rest += '\n' + lines[++i];
        end = rest.indexOf(quote);
      }
      value = end === -1 ? rest : rest.slice(0, end);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"');
      if (quote !== "'") value = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => lookup(k));
    } else {
      const hash = raw.search(/\s#/);
      if (hash !== -1) raw = raw.slice(0, hash);
      value = raw.trim().replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => lookup(k));
    }
    out[key] = value;
  }
  return out;
}

export function envFiles(mode) {
  const files = ['.env'];
  if (mode !== 'test') files.push('.env.local');
  files.push(`.env.${mode}`, `.env.${mode}.local`);
  return files;
}

export function readEnvFiles(root, mode = 'production') {
  const merged = {};
  for (const name of envFiles(mode)) {
    const file = path.join(root, name);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    Object.assign(merged, parseEnv(text, { ...merged, ...process.env }));
  }
  return merged;
}

export function loadEnv(root, { dev = false, mode } = {}) {
  const m = mode ?? process.env.NODE_ENV ?? (dev ? 'development' : 'production');
  const values = readEnvFiles(root, m);
  const loaded = {};
  for (const [k, v] of Object.entries(values)) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
      loaded[k] = v;
    }
  }
  return { mode: m, loaded, public: publicEnvOf(process.env) };
}

export function publicEnvOf(source) {
  const out = {};
  for (const [k, v] of Object.entries(source)) if (k.startsWith(PUBLIC_PREFIX) && v !== undefined) out[k] = String(v);
  return out;
}
