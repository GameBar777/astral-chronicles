// E2E PHASE 8: instance dungeon 古代地下遺跡 — 3 browsers: party entry, floors, chests, party battle sync, disconnect/reconnect, phased boss, clear rewards, leave
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
  await p.fill('#email', `e8${tag}_${Date.now()}@example.com`); await p.fill('#pw', 'correct-horse-9'); await p.click('#reg');
  await p.waitForSelector('#new'); await p.click('#new'); await p.waitForSelector('#name');
  const name = tag + kana(Date.now() + k * 7); await p.fill('#name', name); await p.check(`input[value=${cls}]`); await p.click('#create');
  await p.waitForFunction(() => window.__astral?.scene.isActive('World'), null, { timeout: 15000 });
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  return { ctx, p, name, id, tag, tp: makeTp(p, db, async () => id) };
}
const waitFor = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } return null; };
const api = (P, method, path, body) => P.p.evaluate(async ([m, u, bd]) => { const r = await fetch('/api' + u, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + sessionStorage.getItem('astral.token') }, body: bd ? JSON.stringify(bd) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [method, path, body]);
const active = (P, s) => P.p.evaluate((s) => window.__astral.scene.isActive(s), s);
const shot = (P, f) => P.p.screenshot({ path: SHOT + f });
const dungeonOf = async (P) => (await api(P, 'GET', `/characters/${P.id}/dungeon`)).body?.dungeon;
const gold = async (P) => Number((await db.query('SELECT gold FROM characters WHERE id=$1', [P.id])).rows[0].gold);

const A = await player('甲', 'warrior', 1), B = await player('乙', 'priest', 2), C = await player('丙', 'mage', 3);
const ALL = [A, B, C];
// party via the PHASE 7 API
await api(A, 'POST', `/characters/${A.id}/party/invite`, { name: B.name }); await api(A, 'POST', `/characters/${A.id}/party/invite`, { name: C.name });
for (const P of [B, C]) { const inv = (await api(P, 'GET', `/characters/${P.id}/social`)).body.invites.find((i) => i.kind === 'party'); await api(P, 'POST', `/characters/${P.id}/party/accept`, { partyId: inv.partyId ?? inv.scope_id ?? inv.id }); }
ok('party of 3 formed', (await api(A, 'GET', `/characters/${A.id}/social`)).body.party?.members?.length === 3);
// test-only stat boost so the run finishes in minutes (balance is not what this E2E measures)
for (const [i, P] of ALL.entries()) await db.query(`UPDATE characters SET map_id='green_meadow', pos_x=$2, pos_y=600 WHERE id=$1`, [P.id, i === 2 ? 1100 : 1380 + i * 40]);
for (const P of ALL) { await P.p.reload(); await P.p.waitForSelector('.play'); await P.p.click('.play'); await P.p.waitForFunction(() => window.__astral?.scene.isActive('World'), null, { timeout: 15000 }); await P.p.evaluate(() => { window.__astral.scene.getScene('World').cooldownUntil = 1e12; }); }
ok('all online in meadow', await waitFor(async () => (await Promise.all(ALL.map((P) => P.p.evaluate(() => window.__astral.scene.getScene('World').presence?.status)))).every((s) => s === 'online')));

// guard: non-leader B too far / C entering alone is fine rule-wise, but leader-first is the normal path; check too_far
ok('entry rejected when far (too_far)', (await api(C, 'POST', `/characters/${C.id}/dungeon/enter`, { dungeonId: 'ancient_ruins' })).body?.error === 'too_far');
// --- A walks to the entrance and presses E
await A.tp(1424, 590); await A.p.waitForTimeout(400);
await A.p.keyboard.down('ArrowUp'); await A.p.waitForTimeout(250); await A.p.keyboard.up('ArrowUp'); await A.p.waitForTimeout(300);
ok('entrance prompt shown', await waitFor(async () => A.p.evaluate(() => { const s = window.__astral.scene.getScene('World'); return s.prompt.visible && s.prompt.text.includes('入場'); }), 4000));
await shot(A, 'phase8-entrance.png');
await A.p.keyboard.press('e'); await A.p.waitForSelector('#c-ok'); await shot(A, 'phase8-entry-confirm.png'); await A.p.click('#c-ok');
ok('A in DungeonScene', await waitFor(() => active(A, 'Dungeon')));
ok('B pulled in by push', await waitFor(() => active(B, 'Dungeon')));
ok('C pulled in by push', await waitFor(() => active(C, 'Dungeon')));
ok('panel shows 3 members online', await waitFor(async () => (await A.p.$$('#dungeon .d-m:not(.off)')).length === 3));
ok('one active instance in DB', (await db.query(`SELECT count(DISTINCT instance_id)::int n FROM dungeon_members WHERE character_id=ANY($1) AND left_at IS NULL`, [ALL.map((P) => P.id)])).rows[0].n === 1);
ok('chest locked before fight', await A.p.isDisabled('#d-chest'));
await A.p.waitForTimeout(500); await shot(A, 'phase8-dungeon-f1.png');
const nl = await api(B, 'POST', `/characters/${B.id}/dungeon/next`); ok('stairs locked (gate_not_cleared / not_leader)', ['gate_not_cleared', 'not_leader'].includes(nl.body?.error), nl.body?.error);

// --- party battle driver: everyone attacks whenever a command menu is shown
async function fight(label, during) {
  const t0 = Date.now(); let n = 0, waitingSeen = false;
  while (Date.now() - t0 < 180000) {
    let allDone = true;
    for (const P of ALL) {
      if (P.away) continue;
      const st = await P.p.evaluate(() => { const s = window.__astral.scene.getScene('Battle'); const on = window.__astral.scene.isActive('Battle');
        return { on, status: on ? s.b.status : null, busy: on && s.busy, cmd: !!document.querySelector('#b-cmd button[data-c="attack"]:not([disabled])'), wait: !!document.querySelector('#b-wait'), close: !!document.querySelector('#b-close') }; }).catch(() => ({}));
      if (st.wait) waitingSeen = true;
      if (st.on && st.status === 'active') allDone = false;
      if (st.on && st.cmd && !st.busy) { await P.p.click('#b-cmd button[data-c="attack"]').catch(() => {}); await P.p.waitForTimeout(120); const t = await P.p.$('#b-cmd button[data-t]'); if (t) await t.click().catch(() => {}); n++; if (P.returned) P.actedAfter = true; }
    }
    if (during) await during(n);
    if (allDone && n > 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return { n, waitingSeen, ms: Date.now() - t0 };
}
async function closeAll() { for (const P of ALL) { if (P.away) continue; await P.p.waitForSelector('#b-close', { timeout: 15000 }).catch(() => {}); await P.p.click('#b-close').catch(() => {}); } await A.p.waitForTimeout(800); }

// F1
await db.query(`UPDATE character_stats SET max_hp=800,hp=800,max_mp=80,mp=80,atk=48,def=45,matk=40 WHERE character_id = ANY($1)`, [ALL.map((P) => P.id)]);
ok('stat boost applied', (await db.query('SELECT max_hp FROM character_stats WHERE character_id=$1', [A.id])).rows[0].max_hp === 800);
await A.p.click('#d-battle');
ok('all 3 opened the same battle', await waitFor(async () => { const ids = await Promise.all(ALL.map((P) => P.p.evaluate(() => window.__astral.scene.isActive('Battle') && window.__astral.scene.getScene('Battle').b.id))); return ids[0] && ids.every((x) => x === ids[0]); }));
// first turn: only A acts -> waiting UI on A, B/C get battle_wait
await A.p.waitForSelector('#b-cmd button[data-c="attack"]'); await A.p.click('#b-cmd button[data-c="attack"]'); await A.p.waitForTimeout(150); { const t = await A.p.$('#b-cmd button[data-t]'); if (t) await t.click(); }
ok('A sees party waiting UI', await waitFor(async () => A.p.isVisible('#b-wait'), 4000));
await A.p.waitForTimeout(300); await shot(A, 'phase8-party-battle-wait.png');
await B.p.waitForTimeout(200); await shot(B, 'phase8-party-battle-3players.png');
const f1 = await fight('F1');
ok('F1 battle won by party', (await db.query(`SELECT result FROM battle_logs WHERE dungeon_instance_id IS NOT NULL AND participants @> ARRAY[$1]::uuid[] ORDER BY started_at DESC LIMIT 1`, [A.id])).rows[0]?.result === 'victory', `${f1.n} cmds ${f1.ms}ms`);
await shot(C, 'phase8-party-victory.png');
await closeAll();
ok('back in dungeon after battle', await waitFor(async () => (await Promise.all(ALL.map((P) => active(P, 'Dungeon')))).every(Boolean)));
// chest: each member once; concurrent double-claim guarded
const g0 = await gold(B);
const [c1, c2] = await Promise.all([api(B, 'POST', `/characters/${B.id}/dungeon/chest`), api(B, 'POST', `/characters/${B.id}/dungeon/chest`)]);
ok('concurrent chest claim: exactly one succeeds', [c1.status, c2.status].sort().join() === '200,409', `${c1.status},${c2.status}`);
{ const g1 = await gold(B); ok('B gold +40 once', g1 === g0 + 40, `${g0}->${g1} ${JSON.stringify([c1.body, c2.body])}`); }
await A.p.click('#d-chest'); ok('A chest message', await waitFor(async () => (await A.p.textContent('#dungeon .d-msg')).includes('宝箱')));
await A.p.waitForTimeout(300); await shot(A, 'phase8-chest.png');
await C.p.click('#d-chest'); await C.p.waitForTimeout(500);
ok('chest tx rows = 3 (one per member)', (await db.query(`SELECT count(*)::int n FROM transactions WHERE character_id=ANY($1) AND idempotency_key LIKE 'dungeon:%:chest:1'`, [ALL.map((P) => P.id)])).rows[0].n === 3);
ok('B now sees chest as claimed', await waitFor(async () => { await B.p.evaluate(() => window.__astral.scene.getScene('Dungeon').refresh()); return B.p.isDisabled('#d-chest'); }));
await A.p.click('#d-next');
ok('all on floor 2', await waitFor(async () => (await Promise.all(ALL.map((P) => P.p.textContent('#dungeon .d-floor')))).every((t) => t.includes('2/3'))));

// F2 with a disconnect: C drops mid-battle, party keeps going, C comes back into the same battle
await A.p.click('#d-battle');
await waitFor(async () => (await Promise.all(ALL.map((P) => active(P, 'Battle')))).every(Boolean));
const f2 = await fight('F2');
ok('F2 won', (await db.query(`SELECT result FROM battle_logs WHERE dungeon_instance_id IS NOT NULL AND participants @> ARRAY[$1]::uuid[] ORDER BY started_at DESC LIMIT 1`, [A.id])).rows[0]?.result === 'victory', `${f2.ms}ms`);
await closeAll();
await A.p.waitForTimeout(500); await shot(A, 'phase8-floor2-after.png');
await A.p.click('#d-next');
ok('all on boss floor', await waitFor(async () => (await Promise.all(ALL.map((P) => P.p.textContent('#dungeon .d-floor').catch(() => '')))).every((t) => t.includes('3/3'))));
await A.p.waitForTimeout(500); await shot(A, 'phase8-boss-floor.png');

// F3 boss (re-apply the test boost: the F2 level-up recomputed stats from the base formula)
await db.query(`UPDATE character_stats SET max_hp=800,hp=800,max_mp=80,mp=80,atk=26,def=45,matk=26 WHERE character_id = ANY($1)`, [ALL.map((P) => P.id)]);
await A.p.click('#d-battle');
await waitFor(async () => (await Promise.all(ALL.map((P) => active(P, 'Battle')))).every(Boolean));
await B.p.waitForTimeout(600); await shot(B, 'phase8-boss-battle.png');
let p2shot = false;
let dropped = false, back = false, dropTurn = 0;
const f3 = await fight('boss', async (n) => {
  if (!p2shot && (await B.p.evaluate(() => !!window.__astral.scene.getScene('Battle').children.getByName('phase_banner')))) { p2shot = true; await shot(B, 'phase8-boss-phase.png'); }
  if (!dropped && n >= 2) { dropped = true; C.away = true; await C.p.goto('about:blank'); dropTurn = n; C.dropT = (await db.query(`SELECT (state->>'turn')::int t FROM battle_logs WHERE participants @> ARRAY[$1]::uuid[] ORDER BY started_at DESC LIMIT 1`, [C.id])).rows[0].t; }
  if (dropped && !back && n >= dropTurn + 4) {
    back = true; await C.p.goto(URL); await C.p.waitForSelector('.play', { timeout: 30000 }).catch(async (e) => { await C.p.screenshot({ path: '/tmp/c-fail.png' }); throw e; }); await C.p.click('.play');
    C.offTurns = (await db.query(`SELECT (state->>'turn')::int t FROM battle_logs WHERE participants @> ARRAY[$1]::uuid[] ORDER BY started_at DESC LIMIT 1`, [C.id])).rows[0].t - C.dropT;
    C.backOk = await waitFor(async () => (await active(C, 'Battle')) || (await active(C, 'Dungeon')), 15000); C.away = false; C.returned = true;
    C.dbg = await C.p.evaluate(() => window.__astral.scene.getScenes(true).map((s) => s.scene.key));
    C.inBattleBack = await waitFor(() => active(C, 'Battle'), 8000); C.nBack = n; if (C.inBattleBack) { await C.p.waitForTimeout(600); await shot(C, 'phase8-reconnect-battle.png'); }
  }
});
ok('A/B kept fighting while C was offline', dropped && C.offTurns > 0, `turns while offline: ${C.offTurns}`);
ok('C reconnected into the running boss battle', back && C.inBattleBack, JSON.stringify(C.dbg));
ok('C acted again after reconnect', C.actedAfter);
ok('boss fight won', (await db.query(`SELECT result FROM battle_logs WHERE dungeon_instance_id IS NOT NULL AND participants @> ARRAY[$1]::uuid[] ORDER BY started_at DESC LIMIT 1`, [A.id])).rows[0]?.result === 'victory', `${f3.ms}ms`);
const phases = await B.p.evaluate(() => window.__astralPhases ?? []);
ok('boss phase 2 and 3 reached', phases.includes(2) && phases.includes(3), JSON.stringify(phases));
ok('boss defeated', (await db.query(`SELECT status FROM dungeon_instances i JOIN dungeon_members m ON m.instance_id=i.id WHERE m.character_id=$1 ORDER BY i.started_at DESC LIMIT 1`, [A.id])).rows[0]?.status === 'cleared', `${f3.n} cmds ${f3.ms}ms`);
await A.p.waitForTimeout(400); await shot(A, 'phase8-boss-victory.png');
await closeAll();
// clear reward: all three, once
const gs = await Promise.all(ALL.map(gold));
for (const P of ALL) { await P.p.waitForSelector('#d-claim:not([disabled])', { timeout: 10000 }); await P.p.click('#d-claim'); await P.p.waitForTimeout(500); }
await shot(A, 'phase8-clear-reward.png');
const gs2 = await Promise.all(ALL.map(gold));
ok('each member got clear gold +300', gs2.every((g, i) => g === gs[i] + 300), JSON.stringify([gs, gs2]));
const again = await api(A, 'POST', `/characters/${A.id}/dungeon/claim`); ok('second clear claim rejected', again.body?.error === 'already_claimed');
ok('clear tx exactly once per member', (await db.query(`SELECT count(*)::int n FROM transactions WHERE character_id=ANY($1) AND idempotency_key LIKE 'dungeon:%:clear'`, [ALL.map((P) => P.id)])).rows[0].n === 3);
// leave
for (const P of ALL) { await P.p.click('#d-leave'); }
ok('all back in World', await waitFor(async () => (await Promise.all(ALL.map((P) => active(P, 'World')))).every(Boolean)));
ok('no active membership left', (await db.query(`SELECT count(*)::int n FROM dungeon_members WHERE character_id=ANY($1) AND left_at IS NULL`, [ALL.map((P) => P.id)])).rows[0].n === 0);
await A.p.waitForTimeout(800); await shot(A, 'phase8-back-world.png');
ok('no client errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await b.close(); await db.end();
const f = results.filter((r) => !r.pass); console.log(`\n${results.length - f.length}/${results.length} passed`); process.exit(f.length ? 1 : 0);
