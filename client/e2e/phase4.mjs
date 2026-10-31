// E2E PHASE 4: inventory/equipment panel, walk frames, server position snap-back, server portal, gathering, smith craft+enhance
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
await p.fill('#email', `e4_${Date.now()}@example.com`); await p.fill('#pw', 'correct-horse-9'); await p.click('#reg');
await p.waitForSelector('#new'); await p.click('#new'); await p.waitForSelector('#name');
const n = Date.now(); const name = '装備' + String.fromCharCode(0x30a2 + (n % 40), 0x30a2 + (Math.floor(n / 40) % 40), 0x30a2 + (Math.floor(n / 1600) % 40));
await p.fill('#name', name); await p.check('input[value=warrior]'); await p.click('#create');
await p.waitForFunction(() => window.__astral?.scene.isActive('World'), null, { timeout: 15000 }); await p.waitForTimeout(800);
const charId = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
const tp = makeTp(p, db, async () => charId);
const W = () => p.evaluate(() => { const s = window.__astral.scene.getScene('World'); return { map: s.map.id, x: s.pos.x, y: s.pos.y, frame: s.player.frame.name }; });
const eqRow = async (item) => (await db.query('SELECT count(*)::int n FROM character_equipment e JOIN inventory i ON i.id=e.inventory_id WHERE e.character_id=$1 AND i.item_id=$2', [charId, item])).rows[0].n > 0;
await p.evaluate(() => { window.__astral.scene.getScene('World').cooldownUntil = 1e12; });

// inventory panel
await p.keyboard.press('i'); await p.waitForSelector('#p4 .eqgrid');
ok('inventory panel opens with starter weapon equipped', /木の剣|wooden/i.test(await p.textContent('#p4 .eqgrid')) && await eqRow('wooden_sword'));
ok('potions listed in bag', /やくそう/.test(await p.textContent('#p4 .items')));
await p.screenshot({ path: SHOT + 'phase4-inventory.png' });
await p.click('#p4 [data-un="weapon"]'); await p.waitForTimeout(600);
ok('unequip via panel -> DB', (await eqRow('wooden_sword')) === false);
await p.click('#p4 .items button[data-cat]:not([data-cat="consumable"])'); await p.waitForTimeout(600);
ok('equip via panel -> DB', (await eqRow('wooden_sword')) === true);
await p.click('#p4 .x'); await p.waitForTimeout(200);

// walk frames
await tp(720, 698); await p.waitForTimeout(300);
const frames = new Set(); await p.keyboard.down('ArrowRight');
for (let i = 0; i < 12; i++) { await p.waitForTimeout(60); frames.add((await W()).frame); }
await p.screenshot({ path: SHOT + 'phase4-walk.png' }); await p.keyboard.up('ArrowRight');
ok('walk animation cycles >= 2 frames', frames.size >= 2, [...frames].join(','));

// server-authoritative position: an illegal client jump is snapped back
await p.waitForTimeout(600); const before = await W();
await p.evaluate(() => { const s = window.__astral.scene.getScene('World'); s.pos = { x: s.pos.x - 500, y: s.pos.y }; });
await p.waitForTimeout(1200); const after = await W();
ok('illegal teleport snapped back by server', Math.abs(after.x - before.x) < 20, `${before.x} -> ${after.x}`);
const dbPos = (await db.query('SELECT pos_x FROM characters WHERE id=$1', [charId])).rows[0].pos_x;
ok('DB position not moved by illegal jump', Math.abs(dbPos - before.x) < 20, `db=${dbPos}`);

// server portal -> meadow
await tp(42.2 * 32, 17.6 * 32); await p.keyboard.down('ArrowRight'); await p.waitForTimeout(700); await p.keyboard.up('ArrowRight');
await p.waitForFunction(() => window.__astral.scene.getScene('World').map?.id === 'green_meadow', null, { timeout: 6000 }).catch(() => {});
ok('portal -> green_meadow (server)', (await W()).map === 'green_meadow' && (await db.query('SELECT map_id FROM characters WHERE id=$1', [charId])).rows[0].map_id === 'green_meadow');
await p.evaluate(() => { window.__astral.scene.getScene('World').cooldownUntil = 1e12; });

// gathering
await tp(336, 360); await p.waitForTimeout(400);
ok('gather prompt shown', /採集/.test(await p.evaluate(() => window.__astral.scene.getScene('World').prompt.text)));
await p.keyboard.press('e'); await p.waitForTimeout(1200);
const herb = (await db.query(`SELECT coalesce(sum(quantity),0)::int n FROM inventory WHERE character_id=$1 AND item_id='herb'`, [charId])).rows[0].n;
ok('gather herb -> DB inventory', herb >= 1, `herb=${herb}`);
await p.screenshot({ path: SHOT + 'phase4-gather.png' });
await p.keyboard.press('e'); await p.waitForTimeout(800);
ok('second gather blocked by cooldown', (await db.query(`SELECT coalesce(sum(quantity),0)::int n FROM inventory WHERE character_id=$1 AND item_id='herb'`, [charId])).rows[0].n === herb);

// smith in town: craft + enhance
await db.query(`INSERT INTO inventory(character_id,item_id,quantity) VALUES($1,'copper_ore',20)`, [charId]);
await db.query('UPDATE characters SET gold=2000 WHERE id=$1', [charId]);
await tp(976, 380, 'asteria');
await p.evaluate(() => { const s = window.__astral.scene.getScene('World'); s.scene.restart({ character: { ...s.character, map_id: 'asteria', pos_x: 976, pos_y: 380, gold: 2000 } }); });
await p.waitForTimeout(1500); await p.evaluate(() => { window.__astral.scene.getScene('World').cooldownUntil = 1e12; });
ok('talk prompt near smith', /話す/.test(await p.evaluate(() => window.__astral.scene.getScene('World').prompt.text)));
await p.keyboard.press('e'); await p.waitForSelector('#p4 [data-tab]');
await p.screenshot({ path: SHOT + 'phase4-smith.png' });
await p.click('#p4 [data-r="r_copper_dagger"]'); await p.waitForSelector('#p4 #claim');
ok('craft job started (server)', (await db.query('SELECT count(*)::int n FROM crafting_jobs WHERE character_id=$1', [charId])).rows[0].n === 1);
await p.waitForTimeout(3600); await p.waitForSelector('#p4 #claim:not([disabled])', { timeout: 5000 }); await p.click('#p4 #claim'); await p.waitForTimeout(700);
ok('claimed copper_dagger', (await db.query(`SELECT count(*)::int n FROM inventory WHERE character_id=$1 AND item_id='copper_dagger'`, [charId])).rows[0].n === 1);
await p.click('#p4 [data-tab="enhance"]'); await p.waitForSelector('#p4 [data-e]');
await p.click('#p4 [data-e]'); await p.waitForTimeout(900);
ok('enhance attempt logged server-side', (await db.query('SELECT count(*)::int n FROM enhancement_logs WHERE character_id=$1', [charId])).rows[0].n === 1);
await p.screenshot({ path: SHOT + 'phase4-enhance.png' });
ok('no page errors', errors.length === 0, errors.join(' | '));
await b.close(); await db.end();
const f = results.filter((r) => !r.pass); console.log(`\n${results.length - f.length}/${results.length} passed`); process.exit(f.length ? 1 : 0);
