import type pg from 'pg';
import { checkEquip, enhancedStats, sumEquip, slotsFor, ItemError, INVENTORY_SLOTS, EQUIP_SLOTS, type EquipSlot, type ClassId } from '@astral/shared';
import { HttpError } from './auth.js';
import { tx, ownChar, idem, notInBattle, UUID } from './common.js';

/** Adds items honouring stackable/max_stack and the slot limit. `strict=false` (battle drops) ignores the slot limit. */
export async function addItem(c: pg.PoolClient, characterId: string, itemId: string, qty: number, strict = true) {
  const d = (await c.query('SELECT stackable, max_stack FROM item_definitions WHERE id=$1', [itemId])).rows[0];
  if (!d) throw new Error(`unknown item ${itemId}`);
  let left = qty;
  if (d.stackable) {
    const stacks = (await c.query('SELECT id, quantity FROM inventory WHERE character_id=$1 AND item_id=$2 AND quantity < $3 ORDER BY created_at FOR UPDATE', [characterId, itemId, d.max_stack])).rows;
    for (const s of stacks) { if (!left) break; const add = Math.min(left, d.max_stack - s.quantity); await c.query('UPDATE inventory SET quantity=quantity+$2 WHERE id=$1', [s.id, add]); left -= add; }
  }
  const created: string[] = [];
  while (left > 0) {
    if (strict) { const n = (await c.query('SELECT count(*)::int n FROM inventory WHERE character_id=$1', [characterId])).rows[0].n; if (n >= INVENTORY_SLOTS) throw new ItemError('inventory_full'); }
    const q = d.stackable ? Math.min(left, d.max_stack) : 1;
    const row = (await c.query(`INSERT INTO inventory(character_id,item_id,quantity,durability,max_durability)
      SELECT $1,$2,$3, CASE WHEN q.item_id IS NULL THEN NULL ELSE 50 END, CASE WHEN q.item_id IS NULL THEN NULL ELSE 50 END
      FROM (SELECT $2::text id) x LEFT JOIN equipment_definitions q ON q.item_id=x.id RETURNING id`, [characterId, itemId, q])).rows[0];
    created.push(row.id); left -= q;
  }
  return created;
}
/** Removes stackable materials across stacks (never equipped rows). Throws not_enough_materials. */
export async function removeItems(c: pg.PoolClient, characterId: string, mats: { itemId: string; qty: number }[]) {
  for (const m of mats) {
    const rows = (await c.query(`SELECT i.id, i.quantity FROM inventory i WHERE i.character_id=$1 AND i.item_id=$2
      AND NOT EXISTS (SELECT 1 FROM character_equipment e WHERE e.inventory_id=i.id) ORDER BY i.quantity, i.created_at FOR UPDATE`, [characterId, m.itemId])).rows;
    if (rows.reduce((t, r) => t + r.quantity, 0) < m.qty) throw new ItemError('not_enough_materials');
    let left = m.qty;
    for (const r of rows) { if (!left) break; const take = Math.min(left, r.quantity); left -= take;
      if (take === r.quantity) await c.query('DELETE FROM inventory WHERE id=$1', [r.id]); else await c.query('UPDATE inventory SET quantity=quantity-$2 WHERE id=$1', [r.id, take]); }
  }
}
export async function spendGold(c: pg.PoolClient, characterId: string, gold: number) {
  if (gold <= 0) return;
  const r = await c.query('UPDATE characters SET gold=gold-$2, updated_at=now() WHERE id=$1 AND gold >= $2 RETURNING gold', [characterId, gold]);
  if (!r.rowCount) throw new ItemError('not_enough_gold');
}
const equipRow = (r: any) => r.slot_category ? { slot_category: r.slot_category, level_req: r.level_req, class_restrict: r.class_restrict, atk: r.atk, def: r.def, matk: r.matk, mdef: r.mdef } : null;
export async function equippedDefs(c: pg.PoolClient, characterId: string) {
  return (await c.query(`SELECT e.slot, i.id inventory_id, i.item_id, i.enhance_level, i.durability, i.max_durability, d.name, q.* FROM character_equipment e JOIN inventory i ON i.id=e.inventory_id
    JOIN item_definitions d ON d.id=i.item_id JOIN equipment_definitions q ON q.item_id=i.item_id WHERE e.character_id=$1`, [characterId])).rows;
}
/** Equipment bonus added on top of base stats (character_stats keeps BASE values; TD-012). */
export async function equipmentBonus(c: pg.PoolClient, characterId: string) {
  return sumEquip((await equippedDefs(c, characterId)).filter((r) => r.durability == null || r.durability > 0).map((r) => ({ def: equipRow(r)!, enhance: r.enhance_level })));
}
export async function listItems(userId: string, characterId: string) {
  return tx(async (c) => {
    const ch = await ownChar(c, userId, characterId);
    const rows = (await c.query(`SELECT i.id, i.item_id, i.quantity, i.enhance_level, i.durability, i.max_durability, d.name, d.category, d.rarity, d.sell_price, d.effect, d.description, e.slot equipped, q.slot_category, q.level_req, q.class_restrict, q.atk, q.def, q.matk, q.mdef
      FROM inventory i JOIN item_definitions d ON d.id=i.item_id LEFT JOIN equipment_definitions q ON q.item_id=i.item_id
      LEFT JOIN character_equipment e ON e.inventory_id=i.id WHERE i.character_id=$1 ORDER BY (e.slot IS NULL), d.category, i.item_id, i.enhance_level DESC, i.created_at`, [characterId])).rows;
    const items = rows.map((r) => { const eq = equipRow(r);
      return { id: r.id, itemId: r.item_id, name: r.name, category: r.category, rarity: r.rarity, qty: r.quantity, enhance: r.enhance_level, equipped: r.equipped, sellPrice: r.sell_price,
        effect: r.effect, description: r.description, durability: r.durability, maxDurability: r.max_durability,
        equip: eq ? { category: eq.slot_category, levelReq: eq.level_req, classRestrict: eq.class_restrict, ...enhancedStats(eq, r.enhance_level) } : null }; });
    const bonus = await equipmentBonus(c, characterId);
    const base = { atk: ch.atk, def: ch.def, matk: ch.matk, mdef: ch.mdef };
    return { items, slotsUsed: items.length, slotsMax: INVENTORY_SLOTS, gold: Number(ch.gold),
      stats: { base, bonus, total: { atk: base.atk + bonus.atk, def: base.def + bonus.def, matk: base.matk + bonus.matk, mdef: base.mdef + bonus.mdef } } };
  });
}
export const equip = (userId: string, characterId: unknown, inventoryId: unknown, wantSlot?: unknown) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId, true);
  await notInBattle(c, ch.id);
  if (typeof inventoryId !== 'string' || !UUID.test(inventoryId)) throw new HttpError(404, 'item_not_found');
  const it = (await c.query(`SELECT i.id, i.durability, q.* FROM inventory i LEFT JOIN equipment_definitions q ON q.item_id=i.item_id WHERE i.id=$1 AND i.character_id=$2 FOR UPDATE OF i`, [inventoryId, ch.id])).rows[0];
  if (!it) throw new HttpError(404, 'item_not_found');
  const d = equipRow(it); if (!d) throw new ItemError('not_equipment');
  if (it.durability === 0) throw new ItemError('broken');
  checkEquip(ch.class as ClassId, ch.level, d);
  const cur = (await c.query('SELECT slot, inventory_id FROM character_equipment WHERE character_id=$1', [ch.id])).rows as { slot: EquipSlot; inventory_id: string }[];
  if (cur.some((x) => x.inventory_id === inventoryId)) return { slot: cur.find((x) => x.inventory_id === inventoryId)!.slot, unchanged: true };
  const cands = slotsFor(d.slot_category);
  let slot: EquipSlot = cands[0];
  if (typeof wantSlot === 'string' && (cands as string[]).includes(wantSlot)) slot = wantSlot as EquipSlot;
  else if (cands.length > 1) slot = cands.find((s) => !cur.some((x) => x.slot === s)) ?? cands[0];
  const weapon = (await equippedDefs(c, ch.id)).find((r) => r.slot === 'weapon');
  if (slot === 'shield' && weapon?.slot_category === 'two_hand_sword') throw new ItemError('two_handed');
  if (d.slot_category === 'two_hand_sword') await c.query(`DELETE FROM character_equipment WHERE character_id=$1 AND slot='shield'`, [ch.id]);
  await c.query('DELETE FROM character_equipment WHERE character_id=$1 AND slot=$2', [ch.id, slot]);
  await c.query('INSERT INTO character_equipment(character_id,slot,inventory_id) VALUES($1,$2,$3)', [ch.id, slot, inventoryId]);
  return { slot, unchanged: false };
});
export const unequip = (userId: string, characterId: unknown, slot: unknown) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId, true);
  await notInBattle(c, ch.id);
  if (!(EQUIP_SLOTS as unknown[]).includes(slot)) throw new HttpError(400, 'invalid_slot');
  const r = await c.query('DELETE FROM character_equipment WHERE character_id=$1 AND slot=$2', [ch.id, slot]);
  return { slot, removed: r.rowCount === 1 };
});
/** Field use of a consumable (HP/MP). One item per requestId. */
export const useItem = (userId: string, characterId: unknown, inventoryId: unknown, requestId: unknown) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId, true);
  return idem(c, ch.id, requestId, 'use_item', async () => {
    await notInBattle(c, ch.id);
    if (typeof inventoryId !== 'string' || !UUID.test(inventoryId)) throw new HttpError(404, 'item_not_found');
    const it = (await c.query(`SELECT i.id, i.item_id, i.quantity, d.category, d.effect, d.name FROM inventory i JOIN item_definitions d ON d.id=i.item_id WHERE i.id=$1 AND i.character_id=$2 FOR UPDATE OF i`, [inventoryId, ch.id])).rows[0];
    if (!it) throw new HttpError(404, 'item_not_found');
    if (it.category !== 'consumable' || !(it.effect.heal || it.effect.mp)) throw new ItemError('not_usable');
    if ((it.effect.heal ? ch.hp >= ch.max_hp : true) && (it.effect.mp ? ch.mp >= ch.max_mp : true)) throw new ItemError('already_full');
    if (it.quantity > 1) await c.query('UPDATE inventory SET quantity=quantity-1 WHERE id=$1', [it.id]); else await c.query('DELETE FROM inventory WHERE id=$1', [it.id]);
    const hp = Math.min(ch.max_hp, ch.hp + (it.effect.heal ?? 0)), mp = Math.min(ch.max_mp, ch.mp + (it.effect.mp ?? 0));
    await c.query('UPDATE character_stats SET hp=$2, mp=$3 WHERE character_id=$1', [ch.id, hp, mp]);
    return { itemId: it.item_id, name: it.name, hp, mp, healed: hp - ch.hp, mpHealed: mp - ch.mp, itemsDelta: [{ itemId: it.item_id, qty: -1 }] };
  });
});

