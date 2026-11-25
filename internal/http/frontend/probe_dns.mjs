import { chromium } from 'playwright';

const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();

await p.goto('http://192.168.8.8:3005/login', { waitUntil: 'networkidle' });
await p.evaluate(async () => {
  await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'BH8GLN', password: 'xy147258' }) });
});
await p.goto('http://192.168.8.8:3005/admin/setup#upstreams', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);

// A name that cannot resolve: the save must still succeed now.
await p.locator('[data-test="upstream-network-address-0"]').fill('does-not-resolve.invalid');
await p.waitForTimeout(300);
await p.locator('[data-test="save"]').click();
await p.waitForTimeout(4000);
console.log('MESSAGE:', JSON.stringify(await p.locator('[data-test="savebar-message"]').textContent().catch(() => null)));

const after = await p.evaluate(async () => {
  const r = await fetch('/api/v1/config'); const d = await r.json();
  return { addr: d.dmr?.upstreams?.networks?.[0]?.address, revision: d.revision };
});
console.log('AFTER:', JSON.stringify(after));

// Put the real master back.
await p.locator('[data-test="upstream-network-address-0"]').fill('dmr.wakepc.cn');
await p.waitForTimeout(300);
await p.locator('[data-test="save"]').click();
await p.waitForTimeout(4000);
const back = await p.evaluate(async () => {
  const r = await fetch('/api/v1/config'); const d = await r.json();
  return { addr: d.dmr?.upstreams?.networks?.[0]?.address, revision: d.revision };
});
console.log('RESTORED:', JSON.stringify(back));
await b.close();
