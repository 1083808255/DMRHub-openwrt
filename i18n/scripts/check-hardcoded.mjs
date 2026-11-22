// SPDX-License-Identifier: AGPL-3.0-or-later
// Scan Vue templates for user-facing English text that is NOT wrapped in $t().
// Helps catch untranslated strings introduced by upstream merges.
// Exits non-zero when hardcoded text is found.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
// Repo root is two levels up from i18n/scripts/
const root = path.resolve(here, '../../internal/http/frontend');
// Resolve @vue/compiler-sfc from the frontend's node_modules (this script now
// lives in the top-level i18n/scripts folder, outside the package tree).
const require = createRequire(path.join(root, 'package.json'));
const { parse } = require('@vue/compiler-sfc');
const SKIP_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'script', 'style']);
const TEXT_ATTRS = new Set(['placeholder', 'aria-label', 'alt', 'title', 'label', 'intro', 'empty-text', 'text', 'loading-text', 'summary', 'hint']);
const HAS_WORDS = /[A-Za-z]{2,}/;
const UI_WORD = /^(yes|no|ok|save|cancel|delete|edit|add|remove|search|back|next|previous|close|open|copy|done|name|type|status|owner|admin|none|all|on|off|auto|any|other|from|to|by|of|or|in|at|is|new|view|change|link|user|time|date|value|format|port|token|voice|codec|roles|invites|peers|groups|net|nets|messages|repeaters|talkgroups|positions|settings|plugins|users|approval|drift|logs|rules|details|overview|actions|address|mode|slot|color|theme|language|docs|home|help|refresh|update|create|remove|owned|list|grid)$/i;

function isTranslatable(raw) {
  if (!raw || !HAS_WORDS.test(raw)) return false;
  const t = raw.trim();
  if (!t) return false;
  if (/^(https?:\/\/|\/|[.#@]|\w+\/)/.test(t)) return false;
  if (/^[\w-]+\.[\w-]+$/.test(t) && !/\s/.test(t)) return false;
  if (/^\d/.test(t) && !/[A-Za-z]{3,}/.test(t)) return false;
  if (/\s/.test(t)) return true;
  return UI_WORD.test(t) || /^[A-Z][a-z]/.test(t);
}

function collect(dir, out, exts) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === '__tests__') continue;
      collect(p, out, exts);
    } else if (exts.some((e) => f.endsWith(e))) out.push(p);
  }
}

const vueFiles = [];
collect(path.join(root, 'src/views'), vueFiles, ['.vue']);
collect(path.join(root, 'src/components'), vueFiles, ['.vue']);
// Plain .ts modules hold user-facing text too (error messages, status labels,
// setup field descriptions). Scanning them catches the strings the template
// scan used to miss.
const tsFiles = [];
collect(path.join(root, 'src/lib'), tsFiles, ['.ts']);
collect(path.join(root, 'src/services'), tsFiles, ['.ts']);

const found = [];
for (const file of vueFiles) {
  const src = readFileSync(file, 'utf8');
  const { descriptor, errors } = parse(src);
  if (errors.length || !descriptor.template?.ast) continue;
  const rel = path.relative(root, file);
  function walk(n, parentTag) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 2) {
      const raw = src.slice(n.loc.start.offset, n.loc.end.offset);
      if (isTranslatable(raw) && !SKIP_TAGS.has(parentTag) && !raw.includes('{{') && !raw.includes('}}')) {
        const key = raw.replace(/^\s*|\s*$/g, '').replace(/\s+/g, ' ').trim();
        found.push({ rel, line: n.loc.start.line, key });
      }
    }
    if (n.type === 0 || n.type === 1) {
      const tag = n.type === 1 ? n.tag : parentTag;
      for (const p of n.props || []) {
        if (p.type === 6 && p.value && p.value.type === 2 && TEXT_ATTRS.has(p.name)) {
          const raw = src.slice(p.value.loc.start.offset, p.value.loc.end.offset);
          const v = raw.slice(1, -1);
          if (isTranslatable(v) && !v.includes('$t(')) {
            found.push({ rel, line: p.loc.start.line, key: `${p.name}=${v.trim()}` });
          }
        }
      }
      (n.children || []).forEach((c) => walk(c, tag));
    }
    if (n.type === 11) (n.branches || []).forEach((b) => walk(b, parentTag));
    if (n.type === 13) (n.children || []).forEach((c) => walk(c, parentTag));
  }
  walk(descriptor.template.ast, null);
}

