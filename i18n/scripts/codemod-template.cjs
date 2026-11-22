// Codemod: wrap user-visible template text and attributes with $t().
// Uses Vue's own SFC parser and absolute source offsets. Idempotent.
const { parse } = require('@vue/compiler-sfc');
const fs = require('fs'), path = require('path');

// Attribute names whose literal value is user-visible text.
const TEXT_ATTRS = new Set([
  'placeholder', 'aria-label', 'alt', 'title', 'label', 'intro',
  'empty-text', 'text', 'loading-text', 'summary', 'hint',
]);
// Elements whose text content is code/identifier and must not be translated.
const SKIP_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'script', 'style']);
// Regex: at least two consecutive letters (skips pure numbers/symbols/short tokens).
const HAS_WORDS = /[A-Za-z]{2,}/;
// Sentence-like text: has a space with words on both sides, OR is a known UI word.
const UI_WORD = /^(yes|no|ok|save|cancel|delete|edit|add|remove|search|back|next|previous|close|open|copy|done|name|type|status|owner|admin|none|all|on|off|auto|any|other|from|to|by|of|or|in|at|is|new|view|change|link|user|time|date|value|format|port|token|voice|codec|roles|invites|peers|groups|net|nets|messages|repeaters|talkgroups|positions|settings|plugins|users|approval|drift|logs|rules|details|overview|actions|address|mode|slot|color|theme|language)$/i;

function collect(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f), s = fs.statSync(p);
    if (s.isDirectory()) collect(p, out);
    else if (f.endsWith('.vue')) out.push(p);
  }
}

function isTranslatable(raw) {
  if (!raw || !HAS_WORDS.test(raw)) return false;
  const t = raw.trim();
  if (!t) return false;
  // Skip things that look like identifiers / paths / css / dates / versions.
  if (/^(https?:\/\/|\/|[.#@]|\w+\/)/.test(t)) return false;
  if (/^[\w-]+\.[\w-]+$/.test(t) && !/\s/.test(t)) return false; // foo.bar
  if (/^\d/.test(t) && !/[A-Za-z]{3,}/.test(t)) return false;
  // Must be a sentence (has space) or a recognized UI word / a Capitalized word.
  if (/\s/.test(t)) return true;
  return UI_WORD.test(t) || /^[A-Z][a-z]/.test(t);
}

function q(s) { return JSON.stringify(s); } // safe JS string literal

function transform(file, src, stats, { write = true } = {}) {
  const { descriptor, errors } = parse(src);
  if (errors.length || !descriptor.template || !descriptor.template.ast) return src;
  const edits = [];

  function walk(n, parentTag) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 2) { // TEXT
      const start0 = n.loc.start.offset, end0 = n.loc.end.offset;
      const raw = src.slice(start0, end0);
      if (isTranslatable(raw) && !SKIP_TAGS.has(parentTag) && !raw.includes('{{') && !raw.includes('}}')) {
        const lead = (raw.match(/^\s*/) || [''])[0];
        const trail = (raw.match(/\s*$/) || [''])[0];
        const core = raw.slice(lead.length, raw.length - trail.length);
        if (core) {
          // Normalize internal whitespace (newlines + indentation) to single spaces.
          const key = core.replace(/\s+/g, ' ').trim();
          const start = start0 + lead.length;
          const end = end0 - trail.length;
          edits.push({ s: start, e: end, text: `{{ $t(${q(key)}) }}` });
          stats.keys.add(key);
          stats.text++;
        }
      }
    }
    if (n.type === 0 || n.type === 1) {
      const tag = n.type === 1 ? n.tag : parentTag;
      for (const p of n.props || []) {
        if (p.type === 6 && p.value && p.value.type === 2 && TEXT_ATTRS.has(p.name)) {
          const start0 = p.value.loc.start.offset, end0 = p.value.loc.end.offset;
          const raw = src.slice(start0, end0);
          // raw includes the surrounding quotes; strip them
          const quote = raw[0];
          const v = (quote === '"' || quote === "'") ? raw.slice(1, -1) : raw;
          if (isTranslatable(v)) {
            const key = v.replace(/\s+/g, ' ').trim();
            // Vue template attribute uses double quotes outside; use single quotes
            // inside $t() and escape any apostrophes in the key.
            const inner = "'" + key.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
            edits.push({ s: p.loc.start.offset, e: p.loc.end.offset, text: `:${p.name}="$t(${inner})"` });
            stats.keys.add(key);
            stats.attr++;
          }
        }
      }
      (n.children || []).forEach((c) => walk(c, tag));
    }
    if (n.type === 11) (n.branches || []).forEach((b) => walk(b, parentTag));
    if (n.type === 13) (n.children || []).forEach((c) => walk(c, parentTag));
  }
  walk(descriptor.template.ast, null);

  if (!edits.length) return src;
  edits.sort((a, b) => b.s - a.s);
  let lastStart = Infinity;
  let out = src;
  let applied = 0;
  for (const ed of edits) {
    if (ed.e > lastStart) continue; // overlap with a later-applied edit
    out = out.slice(0, ed.s) + ed.text + out.slice(ed.e);
    lastStart = ed.s;
    applied++;
  }
  if (applied && write) {
    fs.writeFileSync(file, out, 'utf8');
    stats.files++;
  }
  return out;
}

const files = [];
collect('src/views', files);
collect('src/components', files);

// CLI: optional --dry <file>
const dryIdx = process.argv.indexOf('--dry');
const dryFile = dryIdx >= 0 ? process.argv[dryIdx + 1] : null;
const targetFiles = dryFile ? [dryFile] : files;

const stats = { files: 0, text: 0, attr: 0, keys: new Set() };
for (const f of targetFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const result = transform(f, src, stats, { write: !dryFile });
  if (dryFile) fs.writeFileSync('dryrun-out.vue', result, 'utf8');
}
fs.writeFileSync('i18n-template-keys.json', JSON.stringify([...stats.keys].sort(), null, 2));
console.log(`Template codemod: ${stats.files} files, ${stats.text} text nodes, ${stats.attr} attrs, ${stats.keys.size} unique keys.`);
