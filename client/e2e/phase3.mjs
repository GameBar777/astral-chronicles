// E2E PHASE 3: town -> meadow portal, monster symbols, server battle (commands, log, popups), reload-resume,
// victory rewards + LEVEL UP effect, duplicate-turn rejection, HUD refresh, return to field.
import { chromium } from 'playwright';
import pg from 'pg';
import { makeTp } from './lib.mjs';
const URL = process.env.E2E_URL ?? 'http://127.0.0.1:5173/';
const SHOT = new globalThis.URL('../../docs/screenshots/', import.meta.url).pathname;
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://astral:astral_dev_pw@127.0.0.1:5433/astral' });
const results = []; const ok = (name, cond, info = '') => { results.push({ name, pass: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${info}`); };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errors = []; p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => m.type() === 'error' && !/status of 4(00|09)/.test(m.text()) && errors.push(m.text()));
await p.goto(URL); await p.waitForSelector('#email');
await p.fill('#email', `e3_${Date.now()}@example.com`); await p.fill('#pw', 'correct-horse-9'); await p.click('#reg');
await p.waitForSelector('#new'); await p.click('#new'); await p.waitForSelector('#name');
const name = 'バトル' + String.fromCharCode(0x30a2 + (Date.now() % 40), 0x30a2 + (Math.floor(Date.now() / 40) % 40), 0x30a2 + (Math.floor(Date.now() / 1600) % 40));
await p.fill('#name', name); await p.check('input[value=warrior]'); await p.click('#create');
await p.waitForFunction(() => window.__astral?.scene.isActive('World'), null, { timeout: 15000 }); await p.waitForTimeout(600);
const world = () => p.evaluate(() => { const s = window.__astral.scene.getScene('World'); return { map: s.map.id, x: s.pos.x, y: s.pos.y, symbols: s.symbols.length, inBattle: s.inBattle, lv: s.character.level, gold: s.character.gold }; });
const charId = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
// east exit -> meadow
const tp = makeTp(p, db, async () => charId);
await tp(42.2 * 32, 17.6 * 32);
await p.keyboard.down('ArrowRight'); await p.waitForTimeout(700); await p.keyboard.up('ArrowRight');
await p.waitForFunction(() => window.__astral.scene.getScene('World').map?.id === 'green_meadow' && !window.__astral.scene.getScene('World').inBattle, null, { timeout: 5000 });
await p.waitForTimeout(900); let w = await world();
ok('east portal -> green_meadow', w.map === 'green_meadow', JSON.stringify(w));
ok('monster symbols roam in meadow', w.symbols >= 5, `symbols=${w.symbols}`);
// walk a bit for a natural field shot, symbols moved close to the camera for framing
await tp(14 * 32, 17.5 * 32);
await p.evaluate(() => { const s = window.__astral.scene.getScene('World'); s.cooldownUntil = 1e12;
  s.symbols.slice(0, 4).forEach((m, i) => { m.pos = [{ x: 18 * 32, y: 14 * 32 }, { x: 10 * 32, y: 20 * 32 }, { x: 19 * 32, y: 21 * 32 }, { x: 9 * 32, y: 13.5 * 32 }][i]; }); });
await p.waitForTimeout(700); await p.screenshot({ path: SHOT + 'phase3-meadow.png' });
// near level-up: Lv1 needs 100 EXP; slime gives 8 => set 95
await db.query('UPDATE characters SET exp=95 WHERE id=$1', [charId]);
await p.evaluate(() => { const s = window.__astral.scene.getScene('World'); s.character.exp = 95; });
// touch a symbol (the server decides the actual encounter; touched symbol = lead)
await p.evaluate(() => { const s = window.__astral.scene.getScene('World'); s.cooldownUntil = 0; const m = s.symbols[0]; m.id = 'slime'; m.pos = { x: s.pos.x + 4, y: s.pos.y }; m.v = { x: 0, y: 0 }; m.t = 1e9; });
await p.waitForFunction(() => window.__astral.scene.isActive('Battle'), null, { timeout: 6000 });
await p.waitForSelector('#b-cmd button'); await p.waitForTimeout(900);
const bs = () => p.evaluate(() => { const s = window.__astral.scene.getScene('Battle'); return { id: s.b.id, turn: s.b.turn, status: s.b.status, enemies: s.b.combatants.filter((c) => c.side === 'enemy').map((c) => ({ id: c.id, m: c.monsterId, hp: c.hp, max: c.maxHp })), me: s.b.combatants.find((c) => c.side === 'player') }; });
let B = await bs();
ok('battle started by touching symbol; lead = slime', B.enemies[0].m === 'slime' && B.status === 'active', JSON.stringify(B.enemies));
// FIX(phase3 flake): a crit could kill the lone slime on turn 1, ending the battle so the reload-resume step timed out. Make enemies tanky server-side.
await db.query(`UPDATE battle_logs SET state = jsonb_set(state, '{combatants}', (SELECT jsonb_agg(CASE WHEN c->>'side'='enemy' THEN c || '{"hp":300}' ELSE c END) FROM jsonb_array_elements(state->'combatants') c)) WHERE id=$1`, [B.id]);
B.enemies.forEach((e) => (e.hp = 300));
ok('command menu has 攻撃/スキル/アイテム/防御/逃走', (await p.$$eval('#b-cmd button', (x) => x.map((e) => e.textContent).join(','))).match(/攻撃.*スキル.*アイテム.*防御.*逃走/));
// turn 1: attack (choose target if several)
const clickCmd = async (label) => { await p.click(`#b-cmd button:has-text("${label}")`); };
const pickFirstTarget = async () => { if (await p.$('#b-cmd button[data-t]')) await p.click('#b-cmd button[data-t]'); };
await clickCmd('攻撃'); await pickFirstTarget();
await p.waitForFunction((t) => window.__astral.scene.getScene('Battle').b.turn > t && !window.__astral.scene.getScene('Battle').busy, B.turn, { timeout: 15000 });
let B2 = await bs();
ok('attack resolved on server: enemy HP dropped, turn advanced', B2.turn === 2 && (B2.enemies.some((e, i) => e.hp < B.enemies[i].hp) || B2.status !== 'active'), JSON.stringify(B2));
const logTxt = await p.textContent('#b-log'); ok('battle log shows damage text', /ダメージ|たおした/.test(logTxt), logTxt.slice(0, 80));
await p.screenshot({ path: SHOT + 'phase3-battle.png' });
// item: やくそう (starter x3) -> inventory decremented in DB
if (B2.status === 'active') {
  await clickCmd('アイテム'); await p.waitForSelector('#b-cmd button[data-i]');
  ok('starter potions listed', /やくそう.*×3/.test(await p.textContent('#b-cmd')));
  await p.click('#b-cmd button[data-i]');
  await p.waitForFunction(() => window.__astral.scene.getScene('Battle').b.turn === 3 && !window.__astral.scene.getScene('Battle').busy, null, { timeout: 15000 });
  ok('item consumed server-side', (await db.query(`SELECT sum(quantity)::int n FROM inventory WHERE character_id=$1 AND item_id='potion_small'`, [charId])).rows[0].n === 2);
}
// disconnect: reload page mid-battle -> resume same battle from server state
B = await bs();
await p.reload(); await p.waitForSelector('.play', { timeout: 15000 }); await p.click('.play');
await p.waitForFunction(() => window.__astral?.scene.isActive('Battle'), null, { timeout: 10000 }); await p.waitForSelector('#b-cmd button'); await p.waitForTimeout(500);
let R = await bs();
ok('reload mid-battle resumes same battle/turn/HP', R.id === B.id && R.turn === B.turn && JSON.stringify(R.enemies) === JSON.stringify(B.enemies), `turn ${R.turn}`);
ok('resume notice in log', /再開/.test(await p.textContent('#b-log')));
// make the win quick (stats are snapshotted in battle state; boost it there server-side via DB to finish) and finish
await db.query(`UPDATE battle_logs SET state = jsonb_set(state, '{combatants,0,atk}', '999') WHERE id=$1`, [R.id]);
for (let i = 0; i < 6 && (await bs()).status === 'active'; i++) {
  await p.evaluate(() => window.__astral.scene.getScene('Battle').loadInventory()); const t = (await bs()).turn;
  await clickCmd('攻撃'); await pickFirstTarget();
  await p.waitForFunction((t) => { const s = window.__astral.scene.getScene('Battle'); return (s.b.turn > t || s.b.status !== 'active') && !s.busy; }, t, { timeout: 15000 });
}
await p.waitForSelector('#b-result', { timeout: 10000 }); await p.waitForSelector('#lu-box', { timeout: 6000 }).catch(() => {});
await p.waitForTimeout(1100);
const res = await p.textContent('#b-result');
ok('victory result window shows EXP/GOLD/drops', /勝利/.test(res) && /EXP/.test(res) && /GOLD/.test(res) && /ドロップ/.test(res), res.replace(/\s+/g, ' ').slice(0, 120));
ok('LEVEL UP effect + stat diff shown', /ステータス上昇/.test(res) && /最大HP/.test(res) && await p.evaluate(() => window.__astral.scene.getScene('Battle').children.list.some((o) => o.text === 'LEVEL UP!')));
await p.screenshot({ path: SHOT + 'phase3-levelup.png' });
const row = (await db.query('SELECT c.level,c.exp,c.gold FROM characters c WHERE id=$1', [charId])).rows[0];
ok('DB: level 2, gold granted', row.level === 2 && Number(row.gold) > 0, JSON.stringify(row));
// duplicate submission of the last turn must be rejected and not pay twice
const token = await p.evaluate(() => sessionStorage.getItem('astral.token'));
const dup = await fetch('http://127.0.0.1:2567/api/battles/' + R.id + '/action', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ turn: (await bs()).turn - 1, command: { type: 'attack', target: 'e0' } }) });
ok('re-submit after victory rejected (409)', dup.status === 409);
ok('gold unchanged after re-submit', Number((await db.query('SELECT gold FROM characters WHERE id=$1', [charId])).rows[0].gold) === Number(row.gold));
ok('exactly one reward transaction', (await db.query(`SELECT count(*)::int n FROM transactions WHERE idempotency_key=$1`, ['battle:' + R.id])).rows[0].n === 1);
// back to field, HUD refreshed
await p.click('#b-close');
await p.waitForFunction(() => !window.__astral.scene.isActive('Battle') && !window.__astral.scene.getScene('World').inBattle && window.__astral.scene.getScene('World').map?.id === 'green_meadow', null, { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(800);
w = await world();
ok('returned to meadow field', w.map === 'green_meadow' && w.lv === 2, JSON.stringify(w));
ok('HUD shows Lv.2', await p.evaluate(() => window.__astral.scene.getScene('Hud').children.list.some((o) => o.text?.includes('Lv.2'))));
await p.screenshot({ path: SHOT + 'phase3-after.png' });
// west portal back to town
await p.evaluate(() => { window.__astral.scene.getScene('World').cooldownUntil = 1e12; }); await tp(1.6 * 32, 17.6 * 32);
await p.keyboard.down('ArrowLeft'); await p.waitForTimeout(600); await p.keyboard.up('ArrowLeft');
await p.waitForFunction(() => window.__astral.scene.getScene('World').map?.id === 'asteria', null, { timeout: 5000 }).catch(() => {});
ok('west portal -> asteria', (await world()).map === 'asteria');
ok('no page errors', errors.length === 0, errors.join(' | '));
await b.close(); await db.end();
const f = results.filter((r) => !r.pass).length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
