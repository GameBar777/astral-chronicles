// E2E PHASE 5: NPC dialogue, shop buy/sell, inn, quests (hunt/gather/delivery/daily), double-reward guard
import { chromium } from 'playwright';
import { newDb, makeTp } from './lib.mjs';
const URL = process.env.E2E_URL ?? 'http://127.0.0.1:5173/';
const SHOT = new globalThis.URL('../../docs/screenshots/', import.meta.url).pathname;
const db = newDb();
const results = []; const ok = (name, cond, info = '') => { results.push({ name, pass: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${info}`); };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errors = []; p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => m.type() === 'error' && !/status of 4(00|09)/.test(m.text()) && errors.push(m.text()));
await p.goto(URL); await p.waitForSelector('#email');
await p.fill('#email', `e5_${Date.now()}@example.com`); await p.fill('#pw', 'correct-horse-9'); await p.click('#reg');
await p.waitForSelector('#new'); await p.click('#new'); await p.waitForSelector('#name');
const n = Date.now(); const name = '依頼' + String.fromCharCode(0x30a2 + (n % 40), 0x30a2 + (Math.floor(n / 40) % 40), 0x30a2 + (Math.floor(n / 1600) % 40));
await p.fill('#name', name); await p.check('input[value=warrior]'); await p.click('#create');
await p.waitForFunction(() => window.__astral?.scene.isActive('World'), null, { timeout: 15000 }); await p.waitForTimeout(800);
const charId = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
const tp = makeTp(p, db, async () => charId);
const W = () => p.evaluate(() => { const s = window.__astral.scene.getScene('World'); return { map: s.map.id, x: s.pos.x, y: s.pos.y, frame: s.player.frame.name }; });
const eqRow = async (item) => (await db.query('SELECT count(*)::int n FROM character_equipment e JOIN inventory i ON i.id=e.inventory_id WHERE e.character_id=$1 AND i.item_id=$2', [charId, item])).rows[0].n > 0;
await p.evaluate(() => { window.__astral.scene.getScene('World').cooldownUntil = 1e12; });


const NPC = { mira: [352, 736], hana: [1008, 825.6], bram: [688, 435.2], gord: [976, 339.2], leon: [582.4, 620.8] };
const talk = async (k) => { await tp(NPC[k][0], NPC[k][1] + 36); await p.waitForTimeout(350); await p.keyboard.press('e'); await p.waitForSelector('#p4.dlg'); };
const advance = async () => { while (await p.$('#p4 [data-o="next"]')) { await p.click('#p4 [data-o="next"]'); await p.waitForTimeout(80); } };
const gold = async () => Number((await db.query('SELECT gold FROM characters WHERE id=$1', [charId])).rows[0].gold);
const cnt = async (item) => (await db.query('SELECT coalesce(sum(quantity),0)::int n FROM inventory WHERE character_id=$1 AND item_id=$2', [charId, item])).rows[0].n;
const close = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(150); };
const qStatus = async (q) => (await db.query('SELECT status, times_completed t FROM character_quests WHERE character_id=$1 AND quest_id=$2', [charId, q])).rows[0];
await db.query('UPDATE characters SET gold=500 WHERE id=$1', [charId]);
const shown = await p.evaluate(() => window.__astral.scene.getScene('World').children.list.filter((o) => o.texture?.key?.startsWith('ch_npc_')).map((o) => o.texture.key));
ok('npc sprites rendered (shop/inn/chief/smith)', ['ch_npc_shop', 'ch_npc_inn', 'ch_npc_chief', 'ch_npc_smith'].every((k) => shown.includes(k)), shown.join(','));
await tp(NPC.bram[0], NPC.bram[1] + 40); await p.waitForTimeout(400); await p.screenshot({ path: SHOT + 'phase5-town-npcs.png' });

// dialogue + shop
await talk('mira');
ok('dialogue window shows NPC line', /いらっしゃいませ/.test(await p.textContent('#p4 .dlg-text')));
await p.screenshot({ path: SHOT + 'phase5-dialogue.png' });
await p.click('#p4 [data-o="shop"]'); await p.waitForSelector('#p4 [data-b]');
const g0 = await gold(), pot0 = await cnt('potion_small');
await p.click('#p4 [data-b="potion_small"]'); await p.waitForTimeout(700);
const price = (await db.query(`SELECT buy_price FROM item_definitions WHERE id='potion_small'`)).rows[0].buy_price;
ok('buy potion: gold -price, +1 potion (DB)', (await gold()) === g0 - price && (await cnt('potion_small')) === pot0 + 1, `${g0}->${await gold()} price=${price}`);
await p.screenshot({ path: SHOT + 'phase5-shop-buy.png' });
await p.click('#p4 [data-tab="sell"]'); await p.waitForSelector('#p4 [data-s]');
ok('equipped weapon not offered for sale', !/木の剣/.test(await p.textContent('#p4 .rlist')));
const g1 = await gold(); await p.click('#p4 [data-s]'); await p.waitForTimeout(700);
ok('sell one item -> gold increases (DB)', (await gold()) > g1, `${g1}->${await gold()}`);
await p.screenshot({ path: SHOT + 'phase5-shop-sell.png' }); await close();

// inn
await db.query('UPDATE character_stats SET hp=5 WHERE character_id=$1', [charId]);
await talk('hana'); await advance();
const g2 = await gold(); await p.click('#p4 [data-o="inn"]'); await p.waitForTimeout(700);
const st = (await db.query('SELECT hp,max_hp FROM character_stats WHERE character_id=$1', [charId])).rows[0];
ok('inn: full HP and gold charged (DB)', st.hp === st.max_hp && (await gold()) === g2 - 10, `hp=${st.hp}/${st.max_hp} gold ${g2}->${await gold()}`);
await p.screenshot({ path: SHOT + 'phase5-inn.png' });
await p.click('#p4 [data-o="inn"]'); await p.waitForTimeout(600);
ok('inn again at full HP refused, no charge', /回復できません/.test(await p.textContent('#p4 .p4-msg')) && (await gold()) === g2 - 10);
await close();

// hunt quest (chief): accept, kills recorded by the server's battle commit are simulated here via progress (real battles covered in server test)
await talk('bram'); await advance(); await p.click('#p4 [data-o="quest"]'); await p.waitForSelector('#p4 [data-a="q_hunt_slime"]');
await p.screenshot({ path: SHOT + 'phase5-quest-offer.png' });
await p.click('#p4 [data-a="q_hunt_slime"]'); await p.waitForTimeout(600);
ok('hunt quest accepted (DB active)', (await qStatus('q_hunt_slime'))?.status === 'active');
ok('turn-in disabled before kills', await p.$eval('#p4 [data-c="q_hunt_slime"]', (e) => e.disabled));
await db.query(`UPDATE character_quests SET progress='{"kill:slime":3}' WHERE character_id=$1 AND quest_id='q_hunt_slime'`, [charId]);
await close(); await talk('bram'); await advance(); await p.click('#p4 [data-o="quest"]'); await p.waitForSelector('#p4 [data-c="q_hunt_slime"]:not([disabled])');
const g3 = await gold();
await p.evaluate(() => { const b = document.querySelector('#p4 [data-c="q_hunt_slime"]'); b.click(); b.click(); b.click(); }); await p.waitForTimeout(900);
ok('hunt reward paid exactly once (+60G, 1 tx)', (await gold()) === g3 + 60 && (await db.query(`SELECT count(*)::int n FROM transactions WHERE character_id=$1 AND kind='quest_reward'`, [charId])).rows[0].n === 1, `${g3}->${await gold()}`);
await p.screenshot({ path: SHOT + 'phase5-quest-complete.png' });
// delivery
await p.click('#p4 [data-a="q_deliver_letter"]'); await p.waitForTimeout(600);
ok('delivery accepted -> letter in bag', (await cnt('chief_letter')) === 1);
await close(); await talk('gord'); await p.click('#p4 [data-o="quest"]'); await p.waitForSelector('#p4 [data-c="q_deliver_letter"]');
await p.click('#p4 [data-c="q_deliver_letter"]'); await p.waitForTimeout(700);
ok('delivered to smith: letter removed, rewarded', (await cnt('chief_letter')) === 0 && (await qStatus('q_deliver_letter'))?.status === 'rewarded');
await close();
// gather (shop)
await talk('mira'); await p.click('#p4 [data-o="quest"]'); await p.waitForSelector('#p4 [data-a="q_gather_herb"]');
await p.click('#p4 [data-a="q_gather_herb"]'); await p.waitForTimeout(600);
await db.query(`INSERT INTO inventory(character_id,item_id,quantity) VALUES($1,'herb',3)`, [charId]);
await close(); await talk('mira'); await p.click('#p4 [data-o="quest"]'); await p.waitForSelector('#p4 [data-c="q_gather_herb"]:not([disabled])');
await p.click('#p4 [data-c="q_gather_herb"]'); await p.waitForTimeout(700);
ok('gather quest: herbs consumed, rewarded', (await cnt('herb')) === 0 && (await qStatus('q_gather_herb'))?.status === 'rewarded');
await close();
// daily (guard)
await talk('leon'); await advance(); await p.click('#p4 [data-o="quest"]'); await p.waitForSelector('#p4 [data-a="q_daily_hunt"]');
await p.click('#p4 [data-a="q_daily_hunt"]'); await p.waitForTimeout(500);
await db.query(`UPDATE character_quests SET progress='{"kill:slime":5}' WHERE character_id=$1 AND quest_id='q_daily_hunt'`, [charId]);
await close(); await talk('leon'); await advance(); await p.click('#p4 [data-o="quest"]'); await p.waitForSelector('#p4 [data-c="q_daily_hunt"]:not([disabled])');
await p.click('#p4 [data-c="q_daily_hunt"]'); await p.waitForTimeout(700);
ok('daily rewarded, then shown 本日達成 (no re-accept today)', (await qStatus('q_daily_hunt'))?.t === 1 && /本日達成/.test(await p.textContent('#p4 .rlist')) && !(await p.$('#p4 [data-a="q_daily_hunt"]')));
await close();
await p.keyboard.press('l'); await p.waitForSelector('#p4.quests'); await p.screenshot({ path: SHOT + 'phase5-quest-log.png' });
ok('quest log (L) lists states', /達成済み/.test(await p.textContent('#p4 .rlist')));
await close();
ok('no page errors', errors.length === 0, errors.join(' | '));
await b.close(); await db.end();
const f = results.filter((r) => !r.pass); console.log(`\n${results.length - f.length}/${results.length} passed`); process.exit(f.length ? 1 : 0);
