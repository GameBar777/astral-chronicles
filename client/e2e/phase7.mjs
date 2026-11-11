// E2E PHASE 7: chat (local/party/guild/system), spam guard, party, friends, guild, in-battle marker — 3 browsers
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
  await p.fill('#email', `e7${tag}_${Date.now()}@example.com`); await p.fill('#pw', 'correct-horse-9'); await p.click('#reg');
  await p.waitForSelector('#new'); await p.click('#new'); await p.waitForSelector('#name');
  const name = tag + kana(Date.now() + k * 7); await p.fill('#name', name); await p.check(`input[value=${cls}]`); await p.click('#create');
  await p.waitForFunction(() => window.__astral?.scene.isActive('World'), null, { timeout: 15000 });
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await p.evaluate(() => { window.__astral.scene.getScene('World').cooldownUntil = 1e12; });
  return { ctx, p, name, id, tp: makeTp(p, db, async () => id) };
}
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } return null; };
const status = (p) => p.evaluate(() => window.__astral.scene.getScene('World').presence?.status);
const tab = (P, t) => P.p.click(`#chat .tabs button[data-t="${t}"]`);
const logText = (P) => P.p.textContent('#chat .log');
const say = async (P, t, text) => { await tab(P, t); await P.p.fill('#chat input', text); await P.p.press('#chat input', 'Enter'); };
const panel = async (P) => { if (!(await P.p.isVisible('#social'))) { await P.p.click('canvas'); await P.p.keyboard.press('o'); } await P.p.waitForSelector('#social .p4-body'); };
const btn = (P, a, txt) => P.p.click(txt ? `#social button[data-a="${a}"]:has-text("${txt}")` : `#social button[data-a="${a}"]`);
const socialTxt = (P) => P.p.textContent('#social');
const tagOf = (P, name) => P.p.evaluate((n) => [...window.__astral.scene.getScene('World').presence.remotes.values()].map((r) => r.tag.text).find((t) => t.includes(n)), name);
const shot = (P, f) => P.p.screenshot({ path: SHOT + f });

const A = await player('甲', 'warrior', 1), B = await player('乙', 'mage', 2), C = await player('丙', 'priest', 3);
ok('3 clients online', await waitFor(async () => (await Promise.all([A, B, C].map((P) => status(P.p)))).every((s) => s === 'online')));
await A.tp(600, 680); await B.tp(680, 680); await C.tp(760, 680);
for (const P of [A, B, C]) { await P.p.keyboard.down('ArrowDown'); await P.p.waitForTimeout(150); await P.p.keyboard.up('ArrowDown'); }

// --- Local chat, real send/receive + escaping
await say(A, 'Local', 'こんにちは<b>太字</b>');
ok('B receives A local chat', await waitFor(async () => (await logText(B)).includes(`${A.name}: こんにちは<b>太字</b>`)));
ok('C receives A local chat', await waitFor(async () => (await logText(C)).includes('こんにちは<b>太字</b>')));
ok('HTML is not interpreted', (await B.p.$$('#chat .log b')).length === 0);
ok('message stored in DB', (await db.query(`SELECT count(*)::int n FROM chat_messages WHERE sender_character_id=$1 AND channel='say'`, [A.id])).rows[0].n === 1);
await shot(B, 'phase7-chat-local.png');

// --- Party: invite / accept via panel
await panel(A); await A.p.fill('#s-pname', B.name); await btn(A, 'party/invite');
await panel(B); ok('B sees party invite', await waitFor(async () => /パーティー招待/.test(await socialTxt(B))));
await btn(B, 'party/accept', '参加');
ok('A panel shows 2/4 with B', await waitFor(async () => { const t = await socialTxt(A); return t.includes('(2/4)') && t.includes(B.name); }));
ok('B got System notice', /パーティーに招待されました/.test(await B.p.evaluate(() => { const c = document.querySelector('#chat .tabs button[data-t="System"]'); c.click(); return document.querySelector('#chat .log').textContent; })));
// party chat: only members
await say(B, 'Party', 'パーティーへ連絡');
await tab(A, 'Party'); ok('A receives party chat', await waitFor(async () => (await logText(A)).includes('パーティーへ連絡')));
await tab(C, 'Local'); await C.p.waitForTimeout(500); ok('C (non-member) does not', !(await logText(C)).includes('パーティーへ連絡'));
await shot(A, 'phase7-party.png');
await say(C, 'Party', '割り込み'); ok('non-member party send rejected', await waitFor(async () => /パーティーに参加していません/.test(await C.p.textContent('#chat .c-err'))));

// --- Friends A <-> C
await A.p.fill('#s-pname', C.name); await btn(A, 'friends/request');
await panel(C); ok('C sees incoming friend request', await waitFor(async () => (await socialTxt(C)).includes('申請が届いています')));
await btn(C, 'friends/accept', '承認');
ok('A friend list shows C online', await waitFor(async () => (await A.p.evaluate((n) => [...document.querySelectorAll('#social .s-row')].some((r) => r.textContent.includes(n) && r.querySelector('.s-on')), C.name))));
await shot(A, 'phase7-friends.png');

