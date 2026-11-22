// Merge a batch of translations into the locale JSON files.
// New keys are appended; entries whose Chinese value still equals the English
// key (untranslated placeholders) are filled in.
//
// Usage: node i18n/scripts/merge-translations.mjs <translations.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const localesDir = path.join(repoRoot, 'i18n/locales');

const enPath = path.join(localesDir, 'en.json');
const zhPath = path.join(localesDir, 'zh-CN.json');

const en = JSON.parse(readFileSync(enPath, 'utf8'));
const zh = JSON.parse(readFileSync(zhPath, 'utf8'));

const additionsPath = process.argv[2];
if (!additionsPath) {
  console.error('Usage: node merge-translations.mjs <translations.json>');
  process.exit(1);
}
const additions = JSON.parse(readFileSync(additionsPath, 'utf8'));

let addedEn = 0;
let addedZh = 0;
let filledZh = 0;
for (const [key, value] of Object.entries(additions)) {
  if (!(key in en)) {
    en[key] = key;
    addedEn++;
  }
  if (!(key in zh)) {
    zh[key] = value;
    addedZh++;
  } else if (zh[key] === key && value !== key) {
    zh[key] = value;
    filledZh++;
  }
}

// Keep both files in the same key order so diffs stay readable.
const sortedEn = {};
const sortedZh = {};
for (const k of Object.keys(en)) {
  sortedEn[k] = en[k];
  sortedZh[k] = k in zh ? zh[k] : '';
}

writeFileSync(enPath, `${JSON.stringify(sortedEn, null, 2)}\n`, 'utf8');
writeFileSync(zhPath, `${JSON.stringify(sortedZh, null, 2)}\n`, 'utf8');

console.log(`en.json: ${Object.keys(sortedEn).length} keys (+${addedEn})`);
console.log(`zh-CN.json: ${Object.keys(sortedZh).length} keys (+${addedZh}, ${filledZh} filled)`);

const emptyZh = Object.entries(sortedZh).filter(([, v]) => v === '').map(([k]) => k);
if (emptyZh.length) {
  console.log(`\nWARNING: ${emptyZh.length} key(s) with an empty zh value:`);
  emptyZh.forEach((k) => console.log(`  ${k}`));
}
