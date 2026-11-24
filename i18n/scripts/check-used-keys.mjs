// SPDX-License-Identifier: AGPL-3.0-or-later
// Every t('...') key the code asks for must exist in zh-CN.json, otherwise
// vue-i18n falls back to the English key and the Chinese UI shows English.
// This catches that case in CI instead of in a screenshot.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// This script lives in two places: i18n/scripts/ (canonical source, repo root
// is two levels up) and frontend/scripts/ (working copy, root is one level up).
function resolveRoot() {
  const candidates = [
    path.resolve(here, '../../internal/http/frontend'),
    path.resolve(here, '..'),
  ];
  for (const c of candidates) {
    try {
      statSync(path.join(c, 'src'));
      return c;
    } catch {
      // try the next one
    }
  }
  return candidates[0];
}
const root = resolveRoot();
const locales = path.join(root, 'src/i18n/locales');

const files = [];
function collect(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;
      collect(full);
    } else if (/\.(ts|vue)$/.test(entry)) {
      files.push(full);
    }
  }
}
collect(path.join(root, 'src'));

// $t('x'), x.t('x') and a bare t('x'). The look-behind keeps format(, emit(
// and other names that merely end in "t" from matching.
const CALL = /(?:\$t|\.t|(?<![\w$])t)\(\s*(['"])((?:\\.|(?!\1)[^\\\r\n])*)\1/g;

const used = new Map();
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  let m;
  while ((m = CALL.exec(src)) !== null) {
    const key = m[2];
    if (!key) continue;
    const line = src.slice(0, m.index).split('\n').length;
    if (!used.has(key)) used.set(key, []);
    used.get(key).push(`${rel}:${line}`);
  }
}

// Lookup tables hold the key and translate it where the value is shown, for
// example `const labels = { 'log-level': 'Log Level' }` and `t(labels[path])`.
// The keys of those tables are used too, so they are counted here.
const TABLE = /\b(?:labels|sources|deployments|servers|SMS_FORMATS|DATA_SUBS|CSBK_NAMES|UNKNOWN_NAMES|UNDELIVERABLE_WORDS|UNDELIVERABLE_TARGETS|FORMAT_LABEL_KEYS|SAP_NAME_KEYS|SAP_NAMES)\b/;
const TABLE_ENTRY = /^\s*(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))\s*:\s*'((?:[^'\\]|\\.)*)'/gm;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  if (!TABLE.test(src)) continue;
  const rel = path.relative(root, file);
  // Only the body of a table declaration counts.
  const decl = /\b(?:labels|sources|deployments|servers|SMS_FORMATS|DATA_SUBS|CSBK_NAMES|UNKNOWN_NAMES|UNDELIVERABLE_WORDS|UNDELIVERABLE_TARGETS|FORMAT_LABEL_KEYS|SAP_NAME_KEYS|SAP_NAMES)\s*(?::[^=]+)?=\s*\{/g;
  let d;
  while ((d = decl.exec(src)) !== null) {
    let depth = 0;
    for (let j = d.index + d[0].length - 1; j < src.length; j += 1) {
      if (src[j] === '{') depth += 1;
      else if (src[j] === '}') {
        depth -= 1;
        if (depth === 0) {
          const body = src.slice(d.index + d[0].length, j);
          let e;
          TABLE_ENTRY.lastIndex = 0;
          while ((e = TABLE_ENTRY.exec(body)) !== null) {
            const key = e[1] !== undefined ? e[1] : e[2];
            const value = e[3];
            if (!key || !value) continue;
            const line = src.slice(0, d.index + d[0].length + e.index).split('\n').length;
            if (!used.has(value)) used.set(value, []);
            used.get(value).push(`${rel}:${line}`);
          }
          break;
        }
      }
    }
  }
}

const zh = JSON.parse(readFileSync(path.join(locales, 'zh-CN.json'), 'utf8'));
const isProse = (key) => {
  if (/^[/#]/.test(key)) return false;            // paths
  if (/^[a-z][a-z0-9:_-]*$/.test(key)) return false; // single lower-case token
  if (/^[A-Z0-9_]{2,}$/.test(key)) return false;  // ALLCAPS identifiers
  if (/^\d/.test(key) && !/[A-Za-z]{3,}/.test(key)) return false;
  return true;
};

const missing = [];
for (const [key, where] of used) {
  if (!isProse(key)) continue;
  if (!(key in zh)) missing.push({ key, where: where[0] });
}
// The same check the other way round: a key in en.json without a zh-CN entry
// is just as invisible.
const en = JSON.parse(readFileSync(path.join(locales, 'en.json'), 'utf8'));
const untranslated = Object.entries(en).filter(
  ([key, value]) => !(key in zh) && isProse(key) && value === key,
);

if (missing.length) {
  console.error(`The code asks for ${missing.length} key(s) that zh-CN.json does not have:`);
  for (const m of missing.slice(0, 80)) console.error(`  ${m.key}  (${m.where})`);
  if (missing.length > 80) console.error(`  ... and ${missing.length - 80} more`);
  process.exitCode = 1;
}
if (untranslated.length) {
  console.error(`en.json has ${untranslated.length} untranslated key(s) with no zh-CN entry:`);
  for (const [key] of untranslated.slice(0, 40)) console.error(`  ${key}`);
  process.exitCode = 1;
}
if (!process.exitCode) {
  console.log(`used-key check OK: ${used.size} keys referenced, all present in zh-CN.json.`);
}
