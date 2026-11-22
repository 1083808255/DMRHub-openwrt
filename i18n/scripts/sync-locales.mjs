// Copy canonical locale JSONs from the top-level i18n/locales into the
// frontend src/i18n/locales so Vite can bundle them. Run from repo root.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const srcLocales = path.resolve(repoRoot, 'i18n/locales');
const dstLocales = path.resolve(repoRoot, 'internal/http/frontend/src/i18n/locales');

mkdirSync(dstLocales, { recursive: true });
for (const file of ['en.json', 'zh-CN.json']) {
  copyFileSync(path.join(srcLocales, file), path.join(dstLocales, file));
  console.log(`synced ${file} -> frontend`);
}
