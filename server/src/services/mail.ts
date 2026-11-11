/**
 * Dev mail transport (no real accounts, no outbound SMTP).
 * Writes JSON files under MAIL_DIR (default server/var/mail). Production must set MAIL_DIR or the
 * transport still only writes locally — we never open a network connection here.
 * /api/dev/mailbox is registered only when NODE_ENV !== 'production'.
 */
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
export type Mail = { id: string; to: string; subject: string; text: string; at: string; kind?: string };
const dir = () => process.env.MAIL_DIR ?? fileURLToPath(new URL('../../var/mail', import.meta.url));
const ensure = () => { try { mkdirSync(dir(), { recursive: true }); } catch { /* */ } };
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export const newToken = () => randomBytes(24).toString('hex');
export function sendMail(m: Omit<Mail, 'id' | 'at'>): Mail {
  ensure();
  const mail: Mail = { id: `${Date.now()}-${randomBytes(4).toString('hex')}`, at: new Date().toISOString(), ...m };
  writeFileSync(join(dir(), `${mail.id}.json`), JSON.stringify(mail, null, 2));
  return mail;
}
export function listMail(to?: string): Mail[] {
  ensure();
  const files = readdirSync(dir()).filter((f) => f.endsWith('.json')).sort().reverse();
  const all = files.slice(0, 200).map((f) => JSON.parse(readFileSync(join(dir(), f), 'utf8')) as Mail);
  return to ? all.filter((m) => m.to === to) : all;
}
export function lastMail(to: string, kind?: string): Mail | undefined {
  return listMail(to).find((m) => !kind || m.kind === kind);
}
