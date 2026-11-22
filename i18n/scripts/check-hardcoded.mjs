// SPDX-License-Identifier: AGPL-3.0-or-later
// Scan Vue templates for user-facing English text that is NOT wrapped in $t().
// Helps catch untranslated strings introduced by upstream merges.
// Exits non-zero when hardcoded text is found.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from '@vue/compiler-sfc';

const here = path.dirname(fileURLToPath(import.meta.url));
// Repo root is two levels up from i18n/scripts/
const root = path.resolve(here, '../../internal/http/frontend');
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

function collect(dir, out) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) collect(p, out);
    else if (f.endsWith('.vue')) out.push(p);
  }
}

const files = [];
collect(path.join(root, 'src/views'), files);
collect(path.join(root, 'src/components'), files);

const found = [];
for (const file of files) {
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

if (found.length) {
  console.error(`Found ${found.length} hardcoded English string(s) in templates:`);
  for (const f of found.slice(0, 50)) console.error(`  ${f.rel}:${f.line}  ${JSON.stringify(f.key)}`);
  if (found.length > 50) console.error(`  ... and ${found.length - 50} more`);
  process.exitCode = 1;
} else {
  console.log('No hardcoded English text found in Vue templates.');
}
