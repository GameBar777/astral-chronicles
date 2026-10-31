import type pg from 'pg';
import { ItemError, NPCS, type QuestObjective } from '@astral/shared';
import { HttpError } from './auth.js';
import { tx, ownChar, idem, notInBattle } from './common.js';
import { addItem, removeItems } from './inventory.js';
import { assertNearNpc } from './world.js';
import { grantGoldExp } from './battle.js';
/**
 * PHASE 5 quests. Double-reward guard (two layers, like battle rewards):
 *  1) the character row lock + character_quests row lock and the status transition active -> rewarded,
 *  2) transactions UNIQUE(character_id,'quest:<id>:<n>') where n = completion count (dailies get a new n per day).
 */
const TODAY_JST = "date_trunc('day', now() AT TIME ZONE 'Asia/Tokyo')";
type Q = { id: string; name: string; category: string; npc_id: string; requirements: any; objectives: QuestObjective[]; rewards: any; max_repeats: number; description: string };
type CQ = { quest_id: string; status: string; progress: Record<string, number>; times_completed: number; rewarded_today: boolean } | undefined;
const kills = (p: Record<string, number> | undefined, m: string) => Number(p?.[`kill:${m}`] ?? 0);
function stateOf(q: Q, cq: CQ, level: number) {
  if (cq?.status === 'active') return 'active';
  if (cq?.status === 'rewarded') {
    if (q.category === 'daily') return cq.rewarded_today ? 'done_today' : 'available';
    if (cq.times_completed >= q.max_repeats) return 'rewarded';
  }
  return level >= Number(q.requirements?.level ?? 1) ? 'available' : 'locked';
}
async function invCount(c: pg.PoolClient, charId: string, itemId: string) {
  return (await c.query(`SELECT coalesce(sum(i.quantity),0)::int n FROM inventory i WHERE i.character_id=$1 AND i.item_id=$2
    AND NOT EXISTS (SELECT 1 FROM character_equipment e WHERE e.inventory_id=i.id)`, [charId, itemId])).rows[0].n;
}
async function objView(c: pg.PoolClient, charId: string, q: Q, cq: CQ) {
  const out = [];
  for (const o of q.objectives) {
    if (o.type === 'kill') out.push({ ...o, have: Math.min(o.qty, kills(cq?.progress, o.monsterId)) });
    else if (o.type === 'collect') out.push({ ...o, have: Math.min(o.qty, await invCount(c, charId, o.itemId)) });
    else out.push({ ...o, qty: 1, have: Math.min(1, await invCount(c, charId, o.itemId)) });
  }
  return out;
}
const loadAll = async (c: pg.PoolClient, charId: string) => {
  const qs = (await c.query('SELECT * FROM quests ORDER BY id')).rows as Q[];
  const cqs = (await c.query(`SELECT quest_id,status,progress,times_completed,(rewarded_at AT TIME ZONE 'Asia/Tokyo') >= ${TODAY_JST} rewarded_today FROM character_quests WHERE character_id=$1`, [charId])).rows;
  return { qs, cq: (id: string) => cqs.find((r) => r.quest_id === id) as CQ };
};
export async function listQuests(userId: string, characterId: unknown) {
  return tx(async (c) => {
    const ch = await ownChar(c, userId, characterId);
    const { qs, cq } = await loadAll(c, ch.id);
    const out = [];
    for (const q of qs) {
      const s = stateOf(q, cq(q.id), ch.level), objectives = await objView(c, ch.id, q, cq(q.id));
      out.push({ id: q.id, name: q.name, category: q.category, npcId: q.npc_id, npcName: NPCS[q.npc_id]?.name ?? q.npc_id, description: q.description,
        rewards: q.rewards, state: s, objectives, ready: s === 'active' && objectives.every((o) => o.have >= o.qty),
        turnInNpc: (q.objectives.find((o) => o.type === 'deliver') as any)?.npcId ?? q.npc_id, timesCompleted: cq(q.id)?.times_completed ?? 0 });
    }
    return out;
  });
}
export const acceptQuest = (userId: string, characterId: unknown, questId: unknown, requestId: unknown) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId, true);
  return idem(c, ch.id, requestId, 'quest_accept', async () => {
    const q = (await c.query('SELECT * FROM quests WHERE id=$1', [String(questId)])).rows[0] as Q | undefined;
    if (!q) throw new HttpError(404, 'quest_not_found');
    assertNearNpc(ch, q.npc_id);
    const cq = (await c.query(`SELECT quest_id,status,progress,times_completed,(rewarded_at AT TIME ZONE 'Asia/Tokyo') >= ${TODAY_JST} rewarded_today FROM character_quests WHERE character_id=$1 AND quest_id=$2 FOR UPDATE`, [ch.id, q.id])).rows[0] as CQ;
    const s = stateOf(q, cq, ch.level);
    if (s !== 'available') throw new ItemError(s === 'locked' ? 'level_too_low' : s === 'active' ? 'quest_active' : 'quest_done');
    await c.query(`INSERT INTO character_quests(character_id,quest_id,status,progress) VALUES($1,$2,'active','{}')
      ON CONFLICT (character_id,quest_id) DO UPDATE SET status='active', progress='{}', accepted_at=now(), completed_at=NULL`, [ch.id, q.id]);
    const given = [];
    for (const o of q.objectives) if (o.type === 'deliver' && !(await invCount(c, ch.id, o.itemId))) { await addItem(c, ch.id, o.itemId, 1); given.push({ itemId: o.itemId, qty: 1 }); }
    return { questId: q.id, state: 'active', given, itemsDelta: given };
  });
});
export const turnInQuest = (userId: string, characterId: unknown, questId: unknown, requestId: unknown) => tx(async (c) => {
  const ch = await ownChar(c, userId, characterId, true);
  return idem(c, ch.id, requestId, 'quest_complete', async () => {
    await notInBattle(c, ch.id);
    const q = (await c.query('SELECT * FROM quests WHERE id=$1', [String(questId)])).rows[0] as Q | undefined;
    if (!q) throw new HttpError(404, 'quest_not_found');
    const cq = (await c.query('SELECT * FROM character_quests WHERE character_id=$1 AND quest_id=$2 FOR UPDATE', [ch.id, q.id])).rows[0];
    if (!cq || cq.status !== 'active') throw new ItemError(cq?.status === 'rewarded' ? 'already_rewarded' : 'quest_not_active');
    const deliver = q.objectives.find((o) => o.type === 'deliver') as { npcId: string } | undefined;
    assertNearNpc(ch, deliver?.npcId ?? q.npc_id);
    for (const o of q.objectives) if (o.type === 'kill' && kills(cq.progress, o.monsterId) < o.qty) throw new ItemError('quest_incomplete');
    try { await removeItems(c, ch.id, q.objectives.filter((o) => o.type !== 'kill').map((o: any) => ({ itemId: o.itemId, qty: o.qty ?? 1 }))); }
    catch (e) { if (e instanceof ItemError) throw new ItemError('quest_incomplete'); throw e; }
    const n = cq.times_completed + 1, rw = q.rewards ?? {};
    const ins = await c.query(`INSERT INTO transactions(character_id,kind,gold_delta,items_delta,idempotency_key,ref_id) VALUES($1,'quest_reward',$2,$3,$4,$5)
      ON CONFLICT (character_id,idempotency_key) DO NOTHING RETURNING id`, [ch.id, rw.gold ?? 0, JSON.stringify([...(rw.items ?? []), { exp: rw.exp ?? 0 }]), `quest:${q.id}:${n}`, q.id]);
    if (!ins.rowCount) throw new ItemError('already_rewarded');
    for (const it of rw.items ?? []) await addItem(c, ch.id, it.itemId, it.qty, false); // rewards are never lost to a full bag (TD-012)
    const levelUp = await grantGoldExp(c, ch, rw.gold ?? 0, rw.exp ?? 0);
    await c.query(`UPDATE character_quests SET status='rewarded', times_completed=$3, completed_at=now(), rewarded_at=now() WHERE character_id=$1 AND quest_id=$2`, [ch.id, q.id, n]);
    return { questId: q.id, state: 'rewarded', rewards: rw, levelUp };
  });
});
/** Called inside the battle reward transaction (already double-reward guarded) for every defeated monster. */
export async function recordKills(c: pg.PoolClient, charId: string, monsterIds: string[]) {
  if (!monsterIds.length) return;
  const rows = (await c.query(`SELECT cq.quest_id, cq.progress, q.objectives FROM character_quests cq JOIN quests q ON q.id=cq.quest_id
    WHERE cq.character_id=$1 AND cq.status='active' FOR UPDATE OF cq`, [charId])).rows;
  for (const r of rows) {
    const p = { ...r.progress }; let changed = false;
    for (const o of r.objectives as QuestObjective[]) if (o.type === 'kill') {
      const k = `kill:${o.monsterId}`, add = monsterIds.filter((m) => m === o.monsterId).length;
      if (add) { p[k] = Math.min(o.qty, Number(p[k] ?? 0) + add); changed = true; }
    }
    if (changed) await c.query('UPDATE character_quests SET progress=$3 WHERE character_id=$1 AND quest_id=$2', [charId, r.quest_id, JSON.stringify(p)]);
  }
}
