import type pg from 'pg';
import { pool } from '../db/pool.js';
import { HttpError } from './auth.js';
import { ownChar, tx, UUID } from './common.js';
import { hub, onBattleChange } from '../rooms/hub.js';
/**
 * PHASE 7 social: friends, party (max 4, leader/invite/leave/kick/promote), guild (minimal: create/invite/accept/leave)
 * and chat persistence + spam guard. All membership changes are made under row locks; every caller identity comes from
 * the session (userId) + owned characterId, never from the request body.
 */
export const PARTY_MAX = 4, INVITE_TTL_MIN = 10;
const byName = async (c: pg.PoolClient, name: unknown) => {
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'invalid_name');
  const r = await c.query('SELECT id,name FROM characters WHERE name=$1 AND deleted_at IS NULL', [name.trim()]);
  if (!r.rows[0]) throw new HttpError(404, 'target_not_found'); return r.rows[0] as { id: string; name: string };
};
/** `by` has blocked `who` → requests from `who` are refused (the reply does not reveal more than "blocked") */
const notBlocked = async (c: pg.PoolClient | pg.Pool, by: string, who: string) => { if ((await c.query('SELECT 1 FROM character_blocks WHERE character_id=$1 AND blocked_character_id=$2', [by, who])).rowCount) throw new HttpError(409, 'blocked'); };
export const blockersOf = async (id: string) => (await pool.query('SELECT character_id FROM character_blocks WHERE blocked_character_id=$1', [id])).rows.map((r) => r.character_id as string);
const uuid = (v: unknown, code: string) => { if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(404, code); return v; };
export const partyOf = async (c: pg.PoolClient | pg.Pool, characterId: string, lock = false) =>
  (await c.query(`SELECT p.id, p.leader_character_id leader FROM party_members m JOIN parties p ON p.id=m.party_id WHERE m.character_id=$1 AND p.disbanded_at IS NULL ${lock ? 'FOR UPDATE OF p' : ''}`, [characterId])).rows[0] as { id: string; leader: string } | undefined;
export const partyMemberIds = async (c: pg.PoolClient | pg.Pool, partyId: string) => (await c.query('SELECT character_id FROM party_members WHERE party_id=$1 ORDER BY joined_at', [partyId])).rows.map((r) => r.character_id as string);
export const guildOf = async (c: pg.PoolClient | pg.Pool, characterId: string) =>
  (await c.query('SELECT g.id, g.name, m.rank FROM guild_members m JOIN guilds g ON g.id=m.guild_id WHERE m.character_id=$1', [characterId])).rows[0] as { id: string; name: string; rank: string } | undefined;
export const guildMemberIds = async (c: pg.PoolClient | pg.Pool, guildId: string) => (await c.query('SELECT character_id FROM guild_members WHERE guild_id=$1', [guildId])).rows.map((r) => r.character_id as string);
const friendIds = async (c: pg.PoolClient | pg.Pool, id: string) => (await c.query(`SELECT friend_character_id f FROM friends WHERE character_id=$1 AND status='accepted'`, [id])).rows.map((r) => r.f as string);

/* ---------- notifications (after commit) ---------- */
export async function systemMsg(to: string[], body: string) {
  for (const id of to) {
    const r = await pool.query(`INSERT INTO chat_messages(channel,scope_id,recipient_character_id,body) VALUES('system',NULL,$1,$2) RETURNING id,created_at`, [id, body.slice(0, 200)]);
    hub.send([id], 'chat', { id: Number(r.rows[0].id), channel: 'system', body, at: r.rows[0].created_at });
  }
}
const refresh = (ids: Iterable<string>) => hub.send(ids, 'social', {});
onBattleChange(async (id, v) => { // party members' panels show 戦闘中
  const p = await partyOf(pool, id).catch(() => undefined); if (p) hub.send((await partyMemberIds(pool, p.id)).filter((x) => x !== id), 'social', { battle: { id, v } });
});

