// .env loading — same precedence idea as Next.js, zero dependencies.
//
//   .env                  all modes
//   .env.local            everything except `test`   (git-ignored, your secrets)
//   .env.<mode>           mode = development | production | test
//   .env.<mode>.local     highest priority file
//   real process.env      always wins over files
//
// Only variables starting with `NEV_PUBLIC_` are ever sent to the browser.

import fs from 'node:fs';
import path from 'node:path';

export const PUBLIC_PREFIX = 'NEV_PUBLIC_';

/** Parse the text of a .env file → { KEY: 'value' }. Supports comments, `export`, quotes, \n in "double quotes", ${VAR} expansion. */
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
      // quoted value, may span several lines
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

/** Which files are read, lowest priority first. */
export function envFiles(mode) {
  const files = ['.env'];
  if (mode !== 'test') files.push('.env.local');
  files.push(`.env.${mode}`, `.env.${mode}.local`);
  return files;
}

/**
 * Read the .env files of `root` and return the merged values (files only — process.env is NOT modified).
 */
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

/**
 * Load .env files into process.env (existing variables are never overwritten).
 * Returns { loaded: { KEY: value }, public: { NEV_PUBLIC_*: value } }.
 */
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

/** Only the NEV_PUBLIC_* entries (safe for the browser). */
export function publicEnvOf(source) {
  const out = {};
  for (const [k, v] of Object.entries(source)) if (k.startsWith(PUBLIC_PREFIX) && v !== undefined) out[k] = String(v);
  return out;
}
