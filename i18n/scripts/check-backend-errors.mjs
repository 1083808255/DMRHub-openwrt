// Audit the error messages of the backend against the locale files.
//
// The frontend turns an error of the API into text with t(data.error), so
// the message of the backend is the key of the translation. A key that no
// locale has stays in English. The keys that the frontend references in its
// own source are covered by check-used-keys.mjs; this script finds the ones
// that only exist at runtime, in the answers of the API.
//
// Usage: node i18n/scripts/check-backend-errors.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

// The websocket and the helpers keep their errors for the log, and the
// server keeps them for the start. They never answer the API with them.
const SKIP_ERR_DIRS = ['/http/websocket/', '/http/api/utils/'];
const SKIP_ERR_FILES = ['/http/server.go'];

// The codes of the OAuth 2.0 and of RFC 6750. They are part of the protocol
// and a client of the API reads them, so they keep their English spelling.
const PROTOCOL_CODES = new Set([
  'access_denied',
  'insufficient_scope',
  'invalid_token',
  'temporarily_unavailable',
  'unsupported_grant_type',
  'unsupported_response_type',
]);

function walk(dir, out) {
  if (!statSync(dir).isDirectory()) return;
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === 'vendor' || f === 'testdata' || f === 'node_modules' || f === 'dist') continue;
      walk(p, out);
    } else if (f.endsWith('.go') && !f.endsWith('_test.go')) out.push(p);
  }
}

const goFiles = [];
walk(path.join(repoRoot, 'internal'), goFiles);

// A constant of the backend that holds a message, for example
//   msgBadJSON = "JSON data is invalid"
const constRe = /^\s*(?:msg|Msg|err|Err)[A-Za-z0-9_]*\s*=\s*"((?:\\.|[^"\\])*)"/gm;
// A message that the API answers with, for example
//   c.JSON(http.StatusBadRequest, gin.H{errorKey: "RadioID is invalid"})
const literalRe = /\b(?:errorKey|msgKey|"error"|"message")\s*:\s*"((?:\\.|[^"\\])*)"/g;
// A message that the API answers with, named by a constant
const namedRe = /\b(?:errorKey|msgKey)\s*:\s*([A-Za-z][A-Za-z0-9_]*)/g;
// A message that the API makes and gives to the user as it is
const errRe = /(?:errors\.New|fmt\.Errorf)\("((?:\\.|[^"\\])*)"\)/g;
// A message that puts a value into the text, for example
//   c.JSON(http.StatusBadRequest, gin.H{errorKey: "Invalid " + what + " ID"})
const dynamicRe = /\b(?:errorKey|msgKey)\s*:\s*"((?:\\.|[^"\\])*)"\s*\+/g;

const found = new Map();
const add = (text, file) => {
  if (!text || text.length < 2) return;
  // Not a message for the user: a path, a query, a format or a key
  if (/^[a-z0-9_./:@-]+$/.test(text)) return;
  if (/^[A-Z_]+$/.test(text)) return;
  if (!/[A-Za-z]/.test(text)) return;
  if (PROTOCOL_CODES.has(text)) return;
  if (!found.has(text)) found.set(text, new Set());
  found.get(text).add(path.relative(repoRoot, file));
};

// The constants of the whole backend, so that a name can be resolved.
const constValues = new Map();
for (const file of goFiles) {
  const src = readFileSync(file, 'utf8');
  let m;
  constRe.lastIndex = 0;
  while ((m = constRe.exec(src)) !== null) {
    constValues.set(m[1], m[1]);
    constValues.set(m[0].trim().split(/\s*=\s*/)[0], m[1]);
  }
}

for (const file of goFiles) {
  const rel = path.relative(repoRoot, file).split(path.sep).join('/');
  const src = readFileSync(file, 'utf8');

  let m;
  literalRe.lastIndex = 0;
  while ((m = literalRe.exec(src)) !== null) add(m[1], file);

  namedRe.lastIndex = 0;
  while ((m = namedRe.exec(src)) !== null) {
    const value = constValues.get(m[1]);
    if (value) add(value, file);
  }

  dynamicRe.lastIndex = 0;
  while ((m = dynamicRe.exec(src)) !== null) {
    // The text of the message grows with a value, so the whole of it is not
    // a key. The frontend finds the part before the value with prefixKey().
    add(m[1], file);
  }

  if (!rel.startsWith('internal/http/')) continue;
  if (SKIP_ERR_DIRS.some((d) => rel.includes(d))) continue;
  if (SKIP_ERR_FILES.some((f) => rel.endsWith(f))) continue;

  // The messages of the errors that the API gives to the user
  errRe.lastIndex = 0;
  while ((m = errRe.exec(src)) !== null) {
    // A message that wraps another one stays as it is; the frontend shows
    // the whole text, so the key of the wrapper has to match it.
    if (/%[wvd]/.test(m[1])) continue;
    add(m[1], file);
  }
}

const en = JSON.parse(readFileSync(path.join(repoRoot, 'i18n/locales/en.json'), 'utf8'));
const zh = JSON.parse(readFileSync(path.join(repoRoot, 'i18n/locales/zh-CN.json'), 'utf8'));

const missEn = [];
const missZh = [];
const untranslated = [];

for (const [text, files] of [...found].sort((a, b) => a[0].localeCompare(b[0]))) {
  const where = [...files].join(', ');
  if (!(text in en)) missEn.push([text, where]);
  if (!(text in zh)) missZh.push([text, where]);
  else if (!zh[text] || zh[text] === text) untranslated.push([text, where]);
}

console.log(`Backend messages found: ${found.size}`);
console.log(`en.json: ${Object.keys(en).length} | zh-CN.json: ${Object.keys(zh).length}`);

if (missEn.length) {
  console.log(`\nMissing from en.json (${missEn.length}):`);
  missEn.forEach(([t, w]) => console.log(`  ${JSON.stringify(t)}\n      <- ${w}`));
}
if (missZh.length) {
  console.log(`\nMissing from zh-CN.json (${missZh.length}):`);
  missZh.forEach(([t, w]) => console.log(`  ${JSON.stringify(t)}\n      <- ${w}`));
}
if (untranslated.length) {
  console.log(`\nNot translated (${untranslated.length}):`);
  untranslated.forEach(([t, w]) => console.log(`  ${JSON.stringify(t)}\n      <- ${w}`));
}

if (!missEn.length && !missZh.length && !untranslated.length) {
  console.log('\nEvery message of the backend has a translation in both locale files.');
}
