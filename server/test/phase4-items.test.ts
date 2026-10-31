import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createGameServer } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { __setWorldRng, SPEED_TOLERANCE, SLACK_PX } from '../src/services/world.js';
import { __setCraftRng } from '../src/services/crafting.js';
import { resetDb } from './setup-db.js';
import { MAPS } from '../src/world/maps.js';
import { isBlocked } from '@astral/shared';
const freeAt = (x: number, y: number, d: number) => { for (let a = 0; a < 64; a++) { const p = { x: Math.round(x + d * Math.cos(a / 10)), y: Math.round(y + d * Math.sin(a / 10)) }; if (!isBlocked(MAPS.asteria, p)) return p; } throw new Error('no free'); };
const PORT = 25673, B = `http://127.0.0.1:${PORT}/api`;
const { gameServer } = createGameServer({ authLimit: 1000, createLimit: 1000, battleLimit: 10000, actionLimit: 100000, moveLimit: 100000 });
let T = '', T2 = '', CH = '', CH2 = '';
const call = async (method: string, path: string, body?: unknown, token = T) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const user = async (email: string, cls: string, name: string) => {
  await call('POST', '/auth/register', { email, password: 'password123' }, '');
  const t = (await call('POST', '/auth/login', { email, password: 'password123' }, '')).body.token;
  const c = await call('POST', '/characters', { name, class: cls, appearance: { bodyType: 'a', hairStyle: 1, hairColor: 2, skinColor: 0 } }, t);
  return [t, c.body.id];
};
const place = (map: string, x: number, y: number, id = CH) => pool.query(`UPDATE characters SET map_id=$2,pos_x=$3,pos_y=$4,pos_updated_at=now()-interval '1 hour' WHERE id=$1`, [id, map, x, y]);
const give = (item: string, qty: number, id = CH) => pool.query('INSERT INTO inventory(character_id,item_id,quantity) VALUES($1,$2,$3)', [id, item, qty]);
const count = async (item: string, id = CH) => (await pool.query('SELECT coalesce(sum(quantity),0)::int n FROM inventory WHERE character_id=$1 AND item_id=$2', [id, item])).rows[0].n;
const gold = async (id = CH) => Number((await pool.query('SELECT gold FROM characters WHERE id=$1', [id])).rows[0].gold);
const items = async (t = T, id = CH) => (await call('GET', `/characters/${id}/items`, undefined, t)).body;
let n = 0; const rid = () => `req-test-${++n}-${Date.now()}`;
const SMITH = { x: 976, y: 339 + 40 };
beforeAll(async () => { await resetDb(); await gameServer.listen(PORT); [T, CH] = await user('w4@example.test', 'warrior', 'Garo'); [T2, CH2] = await user('k4@example.test', 'knight', 'Leon'); });
afterAll(async () => { __setWorldRng(Math.random); __setCraftRng(Math.random); await gameServer.gracefullyShutdown(false); await pool.end().catch(() => {}); });

