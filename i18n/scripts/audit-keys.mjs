// Audit the i18n key coverage: find every key referenced in the source and
// report which ones are missing from the locale files, plus any entries that
// are still untranslated (value equals the key).
//
// Usage: node i18n/scripts/audit-keys.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const frontend = path.join(repoRoot, 'internal/http/frontend');

function walk(dir, out) {
  if (!statSync(dir).isDirectory()) return;
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === '__tests__' || f === 'node_modules' || f === 'reports' || f === 'dist') continue;
      walk(p, out);
    } else if (/\.(ts|vue)$/.test(f)) out.push(p);
  }
}

const files = [];
walk(path.join(frontend, 'src'), files);

const keys = new Map();
const re = /(?<![A-Za-z0-9_$.])(?:\$?t|i18n\.global\.t)\(\s*(['"`])((?:\\.|(?!\1)[^\\\r\n])*)\1/g;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  let m;
  while ((m = re.exec(src)) !== null) {
    const key = m[2];
    if (!keys.has(key)) keys.set(key, path.relative(repoRoot, file));
  }
}

const enPath = path.join(repoRoot, 'i18n/locales/en.json');
const zhPath = path.join(repoRoot, 'i18n/locales/zh-CN.json');
const en = JSON.parse(readFileSync(enPath, 'utf8'));
const zh = JSON.parse(readFileSync(zhPath, 'utf8'));

const missEn = [...keys.keys()].filter((k) => !(k in en)).sort();
const missZh = [...keys.keys()].filter((k) => !(k in zh)).sort();
const untranslated = Object.entries(zh).filter(([k, v]) => k === v || !v);

console.log(`Referenced keys: ${keys.size}`);
console.log(`en.json: ${Object.keys(en).length} | zh-CN.json: ${Object.keys(zh).length}`);

if (missEn.length) {
  console.log(`\nMissing from en.json (${missEn.length}):`);
  missEn.forEach((k) => console.log(`  ${JSON.stringify(k)}   <- ${keys.get(k)}`));
}
if (missZh.length) {
  console.log(`\nMissing from zh-CN.json (${missZh.length}):`);
  missZh.forEach((k) => console.log(`  ${JSON.stringify(k)}`));
}
if (untranslated.length) {
  console.log(`\nUntranslated (${untranslated.length}):`);
  untranslated.forEach(([k]) => console.log(`  ${JSON.stringify(k)}`));
}

if (!missEn.length && !missZh.length) {
  console.log('\nAll referenced keys are present in both locale files.');
}
