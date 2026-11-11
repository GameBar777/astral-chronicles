import type pg from 'pg';
import { applyExp, statsAt, resolveTurn, computeRewards, BattleError, BATTLE_ITEMS, SKILLS, type BattleState, type Combatant, type Command, type Rng } from '@astral/shared';
import { pool } from '../db/pool.js';
import { HttpError } from './auth.js';
import { addItem as addInv, equipmentBonus } from './inventory.js';
import { MAPS, TOWN } from '../world/maps.js';
import { recordKills } from './quests.js';
export const ZONES = ['green_meadow'];
export const MAX_ENEMIES = 5;
const STALE_MS = 30 * 60_000; // an untouched active battle older than this is aborted (no rewards) when a new one is requested
let rng: Rng = Math.random;
export const __setRng = (r: Rng) => { rng = r; }; // tests only

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ownChar = async (c: pg.PoolClient, userId: string, characterId: string, lock = false) => {
  if (!UUID.test(characterId)) throw new HttpError(404, 'character_not_found');
  const r = await c.query(`SELECT c.id,c.name,c.class,c.appearance,c.level,c.exp,c.gold,c.map_id,s.* FROM characters c JOIN character_stats s ON s.character_id=c.id
    WHERE c.id=$1 AND c.user_id=$2 AND c.deleted_at IS NULL ${lock ? 'FOR UPDATE OF c' : ''}`, [characterId, userId]);
  if (!r.rows[0]) throw new HttpError(404, 'character_not_found');
  return r.rows[0];
};
export const inventoryCounts = async (c: pg.PoolClient, characterId: string) => {
  const r = await c.query('SELECT item_id, sum(quantity)::int q FROM inventory WHERE character_id=$1 GROUP BY item_id', [characterId]);
  return Object.fromEntries(r.rows.map((x) => [x.item_id, x.q])) as Record<string, number>;
};
/** Client view: full state (nothing secret: enemy rewards/drops stripped). */
export const view = (row: any, extra: Record<string, unknown> = {}) => {
  const st: BattleState = row.state;
  return { id: row.id, zone: row.zone, turn: st.turn, status: st.status, canFlee: st.canFlee,
    combatants: st.combatants.map(({ reward, actions, phases, ...c }) => c), participants: row.participants, dungeonInstanceId: row.dungeon_instance_id ?? null, log: st.log.slice(-40), ...extra };
};
async function pickMonsters(c: pg.PoolClient, zone: string, lead?: string) {
  const defs = (await c.query(`SELECT m.*, coalesce(json_agg(json_build_object('itemId',d.item_id,'rate',d.drop_rate::float,'min',d.min_qty,'max',d.max_qty)) FILTER (WHERE d.item_id IS NOT NULL),'[]') drops
    FROM monster_definitions m LEFT JOIN monster_drops d ON d.monster_id=m.id WHERE $1 = ANY(m.spawn_areas) AND NOT m.is_boss GROUP BY m.id ORDER BY m.id`, [zone])).rows;
  if (!defs.length) throw new HttpError(400, 'no_monsters');
  const total = defs.reduce((t, d) => t + Number(d.spawn_rate), 0);
  const roll = () => { let r = rng() * total; for (const d of defs) if ((r -= Number(d.spawn_rate)) < 0) return d; return defs[0]; };
  const n = 1 + Math.floor(rng() * 3); // 1-3 enemies (max 5 supported)
  const out = [defs.find((d) => d.id === lead) ?? roll()]; while (out.length < Math.min(n, MAX_ENEMIES)) out.push(roll());
  return toEnemies(out);
}
/** fixed enemy list (dungeon floors / boss) */
export async function fixedMonsters(c: pg.PoolClient, ids: string[]) {
  const defs = (await c.query(`SELECT m.*, coalesce(json_agg(json_build_object('itemId',d.item_id,'rate',d.drop_rate::float,'min',d.min_qty,'max',d.max_qty)) FILTER (WHERE d.item_id IS NOT NULL),'[]') drops
    FROM monster_definitions m LEFT JOIN monster_drops d ON d.monster_id=m.id WHERE m.id = ANY($1) GROUP BY m.id`, [ids])).rows;
  return toEnemies(ids.map((id) => { const d = defs.find((x) => x.id === id); if (!d) throw new HttpError(500, 'monster_missing'); return d; }));
}
function toEnemies(out: any[]) {
  const counts: Record<string, number> = {};
  return out.map((d, i): Combatant => {
    counts[d.id] = (counts[d.id] ?? 0) + 1; const same = out.filter((x) => x.id === d.id).length > 1;
    return { id: `e${i}`, side: 'enemy', monsterId: d.id, name: same ? `${d.name}${'ABCDE'[counts[d.id] - 1]}` : d.name, level: d.level,
      hp: d.hp, maxHp: d.hp, mp: d.mp, maxMp: d.mp, atk: d.atk, def: d.def, matk: d.matk, mdef: d.mdef, agi: d.agi, luk: 2,
      element: d.element, weakTo: d.behavior.weakTo ?? [], statuses: [], defending: false, guardTurns: 0, actions: d.behavior.actions, ...(d.behavior.phases ? { phases: d.behavior.phases, phase: 0 } : {}),
      reward: { exp: d.exp_reward, gold: d.gold_reward, drops: d.drops } };
  });
}
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>, db: pg.Pool = pool) {
  const c = await db.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); if (e instanceof BattleError) throw new HttpError(400, e.code); throw e; }
  finally { c.release(); }
}
export const activeBattle = (userId: string, characterId: string) => tx(async (c) => {
  await ownChar(c, userId, characterId);
  const r = await c.query(`SELECT * FROM battle_logs WHERE result IS NULL AND (character_id=$1 OR (dungeon_instance_id IS NOT NULL AND participants @> ARRAY[$1]::uuid[])) ORDER BY started_at DESC LIMIT 1`, [characterId]);
  return r.rows[0] ? view(r.rows[0], r.rows[0].dungeon_instance_id ? { pending: Object.keys(r.rows[0].pending ?? {}) } : {}) : null;
});
export const startBattle = (userId: string, characterId: string, zone: string, lead?: string) => tx(async (c) => {
  if (!ZONES.includes(zone)) throw new HttpError(400, 'invalid_zone');
  const ch = await ownChar(c, userId, characterId, true); // row lock serialises concurrent starts
  const cur = (await c.query('SELECT * FROM battle_logs WHERE character_id=$1 AND result IS NULL', [characterId])).rows[0];
  if (cur && Date.now() - new Date(cur.updated_at).getTime() < STALE_MS) return view(cur, { resumed: true });
  if (cur) await c.query(`UPDATE battle_logs SET result='aborted', ended_at=now() WHERE id=$1`, [cur.id]);
  if (ch.hp <= 0) throw new HttpError(409, 'character_down');
  if ((await c.query('SELECT 1 FROM dungeon_members WHERE character_id=$1 AND left_at IS NULL', [characterId])).rowCount) throw new HttpError(409, 'in_dungeon');
  if (ch.map_id !== zone) throw new HttpError(409, 'wrong_map'); // server-side position: can only fight in the zone you stand in
  const player = await playerCombatant(c, ch, 'p0');
  const enemies = await pickMonsters(c, zone, lead);
  const state: BattleState = { turn: 1, status: 'active', canFlee: true, combatants: [player, ...enemies], log: [{ turn: 0, kind: 'start', text: `${enemies.map((e) => e.name).join('、')}があらわれた！` }] };
  const row = (await c.query(`INSERT INTO battle_logs(character_id,zone,participants,monsters,state,log) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [characterId, zone, [characterId], JSON.stringify(enemies.map((e) => ({ id: e.id, monsterId: e.monsterId, level: e.level }))), JSON.stringify(state), JSON.stringify(state.log)])).rows[0];
  return view(row, { resumed: false });
});
/**
 * One command = one turn. `turn` must equal the server turn (duplicate/replayed submissions get 409 stale_turn).
 * State, item consumption, character HP/MP and rewards are all written in ONE transaction, so a disconnect at any
 * point leaves either the previous turn or the new turn fully applied.
 */
export const act = (userId: string, battleId: string, turn: number, command: Command) => tx(async (c) => {
  if (!UUID.test(battleId)) throw new HttpError(404, 'battle_not_found');
  const row = (await c.query('SELECT * FROM battle_logs WHERE id=$1 FOR UPDATE', [battleId])).rows[0];
  if (!row) throw new HttpError(404, 'battle_not_found');
  const ch = await ownChar(c, userId, row.character_id, true);
  if (row.result) throw new HttpError(409, 'battle_over');
  if (turn !== row.state.turn) throw new HttpError(409, 'stale_turn');
  const inv = await inventoryCounts(c, row.character_id);
  const r = resolveTurn(row.state, { p0: command }, rng, inv);
  for (const itemId of r.consumed) await consumeItem(c, row.character_id, itemId);
  const st = r.state; const p = st.combatants.find((x) => x.id === 'p0')!;
  let rewards: any = null, levelUp: any = null;
  if (st.status !== 'active') {
    const result = st.status;
    const hp = result === 'defeat' ? Math.max(1, Math.floor(p.maxHp * 0.3)) : p.hp; // defeat: revive at 30% (TD-011)
    await c.query('UPDATE character_stats SET hp=$2, mp=$3 WHERE character_id=$1', [row.character_id, Math.min(hp, p.maxHp), p.mp]);
    if (result === 'defeat') { const sp = MAPS[TOWN].spawn; await c.query('UPDATE characters SET map_id=$2,pos_x=$3,pos_y=$4,pos_updated_at=now() WHERE id=$1', [row.character_id, TOWN, Math.round(sp.x), Math.round(sp.y)]); }
    if (result === 'victory') ({ rewards, levelUp } = await commitRewards(c, row.id, ch, st));
    await c.query(`UPDATE battle_logs SET state=$2, log=$3, result=$4, rewards=$5, ended_at=now(), updated_at=now() WHERE id=$1`,
      [row.id, JSON.stringify(st), JSON.stringify(st.log), result, JSON.stringify(rewards ?? {})]);
  } else {
    await c.query('UPDATE battle_logs SET state=$2, log=$3, updated_at=now() WHERE id=$1', [row.id, JSON.stringify(st), JSON.stringify(st.log)]);
  }
  return view({ ...row, state: st }, { events: r.events, rewards, levelUp });
});
export async function playerCombatant(c: pg.PoolClient, ch: any, id: string): Promise<Combatant> {
  const eb = await equipmentBonus(c, ch.id);
  const skills = (await c.query('SELECT skill_id FROM character_skills WHERE character_id=$1', [ch.id])).rows.map((r) => r.skill_id).filter((s) => SKILLS[s]);
  return { id, side: 'player', characterId: ch.id, cls: ch.class, look: ch.appearance ?? undefined, name: ch.name, level: ch.level, hp: ch.hp, maxHp: ch.max_hp, mp: ch.mp, maxMp: ch.max_mp,
    atk: ch.atk + eb.atk, def: ch.def + eb.def, matk: ch.matk + eb.matk, mdef: ch.mdef + eb.mdef, agi: ch.agi, luk: ch.luk, element: 'none', statuses: [], defending: false, guardTurns: 0, skills };
}
export async function consumeItem(c: pg.PoolClient, characterId: string, itemId: string) {
  const it = (await c.query('SELECT id, quantity FROM inventory WHERE character_id=$1 AND item_id=$2 ORDER BY created_at LIMIT 1 FOR UPDATE', [characterId, itemId])).rows[0];
  if (!it) throw new BattleError('no_item');
  if (it.quantity > 1) await c.query('UPDATE inventory SET quantity=quantity-1 WHERE id=$1', [it.id]); else await c.query('DELETE FROM inventory WHERE id=$1', [it.id]);
}
/** battle drops are never lost: slot limit not enforced here (TD-012) */
export const addItem = (c: pg.PoolClient, characterId: string, itemId: string, qty: number) => addInv(c, characterId, itemId, qty, false);
/**
 * Double-reward guard (two layers): battle_logs.rewards_committed flipped with a conditional UPDATE, and
 * transactions UNIQUE(character_id, 'battle:<id>'). Either one alone prevents a second grant.
 */
export async function commitRewards(c: pg.PoolClient, battleId: string, ch: any, st: BattleState) {
  const flip = await c.query('UPDATE battle_logs SET rewards_committed=true WHERE id=$1 AND rewards_committed=false RETURNING id', [battleId]);
  if (!flip.rowCount) return { rewards: null, levelUp: null };
  return grantBattleReward(c, battleId, ch, st);
}
/** per-character part of the battle reward (party: called once per participant after the single flip) */
export async function grantBattleReward(c: pg.PoolClient, battleId: string, ch: any, st: BattleState) {
  const rw = computeRewards(st, ch.level, rng);
  const ins = await c.query(`INSERT INTO transactions(character_id,kind,gold_delta,items_delta,idempotency_key,ref_id) VALUES($1,'battle_reward',$2,$3,$4,$5)
    ON CONFLICT (character_id,idempotency_key) DO NOTHING RETURNING id`, [ch.id, rw.gold, JSON.stringify([...rw.drops, { exp: rw.exp }]), `battle:${battleId}`, battleId]);
  if (!ins.rowCount) return { rewards: null, levelUp: null };
  for (const d of rw.drops) await addItem(c, ch.id, d.itemId, d.qty);
  const levelUp = await grantGoldExp(c, ch, rw.gold, rw.exp);
  await recordKills(c, ch.id, st.combatants.filter((x) => x.side === 'enemy' && x.monsterId).map((x) => x.monsterId as string));
  const names = (await c.query('SELECT id,name FROM item_definitions WHERE id = ANY($1)', [rw.drops.map((d) => d.itemId)])).rows;
  return { rewards: { ...rw, drops: rw.drops.map((d) => ({ ...d, name: names.find((n) => n.id === d.itemId)?.name ?? d.itemId })) }, levelUp };
}
export async function listInventory(userId: string, characterId: string) {
  return tx(async (c) => { await ownChar(c, userId, characterId);
    return (await c.query(`SELECT i.item_id, d.name, d.category, sum(i.quantity)::int qty FROM inventory i JOIN item_definitions d ON d.id=i.item_id
      WHERE i.character_id=$1 GROUP BY i.item_id, d.name, d.category ORDER BY i.item_id`, [characterId])).rows; });
}
export { BATTLE_ITEMS };

/** Adds gold+EXP and applies level-ups (stats refilled). Shared by battle and quest rewards. */
export async function grantGoldExp(c: pg.PoolClient, ch: any, gold: number, exp: number) {
  const lv = applyExp(ch.level, Number(ch.exp), exp);
  await c.query('UPDATE characters SET gold=gold+$2, level=$3, exp=$4, updated_at=now() WHERE id=$1', [ch.id, gold, lv.level, lv.exp]);
  if (lv.levelsGained <= 0) return null;
  const b = statsAt(ch.class, ch.level), a = statsAt(ch.class, lv.level);
  await c.query(`UPDATE character_stats SET max_hp=$2,hp=$2,max_mp=$3,mp=$3,str=$4,vit=$5,"int"=$6,agi=$7,luk=$8,atk=$9,def=$10,matk=$11,mdef=$12 WHERE character_id=$1`,
    [ch.id, a.maxHp, a.maxMp, a.str, a.vit, a.int, a.agi, a.luk, a.atk, a.def, a.matk, a.mdef]);
  return { from: ch.level, to: lv.level, statDiff: Object.fromEntries(Object.keys(a).map((k) => [k, (a as any)[k] - (b as any)[k]]).filter(([, v]) => v !== 0)) };
}
export const battleRng: Rng = () => rng();