describe('PHASE 4 inventory / equipment', () => {
  it('master data: 23 new items, 14 recipes, 8 nodes; starter weapon equipped (knight also shield)', async () => {
    expect((await pool.query('SELECT count(*)::int n FROM recipes')).rows[0].n).toBe(14);
    expect((await pool.query(`SELECT count(*)::int n FROM gathering_nodes WHERE map_id='green_meadow'`)).rows[0].n).toBe(8);
    const a = await items(); expect(a.items.find((i: any) => i.itemId === 'wooden_sword').equipped).toBe('weapon');
    expect(a.stats.bonus.atk).toBeGreaterThan(0); expect(a.stats.total.atk).toBe(a.stats.base.atk + a.stats.bonus.atk);
    const k = await items(T2, CH2); expect(k.items.filter((i: any) => i.equipped).map((i: any) => i.equipped).sort()).toEqual(['shield', 'weapon']);
  });
  it('equip validation: class / level / ownership / non-equipment', async () => {
    await give('oak_staff', 1);
    const staff = (await items()).items.find((i: any) => i.itemId === 'oak_staff');
    expect((await call('POST', `/characters/${CH}/equip`, { inventoryId: staff.id })).body.error).toBe('class_cannot_equip');
    await give('iron_sword', 1);
    const iron = (await items()).items.find((i: any) => i.itemId === 'iron_sword');
    expect((await call('POST', `/characters/${CH}/equip`, { inventoryId: iron.id })).body.error).toBe('level_too_low');
    const pot = (await items()).items.find((i: any) => i.itemId === 'potion_small');
    expect((await call('POST', `/characters/${CH}/equip`, { inventoryId: pot.id })).body.error).toBe('not_equipment');
    const other = (await items(T2, CH2)).items[0];
    expect((await call('POST', `/characters/${CH}/equip`, { inventoryId: other.id })).status).toBe(404); // someone else's item
    expect((await call('POST', `/characters/${CH2}/equip`, { inventoryId: staff.id })).status).toBe(404); // someone else's character
  });
  it('equip / unequip changes the battle stats; accessory fills ring slot 1 then 2', async () => {
    await give('leather_cap', 1); await give('copper_ring', 1); await give('copper_ring', 1);
    const before = (await items()).stats.total.def;
    const cap = (await items()).items.find((i: any) => i.itemId === 'leather_cap');
    expect((await call('POST', `/characters/${CH}/equip`, { inventoryId: cap.id })).body.slot).toBe('head');
    expect((await items()).stats.total.def).toBeGreaterThan(before);
    const rings = (await items()).items.filter((i: any) => i.itemId === 'copper_ring');
    await pool.query('UPDATE characters SET level=5 WHERE id=$1', [CH]);
    expect((await call('POST', `/characters/${CH}/equip`, { inventoryId: rings[0].id })).body.slot).toBe('accessory1');
    expect((await call('POST', `/characters/${CH}/equip`, { inventoryId: rings[1].id })).body.slot).toBe('accessory2');
    expect((await call('POST', `/characters/${CH}/unequip`, { slot: 'head' })).body.removed).toBe(true);
    expect((await items()).stats.total.def).toBe(before);
    expect((await call('POST', `/characters/${CH}/unequip`, { slot: 'tail' })).body.error).toBe('invalid_slot');
  });
  it('use item: heals, consumes 1, requestId replay does not consume twice', async () => {
    await pool.query('UPDATE character_stats SET hp=10 WHERE character_id=$1', [CH]);
    const pot = (await items()).items.find((i: any) => i.itemId === 'potion_small'); const before = await count('potion_small');
    const id = rid();
    const [a, b] = await Promise.all([call('POST', `/characters/${CH}/use`, { inventoryId: pot.id, requestId: id }), call('POST', `/characters/${CH}/use`, { inventoryId: pot.id, requestId: id })]);
    expect([a.status, b.status]).toEqual([200, 200]); expect([a.body.replayed, b.body.replayed].sort()).toEqual([false, true]);
    expect(await count('potion_small')).toBe(before - 1);
    expect((await call('POST', `/characters/${CH}/use`, { inventoryId: pot.id, requestId: 'bad' })).body.error).toBe('invalid_request_id');
    await pool.query('UPDATE character_stats SET hp=max_hp WHERE character_id=$1', [CH]);
    expect((await call('POST', `/characters/${CH}/use`, { inventoryId: pot.id, requestId: rid() })).body.error).toBe('already_full');
  });
  it('inventory: non-stackables take a slot each; 60-slot limit -> inventory_full (nothing consumed)', async () => {
    const used = (await items()).slotsUsed;
    await pool.query(`INSERT INTO inventory(character_id,item_id,quantity) SELECT $1,'wooden_shield',1 FROM generate_series(1,$2)`, [CH, 60 - used]);
    await place('green_meadow', 12 * 32 + 16, 24 * 32 + 32 - 16 + 20);
    __setWorldRng(() => 0.01);
    const r = await call('POST', `/characters/${CH}/gather`, { nodeId: 'node_copper_1', requestId: rid() });
    expect(r.status).toBe(409); expect(r.body.error).toBe('inventory_full');
    expect((await pool.query('SELECT count(*)::int n FROM gather_node_state WHERE character_id=$1', [CH])).rows[0].n).toBe(0); // rolled back
    await pool.query(`DELETE FROM inventory WHERE character_id=$1 AND item_id='wooden_shield'`, [CH]);
  });
});

