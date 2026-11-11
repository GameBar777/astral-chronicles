import type pg from 'pg';
import { DUNGEONS, resolveTurn, type BattleState, type Command, type Combatant } from '@astral/shared';
import { pool } from '../db/pool.js';
import { HttpError } from './auth.js';
import { tx, ownChar, UUID } from './common.js';
import { MAPS, TOWN } from '../world/maps.js';
import { hub } from '../rooms/hub.js';
import { partyOf, partyMemberIds, addGuildExp } from './social.js';
import { addItem, battleRng, consumeItem, fixedMonsters, grantBattleReward, grantGoldExp, inventoryCounts, playerCombatant, view } from './battle.js';
import { wearEquipment } from './inventory.js';
/**
 * PHASE 8 instance dungeon (TD-016). One dungeon_instances row per run; membership in dungeon_members (one active per character).
 * Party battles: every member submits a command; the turn resolves when all living members have submitted, when the
 * remaining ones are offline, or when the deadline passes (missing = defend). All writes happen under the battle row lock.
 */
const DBG = process.env.DUNGEON_DEBUG === '1';
export const dlog = (...a: unknown[]) => { if (DBG) console.log('[dungeon]', new Date().toISOString().slice(11, 23), ...a); };
export const turnMs = () => Number(process.env.DUNGEON_TURN_MS ?? 20_000);
const ZONE = 'ancient_ruins';

async function instanceOf(c: pg.PoolClient, characterId: string, lock = false) {
  const r = await c.query(`SELECT i.* FROM dungeon_members m JOIN dungeon_instances i ON i.id=m.instance_id WHERE m.character_id=$1 AND m.left_at IS NULL ${lock ? 'FOR UPDATE OF i' : ''}`, [characterId]);
  const inst = r.rows[0]; if (!inst) return null;
  if (inst.status === 'active' && new Date(inst.expires_at).getTime() < Date.now()) { await endInstance(c, inst.id, 'expired'); return null; }
  return inst;
}
async function members(c: pg.PoolClient, instId: string) {
  return (await c.query(`SELECT c.id,c.name,c.class,c.appearance,c.level,s.hp,s.max_hp,s.mp,s.max_mp,m.left_at FROM dungeon_members m JOIN characters c ON c.id=m.character_id
    JOIN character_stats s ON s.character_id=c.id WHERE m.instance_id=$1 ORDER BY m.joined_at, c.id`, [instId])).rows;
}
const activeBattleRow = async (c: pg.PoolClient, instId: string, lock = false) =>
  (await c.query(`SELECT * FROM battle_logs WHERE dungeon_instance_id=$1 AND result IS NULL ${lock ? 'FOR UPDATE' : ''}`, [instId])).rows[0];
/** ends the run: open battle aborted, everyone still inside is marked as left */
async function endInstance(c: pg.PoolClient, instId: string, status: 'failed' | 'expired' | 'cleared') {
  await c.query(`UPDATE dungeon_instances SET status=$2, ended_at=coalesce(ended_at,now()), updated_at=now() WHERE id=$1 AND status='active'`, [instId, status]);
  if (status !== 'cleared') {
    await c.query(`UPDATE battle_logs SET result='aborted', ended_at=now() WHERE dungeon_instance_id=$1 AND result IS NULL`, [instId]);
    await c.query('UPDATE dungeon_members SET left_at=now() WHERE instance_id=$1 AND left_at IS NULL', [instId]);
  }
}
async function dview(c: pg.PoolClient, inst: any, me: string) {
  const def = DUNGEONS[inst.dungeon_id], fl = def.floors[inst.current_floor - 1], st = inst.state ?? {}, cl = inst.rewards_claimed ?? {};
  const b = await activeBattleRow(c, inst.id);
  return {
    id: inst.id, dungeonId: inst.dungeon_id, name: def.name, status: inst.status, floor: inst.current_floor, floors: def.floors.length, floorName: fl.name,
    leader: inst.leader_character_id, expiresAt: inst.expires_at, isBoss: !!fl.boss, enemies: fl.boss ? [fl.boss] : fl.enemies ?? [],
    gateCleared: !!st.gates?.[inst.current_floor], hasChest: !!fl.chest, chestOpened: !!cl[`chest:${inst.current_floor}:${me}`],
    clearClaimed: !!cl[`clear:${me}`], battleId: b?.id ?? null,
    members: (await members(c, inst.id)).map((m) => ({ id: m.id, name: m.name, class: m.class, look: m.appearance, level: m.level, hp: m.hp, maxHp: m.max_hp, mp: m.mp, maxMp: m.max_mp,
      left: !!m.left_at, online: hub.online(m.id), inBattle: hub.inBattle(m.id) })),
  };
}
const notify = (ids: string[], msg: Record<string, unknown>) => hub.send(ids, 'dungeon', msg);
const activeIds = async (c: pg.PoolClient | pg.Pool, instId: string) =>
  (await c.query('SELECT character_id FROM dungeon_members WHERE instance_id=$1 AND left_at IS NULL', [instId])).rows.map((r) => r.character_id as string);