// Plain .ts modules: look for English string literals that look like UI text.
// Strings already inside t()/i18n.global.t() are keys, not untranslated text,
// so they are stripped before scanning.
const TS_ALLOW = [
  /^[A-Z]{2,}$/, // ALLCAPS identifiers like AMBE, CORS, CSBK
  /^[\w./:@-]+$/, // paths, ids, css-ish tokens
  /^https?:\/\//,
  /^[a-z0-9_-]+$/i, // single lowercase token
  /^(id|uuid|token|api|json|xml|html|css|js|yaml|yml|md|csv|log|png|jpg|svg|webp|ico)$/i,
  /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/,
  /^(application|audio|image|text|multipart)\//i,
  /^[\d\s.,:%+-]+$/, // pure numbers and units
  // Font family names used by the map styles.
  /^(Montserrat|Open Sans)\b/,
  // Date/time format patterns such as "MMM d, HH:mm".
  /^[A-Z]{3,}\s+[a-z]?\s*[dHms:,\-/]+$/,
  // Map tile coordinates such as "z12/656/1582".
  /\bz\d+\/\d+\/\d+/,
  // date-fns format patterns such as "MMM d, HH:mm".
  /^[A-Z]{2,4}\s+[a-z]?,\s*[A-Za-z:]+$/,
  // Date/time samples such as "Tue at 19:00 America/Chicago".
  /^[A-Z][a-z]{2} at \d{2}:\d{2}/,
];

for (const file of tsFiles) {
  const raw = readFileSync(file, 'utf8');
  // Drop i18n-wrapped strings (they are keys).
  const src = raw.replace(/[A-Za-z0-9_$.]*\.?t\(\s*(['"])((?:\\.|(?!\1)[^\\\r\n])*)\1/g, '""');
  // Blank out block comments so their prose is not reported.
  const scanned = src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  // Lookup tables hold the English key and translate it where they are used,
  // e.g. `const SMS_FORMATS = { ip: 'ETSI IP' }` followed by `t(SMS_FORMATS[k])`.
  // Their values are keys, not untranslated text.
  const TABLE_KEYS = /\b(SMS_FORMATS|DATA_SUBS|CSBK_NAMES|UNKNOWN_NAMES|UNDELIVERABLE_WORDS|UNDELIVERABLE_TARGETS|FORMAT_LABEL_KEYS|SAP_NAME_KEYS)\b/;
  // Mark the body of those tables so their entries are skipped.
  const tableBody = new Set();
  const tableRe = new RegExp(
    String.raw`(?:const|let)\s+(${TABLE_KEYS.source})\s*(?::[^=]+)?=\s*\{`,
    'g'
  );
  let tm;
  while ((tm = tableRe.exec(scanned)) !== null) {
    const start = tm.index + tm[0].length;
    const end = scanned.indexOf('};', start);
    if (end < 0) continue;
    for (let i = start; i < end; i++) tableBody.add(i);
  }
  const rel = path.relative(root, file);
  const re = /'([^'\\\n]{4,120})'|"([^"\\\n]{4,120})"/g;
  let m;
  while ((m = re.exec(scanned)) !== null) {
    const v = m[1] !== undefined ? m[1] : m[2];
    if (!HAS_WORDS.test(v)) continue;
    if (TS_ALLOW.some((rx) => rx.test(v.trim()))) continue;
    // Skip CSS utility classes and long code-ish strings.
    if (/\b(bg-|text-|flex|items-|rounded|gap-|px-|py-|hover:|dark:|font-)/.test(v)) continue;
    // Skip strings that look like sentences about code rather than UI text.
    if (/^\s*(\/\/|\*|\/\*)/.test(v)) continue;
    if (!/\s/.test(v.trim())) continue;
    // Must look like prose: start with a capital letter and read as a sentence.
    if (!/^[A-Z0-9"'(\[]/.test(v.trim())) continue;
    // Skip the body of lookup tables: those hold translation keys.
    if (tableBody.has(m.index)) continue;
    // Ignore matches inside comments and debug logging.
    const lineStart = scanned.lastIndexOf('\n', m.index) + 1;
    const lineText = scanned.slice(lineStart, m.index);
    if (/\/\/|\/\*|\*\//.test(lineText)) continue;
    if (/console\.(log|debug|info|warn|error)\s*\(/.test(lineText)) continue;
    const line = scanned.slice(0, m.index).split('\n').length;
    found.push({ rel, line, key: v.trim() });
  }
}

if (found.length) {
  console.error(`Found ${found.length} hardcoded English string(s):`);
  for (const f of found.slice(0, 50)) console.error(`  ${f.rel}:${f.line}  ${JSON.stringify(f.key)}`);
  if (found.length > 50) console.error(`  ... and ${found.length - 50} more`);
  process.exitCode = 1;
} else {
  console.log('No hardcoded English text found.');
}