/* ---------- view ---------- */
export async function socialView(userId: string, characterId: string) {
  const c = pool; const me = await tx((cl) => ownChar(cl, userId, characterId));
  const mem = (r: any) => ({ id: r.id, name: r.name, cls: r.class, level: r.level, online: hub.online(r.id), map: hub.mapOf(r.id), inBattle: hub.inBattle(r.id) });
  const fr = (await c.query(`SELECT c.id,c.name,c.class,c.level, f.status, EXISTS(SELECT 1 FROM friends b WHERE b.character_id=c.id AND b.friend_character_id=$1) back
    FROM friends f JOIN characters c ON c.id=f.friend_character_id WHERE f.character_id=$1 ORDER BY c.name`, [me.id])).rows;
  const incoming = (await c.query(`SELECT c.id,c.name FROM friends f JOIN characters c ON c.id=f.character_id WHERE f.friend_character_id=$1 AND f.status='pending'`, [me.id])).rows;
  const p = await partyOf(c, me.id);
  const party = p ? { id: p.id, leader: p.leader, members: (await c.query(`SELECT c.id,c.name,c.class,c.level FROM party_members m JOIN characters c ON c.id=m.character_id WHERE m.party_id=$1 ORDER BY m.joined_at`, [p.id])).rows.map(mem) } : null;
  const g = await guildOf(c, me.id);
  const guild = g ? { ...g, members: (await c.query(`SELECT c.id,c.name,c.class,c.level,m.rank FROM guild_members m JOIN characters c ON c.id=m.character_id WHERE m.guild_id=$1 ORDER BY array_position(ARRAY['leader','officer','member'], m.rank), c.name`, [g.id])).rows.map((r: any) => ({ ...mem(r), rank: r.rank })) } : null;
  const invites = (await c.query(`SELECT i.kind, i.scope_id, c.name "from" FROM social_invites i JOIN characters c ON c.id=i.invited_by WHERE i.character_id=$1 AND i.created_at > now() - interval '${INVITE_TTL_MIN} minutes' ORDER BY i.created_at`, [me.id])).rows
    .map((r) => ({ kind: r.kind, id: r.scope_id, from: r.from }));
  const blocks = (await c.query('SELECT c.id,c.name FROM character_blocks b JOIN characters c ON c.id=b.blocked_character_id WHERE b.character_id=$1 ORDER BY c.name', [me.id])).rows;
  const mute = (await c.query('SELECT until FROM chat_mutes WHERE character_id=$1 AND until > now()', [me.id])).rows[0]?.until ?? null;
  return { blocks, mutedUntil: mute, me: me.id, friends: fr.filter((f) => f.status === 'accepted').map(mem), outgoing: fr.filter((f) => f.status === 'pending').map((f) => ({ id: f.id, name: f.name })), incoming, party, guild, invites };
}

/* ---------- friends ---------- */
export async function friendRequest(userId: string, characterId: string, name: unknown) {
  let accepted = false; let target: { id: string; name: string }; let me: any;
  await tx(async (c) => {
    me = await ownChar(c, userId, characterId, true); target = await byName(c, name); await notBlocked(c, target.id, me.id);
    if (target.id === me.id) throw new HttpError(400, 'self');
    const rev = (await c.query('SELECT status FROM friends WHERE character_id=$1 AND friend_character_id=$2', [target.id, me.id])).rows[0];
    if (rev?.status === 'blocked') throw new HttpError(404, 'target_not_found');
    if (rev?.status === 'pending') { // they already asked me -> becomes mutual
      await c.query(`UPDATE friends SET status='accepted' WHERE character_id=$1 AND friend_character_id=$2`, [target.id, me.id]);
      await c.query(`INSERT INTO friends(character_id,friend_character_id,status) VALUES($1,$2,'accepted') ON CONFLICT (character_id,friend_character_id) DO UPDATE SET status='accepted'`, [me.id, target.id]); accepted = true;
    } else {
      const ins = await c.query(`INSERT INTO friends(character_id,friend_character_id,status) VALUES($1,$2,'pending') ON CONFLICT DO NOTHING`, [me.id, target.id]);
      if (!ins.rowCount) throw new HttpError(409, 'already_requested');
    }
  });
  refresh([me.id, target!.id]);
  await systemMsg([target!.id], accepted ? `${me.name} とフレンドになりました` : `${me.name} からフレンド申請が届きました`);
  return { ok: true, accepted };
}
export async function friendAccept(userId: string, characterId: string, fromId: unknown) {
  const from = uuid(fromId, 'request_not_found'); let me: any;
  await tx(async (c) => {
    me = await ownChar(c, userId, characterId, true);
    const u = await c.query(`UPDATE friends SET status='accepted' WHERE character_id=$1 AND friend_character_id=$2 AND status='pending'`, [from, me.id]);
    if (!u.rowCount) throw new HttpError(404, 'request_not_found');
    await c.query(`INSERT INTO friends(character_id,friend_character_id,status) VALUES($1,$2,'accepted') ON CONFLICT (character_id,friend_character_id) DO UPDATE SET status='accepted'`, [me.id, from]);
  });
  refresh([me.id, from]); await systemMsg([from], `${me.name} がフレンド申請を承認しました`);
  return { ok: true };
}
export async function friendRemove(userId: string, characterId: string, otherId: unknown) {
  const o = uuid(otherId, 'friend_not_found'); let me: any;
  await tx(async (c) => { me = await ownChar(c, userId, characterId, true);
    const d = await c.query('DELETE FROM friends WHERE (character_id=$1 AND friend_character_id=$2) OR (character_id=$2 AND friend_character_id=$1)', [me.id, o]);
    if (!d.rowCount) throw new HttpError(404, 'friend_not_found'); });
  refresh([me.id, o]); return { ok: true };
}

