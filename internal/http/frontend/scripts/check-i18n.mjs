// SPDX-License-Identifier: AGPL-3.0-or-later
// Compare the key sets of the locale files. Exits non-zero when zh-CN is
// missing keys that exist in en, so CI can catch untranslated additions.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const locales = path.resolve(here, '../src/i18n/locales');

const read = (file) => JSON.parse(readFileSync(path.join(locales, file), 'utf8'));
const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' && !Array.isArray(value) ? flatten(value, full) : [full];
  });

const en = new Set(flatten(read('en.json')));
const zh = new Set(flatten(read('zh-CN.json')));

const missing = [...en].filter((key) => !zh.has(key));
const extra = [...zh].filter((key) => !en.has(key));

if (missing.length) {
  console.error(`zh-CN missing ${missing.length} key(s):`);
  missing.forEach((key) => console.error(`  - ${key}`));
}
if (extra.length) {
  console.warn(`zh-CN has ${extra.length} key(s) not in en:`);
  extra.forEach((key) => console.warn(`  - ${key}`));
}

if (!missing.length && !extra.length) {
  console.log(`i18n OK: ${en.size} keys in both locales.`);
}
process.exitCode = missing.length ? 1 : 0;
