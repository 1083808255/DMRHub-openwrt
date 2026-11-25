import { chromium } from 'playwright';

const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
const netLog = [];
p.on('request', r => { if (r.url().includes('/api/v1/config')) netLog.push(`${r.method()} ${new URL(r.url()).pathname}`); });

await p.goto('http://192.168.8.8:3005/login', { waitUntil: 'networkidle' });
await p.evaluate(async () => {
  await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'BH8GLN', password: 'xy147258' }) });
});

await p.goto('http://192.168.8.8:3005/admin/setup#upstreams', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);

// Fix network 1 back to its real master and save, as an admin would.
const addr = p.locator('[data-test="upstream-network-address-0"]');
await addr.fill('dmr.wakepc.cn');
await p.waitForTimeout(300);
const saveBtn = p.locator('[data-test="save"]');
console.log('SAVE ENABLED:', await saveBtn.isEnabled());
await saveBtn.click();
await p.waitForTimeout(3500);

const msg = await p.locator('[data-test="savebar-message"]').textContent().catch(() => null);
console.log('SAVE MESSAGE:', JSON.stringify(msg));

// What the hub now holds.
const after = await p.evaluate(async () => {
  const r = await fetch('/api/v1/config');
  const d = await r.json();
  return { networks: d.dmr?.upstreams?.networks ?? [], revision: d.revision };
});
console.log('AFTER:', JSON.stringify(after.networks.map(n => ({ name: n.name, addr: n.address, id: n.id, opts: n.options }))));
console.log('REVISION:', after.revision);
console.log('NET:', netLog.slice(-6).join(' | '));
await p.screenshot({ path: 'C:/Users/dell/Desktop/DMRHUB/_build_staging/shot-saved.png', fullPage: true });
await b.close();