/* ---------- party ---------- */
export async function partyCreate(userId: string, characterId: string) {
  return tx(async (c) => {
    const me = await ownChar(c, userId, characterId, true);
    if (await partyOf(c, me.id)) throw new HttpError(409, 'already_in_party');
    const p = (await c.query('INSERT INTO parties(leader_character_id) VALUES($1) RETURNING id', [me.id])).rows[0];
    await c.query('INSERT INTO party_members(party_id,character_id) VALUES($1,$2)', [p.id, me.id]);
    return { ok: true, partyId: p.id as string };
  }).then((r) => { refresh([characterId]); return r; });
}
export async function partyInvite(userId: string, characterId: string, name: unknown) {
  let me: any, target: any, partyId = '';
  await tx(async (c) => {
    me = await ownChar(c, userId, characterId, true); target = await byName(c, name); await notBlocked(c, target.id, me.id);
    if (target.id === me.id) throw new HttpError(400, 'self');
    let p = await partyOf(c, me.id, true);
    if (!p) { // inviting without a party creates one with you as leader
      const np = (await c.query('INSERT INTO parties(leader_character_id) VALUES($1) RETURNING id', [me.id])).rows[0];
      await c.query('INSERT INTO party_members(party_id,character_id) VALUES($1,$2)', [np.id, me.id]); p = { id: np.id, leader: me.id };
    }
    if (p.leader !== me.id) throw new HttpError(403, 'not_leader');
    if ((await partyMemberIds(c, p.id)).length >= PARTY_MAX) throw new HttpError(409, 'party_full');
    if (await partyOf(c, target.id)) throw new HttpError(409, 'target_in_party');
    await c.query(`INSERT INTO social_invites(kind,scope_id,character_id,invited_by) VALUES('party',$1,$2,$3) ON CONFLICT (kind,scope_id,character_id) DO UPDATE SET created_at=now(), invited_by=$3`, [p.id, target.id, me.id]);
    partyId = p.id;
  });
  refresh([me.id, target.id]); await systemMsg([target.id], `${me.name} からパーティーに招待されました`);
  return { ok: true, partyId };
}
async function joinScope(kind: 'party' | 'guild', userId: string, characterId: string, scopeId: unknown) {
  const sid = uuid(scopeId, 'invite_not_found'); let me: any;
  await tx(async (c) => {
    me = await ownChar(c, userId, characterId, true);
    const inv = (await c.query(`DELETE FROM social_invites WHERE kind=$1 AND scope_id=$2 AND character_id=$3 RETURNING created_at`, [kind, sid, me.id])).rows[0];
    if (!inv || Date.now() - new Date(inv.created_at).getTime() > INVITE_TTL_MIN * 60_000) throw new HttpError(404, 'invite_not_found');
    if (kind === 'party') {
      if (await partyOf(c, me.id)) throw new HttpError(409, 'already_in_party');
      const p = (await c.query('SELECT id FROM parties WHERE id=$1 AND disbanded_at IS NULL FOR UPDATE', [sid])).rows[0]; // serialises concurrent accepts
      if (!p) throw new HttpError(404, 'party_not_found');
      if ((await partyMemberIds(c, sid)).length >= PARTY_MAX) throw new HttpError(409, 'party_full');
      await c.query('INSERT INTO party_members(party_id,character_id) VALUES($1,$2)', [sid, me.id]);
      await c.query(`DELETE FROM social_invites WHERE kind='party' AND character_id=$1`, [me.id]);
    } else {
      if (await guildOf(c, me.id)) throw new HttpError(409, 'already_in_guild');
      const g = (await c.query('SELECT id FROM guilds WHERE id=$1 FOR UPDATE', [sid])).rows[0]; if (!g) throw new HttpError(404, 'guild_not_found');
      await c.query(`INSERT INTO guild_members(guild_id,character_id,rank) VALUES($1,$2,'member')`, [sid, me.id]);
    }
  });
  const ids = kind === 'party' ? await partyMemberIds(pool, sid) : await guildMemberIds(pool, sid);
  refresh(ids); await systemMsg(ids.filter((x) => x !== me.id), `${me.name} が${kind === 'party' ? 'パーティー' : 'ギルド'}に参加しました`);
  return { ok: true };
}
export const partyAccept = (u: string, ch: string, partyId: unknown) => joinScope('party', u, ch, partyId);
export async function inviteDecline(userId: string, characterId: string, kind: unknown, scopeId: unknown) {
  const sid = uuid(scopeId, 'invite_not_found'); if (kind !== 'party' && kind !== 'guild') throw new HttpError(400, 'invalid_kind');
  await tx(async (c) => { const me = await ownChar(c, userId, characterId);
    if (!(await c.query('DELETE FROM social_invites WHERE kind=$1 AND scope_id=$2 AND character_id=$3', [kind, sid, me.id])).rowCount) throw new HttpError(404, 'invite_not_found'); });
  refresh([characterId]); return { ok: true };
}
/** leave (or be kicked). Leader leaving promotes the longest-standing member; last member disbands. */
async function removeFromParty(c: pg.PoolClient, partyId: string, leaderId: string, who: string) {
  await c.query('DELETE FROM party_members WHERE party_id=$1 AND character_id=$2', [partyId, who]);
  const rest = await partyMemberIds(c, partyId);
  if (!rest.length) { await c.query('UPDATE parties SET disbanded_at=now() WHERE id=$1', [partyId]); await c.query(`DELETE FROM social_invites WHERE kind='party' AND scope_id=$1`, [partyId]); return { rest, leader: null as string | null }; }
  let leader = leaderId; if (leader === who) { leader = rest[0]; await c.query('UPDATE parties SET leader_character_id=$2 WHERE id=$1', [partyId, leader]); }
  return { rest, leader };
}
export async function partyLeave(userId: string, characterId: string) {
  let me: any, out: any;
  await tx(async (c) => { me = await ownChar(c, userId, characterId, true); const p = await partyOf(c, me.id, true); if (!p) throw new HttpError(409, 'not_in_party'); out = await removeFromParty(c, p.id, p.leader, me.id); });
  refresh([me.id, ...out.rest]); await systemMsg(out.rest, `${me.name} がパーティーを抜けました${out.leader && out.leader !== me.id ? '' : ''}`);
  return { ok: true, newLeader: out.leader };
}
export async function partyKick(userId: string, characterId: string, targetId: unknown) {
  const t = uuid(targetId, 'member_not_found'); let me: any, out: any;
  await tx(async (c) => { me = await ownChar(c, userId, characterId, true); const p = await partyOf(c, me.id, true); if (!p) throw new HttpError(409, 'not_in_party');
    if (p.leader !== me.id) throw new HttpError(403, 'not_leader'); if (t === me.id) throw new HttpError(400, 'self');
    if (!(await partyMemberIds(c, p.id)).includes(t)) throw new HttpError(404, 'member_not_found'); out = await removeFromParty(c, p.id, p.leader, t); });
  refresh([t, ...out.rest]); await systemMsg([t], 'パーティーから外されました'); return { ok: true };
}
export async function partyPromote(userId: string, characterId: string, targetId: unknown) {
  const t = uuid(targetId, 'member_not_found'); let me: any, ids: string[] = [], tname = '';
  await tx(async (c) => { me = await ownChar(c, userId, characterId, true); const p = await partyOf(c, me.id, true); if (!p) throw new HttpError(409, 'not_in_party');
    if (p.leader !== me.id) throw new HttpError(403, 'not_leader'); ids = await partyMemberIds(c, p.id); if (!ids.includes(t) || t === me.id) throw new HttpError(404, 'member_not_found');
    await c.query('UPDATE parties SET leader_character_id=$2 WHERE id=$1', [p.id, t]); tname = (await c.query('SELECT name FROM characters WHERE id=$1', [t])).rows[0].name; });
  refresh(ids); await systemMsg(ids, `${tname} がパーティーリーダーになりました`); return { ok: true };
}