export const getDungeon = (userId: string, characterId: string) => tx(async (c) => {
  const me = await ownChar(c, userId, characterId); const inst = await instanceOf(c, me.id);
  return inst ? dview(c, inst, me.id) : null;
});

export async function enterDungeon(userId: string, characterId: string, dungeonId: unknown) {
  const def = DUNGEONS[String(dungeonId)]; if (!def) throw new HttpError(400, 'invalid_dungeon');
  let ids: string[] = [], skipped: string[] = [], meName = '';
  const out = await tx(async (c) => {
    const me = await ownChar(c, userId, characterId, true); meName = me.name;
    if (await instanceOf(c, me.id)) throw new HttpError(409, 'already_in_dungeon');
    if (me.map_id !== def.entryMap) throw new HttpError(409, 'wrong_map');
    const ent = MAPS[def.entryMap].objects.find((o) => o.id === def.entrance)!;
    if (Math.hypot(me.pos_x - ent.x, me.pos_y - ent.y) > 112) throw new HttpError(409, 'too_far');
    if (me.hp <= 0) throw new HttpError(409, 'character_down');
    if (me.level < def.minLevel) throw new HttpError(409, 'level_too_low');
    const cool = async (id: string) => (await c.query(`SELECT 1 FROM dungeon_members m JOIN dungeon_instances i ON i.id=m.instance_id
      WHERE m.character_id=$1 AND i.dungeon_id=$2 AND i.status='cleared' AND i.ended_at > now() - ($3||' minutes')::interval LIMIT 1`, [id, def.id, String(def.reentryCooldownMin)])).rowCount;
    if (await cool(me.id)) throw new HttpError(409, 'reentry_cooldown');
    const party = await partyOf(c, me.id, true);
    if (party && party.leader !== me.id) throw new HttpError(409, 'not_leader');
    const cand = party ? await partyMemberIds(c, party.id) : [me.id];
    for (const id of cand) {
      const r = (await c.query(`SELECT c.name,c.map_id,c.level,s.hp,
        EXISTS(SELECT 1 FROM battle_logs b WHERE b.result IS NULL AND (b.character_id=c.id OR b.participants @> ARRAY[c.id])) busy,
        EXISTS(SELECT 1 FROM dungeon_members m WHERE m.character_id=c.id AND m.left_at IS NULL) inside
        FROM characters c JOIN character_stats s ON s.character_id=c.id WHERE c.id=$1 FOR UPDATE OF c`, [id])).rows[0];
      if (id === me.id) { if (r.busy) throw new HttpError(409, 'in_battle'); ids.push(id); continue; }
      if (r && r.map_id === def.entryMap && r.hp > 0 && r.level >= def.minLevel && !r.busy && !r.inside && hub.online(id) && !(await cool(id))) ids.push(id); else if (r) skipped.push(r.name);
    }
    ids = ids.slice(0, def.maxParty);
    const inst = (await c.query(`INSERT INTO dungeon_instances(dungeon_id,party_id,status,expires_at,leader_character_id,state) VALUES($1,$2,'active',now()+($3||' minutes')::interval,$4,'{"gates":{}}') RETURNING *`,
      [def.id, party?.id ?? null, String(def.ttlMin), me.id])).rows[0];
    for (const id of ids) await c.query('INSERT INTO dungeon_members(instance_id,character_id) VALUES($1,$2)', [inst.id, id]);
    await c.query('UPDATE characters SET pos_x=$2,pos_y=$3,pos_updated_at=now() WHERE id = ANY($1)', [ids, Math.round(ent.x), Math.round(ent.y + 24)]);
    return { dungeon: await dview(c, inst, me.id), skipped };
  });
  notify(ids.filter((x) => x !== characterId), { type: 'entered', instanceId: out.dungeon.id, by: meName });
  return out;
}

