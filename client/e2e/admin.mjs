// Staff admin console (admin.html): login gate, maintenance, announcements, mute, grant, audit log
import { chromium } from 'playwright';
import { newDb } from './lib.mjs';
const URL = process.env.E2E_URL ?? 'http://127.0.0.1:5173/';
const ADMIN = new globalThis.URL(URL).origin + '/admin.html';
const SHOT = new globalThis.URL('../../docs/screenshots/', import.meta.url).pathname;
const db = newDb();
const results = []; const ok = (n, c, i = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${i}`); };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1100, height: 800 } }); const p = await ctx.newPage();
const email = `adm_${Date.now()}@example.com`;
await p.goto(URL);
await p.evaluate(async (email) => {
  await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-9' }) });
}, email);
const uid = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
await db.query(`UPDATE users SET role='admin' WHERE id=$1`, [uid]);
await p.goto(ADMIN);
await p.waitForSelector('#login:not([hidden]), #app:not([hidden])');
if (await p.isVisible('#login')) {
  await p.fill('#email', email); await p.fill('#pw', 'correct-horse-9'); await p.click('#login-btn');
}
ok('admin app visible after staff login', await p.waitForSelector('#app:not([hidden])', { timeout: 8000 }).then(() => true).catch(() => false));
ok('who shows 管理者', ((await p.textContent('#who')) || '').includes('管理者'));
ok('status shows メンテナンス', await p.waitForFunction(() => document.querySelector('#st-body')?.textContent.includes('メンテナンス'), null, { timeout: 8000 }).then(() => true).catch(() => false));
await p.screenshot({ path: SHOT + 'admin-status.png' });
await p.fill('#mnt-msg', 'E2E管理画面メンテ'); await p.click('#mnt-on');
ok('maintenance toggled on from UI', await p.waitForFunction(() => document.querySelector('#st-body')?.textContent.includes('ON'), null, { timeout: 8000 }).then(() => true).catch(() => false));
await p.click('#mnt-off');
await p.waitForFunction(() => document.querySelector('#st-body')?.textContent.includes('OFF'), null, { timeout: 8000 });
await p.click('[data-t="news"]'); await p.fill('#nw-title', '管理画面テスト'); await p.fill('#nw-body', 'お知らせ本文です'); await p.click('#nw-add');
ok('announcement created', await p.waitForFunction(() => document.querySelector('#news-list')?.textContent.includes('管理画面テスト'), null, { timeout: 8000 }).then(() => true).catch(() => false));
await p.screenshot({ path: SHOT + 'admin-news.png' });
const victim = await p.evaluate(async () => {
  const email = `vic_${Date.now()}@example.com`;
  await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-9' }) });
  const { token } = await (await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-9' }) })).json();
  const ch = await (await fetch('/api/characters', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ name: '被' + String.fromCharCode(0x30a2 + (Date.now() % 40), 0x30a2 + 3), class: 'mage', appearance: { bodyType: 'a', hairStyle: 0, hairColor: 0, skinColor: 0 } }) })).json();
  return { token, name: ch.name ?? ch.character?.name, id: ch.id ?? ch.character?.id };
});
await p.click('[data-t="mod"]'); await p.fill('#mu-name', victim.name); await p.fill('#mu-min', '15'); await p.click('#mu-go');
ok('mute ok', await p.waitForFunction(() => document.querySelector('#mod-msg')?.textContent.includes('発言制限'), null, { timeout: 8000 }).then(() => true).catch(() => false), await p.textContent('#mod-msg'));
const before = (await db.query(`SELECT coalesce(sum(quantity),0)::int n FROM inventory WHERE character_id=$1 AND item_id='potion_small'`, [victim.id])).rows[0].n;
await p.click('[data-t="grant"]'); await p.fill('#gr-name', victim.name); await p.fill('#gr-item', 'potion_small'); await p.fill('#gr-qty', '3'); await p.fill('#gr-id', 'e2e-grant-1'); await p.click('#gr-go');
ok('grant ok', await p.waitForFunction(() => document.querySelector('#gr-msg')?.textContent.includes('付与'), null, { timeout: 8000 }).then(() => true).catch(() => false), await p.textContent('#gr-msg'));
const qty = (await db.query(`SELECT coalesce(sum(quantity),0)::int n FROM inventory WHERE character_id=$1 AND item_id='potion_small'`, [victim.id])).rows[0].n;
ok('victim received 3 potions', qty === before + 3, `${before} -> ${qty}`);
await p.click('[data-t="logs"]'); await p.fill('#lg-q', 'admin.'); await p.click('#lg-go');
ok('audit log lists admin actions', await p.waitForFunction(() => /admin\.(maintenance|announcements|mute|grant)/.test(document.querySelector('#lg-body')?.textContent ?? ''), null, { timeout: 8000 }).then(() => true).catch(() => false));
await p.screenshot({ path: SHOT + 'admin-logs.png' });
const p2 = await (await b.newContext()).newPage();
const pem = `pl_${Date.now()}@example.com`;
await p2.goto(ADMIN);
await p2.evaluate(async (email) => { await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-9' }) }); }, pem);
await p2.fill('#email', pem); await p2.fill('#pw', 'correct-horse-9'); await p2.click('#login-btn');
ok('plain player is refused', await p2.waitForFunction(() => document.querySelector('#login-msg')?.textContent.includes('管理権限'), null, { timeout: 8000 }).then(() => true).catch(() => false), await p2.textContent('#login-msg'));
await b.close(); await db.end();
const fail = results.filter((x) => !x).length; console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
