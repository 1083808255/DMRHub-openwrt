import { chromium } from 'playwright';

const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
const logs = [];
p.on('pageerror', e => logs.push(`[PAGEERROR] ${e.message}`));
p.on('console', m => { if (m.type() === 'error') logs.push(`[console] ${m.text()}`); });

await p.goto('http://192.168.8.8:3005/login', { waitUntil: 'networkidle' });
await p.evaluate(async () => {
  await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'BH8GLN', password: 'xy147258' }) });
});

// Read the upstream settings through the API, as the page does.
const before = await p.evaluate(async () => {
  const r = await fetch('/api/v1/config');
  const d = await r.json();
  return { networks: d.dmr?.upstreams?.networks ?? [], enabled: d.dmr?.upstreams?.enabled,
           pwSet: d.secrets?.upstreamPasswordsSet, revision: d.revision };
});
console.log('BEFORE networks:', JSON.stringify(before.networks.map(n => ({ name: n.name, addr: n.address, id: n.id }))));
console.log('BEFORE pwSet:', JSON.stringify(before.pwSet), 'revision:', before.revision);

await p.goto('http://192.168.8.8:3005/admin/setup#upstreams', { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);

const ui = await p.evaluate(() => {
  const q = s => document.querySelector(s);
  return {
    addBtn: !!q('[data-test="upstream-network-add"]'),
    card0: !!q('[data-test="upstream-network-0"]'),
    card1: !!q('[data-test="upstream-network-1"]'),
    card2: !!q('[data-test="upstream-network-2"]'),
    name0: q('[data-test="upstream-network-name-0"]')?.value ?? null,
    addr0: q('[data-test="upstream-network-address-0"]')?.value ?? null,
    notLoaded: !!q('[data-test="settings-not-loaded"]'),
  };
});
console.log('UI:', JSON.stringify(ui));
console.log('LOGS:', logs.slice(0, 5).join(' | ') || 'none');
await p.screenshot({ path: 'C:/Users/dell/Desktop/DMRHUB/_build_staging/shot-upstream.png', fullPage: true });
await b.close();