export async function leaveDungeon(userId: string, characterId: string) {
  let rest: string[] = [];
  const r = await tx(async (c) => {
    const me = await ownChar(c, userId, characterId, true); const inst = await instanceOf(c, me.id, true);
    if (!inst) throw new HttpError(409, 'not_in_dungeon');
    const b = await activeBattleRow(c, inst.id);
    if (b && b.participants.includes(me.id)) throw new HttpError(409, 'in_battle');
    await c.query('UPDATE dungeon_members SET left_at=now() WHERE instance_id=$1 AND character_id=$2', [inst.id, me.id]);
    rest = await activeIds(c, inst.id);
    if (!rest.length && inst.status === 'active') await endInstance(c, inst.id, 'failed');
    else if (inst.leader_character_id === me.id && rest.length) await c.query('UPDATE dungeon_instances SET leader_character_id=$2 WHERE id=$1', [inst.id, rest[0]]);
    return { ok: true, status: rest.length ? inst.status : (inst.status === 'active' ? 'failed' : inst.status) };
  });
  notify(rest, { type: 'update' });
  return r;
}

export async function nextFloor(userId: string, characterId: string) {
  let ids: string[] = [];
  const r = await tx(async (c) => {
    const me = await ownChar(c, userId, characterId); const inst = await instanceOf(c, me.id, true);
    if (!inst || inst.status !== 'active') throw new HttpError(409, 'not_in_dungeon');
    if (inst.leader_character_id !== me.id) throw new HttpError(409, 'not_leader');
    if (!inst.state?.gates?.[inst.current_floor]) throw new HttpError(409, 'gate_not_cleared');
    if (inst.current_floor >= DUNGEONS[inst.dungeon_id].floors.length) throw new HttpError(409, 'last_floor');
    const n = (await c.query('UPDATE dungeon_instances SET current_floor=current_floor+1, updated_at=now() WHERE id=$1 RETURNING *', [inst.id])).rows[0];
    ids = await activeIds(c, inst.id);
    return dview(c, n, me.id);
  });
  notify(ids.filter((x) => x !== characterId), { type: 'update' });
  return r;
}

/** personal reward with two guards: rewards_claimed key flipped conditionally + transactions UNIQUE key */
async function claim(c: pg.PoolClient, inst: any, ch: any, key: string, txKey: string, gold: number, exp: number, items: { itemId: string; qty: number }[]) {
  const f = await c.query(`UPDATE dungeon_instances SET rewards_claimed = rewards_claimed || jsonb_build_object($2::text, true) WHERE id=$1 AND NOT (rewards_claimed ? $2) RETURNING id`, [inst.id, key]);
  if (!f.rowCount) throw new HttpError(409, 'already_claimed');
  const ins = await c.query(`INSERT INTO transactions(character_id,kind,gold_delta,items_delta,idempotency_key,ref_id) VALUES($1,'dungeon_reward',$2,$3,$4,$5) ON CONFLICT (character_id,idempotency_key) DO NOTHING RETURNING id`,
    [ch.id, gold, JSON.stringify([...items, { exp }]), txKey, inst.id]);
  if (!ins.rowCount) throw new HttpError(409, 'already_claimed');
  for (const it of items) await addItem(c, ch.id, it.itemId, it.qty);
  const levelUp = await grantGoldExp(c, ch, gold, exp);
  const names = (await c.query('SELECT id,name FROM item_definitions WHERE id = ANY($1)', [items.map((i) => i.itemId)])).rows;
  return { gold, exp, items: items.map((i) => ({ ...i, name: names.find((n) => n.id === i.itemId)?.name ?? i.itemId })), levelUp };
}
export const openChest = (userId: string, characterId: string) => tx(async (c) => {
  const me = await ownChar(c, userId, characterId, true); const inst = await instanceOf(c, me.id, true);
  if (!inst) throw new HttpError(409, 'not_in_dungeon');
  const fl = DUNGEONS[inst.dungeon_id].floors[inst.current_floor - 1];
  if (!fl.chest) throw new HttpError(409, 'no_chest');
  if (!inst.state?.gates?.[inst.current_floor]) throw new HttpError(409, 'gate_not_cleared');
  return claim(c, inst, me, `chest:${inst.current_floor}:${me.id}`, `dungeon:${inst.id}:chest:${inst.current_floor}`, fl.chest.gold, 0, fl.chest.items);
});
export const claimClear = (userId: string, characterId: string) => tx(async (c) => {
  const me = await ownChar(c, userId, characterId, true); const inst = await instanceOf(c, me.id, true);
  if (!inst) throw new HttpError(409, 'not_in_dungeon');
  if (inst.status !== 'cleared') throw new HttpError(409, 'not_cleared');
  const rw = DUNGEONS[inst.dungeon_id].clearReward;
  const out = await claim(c, inst, me, `clear:${me.id}`, `dungeon:${inst.id}:clear`, rw.gold, rw.exp, rw.items);
  await addGuildExp(c, me.id, rw.exp);
  return out;
});

