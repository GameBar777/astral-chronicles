import { enhanceRate, enhanceCost, enhancedStats, ENHANCE_MAX, ItemError } from '@astral/shared';
import { HttpError } from './auth.js';
import { tx, ownChar, idem, notInBattle, UUID } from './common.js';
import { addItem, removeItems, spendGold } from './inventory.js';
import { assertNearNpc } from './world.js';
let rng = Math.random; export const __setCraftRng = (r: () => number) => { rng = r; };
export const SMITH = 'npc_smith_gord';
/** weapon/armor/accessory need the smith's forge; alchemy can be done anywhere */
const needsForge = (cat: string) => cat !== 'alchemy';
export async function listRecipes() {
  const { pool } = await import('../db/pool.js');
  return (await pool.query(`SELECT r.*, d.name result_name FROM recipes r JOIN item_definitions d ON d.id=r.result_item_id ORDER BY r.category, r.required_level, r.id`)).rows
    .map((r) => ({ id: r.id, category: r.category, resultItemId: r.result_item_id, resultName: r.result_name, resultQty: r.result_qty, materials: r.materials, requiredLevel: r.required_level, craftTimeSec: r.craft_time_sec, goldCost: r.gold_cost, needsForge: needsForge(r.category) }));
}
const jobView = (j: any) => !j ? null : ({ id: j.id, recipeId: j.recipe_id, readyAt: j.ready_at, readyInMs: Math.max(0, new Date(j.ready_at).getTime() - Date.now()) });
export const activeJob = (userId: string, characterId: string) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId);
  return { job: jobView((await c.query('SELECT * FROM crafting_jobs WHERE character_id=$1 AND claimed_at IS NULL', [ch.id])).rows[0]) };
});
/** Start: materials + gold are consumed now (one transaction); the result is claimed after craft_time_sec. */
export const startCraft = (userId: string, characterId: unknown, recipeId: unknown, requestId: unknown) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId, true);
  return idem(c, ch.id, requestId, 'craft_start', async () => {
    await notInBattle(c, ch.id);
    const r = (await c.query('SELECT * FROM recipes WHERE id=$1', [recipeId])).rows[0];
    if (!r) throw new HttpError(404, 'recipe_not_found');
    if (ch.level < r.required_level) throw new ItemError('level_too_low');
    if (needsForge(r.category)) assertNearNpc(ch, SMITH);
    if ((await c.query('SELECT 1 FROM crafting_jobs WHERE character_id=$1 AND claimed_at IS NULL', [ch.id])).rowCount) throw new ItemError('craft_busy');
    await removeItems(c, ch.id, r.materials);
    await spendGold(c, ch.id, r.gold_cost);
    const j = (await c.query(`INSERT INTO crafting_jobs(character_id,recipe_id,ready_at) VALUES($1,$2,now() + make_interval(secs => $3)) RETURNING *`, [ch.id, r.id, r.craft_time_sec])).rows[0];
    return { job: jobView(j), goldDelta: -r.gold_cost, itemsDelta: r.materials.map((m: any) => ({ itemId: m.itemId, qty: -m.qty })) };
  });
});
/** Claim: conditional UPDATE on claimed_at makes a second claim a no-op (409 already_claimed). */
export const claimCraft = (userId: string, characterId: unknown, jobId: unknown) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId, true);
  if (typeof jobId !== 'string' || !UUID.test(jobId)) throw new HttpError(404, 'job_not_found');
  const j = (await c.query('SELECT j.*, r.result_item_id, r.result_qty FROM crafting_jobs j JOIN recipes r ON r.id=j.recipe_id WHERE j.id=$1 AND j.character_id=$2 FOR UPDATE OF j', [jobId, ch.id])).rows[0];
  if (!j) throw new HttpError(404, 'job_not_found');
  if (j.claimed_at) throw new ItemError('already_claimed');
  if (new Date(j.ready_at).getTime() > Date.now()) throw new ItemError('not_ready');
  const ids = await addItem(c, ch.id, j.result_item_id, j.result_qty);
  await c.query('UPDATE crafting_jobs SET claimed_at=now() WHERE id=$1', [j.id]);
  await c.query(`INSERT INTO transactions(character_id,kind,items_delta,idempotency_key,ref_id) VALUES($1,'craft',$2,$3,$4)`, [ch.id, JSON.stringify([{ itemId: j.result_item_id, qty: j.result_qty }]), `craft:${j.id}`, j.id]);
  const name = (await c.query('SELECT name FROM item_definitions WHERE id=$1', [j.result_item_id])).rows[0].name;
  return { item: { itemId: j.result_item_id, qty: j.result_qty, name, inventoryIds: ids } };
});
/** SECTION 11: server rolls success; failure keeps the item (no break) but consumes gold+materials. Logged per request. */
export const enhance = (userId: string, characterId: unknown, inventoryId: unknown, requestId: unknown) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId, true);
  return idem(c, ch.id, requestId, 'enhance', async () => {
    await notInBattle(c, ch.id);
    assertNearNpc(ch, SMITH);
    if (typeof inventoryId !== 'string' || !UUID.test(inventoryId)) throw new HttpError(404, 'item_not_found');
    const it = (await c.query(`SELECT i.id, i.item_id, i.enhance_level, d.name, q.* FROM inventory i JOIN item_definitions d ON d.id=i.item_id LEFT JOIN equipment_definitions q ON q.item_id=i.item_id
      WHERE i.id=$1 AND i.character_id=$2 FOR UPDATE OF i`, [inventoryId, ch.id])).rows[0];
    if (!it) throw new HttpError(404, 'item_not_found');
    if (!it.slot_category) throw new ItemError('not_equipment');
    const from = it.enhance_level; if (from >= ENHANCE_MAX) throw new ItemError('max_enhance');
    const rate = enhanceRate(from), cost = enhanceCost(from);
    await removeItems(c, ch.id, cost.materials);
    await spendGold(c, ch.id, cost.gold);
    const success = rng() < rate, to = success ? from + 1 : from;
    if (success) await c.query('UPDATE inventory SET enhance_level=$2 WHERE id=$1', [it.id, to]);
    await c.query(`INSERT INTO enhancement_logs(character_id,inventory_id,from_level,to_level,success,success_rate,gold_cost,materials,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [ch.id, it.id, from, to, success, rate, cost.gold, JSON.stringify(cost.materials), `${ch.id}:${requestId}`]);
    const def = { slot_category: it.slot_category, level_req: it.level_req, class_restrict: it.class_restrict, atk: it.atk, def: it.def, matk: it.matk, mdef: it.mdef };
    return { inventoryId: it.id, name: it.name, from, to, success, rate, cost, stats: enhancedStats(def, to), goldDelta: -cost.gold, itemsDelta: cost.materials.map((m) => ({ itemId: m.itemId, qty: -m.qty })) };
  });
});
export const enhanceInfo = (from: number) => (from >= ENHANCE_MAX ? null : { rate: enhanceRate(from), ...enhanceCost(from) });