/* ---------- guild (minimal, needed for Guild chat) ---------- */
const GUILD_NAME = /^[\p{L}\p{N}ー・]{2,16}$/u;
export async function guildCreate(userId: string, characterId: string, name: unknown) {
  if (typeof name !== 'string' || !GUILD_NAME.test(name.trim())) throw new HttpError(400, 'invalid_guild_name');
  const r = await tx(async (c) => { const me = await ownChar(c, userId, characterId, true); if (await guildOf(c, me.id)) throw new HttpError(409, 'already_in_guild');
    if ((await c.query('SELECT 1 FROM guilds WHERE lower(name)=lower($1)', [name.trim()])).rowCount) throw new HttpError(409, 'guild_name_taken');
    const g = (await c.query('INSERT INTO guilds(name,leader_character_id) VALUES($1,$2) RETURNING id', [name.trim(), me.id])).rows[0];
    await c.query(`INSERT INTO guild_members(guild_id,character_id,rank) VALUES($1,$2,'leader')`, [g.id, me.id]); return { ok: true, guildId: g.id as string }; });
  refresh([characterId]); return r;
}
export async function guildInvite(userId: string, characterId: string, name: unknown) {
  let me: any, target: any;
  await tx(async (c) => { me = await ownChar(c, userId, characterId, true); target = await byName(c, name); await notBlocked(c, target.id, me.id); const g = await guildOf(c, me.id);
    if (!g) throw new HttpError(409, 'not_in_guild'); if (g.rank === 'member') throw new HttpError(403, 'not_officer');
    if (await guildOf(c, target.id)) throw new HttpError(409, 'target_in_guild');
    await c.query(`INSERT INTO social_invites(kind,scope_id,character_id,invited_by) VALUES('guild',$1,$2,$3) ON CONFLICT (kind,scope_id,character_id) DO UPDATE SET created_at=now(), invited_by=$3`, [g.id, target.id, me.id]); });
  refresh([target.id]); await systemMsg([target.id], `${me.name} からギルドに招待されました`); return { ok: true };
}
export const guildAccept = (u: string, ch: string, guildId: unknown) => joinScope('guild', u, ch, guildId);
export async function guildLeave(userId: string, characterId: string) {
  let me: any, rest: string[] = [];
  await tx(async (c) => { me = await ownChar(c, userId, characterId, true); const g = await guildOf(c, me.id); if (!g) throw new HttpError(409, 'not_in_guild');
    await c.query('DELETE FROM guild_members WHERE character_id=$1', [me.id]); rest = await guildMemberIds(c, g.id);
    if (!rest.length) await c.query('DELETE FROM guilds WHERE id=$1', [g.id]);
    else if (g.rank === 'leader') { await c.query(`UPDATE guild_members SET rank='leader' WHERE guild_id=$1 AND character_id=(SELECT character_id FROM guild_members WHERE guild_id=$1 ORDER BY joined_at LIMIT 1)`, [g.id]);
      await c.query('UPDATE guilds SET leader_character_id=(SELECT character_id FROM guild_members WHERE guild_id=$1 AND rank=\'leader\' LIMIT 1) WHERE id=$1', [g.id]); } });
  refresh([me.id, ...rest]); await systemMsg(rest, `${me.name} がギルドを抜けました`); return { ok: true };
}

