// Targeted codemod: wrap user-facing string literals in <script> with t().
// Only transforms strings in known UI contexts to avoid touching type literals,
// domain values, comparisons, API paths, or CSS classes.
const fs = require('fs'), path = require('path');

const master = new Set(JSON.parse(fs.readFileSync('i18n-master.json', 'utf8')));
for (const k of JSON.parse(fs.readFileSync('i18n-template-keys.json', 'utf8'))) master.add(k);

function collect(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f), s = fs.statSync(p);
    if (s.isDirectory()) collect(p, out);
    else if (f.endsWith('.vue')) out.push(p);
  }
}
function esc(s) { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

// Patterns where the captured string is definitely user-facing UI text.
// Each entry: [RegExp with one capture group for the quoted string, replacement template]
const RULES = [
  // useHead({ title: '...' })
  [/\buseHead\(\s*\{\s*title:\s*'((?:\\.|[^'\\])*)'\s*\}\s*\)/g, (k) => `useHead({ title: t('${esc(k)}') })`],
  // summary: '...' and detail: '...' (toast options)
  [/\b(summary|detail):\s*'((?:\\.|[^'\\])*)'/g, (k, args) => `${args[0]}: t('${esc(k)}')`, 2],
  // errorText(err, '...') -- second arg is a user-facing fallback message
  [/\berrorText\(\s*(\w+)\s*,\s*'((?:\\.|[^'\\])*)'\s*\)/g, (k, args) => `errorText(${args[0]}, t('${esc(k)}'))`, 2],
  // Toast detail/summary via this.$toast.add - already covered by summary/detail rule
  // withMessage('...', ...) from vuelidate
  [/\bwithMessage\(\s*'((?:\\.|[^'\\])*)'/g, (k) => `withMessage(t('${esc(k)}')`],
  // Vuelidate helpers.withMessage
  // Direct confirmation dialogs: confirm('...') / window.confirm('...')
  [/\bconfirm\(\s*'((?:\\.|[^'\\])*)'\s*\)/g, (k) => `confirm(t('${esc(k)}'))`],
  // alert('...')
  [/\balert\(\s*'((?:\\.|[^'\\])*)'\s*\)/g, (k) => `alert(t('${esc(k)}'))`],
  // this.$toast.add({severity:'error', summary:'X', detail:'Y'}) - summary/detail already covered
];

function transformScript(code, helper) {
  let out = code;
  const keys = [];
  for (const rule of RULES) {
    const [re, make, keyIdx = 1] = rule;
    out = out.replace(re, (full, ...args) => {
      // args: captured groups, offset, string
      const keyRaw = args[keyIdx - 1];
      if (!keyRaw) return full;
      const key = keyRaw.replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\s+/g, ' ').trim();
      if (!master.has(key)) return full;
      keys.push(key);
      return make(key, args, full);
    });
  }
  return { out, keys };
}

function transform(file, stats) {
  const src = fs.readFileSync(file, 'utf8');
  const scriptRe = /(<script[^>]*>)([\s\S]*?)(<\/script>)/g;
  let out = '', last = 0, m, changed = false;
  while ((m = scriptRe.exec(src))) {
    const open = m[1], code = m[2], close = m[3];
    const localT = /\b(?:const|let|var)\s+t\b|\bfunction\s+t\s*\(/.test(code);
    const helper = localT ? '$t' : 't';
    const res = transformScript(code, helper);
    if (res.keys.length) {
      let newCode = res.out;
      // Replace helper in generated calls if needed
      if (helper !== 't') newCode = newCode.replace(/\bt\(/g, '$t(');
      if (!/from ['"]@\/i18n['"]/.test(newCode)) {
        newCode = (localT ? "\nimport { t as $t } from '@/i18n';\n" : "\nimport { t } from '@/i18n';\n") + newCode;
      }
      out += src.slice(last, m.index) + open + newCode + close;
      last = m.index + m[0].length;
      changed = true;
      res.keys.forEach((k) => stats.keys.add(k));
      stats.blocks++;
    }
  }
  if (changed) {
    out += src.slice(last);
    fs.writeFileSync(file, out, 'utf8');
    stats.files++;
  }
}

const files = [];
collect('src/views', files);
collect('src/components', files);
const stats = { files: 0, blocks: 0, keys: new Set() };
for (const f of files) transform(f, stats);
fs.writeFileSync('i18n-script-keys.json', JSON.stringify([...stats.keys].sort(), null, 2));
console.log(`Script codemod: ${stats.files} files, ${stats.blocks} blocks, ${stats.keys.size} keys.`);