export const DURABILITY_MAX = 50, REPAIR_GOLD_PER = 2;
/** Lose 1 durability on every equipped item after a battle; broken pieces are unequipped (no stat bonus). */
export async function wearEquipment(c: pg.PoolClient, characterId: string) {
  await c.query(`UPDATE inventory i SET durability = GREATEST(0, durability - 1) FROM character_equipment e WHERE e.inventory_id=i.id AND e.character_id=$1 AND i.durability IS NOT NULL`, [characterId]);
  await c.query(`DELETE FROM character_equipment e USING inventory i WHERE e.inventory_id=i.id AND e.character_id=$1 AND i.durability = 0`, [characterId]);
}
export const repairItem = (userId: string, characterId: unknown, inventoryId: unknown, requestId: unknown) =>
  tx(async (c) => {
    const ch = await ownChar(c, userId, characterId, true); await notInBattle(c, ch.id);
    if (typeof inventoryId !== 'string' || !UUID.test(inventoryId)) throw new HttpError(404, 'item_not_found');
    return idem(c, ch.id, requestId, 'repair', async () => {
      const it = (await c.query(`SELECT i.id, i.durability, i.max_durability, d.name FROM inventory i JOIN item_definitions d ON d.id=i.item_id
        WHERE i.id=$1 AND i.character_id=$2 FOR UPDATE OF i`, [inventoryId, ch.id])).rows[0];
      if (!it) throw new HttpError(404, 'item_not_found');
      if (it.max_durability == null) throw new ItemError('not_equipment');
      if (it.durability >= it.max_durability) throw new ItemError('already_repaired');
      const missing = it.max_durability - it.durability, gold = missing * REPAIR_GOLD_PER;
      await spendGold(c, ch.id, gold);
      await c.query('UPDATE inventory SET durability=max_durability WHERE id=$1', [it.id]);
      return { name: it.name, durability: it.max_durability, maxDurability: it.max_durability, gold, goldDelta: -gold };
    });
  });
