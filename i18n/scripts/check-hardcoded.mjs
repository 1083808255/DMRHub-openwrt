// SPDX-License-Identifier: AGPL-3.0-or-later
// Scan the frontend for user-facing English text that is NOT wrapped in t().
//
// The scan covers three places that used to be missed:
//   1. Vue templates (text nodes and text-bearing attributes)
//   2. Vue <script> / <script setup> blocks
//   3. Every .ts module under src/ (not just lib/ and services/)
//
// It also flags toast/notification calls whose arguments are not translated,
// because those strings are shown verbatim in the corner of the screen.
//
// Exits non-zero when hardcoded text is found.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
// This script lives in two places: i18n/scripts/ (canonical source, repo root
// is two levels up) and frontend/scripts/ (working copy, root is one level up).
// Pick whichever resolves to a directory that actually has src/.
let rootWithDeps = null;
function resolveRoot() {
  const candidates = [
    path.resolve(here, '../../internal/http/frontend'),
    path.resolve(here, '..'),
  ];
  for (const c of candidates) {
    if (!existsSafe(path.join(c, 'src'))) continue;
    // The compiler lives in node_modules. Prefer the copy that has it, so
    // the script runs from either location.
    if (existsSafe(path.join(c, 'node_modules', '@vue', 'compiler-sfc'))) return c;
    if (!rootWithDeps) rootWithDeps = c;
  }
  return rootWithDeps || candidates[0];
}
const root = resolveRoot();
// Resolve @vue/compiler-sfc from the frontend's node_modules (this script now
// lives in the top-level i18n/scripts folder, outside the package tree).
const require = createRequire(path.join(root, 'package.json'));
const { parse } = require('@vue/compiler-sfc');

const SKIP_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'script', 'style']);
const TEXT_ATTRS = new Set([
  'placeholder', 'aria-label', 'alt', 'title', 'label', 'intro',
  'empty-text', 'text', 'loading-text', 'summary', 'hint', 'description',
  'message', 'confirm-text', 'cancel-text', 'ok-text', 'tooltip',
]);
const HAS_WORDS = /[A-Za-z]{2,}/;
const UI_WORD = /^(yes|no|ok|save|cancel|delete|edit|add|remove|search|back|next|previous|close|open|copy|done|name|type|status|owner|admin|none|all|on|off|auto|any|other|from|to|by|of|or|in|at|is|new|view|change|link|user|time|date|value|format|port|token|voice|codec|roles|invites|peers|groups|net|nets|messages|repeaters|talkgroups|positions|settings|plugins|users|approval|drift|logs|rules|details|overview|actions|address|mode|slot|color|theme|language|docs|home|help|refresh|update|create|remove|owned|list|grid|notification|loading|success|failure|warning|error|info|confirm|cancel|yes|no|ok)$/i;

// Lookup tables hold the English key and translate it where they are used,
// e.g. `const SMS_FORMATS = { ip: 'ETSI IP' }` followed by `t(SMS_FORMATS[k])`.
const TABLE_KEYS = /\b(SMS_FORMATS|DATA_SUBS|CSBK_NAMES|UNKNOWN_NAMES|UNDELIVERABLE_WORDS|UNDELIVERABLE_TARGETS|FORMAT_LABEL_KEYS|SAP_NAME_KEYS|SAP_NAMES)\b/;

// Every key of the locale files. A string that is one of them is a
// translation key, whatever it looks like. The lookup tables of the setup
// page hold the key and translate it where they are shown, so their entries
// are not untranslated text.
const LOCALE_KEYS = new Set();
for (const file of ['en.json', 'zh-CN.json']) {
  const p = path.join(root, 'src/i18n/locales', file);
  if (!existsSafe(p)) continue;
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    for (const key of Object.keys(data)) LOCALE_KEYS.add(key);
  } catch {
    // A broken locale file is reported by check-i18n.mjs.
  }
}