// --- Guild A + C, guild chat
await A.p.fill('#s-gname', 'ギルド' + A.name.slice(1)); await btn(A, 'guild/create');
ok('guild created', await waitFor(async () => (await socialTxt(A)).includes('マスター')));
await A.p.fill('#s-pname', C.name); await btn(A, 'guild/invite');
ok('C sees guild invite', await waitFor(async () => /ギルド招待/.test(await socialTxt(C))));
await btn(C, 'guild/accept', '参加');
await waitFor(async () => (await socialTxt(A)).includes(C.name + ' '));
await say(C, 'Guild', 'ギルドの皆さんへ');
await tab(A, 'Guild'); ok('A receives guild chat', await waitFor(async () => (await logText(A)).includes('ギルドの皆さんへ')));
await tab(B, 'Local'); await B.p.waitForTimeout(400); ok('B (non-member) does not', !(await logText(B)).includes('ギルドの皆さんへ'));
await shot(A, 'phase7-chat-guild.png');

// --- Leader promotion, then System tab read-only
await btn(A, 'party/leader');
ok('B becomes leader (★ shown on B)', await waitFor(async () => B.p.evaluate((n) => [...document.querySelectorAll('#social .s-row')].some((r) => r.textContent.includes(n) && r.querySelector('.s-lead')), B.name)));
await tab(A, 'System'); ok('System tab input is disabled', await A.p.isDisabled('#chat input'));

// --- Spam guard (C floods)
await tab(C, 'Local');
for (let i = 0; i < 9; i++) { await C.p.fill('#chat input', `連投${i}`); await C.p.press('#chat input', 'Enter'); }
ok('flood → muted notice', await waitFor(async () => /発言が制限されています|一時的に発言できません/.test(await C.p.textContent('#chat .c-err'))));
const fl = (await db.query(`SELECT count(*) FILTER (WHERE body LIKE '連投%')::int n, count(*) FILTER (WHERE created_at > now()-interval '10 seconds')::int w FROM chat_messages WHERE sender_character_id=$1`, [C.id])).rows[0];
ok('flood capped: ≤5 msgs per 10s stored', fl.n < 9 && fl.w <= 5, JSON.stringify(fl));
await shot(C, 'phase7-chat-spam.png');

// --- In-battle marker: A and B to the meadow, A starts a battle, B sees [戦闘中]
for (const [P, x] of [[A, 330], [B, 520]]) {
  await P.tp(x, 300, 'green_meadow');
  await P.p.evaluate(([x]) => { const s = window.__astral.scene.getScene('World'); s.scene.restart({ character: { ...s.character, map_id: 'green_meadow', pos_x: x, pos_y: 300 } }); }, [x]);
  await P.p.waitForFunction(() => window.__astral.scene.getScene('World').map?.id === 'green_meadow' && window.__astral.scene.getScene('World').presence?.status === 'online', null, { timeout: 8000 });
}
ok('B sees A in meadow (no [戦闘中])', await waitFor(async () => { const t = await tagOf(B, A.name); return t && !t.includes('[戦闘中]'); }));
await A.p.evaluate(() => { const s = window.__astral.scene.getScene('World'); s.cooldownUntil = 0; return s.encounter(s.symbols[0]); });
await A.p.waitForFunction(() => window.__astral.scene.isActive('Battle'), null, { timeout: 8000 });
ok('B sees [戦闘中] on A name tag (BUG-019)', await waitFor(async () => (await tagOf(B, A.name))?.startsWith('[戦闘中] ')));
await panel(B); ok('B party list shows A 戦闘中', await waitFor(async () => B.p.evaluate((n) => [...document.querySelectorAll('#social .s-row')].some((r) => r.textContent.includes(n) && r.querySelector('.s-bt')), A.name)));
await B.p.keyboard.press('o'); await B.p.waitForTimeout(150); await B.p.click('canvas').catch(() => {}); await B.p.waitForTimeout(300);
await shot(B, 'phase7-in-battle.png');
// end A's battle (flee via API until it ends) and the marker disappears
await A.p.evaluate(async () => { const s = window.__astral.scene.getScene('Battle'); let b = s.b; const tok = sessionStorage.getItem('astral.token');
  for (let i = 0; i < 40 && b.status === 'active'; i++) { const r = await fetch(`/api/battles/${b.id}/action`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ turn: b.turn, command: { type: 'flee' } }) }); b = await r.json(); if (!b.turn) break; } });
ok('[戦闘中] cleared after battle ends', await waitFor(async () => { const t = await tagOf(B, A.name); return t && !t.includes('[戦闘中]'); }));

// --- History: B reloads and sees earlier party chat + system notices
await B.p.reload(); await B.p.waitForSelector('.play', { timeout: 10000 }); await B.p.click('.play');
await B.p.waitForFunction(() => window.__astral?.scene.isActive('World'), null, { timeout: 15000 }).catch(() => {});
await B.p.waitForTimeout(800); await tab(B, 'Party');
ok('history restored after reload', await waitFor(async () => (await logText(B)).includes('パーティーへ連絡')));

ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await b.close(); await db.end();
const f = results.filter((r) => !r.pass); console.log(`\n${results.length - f.length}/${results.length} passed`); process.exit(f.length ? 1 : 0);
