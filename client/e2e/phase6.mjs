// E2E PHASE 6: two browsers in the shared town room see each other (sprite + name tag), movement sync, reconnect
import { chromium } from 'playwright';
import { newDb, makeTp } from './lib.mjs';
const URL = process.env.E2E_URL ?? 'http://127.0.0.1:5173/';
const SHOT = new globalThis.URL('../../docs/screenshots/', import.meta.url).pathname;
const db = newDb();
const results = []; const ok = (name, cond, info = '') => { results.push({ name, pass: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${info}`); };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const kana = (n) => String.fromCharCode(0x30a2 + (n % 40), 0x30a2 + (Math.floor(n / 40) % 40), 0x30a2 + (Math.floor(n / 1600) % 40));
async function player(tag, cls, k) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(tag + ': ' + e)); p.on('console', (m) => m.type() === 'error' && !/status of 4(00|09)/.test(m.text()) && errors.push(tag + ': ' + m.text()));
  await p.goto(URL); await p.waitForSelector('#email');
  await p.fill('#email', `e6${tag}_${Date.now()}@example.com`); await p.fill('#pw', 'correct-horse-9'); await p.click('#reg');
  await p.waitForSelector('#new'); await p.click('#new'); await p.waitForSelector('#name');
  const name = tag + kana(Date.now() + k * 7); await p.fill('#name', name); await p.check(`input[value=${cls}]`); await p.click('#create');
  await p.waitForFunction(() => window.__astral?.scene.isActive('World'), null, { timeout: 15000 });
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await p.evaluate(() => { window.__astral.scene.getScene('World').cooldownUntil = 1e12; });
  return { ctx, p, name, id, tp: makeTp(p, db, async () => id) };
}
const status = (p) => p.evaluate(() => window.__astral.scene.getScene('World').presence?.status);
const remotes = (p) => p.evaluate(() => [...window.__astral.scene.getScene('World').presence.remotes.values()].map((r) => ({ name: r.tag.text, x: r.spr.x, y: r.spr.y, tx: r.tx, ty: r.ty, key: r.spr.texture.key, vis: r.spr.visible })));
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } return null; };

const A = await player('甲', 'warrior', 1), B = await player('乙', 'mage', 2);
ok('both clients joined the room', await waitFor(async () => (await status(A.p)) === 'online' && (await status(B.p)) === 'online'));
await A.tp(640, 680); await B.tp(720, 680);
// nudge so the room state carries the teleported positions
for (const P of [A, B]) { await P.p.keyboard.down('ArrowDown'); await P.p.waitForTimeout(200); await P.p.keyboard.up('ArrowDown'); }
const seeB = await waitFor(async () => (await remotes(A.p)).find((r) => r.name === B.name && Math.abs(r.x - 720) < 30));
const seeA = await waitFor(async () => (await remotes(B.p)).find((r) => r.name === A.name && Math.abs(r.x - 640) < 30));
ok('A sees B (sprite + name tag)', seeB && seeB.key === 'ch_mage' && seeB.vis, JSON.stringify(seeB));
ok('B sees A (sprite + name tag)', seeA && seeA.key === 'ch_warrior' && seeA.vis, JSON.stringify(seeA));
await A.p.waitForTimeout(400);
await A.p.screenshot({ path: SHOT + 'phase6-two-clients-a.png' }); await B.p.screenshot({ path: SHOT + 'phase6-two-clients-b.png' });

// movement: A walks right, B observes
const a0 = await A.p.evaluate(() => ({ ...window.__astral.scene.getScene('World').pos }));
await A.p.keyboard.down('ArrowRight'); await A.p.waitForTimeout(700); await A.p.keyboard.up('ArrowRight');
const a1 = await A.p.evaluate(() => ({ ...window.__astral.scene.getScene('World').pos }));
const moved = await waitFor(async () => { const r = (await remotes(B.p)).find((r) => r.name === A.name); return r && Math.abs(r.x - a1.x) < 6 && r; });
ok('B sees A move (server-synced)', a1.x - a0.x > 40 && moved, `a0=${a0.x} a1=${a1.x} seen=${moved?.x}`);
const dbA = (await db.query('SELECT pos_x FROM characters WHERE id=$1', [A.id])).rows[0].pos_x;
ok('moved position persisted by room', Math.abs(dbA - a1.x) < 6, `db=${dbA}`);

// cheat: A forces an impossible jump through the room only -> server corrects, B never sees it
await A.p.evaluate(() => { const s = window.__astral.scene.getScene('World'); s.presence.room.send('move', { x: s.pos.x + 600, y: s.pos.y, facing: 'right', moving: false }); });
await A.p.waitForTimeout(700);
const rb = (await remotes(B.p)).find((r) => r.name === A.name);
ok('teleport move rejected; B keeps legit position', rb && Math.abs(rb.x - a1.x) < 6, `seen=${rb?.x}`);

// disconnect recovery: drop A's socket without consent
await A.p.evaluate(() => window.__astral.scene.getScene('World').presence.room.connection.close(4999));
const went = await waitFor(async () => (await status(A.p)) === 'reconnecting', 3000);
const back = await waitFor(async () => (await status(A.p)) === 'online', 12000);
ok('A reconnects after drop', went && back);
const stillB = await waitFor(async () => (await remotes(A.p)).find((r) => r.name === B.name));
const stillA = (await remotes(B.p)).filter((r) => r.name === A.name).length;
ok('after reconnect A still sees B, B sees A once', stillB && stillA === 1, `dupA=${stillA}`);

// reload B (full page): B leaves then rejoins via login session; A sees B again
await B.p.reload(); await B.p.waitForSelector("button.play", { timeout: 15000 }); await B.p.click("button.play");

const rejoined = await waitFor(async () => B.p.evaluate(() => window.__astral?.scene?.isActive?.('World') && window.__astral.scene.getScene('World').presence?.status === 'online').catch(() => false), 15000);
const againB = await waitFor(async () => (await remotes(A.p)).filter((r) => r.name === B.name).length === 1);
ok('B reload/rejoin visible to A (no ghost)', rejoined && againB, `rejoined=${!!rejoined}`);

// leave: B logs off -> A no longer sees B
await B.ctx.close();
const gone = await waitFor(async () => !(await remotes(A.p)).some((r) => r.name === B.name), 25000);
ok('closed client disappears for others', gone);
ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await b.close(); await db.end();
const f = results.filter((r) => !r.pass).length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