/* ---------- chat ---------- */
export const CHAT_MAX = 200, RATE_N = 5, RATE_MS = 10_000, DUP_MS = 15_000, MUTE_MS = 30_000, STRIKES = 3;
type Spam = { times: number[]; last?: { body: string; at: number }; strikes: number[]; muteUntil: number };
const spam = new Map<string, Spam>();
export const __resetSpam = () => spam.clear();
export function sanitize(raw: unknown) {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFC').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
  return s && [...s].length <= CHAT_MAX ? s : null;
}
/** returns an error code or null. Strikes for flood/duplicate; STRIKES within 60s -> muted MUTE_MS. */
export function spamCheck(id: string, body: string, now = Date.now()): string | null {
  const s = spam.get(id) ?? { times: [], strikes: [], muteUntil: 0 }; spam.set(id, s);
  if (now < s.muteUntil) return 'muted';
  const strike = (code: string) => { s.strikes = s.strikes.filter((t) => now - t < 60_000); s.strikes.push(now); if (s.strikes.length >= STRIKES) { s.muteUntil = now + MUTE_MS; s.strikes = []; return 'muted'; } return code; };
  s.times = s.times.filter((t) => now - t < RATE_MS);
  if (s.times.length >= RATE_N) return strike('rate_limited');
  if (s.last && s.last.body === body && now - s.last.at < DUP_MS) return strike('duplicate');
  s.times.push(now); s.last = { body, at: now }; return null;
}
export type ChatChannel = 'local' | 'party' | 'guild' | 'whisper';
/** persistent mute (spam auto-mute or GM mute) — survives restarts (PHASE 10, migration 009) */
async function mutedUntil(id: string) { const r = await pool.query('SELECT until FROM chat_mutes WHERE character_id=$1 AND until > now()', [id]); return r.rows[0]?.until as Date | undefined; }
async function persistMute(id: string) { await pool.query(`INSERT INTO chat_mutes(character_id,until,reason) VALUES($1,now()+($2||' milliseconds')::interval,'spam') ON CONFLICT (character_id) DO UPDATE SET until=GREATEST(chat_mutes.until, EXCLUDED.until)`, [id, String(MUTE_MS)]); }
/** resolves recipients + persists. Local scope = map id (room broadcast is done by the caller). */
export async function postChat(sender: { id: string; name: string }, mapId: string, channel: unknown, raw: unknown, whisperTo?: unknown): Promise<any> {
  if (channel !== 'local' && channel !== 'party' && channel !== 'guild' && channel !== 'whisper') return { error: channel === 'system' ? 'system_readonly' : 'invalid_channel' };
  const body = sanitize(raw); if (!body) return { error: 'invalid_body' };
  if (await mutedUntil(sender.id)) return { error: 'muted' };
  let scope = mapId, to: string[] | null = null, recipient: { id: string; name: string } | null = null;
  if (channel === 'whisper') {
    if (typeof whisperTo !== 'string' || !whisperTo.trim()) return { error: 'invalid_name' };
    const t = (await pool.query('SELECT id,name FROM characters WHERE name=$1 AND deleted_at IS NULL', [whisperTo.trim()])).rows[0];
    if (!t) return { error: 'target_not_found' }; if (t.id === sender.id) return { error: 'self' };
    if ((await pool.query('SELECT 1 FROM character_blocks WHERE character_id=$1 AND blocked_character_id=$2', [t.id, sender.id])).rowCount) return { error: 'blocked' };
    if (!hub.online(t.id)) return { error: 'target_offline' };
    recipient = t; scope = t.id; to = [t.id, sender.id];
  }
  if (channel === 'party') { const p = await partyOf(pool, sender.id); if (!p) return { error: 'not_in_party' }; scope = p.id; to = await partyMemberIds(pool, p.id); }
  if (channel === 'guild') { const g = await guildOf(pool, sender.id); if (!g) return { error: 'not_in_guild' }; scope = g.id; to = await guildMemberIds(pool, g.id); }
  const e = spamCheck(sender.id, body); if (e) { if (e === 'muted') await persistMute(sender.id); return { error: e }; }
  const r = await pool.query(`INSERT INTO chat_messages(channel,scope_id,sender_character_id,recipient_character_id,body) VALUES($1,$2,$3,$4,$5) RETURNING id,created_at`, [channel === 'local' ? 'say' : channel, scope, sender.id, recipient?.id ?? null, body]);
  const blockers = await blockersOf(sender.id); // people who blocked the sender never receive the message
  if (to) to = to.filter((x) => !blockers.includes(x));
  return { msg: { id: Number(r.rows[0].id), channel, from: { id: sender.id, name: sender.name }, ...(recipient ? { to: recipient } : {}), body, at: r.rows[0].created_at }, to, exclude: blockers };
}
export async function chatHistory(characterId: string, mapId: string, limit = 30) {
  const p = await partyOf(pool, characterId), g = await guildOf(pool, characterId);
  const r = await pool.query(`SELECT m.id, m.channel, m.body, m.created_at at, m.sender_character_id sid, c.name, CASE WHEN m.channel='whisper' THEN m.recipient_character_id END rid, rc.name rname FROM chat_messages m LEFT JOIN characters c ON c.id=m.sender_character_id LEFT JOIN characters rc ON rc.id=m.recipient_character_id AND m.channel='whisper'
    WHERE ((m.channel='say' AND m.scope_id=$1) OR (m.channel='party' AND m.scope_id=$2) OR (m.channel='guild' AND m.scope_id=$3) OR (m.channel='system' AND m.recipient_character_id=$4)
      OR (m.channel='whisper' AND (m.recipient_character_id=$4 OR m.sender_character_id=$4)))
      AND NOT EXISTS (SELECT 1 FROM character_blocks b WHERE b.character_id=$4 AND b.blocked_character_id=m.sender_character_id)
    ORDER BY m.id DESC LIMIT $5`, [mapId, p?.id ?? '-', g?.id ?? '-', characterId, limit]);
  return r.rows.reverse().map((x) => ({ id: Number(x.id), channel: x.channel === 'say' ? 'local' : x.channel, body: x.body, at: x.at, ...(x.sid ? { from: { id: x.sid, name: x.name } } : {}), ...(x.rid ? { to: { id: x.rid, name: x.rname } } : {}) }));
}
export const friendsOf = (id: string) => friendIds(pool, id);