describe('PHASE 4 position / map (server-authoritative)', () => {
  it('position: accepts walkable step, rejects blocked / teleport / wrong map', async () => {
    await place('asteria', 720, 698);
    expect((await call('PUT', `/characters/${CH}/position`, { mapId: 'asteria', x: 730, y: 698 })).body).toEqual({ ok: true, pos: { mapId: 'asteria', x: 730, y: 698 } });
    const far = await call('PUT', `/characters/${CH}/position`, { mapId: 'asteria', x: 730 + 120 * SPEED_TOLERANCE * 5 + SLACK_PX + 200, y: 698 });
    expect(far.status).toBe(409); expect(['too_fast', 'blocked']).toContain(far.body.reason); expect(far.body.pos.x).toBe(730);
    const q = freeAt(730, 698, 200); const quick = await call('PUT', `/characters/${CH}/position`, { mapId: 'asteria', ...q }); // 200px right after an update (dt≈0)
    expect(quick.body.reason).toBe('too_fast');
    expect((await call('PUT', `/characters/${CH}/position`, { mapId: 'asteria', x: 4, y: 4 })).body.reason).toMatch(/blocked|too_fast/);
    await place('asteria', 720, 698);
    expect((await call('PUT', `/characters/${CH}/position`, { mapId: 'asteria', x: -50, y: 698 })).body.reason).toBe('blocked'); // out of map
    expect((await call('PUT', `/characters/${CH}/position`, { mapId: 'green_meadow', x: 112, y: 563 })).body.reason).toBe('wrong_map');
    expect((await call('PUT', `/characters/${CH}/position`, { mapId: 'asteria', x: 'a', y: 1 })).status).toBe(400);
  });
  it('portal: only when standing on it; moves to target map spawn; battle requires being in the zone', async () => {
    await place('asteria', 720, 698);
    expect((await call('POST', `/characters/${CH}/portal`, { portalId: 'portal_to_meadow' })).body.error).toBe('not_at_portal');
    expect((await call('POST', '/battles', { characterId: CH, zone: 'green_meadow' })).body.error).toBe('wrong_map');
    await place('asteria', 43 * 32 + 16, 17 * 32 + 16);
    const p = await call('POST', `/characters/${CH}/portal`, { portalId: 'portal_to_meadow' });
    expect(p.body.pos.mapId).toBe('green_meadow');
    expect((await call('POST', `/characters/${CH}/portal`, { portalId: 'nope' })).status).toBe(404);
  });
});

describe('PHASE 4 gathering', () => {
  const NODE = { x: 12 * 32 + 16, y: 25 * 32 }; // node_copper_1
  it('too far / wrong map rejected; success gives server-rolled loot + exp; cooldown; replay safe', async () => {
    await place('green_meadow', NODE.x + 300, NODE.y);
    expect((await call('POST', `/characters/${CH}/gather`, { nodeId: 'node_copper_1', requestId: rid() })).body.error).toBe('too_far');
    await place('asteria', NODE.x, NODE.y);
    expect((await call('POST', `/characters/${CH}/gather`, { nodeId: 'node_copper_1', requestId: rid() })).body.error).toBe('too_far');
    await place('green_meadow', NODE.x, NODE.y + 20);
    __setWorldRng(() => 0.01);
    const before = await count('copper_ore'); const id = rid();
    const [a, b] = await Promise.all([1, 2].map(() => call('POST', `/characters/${CH}/gather`, { nodeId: 'node_copper_1', requestId: id })));
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(a.body.item.itemId).toBe('copper_ore'); expect(await count('copper_ore')).toBe(before + a.body.item.qty);
    const again = await call('POST', `/characters/${CH}/gather`, { nodeId: 'node_copper_1', requestId: rid() });
    expect(again.status).toBe(409); expect(again.body.error).toBe('node_not_ready');
    const st = (await call('GET', `/characters/${CH}/gathering`)).body;
    expect(st.levels.mining.exp).toBeGreaterThan(0); expect(st.nodes.find((x: any) => x.id === 'node_copper_1').readyInSec).toBeGreaterThan(0);
  });
  it('gather level gates rare loot (rollLoot with server level)', async () => {
    await pool.query(`DELETE FROM gather_node_state WHERE character_id=$1`, [CH]);
    __setWorldRng(() => 0.999); // top of table: high level entries are filtered at Lv1
    const r = await call('POST', `/characters/${CH}/gather`, { nodeId: 'node_copper_1', requestId: rid() });
    expect(r.status).toBe(200); expect(r.body.item.itemId).not.toBe('silver_ore');
  });
});

