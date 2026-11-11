import { pool } from '../db/pool.js';
import { HttpError } from './auth.js';
import { hub } from '../rooms/hub.js';
import { UUID } from './common.js';
import { addItem } from './inventory.js';
import { tx } from './common.js';
/**
 * PHASE 10 operations (SECTION 20/23): audit log, maintenance mode, announcements, admin tools.
 * Admin rights come only from users.role in the DB (gm/admin), checked per request — never from the client.
 * gm: status, logs, announcements, mute. admin: everything incl. maintenance, ban, item grant.
 */
export async function audit(a: { userId?: string | null; characterId?: string | null; action: string; target?: string | null; detail?: unknown; ip?: string | null }) {
  await pool.query('INSERT INTO audit_logs(actor_user_id,actor_character_id,action,target,detail,ip) VALUES($1,$2,$3,$4,$5,$6)',
    [a.userId ?? null, a.characterId ?? null, a.action, a.target ?? null, JSON.stringify(a.detail ?? {}), a.ip ?? null]).catch((e) => console.error('[audit]', e.message));
}
let maint = { on: false, message: '', at: 0 };
export async function maintenance() {
  if (Date.now() - maint.at > 2000) { const r = await pool.query(`SELECT value FROM server_settings WHERE key='maintenance'`); maint = { ...(r.rows[0]?.value ?? { on: false, message: '' }), at: Date.now() }; }
  return { on: !!maint.on, message: String(maint.message ?? '') };
}
export const __resetMaintCache = () => { maint.at = 0; };
export const isStaff = (role?: string) => role === 'gm' || role === 'admin';
export function requireRole(role: string | undefined, need: 'gm' | 'admin') {
  if (need === 'admin' ? role !== 'admin' : !isStaff(role)) throw new HttpError(403, 'forbidden');
}
export async function setMaintenance(actor: { userId: string; role: string; ip?: string }, on: unknown, message: unknown) {
  requireRole(actor.role, 'admin');
  const v = { on: on === true, message: typeof message === 'string' ? message.slice(0, 200) : '' };
  await pool.query(`INSERT INTO server_settings(key,value,updated_at) VALUES('maintenance',$1,now()) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`, [JSON.stringify(v)]);
  maint.at = 0; await audit({ userId: actor.userId, action: 'admin.maintenance', detail: v, ip: actor.ip });
  if (v.on) for (const id of hub.onlineIds()) hub.send([id], 'system_notice', { type: 'maintenance', message: v.message || 'メンテナンスを開始します' });
  return v;
}
export async function serverStatus(actor: { role: string }) {
  requireRole(actor.role, 'gm');
  const db = await pool.query('SELECT (SELECT count(*)::int FROM users) users, (SELECT count(*)::int FROM characters WHERE deleted_at IS NULL) characters, (SELECT count(*)::int FROM market_listings WHERE status=\'active\') listings, (SELECT count(*)::int FROM dungeon_instances WHERE status=\'active\') dungeons');
  const m = process.memoryUsage();
  return { online: hub.onlineIds().length, uptimeSec: Math.round(process.uptime()), rssMB: Math.round(m.rss / 1048576), heapMB: Math.round(m.heapUsed / 1048576), ...db.rows[0], maintenance: await maintenance() };
}
export async function publicStatus() { const m = await maintenance(); return { ok: true, maintenance: m.on, message: m.on ? m.message : '', online: hub.onlineIds().length }; }
export async function listAnnouncements() {
  return (await pool.query('SELECT id, title, body, starts_at "startsAt", ends_at "endsAt" FROM announcements WHERE starts_at <= now() AND (ends_at IS NULL OR ends_at > now()) ORDER BY starts_at DESC LIMIT 10')).rows;
}
export async function createAnnouncement(actor: { userId: string; role: string; ip?: string }, b: any) {
  requireRole(actor.role, 'gm');
  const title = typeof b?.title === 'string' ? b.title.trim() : '', body = typeof b?.body === 'string' ? b.body.trim() : '';
  if (!title || title.length > 60 || !body || body.length > 1000) throw new HttpError(400, 'invalid_announcement');
  const hours = b?.hours === undefined ? null : Number(b.hours); if (hours !== null && !(hours > 0 && hours <= 24 * 90)) throw new HttpError(400, 'invalid_announcement');
  const r = await pool.query(`INSERT INTO announcements(title,body,ends_at,created_by) VALUES($1,$2,CASE WHEN $3::float IS NULL THEN NULL ELSE now()+($3::float||' hours')::interval END,$4) RETURNING id`, [title, body, hours, actor.userId]);
  await audit({ userId: actor.userId, action: 'admin.announce', target: String(r.rows[0].id), detail: { title }, ip: actor.ip });
  for (const id of hub.onlineIds()) hub.send([id], 'system_notice', { type: 'announcement', title });
  return { id: Number(r.rows[0].id) };
}
const charByName = async (name: unknown) => {
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'invalid_name');
  const r = await pool.query('SELECT id, user_id, name FROM characters WHERE name=$1 AND deleted_at IS NULL', [name.trim()]); if (!r.rows[0]) throw new HttpError(404, 'target_not_found'); return r.rows[0];
};
/** gm: mute a character's chat for N minutes (persistent; survives restarts). minutes=0 lifts it. */
export async function adminMute(actor: { userId: string; role: string; ip?: string }, name: unknown, minutes: unknown) {
  requireRole(actor.role, 'gm'); const t = await charByName(name); const min = Number(minutes);
  if (!Number.isInteger(min) || min < 0 || min > 60 * 24 * 30) throw new HttpError(400, 'invalid_minutes');
  if (min === 0) await pool.query('DELETE FROM chat_mutes WHERE character_id=$1', [t.id]);
  else await pool.query(`INSERT INTO chat_mutes(character_id,until,reason) VALUES($1,now()+($2||' minutes')::interval,'gm') ON CONFLICT (character_id) DO UPDATE SET until=EXCLUDED.until, reason='gm'`, [t.id, String(min)]);
  await audit({ userId: actor.userId, action: 'admin.mute', target: t.id, detail: { name: t.name, minutes: min }, ip: actor.ip });
  return { ok: true };
}
/** admin: ban / unban the account owning a character; bans revoke every session immediately */
export async function adminBan(actor: { userId: string; role: string; ip?: string }, name: unknown, ban: unknown) {
  requireRole(actor.role, 'admin'); const t = await charByName(name);
  if (t.user_id === actor.userId) throw new HttpError(400, 'self');
  const tgt = (await pool.query('SELECT role FROM users WHERE id=$1', [t.user_id])).rows[0]; if (isStaff(tgt?.role)) throw new HttpError(403, 'forbidden');
  await pool.query('UPDATE users SET is_banned=$2 WHERE id=$1', [t.user_id, ban === true]);
  if (ban === true) { await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [t.user_id]);
    const ids = (await pool.query('SELECT id FROM characters WHERE user_id=$1', [t.user_id])).rows.map((r) => r.id); hub.kick(ids, 'banned'); }
  await audit({ userId: actor.userId, action: ban === true ? 'admin.ban' : 'admin.unban', target: t.user_id, detail: { name: t.name }, ip: actor.ip });
  return { ok: true };
}
/** admin: item distribution (event rewards / compensation). Idempotent per (character, grantId). */
export async function adminGrant(actor: { userId: string; role: string; ip?: string }, b: any) {
  requireRole(actor.role, 'admin'); const t = await charByName(b?.name);
  const qty = Number(b?.qty ?? 1); if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new HttpError(400, 'invalid_qty');
  if (typeof b?.grantId !== 'string' || !/^[A-Za-z0-9-]{4,64}$/.test(b.grantId)) throw new HttpError(400, 'invalid_grant_id');
  const it = (await pool.query('SELECT id, name FROM item_definitions WHERE id=$1', [String(b?.itemId ?? '')])).rows[0]; if (!it) throw new HttpError(404, 'item_not_found');
  const done = await tx(async (c) => {
    const ins = await c.query(`INSERT INTO transactions(character_id,kind,gold_delta,items_delta,idempotency_key,ref_id) VALUES($1,'admin_grant',0,$2,$3,$4) ON CONFLICT (character_id,idempotency_key) DO NOTHING RETURNING id`,
      [t.id, JSON.stringify([{ itemId: it.id, qty }]), `grant:${b.grantId}`, actor.userId]);
    if (!ins.rowCount) return false; await addItem(c, t.id, it.id, qty, false); return true;
  });
  if (done) await audit({ userId: actor.userId, action: 'admin.grant', target: t.id, detail: { name: t.name, itemId: it.id, qty, grantId: b.grantId }, ip: actor.ip });
  return { ok: true, granted: done };
}
export async function auditLogs(actor: { role: string }, q: any) {
  requireRole(actor.role, 'gm');
  const action = typeof q?.action === 'string' ? q.action.slice(0, 40) : '';
  return (await pool.query(`SELECT id, created_at "at", actor_user_id "userId", actor_character_id "characterId", action, target, detail, ip FROM audit_logs WHERE ($1='' OR action LIKE $1||'%') ORDER BY id DESC LIMIT 100`, [action])).rows;
}
export const validUuid = (v: unknown) => typeof v === 'string' && UUID.test(v);