/* ---------------- party battle ---------------- */
type Push = { ids: string[]; per: Record<string, unknown>; ended: boolean; row: any; st: BattleState; events: any[]; instIds: string[] };
function broadcast(p: Push, except?: string) {
  dlog('push turn', p.st.turn, p.st.status, 'to', p.ids.filter((i) => i !== except).map((i) => `${i.slice(0, 4)}@${hub.mapOf(i)}`));
  for (const id of p.ids) if (id !== except) hub.send([id], 'battle', view({ ...p.row, state: p.st }, { events: p.events, ...(p.per[id] as object ?? {}), pending: [] }));
  if (p.ended) for (const id of p.ids) hub.setBattle(id, false);
  notify(p.instIds, { type: 'update' });
}
export async function startDungeonBattle(userId: string, characterId: string) {
  let ids: string[] = [];
  const out = await tx(async (c) => {
    const me = await ownChar(c, userId, characterId); const inst = await instanceOf(c, me.id, true);
    if (!inst || inst.status !== 'active') throw new HttpError(409, 'not_in_dungeon');
    const cur = await activeBattleRow(c, inst.id);
    if (cur) { ids = []; return view(cur, { resumed: true, pending: Object.keys(cur.pending ?? {}) }); }
    if (inst.state?.gates?.[inst.current_floor]) throw new HttpError(409, 'already_cleared');
    const fl = DUNGEONS[inst.dungeon_id].floors[inst.current_floor - 1];
    const mem = (await members(c, inst.id)).filter((m) => !m.left_at && m.hp > 0);
    if (!mem.length) throw new HttpError(409, 'character_down');
    const players: Combatant[] = [];
    for (const m of mem) players.push(await playerCombatant(c, await ownCharById(c, m.id), `p${players.length}`));
    const enemies = await fixedMonsters(c, fl.boss ? [fl.boss] : fl.enemies!);
    const state: BattleState = { turn: 1, status: 'active', canFlee: !fl.boss, combatants: [...players, ...enemies],
      log: [{ turn: 0, kind: 'start', text: fl.boss ? `${enemies[0].name}が立ちはだかった！` : `${enemies.map((e) => e.name).join('、')}があらわれた！` }] };
    ids = mem.map((m) => m.id);
    const row = (await c.query(`INSERT INTO battle_logs(character_id,zone,participants,monsters,state,log,dungeon_instance_id) VALUES(NULL,$1,$2,$3,$4,$5,$6) RETURNING *`,
      [ZONE, ids, JSON.stringify(enemies.map((e) => ({ id: e.id, monsterId: e.monsterId, level: e.level }))), JSON.stringify(state), JSON.stringify(state.log), inst.id])).rows[0];
    return view(row, { resumed: false, pending: [] });
  });
  for (const id of ids) hub.setBattle(id, true);
  hub.send(ids.filter((x) => x !== characterId), 'battle', out);
  if (ids.length) notify(ids, { type: 'update' });
  return out;
}
const ownCharById = async (c: pg.PoolClient, id: string) => (await c.query(`SELECT c.id,c.name,c.class,c.appearance,c.level,c.exp,c.gold,c.map_id,s.* FROM characters c JOIN character_stats s ON s.character_id=c.id WHERE c.id=$1 FOR UPDATE OF c`, [id])).rows[0];
export const isPartyBattle = async (battleId: string) => UUID.test(battleId) && !!(await pool.query('SELECT 1 FROM battle_logs WHERE id=$1 AND dungeon_instance_id IS NOT NULL', [battleId])).rowCount;