describe('PHASE 4 crafting', () => {
  it('alchemy anywhere; materials consumed once; busy while active; claim once after ready', async () => {
    const recipes = (await call('GET', '/recipes')).body; const pot = recipes.find((r: any) => r.resultItemId === 'potion_small');
    expect(pot.needsForge).toBe(false);
    const nonAlch = recipes.find((r: any) => r.category === 'weapon');
    for (const m of pot.materials) await give(m.itemId, m.qty * 2);
    const mats = await Promise.all(pot.materials.map((m: any) => count(m.itemId)));
    const id = rid();
    const [a, b] = await Promise.all([1, 2].map(() => call('POST', `/characters/${CH}/craft`, { recipeId: pot.id, requestId: id })));
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(await Promise.all(pot.materials.map((m: any) => count(m.itemId)))).toEqual(mats.map((q: number, i: number) => q - pot.materials[i].qty));
    expect((await call('POST', `/characters/${CH}/craft`, { recipeId: pot.id, requestId: rid() })).body.error).toBe('craft_busy');
    const job = a.body.job;
    expect((await call('POST', `/characters/${CH}/craft/${job.id}/claim`)).body.error).toBe('not_ready');
    await pool.query(`UPDATE crafting_jobs SET ready_at=now()-interval '1 second' WHERE id=$1`, [job.id]);
    const before = await count('potion_small');
    const [c1, c2] = await Promise.all([1, 2].map(() => call('POST', `/characters/${CH}/craft/${job.id}/claim`)));
    expect([c1.status, c2.status].sort()).toEqual([200, 409]);
    expect(await count('potion_small')).toBe(before + pot.resultQty);
    expect((await call('POST', `/characters/${CH2}/craft/${job.id}/claim`, undefined, T2)).status).toBe(404);
    await place('green_meadow', 500, 500);
    expect((await call('POST', `/characters/${CH}/craft`, { recipeId: nonAlch.id, requestId: rid() })).body.error).toBe('too_far');
  });
  it('not enough materials -> nothing consumed, no job', async () => {
    const r = (await call('GET', '/recipes')).body.find((x: any) => x.category === 'alchemy' && x.resultItemId === 'ether_small');
    await pool.query(`DELETE FROM inventory WHERE character_id=$1 AND item_id = ANY($2)`, [CH, r.materials.map((m: any) => m.itemId)]);
    expect((await call('POST', `/characters/${CH}/craft`, { recipeId: r.id, requestId: rid() })).body.error).toBe('not_enough_materials');
    expect((await call('GET', `/characters/${CH}/crafting`)).body.job).toBeNull();
  });
});

describe('PHASE 4 enhancement', () => {
  it('needs smith; consumes gold+mats; replay safe; failure keeps item; logs; max +10', async () => {
    const sword = (await items()).items.find((i: any) => i.itemId === 'wooden_sword');
    await place('green_meadow', 500, 500);
    expect((await call('POST', `/characters/${CH}/enhance`, { inventoryId: sword.id, requestId: rid() })).body.error).toBe('too_far');
    await place('asteria', SMITH.x, SMITH.y);
    await pool.query('UPDATE characters SET gold=0 WHERE id=$1', [CH]); await give('copper_ore', 50); await give('iron_ore', 50); await give('magic_stone', 20);
    const ore0 = await count('copper_ore');
    expect((await call('POST', `/characters/${CH}/enhance`, { inventoryId: sword.id, requestId: rid() })).body.error).toBe('not_enough_gold');
    expect(await count('copper_ore')).toBe(ore0); // materials not consumed (rolled back)
    await pool.query('UPDATE characters SET gold=100000 WHERE id=$1', [CH]);
    __setCraftRng(() => 0.0);
    const id = rid(); const g0 = await gold();
    const [a, b] = await Promise.all([1, 2].map(() => call('POST', `/characters/${CH}/enhance`, { inventoryId: sword.id, requestId: id })));
    expect(a.body.to).toBe(1); expect(b.body.to).toBe(1); expect(await gold()).toBe(g0 - a.body.cost.gold);
    expect((await pool.query('SELECT count(*)::int n FROM enhancement_logs WHERE character_id=$1', [CH])).rows[0].n).toBe(1);
    expect((await items()).items.find((i: any) => i.id === sword.id).enhance).toBe(1);
    await pool.query('UPDATE inventory SET enhance_level=9 WHERE id=$1', [sword.id]);
    __setCraftRng(() => 0.99);
    const f = await call('POST', `/characters/${CH}/enhance`, { inventoryId: sword.id, requestId: rid() });
    expect(f.body.success).toBe(false); expect(f.body.to).toBe(9);
    expect((await items()).items.find((i: any) => i.id === sword.id)).toBeTruthy(); // not destroyed
    await pool.query('UPDATE inventory SET enhance_level=10 WHERE id=$1', [sword.id]);
    expect((await call('POST', `/characters/${CH}/enhance`, { inventoryId: sword.id, requestId: rid() })).body.error).toBe('max_enhance');
    expect((await call('POST', `/characters/${CH}/enhance`, { inventoryId: sword.id, requestId: id })).body.replayed).toBe(true); // old id still replays
  });
  it('request id cannot be reused for a different action kind', async () => {
    const id = rid(); await pool.query('UPDATE character_stats SET hp=1 WHERE character_id=$1', [CH]);
    const pot = (await items()).items.find((i: any) => i.itemId === 'potion_small');
    expect((await call('POST', `/characters/${CH}/use`, { inventoryId: pot.id, requestId: id })).status).toBe(200);
    expect((await call('POST', `/characters/${CH}/enhance`, { inventoryId: pot.id, requestId: id })).body.error).toBe('request_id_reused');
  });
});