// Strings that look like code, not prose.
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
  // CSS class names and Tailwind utilities.
  /\b(bg-|text-|flex|items-|rounded|gap-|px-|py-|hover:|dark:|font-|border-|grid-|w-|h-|m-|p-|justify-|space-|overflow-|transition|absolute|relative|sticky|fixed|hidden|block|inline)/,
  // Route paths and view names.
  /^(\/|\w+\/)/,
  // Hex colours, versions, and semver-ish tokens.
  /^[0-9a-f]{6,8}$/i,
  /^v?\d+(\.\d+)+$/,
  // MIME and charset tokens.
  /^(utf-?8|ascii|base64|bearer)$/i,
  // date-fns format patterns such as "MMM d, h:mm a" and "yyyy-MM-dd HH:mm:ss".
  /^[A-Za-z]{3,}[-/, ][A-Za-z0-9:/\- ,apmhs]+$/,
  // CSS media queries and pseudo-classes.
  /^\((prefers-|hover|active|focus|not|only|max-|min-)[^)]*\)$/,
  // Hex literals and bit masks, with or without an interpolated value.
  /^0x[0-9a-f]*$/i,
  /^0x\$\{/i,
  // DMR domain terms. The project keeps these as they are in English; the
  // locale files show "TG（通话组）" and similar.
  /^(TG|Codec2|SAP|RX|TX|MHz|kHz|DMR|DMRHub|ID|ID3|AMBE|C4FM|C4FSK|YSF|P25|NXDN|D-STAR|CPSMS|APRS|APRS-IS|IMIS|GPS|GPSDO|MMDVM|OpenBridge|WebTransport|IPSC|Redis|HTTP|HTTPS|RPC|API|REST|WebSocket|UDP|TCP|IPv4|IPv6|CORS|CSRF|DNS|NTP|TLS|SSL|SSH|SNMP|LDAP|SAML|OAuth|JWT|CSR|AES|RSA|ECDSA|MD5|SHA-1|SHA-256|HMAC|PBKDF|BCrypt|Argon2)$/i,
];

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
  if (!existsSafe(dir)) return;
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === '__tests__' || f === 'node_modules') continue;
      collect(p, out, exts);
    } else if (exts.some((e) => f.endsWith(e))) out.push(p);
  }
}