/** resolve the stored turn (missing commands = defend). Caller holds the battle row lock. */
async function resolveParty(c: pg.PoolClient, row: any): Promise<Push> {
  const st0: BattleState = row.state; const pend = row.pending ?? {};
  const alive = st0.combatants.filter((x) => x.side === 'player' && x.hp > 0);
  const cmds: Record<string, Command> = {}, invBy: Record<string, Record<string, number>> = {};
  for (const p of alive) { cmds[p.id] = pend[p.id] ?? { type: 'defend' }; invBy[p.id] = await inventoryCounts(c, p.characterId!); }
  let r;
  try { r = resolveTurn(st0, cmds, battleRng, {}, invBy); }
  catch { for (const p of alive) cmds[p.id] = cmds[p.id].type === 'item' ? { type: 'defend' } : cmds[p.id]; r = resolveTurn(st0, cmds, battleRng, {}, invBy); } // item spent elsewhere meanwhile
  const st = r.state, byPid = new Map(st.combatants.filter((x) => x.side === 'player').map((x) => [x.id, x]));
  for (const u of r.consumedBy) await consumeItem(c, byPid.get(u.actor)!.characterId!, u.itemId);
  const per: Record<string, any> = {}; const ended = st.status !== 'active';
  const inst = (await c.query('SELECT * FROM dungeon_instances WHERE id=$1 FOR UPDATE', [row.dungeon_instance_id])).rows[0];
  for (const p of byPid.values()) {
    const hp = st.status === 'defeat' ? Math.max(1, Math.floor(p.maxHp * 0.3)) : ended ? Math.max(1, p.hp) : Math.max(0, p.hp);
    await c.query('UPDATE character_stats SET hp=$2, mp=$3 WHERE character_id=$1', [p.characterId, Math.min(hp, p.maxHp), p.mp]);
    if (ended && p.characterId) await wearEquipment(c, p.characterId);
  }
  if (st.status === 'victory') {
    const flip = await c.query('UPDATE battle_logs SET rewards_committed=true WHERE id=$1 AND rewards_committed=false RETURNING id', [row.id]);
    if (flip.rowCount) for (const p of byPid.values()) per[p.characterId!] = await grantBattleReward(c, row.id, await ownCharById(c, p.characterId!), st);
    const gates = { ...(inst.state?.gates ?? {}), [inst.current_floor]: true };
    await c.query(`UPDATE dungeon_instances SET state = jsonb_set(state,'{gates}',$2::jsonb), updated_at=now() WHERE id=$1`, [inst.id, JSON.stringify(gates)]);
    if (DUNGEONS[inst.dungeon_id].floors[inst.current_floor - 1].boss) await endInstance(c, inst.id, 'cleared');
  } else if (st.status === 'defeat') {
    const sp = MAPS[TOWN].spawn;
    await c.query('UPDATE characters SET map_id=$2,pos_x=$3,pos_y=$4,pos_updated_at=now() WHERE id = ANY($1)', [row.participants, TOWN, Math.round(sp.x), Math.round(sp.y)]);
    await c.query(`UPDATE battle_logs SET result='defeat', ended_at=now() WHERE id=$1`, [row.id]);
    await endInstance(c, inst.id, 'failed');
  }
  const instIds = await activeIds(c, inst.id);
  await c.query(`UPDATE battle_logs SET state=$2, log=$3, pending='{}', deadline_at=NULL, updated_at=now() ${ended ? ', result=$4, ended_at=now(), rewards=$5' : ''} WHERE id=$1`,
    ended ? [row.id, JSON.stringify(st), JSON.stringify(st.log), st.status, JSON.stringify(per)] : [row.id, JSON.stringify(st), JSON.stringify(st.log)]);
  for (const id of row.participants) per[id] = { rewards: per[id]?.rewards ?? null, levelUp: per[id]?.levelUp ?? null, dungeonStatus: ended ? (st.status === 'defeat' ? 'failed' : undefined) : undefined };
  return { ids: row.participants, per, ended, row, st, events: r.events, instIds: [...new Set([...instIds, ...row.participants])] };
}

