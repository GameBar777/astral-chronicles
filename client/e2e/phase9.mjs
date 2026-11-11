// E2E PHASE 9: player market (list → browse → buy via UI, fee, escrow, cancel, history), guild roles/transfer/disband via UI, rankings
import { chromium } from 'playwright';
import { newDb } from './lib.mjs';
const URL = process.env.E2E_URL ?? 'http://127.0.0.1:5173/';
const SHOT = new globalThis.URL('../../docs/screenshots/', import.meta.url).pathname;
const db = newDb();
const results = []; const ok = (name, cond, info = '') => { results.push({ name, pass: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${info}`); };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const kana = (n) => String.fromCharCode(0x30a2 + (n % 40), 0x30a2 + (Math.floor(n / 40) % 40), 0x30a2 + (Math.floor(n / 1600) % 40));
async function player(tag, cls, k) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(tag + ': ' + e)); p.on('console', (m) => m.type() === 'error' && !/status of 4(00|03|04|09)/.test(m.text()) && errors.push(tag + ': ' + m.text()));
  await p.goto(URL); await p.waitForSelector('#email');
  await p.fill('#email', `e9${tag}_${Date.now()}@example.com`); await p.fill('#pw', 'correct-horse-9'); await p.click('#reg');
  await p.waitForSelector('#new'); await p.click('#new'); await p.waitForSelector('#name');
  const name = tag + kana(Date.now() + k * 7); await p.fill('#name', name); await p.check(`input[value=${cls}]`); await p.click('#create');
  await p.waitForFunction(() => window.__astral?.scene.isActive('World'), null, { timeout: 15000 });
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  return { ctx, p, name, id, tag };
}
const waitFor = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } return null; };
const gold = async (P) => Number((await db.query('SELECT gold FROM characters WHERE id=$1', [P.id])).rows[0].gold);
const count = async (P, item) => Number((await db.query('SELECT coalesce(sum(quantity),0)::int n FROM inventory WHERE character_id=$1 AND item_id=$2', [P.id, item])).rows[0].n);
const msgText = (P) => P.p.textContent('#p4 .p4-msg');
const shot = (P, f) => P.p.screenshot({ path: SHOT + f });
const press = async (P, key) => { await P.p.evaluate(() => document.activeElement?.blur?.()); await P.p.keyboard.press(key); };

const A = await player('売', 'warrior', 1), B = await player('買', 'mage', 2);
await db.query(`INSERT INTO inventory(character_id,item_id,quantity) VALUES($1,'iron_ore',8)`, [A.id]);
await db.query('UPDATE characters SET gold=500 WHERE id=$1', [B.id]);
const a0 = await gold(A);

// --- A lists 5 iron ore for 200G via the market panel
await press(A, 'b'); await A.p.waitForSelector('#p4.market');
ok('market panel opens with B key', await A.p.isVisible('#p4.market'));
await A.p.click('[data-tab="sell"]'); await A.p.waitForSelector('#m-item');
const opt = await A.p.$$eval('#m-item option', (os) => os.map((o) => [o.value, o.textContent]));
const ore = opt.find(([, t]) => t.includes('鉄鉱石')); ok('iron ore offered in sell list', !!ore, JSON.stringify(opt.map((o) => o[1])));
await A.p.selectOption('#m-item', ore[0]); await A.p.fill('#m-qty', '5'); await A.p.fill('#m-price', '200'); await A.p.dispatchEvent('#m-price', 'input');
ok('fee preview 10G / 190G', (await A.p.textContent('#m-fee')).includes('手数料 10G') && (await A.p.textContent('#m-fee')).includes('190'));
await shot(A, 'phase9-market-sell.png');
await A.p.click('#m-list-btn');
ok('listed message', await waitFor(async () => (await msgText(A)).includes('出品しました')));
ok('escrow: 3 ore left in A inventory', (await count(A, 'iron_ore')) === 3);

// --- B browses, searches, buys
await press(B, 'b'); await B.p.waitForSelector('#p4.market .m-list');
await B.p.fill('#m-q', '鉄鉱石'); await B.p.click('#m-go');
ok('B finds the listing by search', await waitFor(async () => (await B.p.$$('.m-buy')).length >= 1));
await shot(B, 'phase9-market-browse.png');
await B.p.click('.m-buy'); await B.p.waitForSelector('#c-ok'); await shot(B, 'phase9-market-confirm.png'); await B.p.click('#c-ok');
ok('B purchase message', await waitFor(async () => (await msgText(B)).includes('購入しました')));
ok('B paid 200G, received 5 ore', (await gold(B)) === 300 && (await count(B, 'iron_ore')) === 5, `${await gold(B)} ${await count(B, 'iron_ore')}`);
ok('A received 190G (5% fee)', (await gold(A)) === a0 + 190, `${a0} -> ${await gold(A)}`);
ok('seller got a system chat notice', await waitFor(async () => (await A.p.textContent('#chat')).includes('売れました')));
await shot(B, 'phase9-market-bought.png');
// double-click resistance: same listing again is closed
const again = await B.p.evaluate(async ([cid]) => { const r = await fetch('/api/market', { headers: { authorization: 'Bearer ' + sessionStorage.getItem('astral.token') } }); return (await r.json()).listings.length; }, [B.id]);
ok('sold listing no longer browsable', again === 0, String(again));

// --- A: second listing, cancel it from history tab
await A.p.click('[data-tab="sell"]'); await A.p.waitForSelector('#m-item');
const ore2 = (await A.p.$$eval('#m-item option', (os) => os.map((o) => [o.value, o.textContent]))).find(([, t]) => t.includes('鉄鉱石'));
await A.p.selectOption('#m-item', ore2[0]); await A.p.fill('#m-qty', '2'); await A.p.fill('#m-price', '80'); await A.p.click('#m-list-btn');
await waitFor(async () => (await msgText(A)).includes('出品しました'));
await A.p.click('[data-tab="mine"]'); await A.p.waitForSelector('.m-cancel');
ok('history shows sold row with buyer and fee', (await A.p.textContent('#p4 .m-list')).includes('売却済') && (await A.p.textContent('#p4 .m-list')).includes(B.name));
await shot(A, 'phase9-market-history.png');
await A.p.click('.m-cancel');
ok('cancel returns items', await waitFor(async () => (await count(A, 'iron_ore')) === 3));
await A.p.keyboard.press('Escape'); ok('Esc closes the market panel', await waitFor(async () => !(await A.p.$('#p4'))));

// --- guild via the social panel: create, invite, accept, promote, transfer, disband
await press(A, 'o'); await A.p.waitForSelector('#social:not(.hidden)');
const gname = '星' + kana(Date.now()); await A.p.fill('#s-gname', gname); await A.p.click('[data-a="guild/create"]');
await waitFor(async () => (await A.p.textContent('#social')).includes(gname));
await A.p.fill('#s-pname', B.name); await A.p.click('[data-a="guild/invite"]');
await press(B, 'o'); await B.p.waitForSelector('#social:not(.hidden)');
await waitFor(async () => { await B.p.evaluate(() => window.__astral && document.querySelector('#social') && null); return B.p.$('[data-a="guild/accept"]'); }, 8000);
await B.p.click('[data-a="guild/accept"]');
ok('B joined guild', await waitFor(async () => (await db.query('SELECT 1 FROM guild_members WHERE character_id=$1', [B.id])).rowCount === 1));
await waitFor(async () => A.p.$('[data-a="guild/rank"][data-rank="officer"]'));
await A.p.click('[data-a="guild/rank"][data-rank="officer"]');
ok('B promoted to officer', await waitFor(async () => (await db.query('SELECT rank FROM guild_members WHERE character_id=$1', [B.id])).rows[0]?.rank === 'officer'));
ok('panel shows オフィサー', await waitFor(async () => (await A.p.textContent('#social')).includes('オフィサー')));
await shot(A, 'phase9-guild-roles.png');
await A.p.click('[data-a="guild/transfer"]'); await A.p.click('#c-ok');
ok('leadership transferred to B', await waitFor(async () => (await db.query('SELECT rank FROM guild_members WHERE character_id=$1', [B.id])).rows[0]?.rank === 'leader'));
await waitFor(async () => B.p.$('[data-a="guild/disband"]'));
await B.p.click('[data-a="guild/disband"]'); await B.p.fill('#c-input', '違う名前'); await B.p.click('#c-ok');
ok('disband with wrong name rejected', await waitFor(async () => (await B.p.textContent('#social .p4-msg')).includes('一致しません')));
await B.p.click('[data-a="guild/disband"]'); await B.p.fill('#c-input', gname); await B.p.click('#c-ok');
ok('guild disbanded', await waitFor(async () => (await db.query('SELECT 1 FROM guilds WHERE name=$1', [gname])).rowCount === 0));
await B.p.click('#social [data-a="close"]'); await A.p.click('#social [data-a="close"]').catch(() => {});

// --- rankings
await db.query(`UPDATE characters SET level=1 WHERE level=99 AND name LIKE '買%'`); // leftovers of aborted runs
await db.query('UPDATE characters SET level=99 WHERE id=$1', [B.id]);
await new Promise((r) => setTimeout(r, Number(process.env.RK_WAIT ?? 31000))); // ranking cache TTL is 30 s
await press(A, 'r'); await A.p.waitForSelector('#p4.ranking table.rk', { timeout: 8000 });
ok('level ranking: B (Lv99) in the top rows', await waitFor(async () => (await A.p.textContent('table.rk tbody')).includes(B.name)));
await shot(A, 'phase9-ranking.png');
await A.p.click('[data-k="guild"]'); ok('guild ranking tab renders', await waitFor(async () => (await A.p.$$('table.rk thead th')).length === 5));
await A.p.click('[data-k="dungeon"]'); ok('dungeon ranking tab renders', await waitFor(async () => (await A.p.textContent('table.rk thead')).includes('遺跡踏破')));
await db.query('UPDATE characters SET level=1 WHERE id=$1', [B.id]);
ok('no client errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await b.close(); await db.end();
const f = results.filter((r) => !r.pass); console.log(`\n${results.length - f.length}/${results.length} passed`); process.exit(f.length ? 1 : 0);