function existsSafe(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

// Strip block and line comments so prose inside them is not reported.
function blankComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

// Replace translated strings with empty quotes: they are keys, not text.
function blankTranslated(src) {
  // t('...'), $t('...'), i18n.global.t('...'), tm('...')
  return src.replace(/[A-Za-z0-9_$.]*\.?t\(\s*(['"])((?:\\.|(?!\1)[^\\\r\n])*)\1/g, '""');
}

// Mark the body of lookup tables so their entries are skipped.
function tableBodyRanges(scanned) {
  const body = new Set();
  const tableRe = new RegExp(
    String.raw`(?:const|let)\s+(${TABLE_KEYS.source})\s*(?::[^=]+)?=\s*\{`,
    'g'
  );
  let tm;
  while ((tm = tableRe.exec(scanned)) !== null) {
    const start = tm.index + tm[0].length;
    const end = scanned.indexOf('};', start);
    if (end < 0) continue;
    for (let i = start; i < end; i++) body.add(i);
  }
  return body;
}

// scanScript - look for English string literals inside script code.
function scanScript(code, rel, lineOffset, found, opts = {}) {
  const raw = blankComments(code);
  const scanned = blankTranslated(raw);
  const body = tableBodyRanges(scanned);
  const re = /'([^'\\\n]{4,160})'|"([^"\\\n]{4,160})"|`([^`\\]{4,160})`/g;
  let m;
  while ((m = re.exec(scanned)) !== null) {
    const v = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
    if (!HAS_WORDS.test(v)) continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    if (TS_ALLOW.some((rx) => rx.test(trimmed))) continue;
    // A string that is a key of the locale files is a translation key, not
    // untranslated text. Lookup tables such as the labels of the setup page
    // hold the key and translate it where they are shown.
    if (LOCALE_KEYS.has(trimmed)) continue;
    // Ignore matches inside console logging.
    const lineStart = scanned.lastIndexOf('\n', m.index) + 1;
    const lineText = scanned.slice(lineStart, m.index);
    if (/console\.(log|debug|info|warn|error)\s*\(/.test(lineText)) continue;
    // A single word only counts when it reads like a UI label.
    const hasSpace = /\s/.test(trimmed);
    if (!hasSpace) {
      if (!opts.singleWord) continue;
      if (!/^[A-Z][a-z]+$/.test(trimmed)) continue;
      if (UI_WORD.test(trimmed) && opts.allowUIWord) continue;
    } else {
      // Prose only when it starts like a sentence.
      if (!/^[A-Z0-9"'(\[]/.test(trimmed)) continue;
      // A string that starts with a domain term and continues with a value
      // ("TG 3100 - Name", "RX 145.5 / TX 145.5 MHz") is a label, not prose.
      if (/^(TG|Codec2|SAP|RX|TX|MHz|DMR|ID)\b/.test(trimmed)) continue;
    }
    if (body.has(m.index)) continue;
    const line = scanned.slice(0, m.index).split('\n').length + lineOffset;
    found.push({ rel, line, key: trimmed });
  }
}

// scanToastCalls - flag toast/notification calls whose text argument is a
// literal rather than a translated key. These strings reach the user
// verbatim, so a missing translation shows up in the corner of the screen.
function scanToastCalls(code, rel, lineOffset, found) {
  const raw = blankComments(code);
  const names = [
    'toast', 'notify', 'notification', 'showToast', 'showNotification',
    'addToast', 'pushToast', 'notifySuccess', 'notifyError', 'notifyInfo',
    'notifyWarning', 'enqueueToast', 'message', 'messages', 'add',
  ];
  const re = new RegExp(
    String.raw`(?:${names.join('|')})\s*\.\s*(?:success|error|info|warning|warn|add|push|show|primary|secondary|contrast)\s*\(\s*([` + "`" + String.raw`'"(])`,
    'g'
  );
  let m;
  while ((m = re.exec(raw)) !== null) {
    const quote = m[1];
    // Read the literal that follows the quote.
    const start = m.index + m[0].length;
    const close = quote === ')' ? ')' : quote;
    let end = raw.indexOf(close, start);
    if (end < 0) continue;
    const literal = raw.slice(start, end);
    if (!HAS_WORDS.test(literal)) continue;
    const trimmed = literal.trim();
    if (TS_ALLOW.some((rx) => rx.test(trimmed))) continue;
    // Already translated? Then it is a key, not untranslated text.
    const before = raw.slice(Math.max(0, m.index - 40), m.index);
    if (/\bt\s*\(\s*$/.test(before) || /\bt\s*$/.test(before)) continue;
    const line = raw.slice(0, m.index).split('\n').length + lineOffset;
    found.push({ rel, line, key: `${m[0].slice(0, m[0].length - 1).trim()} ${JSON.stringify(trimmed)}`, toast: true });
  }
}

const vueFiles = [];
collect(path.join(root, 'src'), vueFiles, ['.vue']);
// Every .ts module under src/ holds user-facing text too (error messages,
// status labels, toast fallbacks). Scanning them all catches the strings the
// template scan used to miss.
const tsFiles = [];
collect(path.join(root, 'src'), tsFiles, ['.ts']);

const found = [];
for (const file of vueFiles) {
  const src = readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  let descriptor = null;
  try {
    const parsed = parse(src);
    if (parsed.errors.length) continue;
    descriptor = parsed.descriptor;
  } catch {
    continue;
  }
  if (descriptor.template?.ast) {
    const templateSrc = src;
    function walk(n, parentTag) {
      if (!n || typeof n !== 'object') return;
      if (n.type === 2) {
        const raw = templateSrc.slice(n.loc.start.offset, n.loc.end.offset);
        if (isTranslatable(raw) && !SKIP_TAGS.has(parentTag) && !raw.includes('{{') && !raw.includes('}}')) {
          const key = raw.replace(/^\s*|\s*$/g, '').replace(/\s+/g, ' ').trim();
          found.push({ rel, line: n.loc.start.line, key });
        }
      }
      if (n.type === 0 || n.type === 1) {
        const tag = n.type === 1 ? n.tag : parentTag;
        for (const p of n.props || []) {
          if (p.type === 6 && p.value && p.value.type === 2 && TEXT_ATTRS.has(p.name)) {
            const raw = templateSrc.slice(p.value.loc.start.offset, p.value.loc.end.offset);
            const v = raw.slice(1, -1);
            if (isTranslatable(v) && !v.includes('$t(') && !v.includes('t(')) {
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
  // Script blocks: the toast and notification strings live here.
  const blocks = [];
  if (descriptor.script?.content) blocks.push(descriptor.script.content);
  if (descriptor.scriptSetup?.content) blocks.push(descriptor.scriptSetup.content);
  for (const b of blocks) {
    scanScript(b, rel, 0, found);
    scanToastCalls(b, rel, 0, found);
  }
}

for (const file of tsFiles) {
  const raw = readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  scanScript(raw, rel, 0, found, { singleWord: true, allowUIWord: false });
  scanToastCalls(raw, rel, 0, found);
}

if (found.length) {
  console.error(`Found ${found.length} hardcoded English string(s):`);
  for (const f of found.slice(0, 200)) {
    console.error(`  ${f.rel}:${f.line}  ${JSON.stringify(f.key)}`);
  }
  if (found.length > 200) console.error(`  ... and ${found.length - 200} more`);
  process.exitCode = 1;
} else {
  console.log('No hardcoded English text found.');
}