export async function partyAct(userId: string, battleId: string, turn: number, command: Command) {
  let push: Push | null = null, myId = '';
  const out = await tx(async (c) => {
    const row = (await c.query('SELECT * FROM battle_logs WHERE id=$1 AND dungeon_instance_id IS NOT NULL FOR UPDATE', [battleId])).rows[0];
    if (!row) throw new HttpError(404, 'battle_not_found');
    const mine = (await c.query('SELECT id FROM characters WHERE id = ANY($1) AND user_id=$2 AND deleted_at IS NULL', [row.participants, userId])).rows[0];
    if (!mine) throw new HttpError(404, 'battle_not_found');
    myId = mine.id;
    if (row.result) throw new HttpError(409, 'battle_over');
    if (turn !== row.state.turn) throw new HttpError(409, 'stale_turn');
    const st: BattleState = row.state; const me = st.combatants.find((x) => x.characterId === myId)!;
    if (me.hp <= 0) throw new HttpError(409, 'character_down');
    const alive = st.combatants.filter((x) => x.side === 'player' && x.hp > 0);
    // validate now (dry run with a fixed rng, others defend) so a bad command never blocks the party
    const probe: Record<string, Command> = {}; const invBy: Record<string, Record<string, number>> = {};
    for (const p of alive) probe[p.id] = p.id === me.id ? command : { type: 'defend' };
    invBy[me.id] = await inventoryCounts(c, myId);
    resolveTurn(st, probe, () => 0.5, {}, invBy);
    row.pending = { ...(row.pending ?? {}), [me.id]: command };
    // BUG-023: a member who is merely in the dungeon room (online) but whose Battle scene is not up
    // must not stall the party — they auto-defend this turn and catch the next state when they open Battle.
    // Members who have sent battle_ready block the turn until they act or the deadline fires.
    const waiting = alive.filter((p) => !row.pending[p.id] && hub.online(p.characterId!) && hub.battleReady(p.characterId!));
    dlog('act', myId.slice(0, 4), 'turn', turn, 'waiting', waiting.map((p) => `${p.characterId!.slice(0, 4)} ready=${hub.battleReady(p.characterId!)} @${hub.mapOf(p.characterId!)}`));
    if (!waiting.length) { push = await resolveParty(c, row); return view({ ...row, state: push.st }, { events: push.events, ...(push.per[myId] as object), pending: [] }); }
    const dl = row.deadline_at ?? new Date(Date.now() + turnMs());
    await c.query('UPDATE battle_logs SET pending=$2, deadline_at=$3, updated_at=now() WHERE id=$1', [row.id, JSON.stringify(row.pending), dl]);
    return view(row, { waiting: true, pending: Object.keys(row.pending), deadlineAt: dl });
  });
  if (push) broadcast(push, myId);
  else hub.send((out as any).participants.filter((x: string) => x !== myId), 'battle_wait', { id: battleId, turn, pending: (out as any).pending, deadlineAt: (out as any).deadlineAt });
  return out;
}

/** deadline sweep: resolves party turns whose deadline passed, and expires timed-out instances */
export async function sweepDungeons() {
  const due = (await pool.query(`SELECT id FROM battle_logs WHERE dungeon_instance_id IS NOT NULL AND result IS NULL AND deadline_at < now()`)).rows;
  for (const { id } of due) {
    let push: Push | null = null;
    await tx(async (c) => {
      const row = (await c.query('SELECT * FROM battle_logs WHERE id=$1 AND result IS NULL AND deadline_at < now() FOR UPDATE SKIP LOCKED', [id])).rows[0];
      if (row) { dlog('sweep resolves turn', row.state.turn, 'pending', Object.keys(row.pending ?? {})); push = await resolveParty(c, row); }
    }).catch((e) => console.error('[dungeon sweep]', e));
    if (push) broadcast(push);
  }
  const exp = (await pool.query(`SELECT id FROM dungeon_instances WHERE status='active' AND expires_at < now()`)).rows;
  for (const { id } of exp) {
    const ids = await activeIds(pool, id);
    await tx((c) => endInstance(c, id, 'expired'));
    for (const x of ids) hub.setBattle(x, false);
    notify(ids, { type: 'ended', status: 'expired' });
  }
}
let timer: NodeJS.Timeout | undefined;
export const startDungeonSweep = (ms = 1000) => { if (!timer) { timer = setInterval(() => { sweepDungeons().catch(() => {}); }, ms); timer.unref(); } };
export const stopDungeonSweep = () => { if (timer) clearInterval(timer); timer = undefined; };