/* ---------- guild management (PHASE 9): roles, kick, leader transfer, disband ---------- */
const RANK_JA: Record<string, string> = { leader: 'マスター', officer: 'オフィサー', member: 'メンバー' };
async function guildCtx(c: pg.PoolClient, userId: string, characterId: string, targetId?: unknown) {
  const me = await ownChar(c, userId, characterId, true); const g = await guildOf(c, me.id); if (!g) throw new HttpError(409, 'not_in_guild');
  await c.query('SELECT id FROM guilds WHERE id=$1 FOR UPDATE', [g.id]); // serialise every membership/rank change of this guild
  let t: { id: string; name: string; rank: string } | undefined;
  if (targetId !== undefined) { const tid = uuid(targetId, 'member_not_found');
    t = (await c.query('SELECT c.id, c.name, m.rank FROM guild_members m JOIN characters c ON c.id=m.character_id WHERE m.guild_id=$1 AND m.character_id=$2', [g.id, tid])).rows[0];
    if (!t) throw new HttpError(404, 'member_not_found'); if (t.id === me.id) throw new HttpError(400, 'self'); }
  return { me, g, t: t! };
}
/** leader only: member ⇄ officer */
export async function guildSetRank(userId: string, characterId: string, targetId: unknown, rank: unknown) {
  if (rank !== 'officer' && rank !== 'member') throw new HttpError(400, 'invalid_rank');
  let ids: string[] = [], text = '';
  await tx(async (c) => { const { g, t } = await guildCtx(c, userId, characterId, targetId);
    if (g.rank !== 'leader') throw new HttpError(403, 'not_guild_leader');
    await c.query('UPDATE guild_members SET rank=$3 WHERE guild_id=$1 AND character_id=$2', [g.id, t.id, rank]);
    ids = await guildMemberIds(c, g.id); text = `${t.name} が${RANK_JA[rank]}になりました`; });
  refresh(ids); await systemMsg(ids, text); return { ok: true };
}
/** leader only: hand the guild to another member (old leader becomes officer) */
export async function guildTransfer(userId: string, characterId: string, targetId: unknown) {
  let ids: string[] = [], text = '';
  await tx(async (c) => { const { me, g, t } = await guildCtx(c, userId, characterId, targetId);
    if (g.rank !== 'leader') throw new HttpError(403, 'not_guild_leader');
    await c.query(`UPDATE guild_members SET rank='officer' WHERE guild_id=$1 AND character_id=$2`, [g.id, me.id]);
    await c.query(`UPDATE guild_members SET rank='leader' WHERE guild_id=$1 AND character_id=$2`, [g.id, t.id]);
    await c.query('UPDATE guilds SET leader_character_id=$2 WHERE id=$1', [g.id, t.id]);
    ids = await guildMemberIds(c, g.id); text = `${t.name} がギルドマスターになりました`; });
  refresh(ids); await systemMsg(ids, text); return { ok: true };
}
/** leader: kick anyone; officer: kick members only */
export async function guildKick(userId: string, characterId: string, targetId: unknown) {
  let ids: string[] = [], t: any;
  await tx(async (c) => { const r = await guildCtx(c, userId, characterId, targetId); t = r.t;
    if (r.g.rank === 'member' || (r.g.rank === 'officer' && t.rank !== 'member')) throw new HttpError(403, 'not_allowed');
    await c.query('DELETE FROM guild_members WHERE guild_id=$1 AND character_id=$2', [r.g.id, t.id]); ids = await guildMemberIds(c, r.g.id); });
  refresh([t.id, ...ids]); await systemMsg([t.id], 'ギルドから外されました'); await systemMsg(ids, `${t.name} がギルドから外されました`); return { ok: true };
}
/** leader only: removes the guild and every membership / pending invite */
export async function guildDisband(userId: string, characterId: string, confirmName: unknown) {
  let ids: string[] = [], name = '';
  await tx(async (c) => { const { g } = await guildCtx(c, userId, characterId);
    if (g.rank !== 'leader') throw new HttpError(403, 'not_guild_leader');
    if (confirmName !== g.name) throw new HttpError(400, 'confirm_name_mismatch');
    ids = await guildMemberIds(c, g.id); name = g.name;
    await c.query(`DELETE FROM social_invites WHERE kind='guild' AND scope_id=$1`, [g.id]); await c.query('DELETE FROM guilds WHERE id=$1', [g.id]); });
  refresh(ids); await systemMsg(ids, `ギルド「${name}」は解散しました`); return { ok: true };
}

/* ---------- block (PHASE 10 gap) ---------- */
export async function blockAdd(userId: string, characterId: string, name: unknown) {
  return tx(async (c) => { const me = await ownChar(c, userId, characterId, true); const t = await byName(c, name); if (t.id === me.id) throw new HttpError(400, 'self');
    await c.query('INSERT INTO character_blocks(character_id,blocked_character_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [me.id, t.id]);
    await c.query(`DELETE FROM friends WHERE (character_id=$1 AND friend_character_id=$2) OR (character_id=$2 AND friend_character_id=$1)`, [me.id, t.id]); // blocking ends a friendship
    await c.query('DELETE FROM social_invites WHERE character_id=$1 AND invited_by=$2', [me.id, t.id]);
    return { ok: true }; }).then((r) => { refresh([characterId]); return r; });
}
export async function blockRemove(userId: string, characterId: string, targetId: unknown) {
  const t = uuid(targetId, 'member_not_found');
  await tx(async (c) => { const me = await ownChar(c, userId, characterId); await c.query('DELETE FROM character_blocks WHERE character_id=$1 AND blocked_character_id=$2', [me.id, t]); });
  refresh([characterId]); return { ok: true };
}
