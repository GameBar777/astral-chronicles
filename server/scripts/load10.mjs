// PHASE 6 simple load test: N colyseus clients in the town room walking at full speed for DURATION sec.
// Measures own-move echo latency (send -> own position appears in state patch), patch rate, corrections, server RSS.
import { Client } from 'colyseus.js';
import { execSync } from 'node:child_process';
const HTTP = process.env.HTTP ?? 'http://127.0.0.1:2567/api', WS = process.env.WS ?? 'ws://127.0.0.1:2567';
const N = +(process.env.N ?? 10), DURATION = +(process.env.DURATION ?? 30), HZ = 8, SPEED = 110; // px/s (server max 120)
const post = async (path, body, token, method = 'POST') => { let r; for (;;) { r = await fetch(HTTP + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); if (r.status !== 429) break; await new Promise((z) => setTimeout(z, 5000)); } const j = await r.json(); if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + JSON.stringify(j)); return j; };
const kana = (n) => String.fromCharCode(0x30a2 + (n % 40), 0x30a2 + (Math.floor(n / 40) % 40), 0x30a2 + (Math.floor(n / 1600) % 40));
const rss = () => { try { const pid = execSync(`fuser ${new globalThis.URL(HTTP).port || 2567}/tcp 2>/dev/null`).toString().trim().split(/\s+/)[0]; return Math.round(+execSync(`ps -o rss= -p ${pid}`).toString() / 1024); } catch { return NaN; } };
const bots = [];
for (let i = 0; i < N; i++) {
  const email = `loadbot${i}@example.com`, password = 'correct-horse-9'; // reused across runs (auth rate limit)
  let token; try { ({ token } = await post('/auth/login', { email, password })); } catch { await post('/auth/register', { email, password }); ({ token } = await post('/auth/login', { email, password })); }
  const list = await post('/characters', null, token, 'GET'); const arr = list.characters ?? list;
  const ch = arr[0] ?? await post('/characters', { name: '負荷' + kana(Date.now() + i * 13), class: ['warrior', 'mage', 'knight', 'priest'][i % 4], appearance: { bodyType: 'a', hairStyle: 0, hairColor: 0, skinColor: 0 } }, token);
  const c = ch.character ?? ch; bots.push({ token, id: c.id, x: c.pos_x ?? c.x, y: c.pos_y ?? c.y });
}
// start every bot on the open plaza at the town spawn (positions persist between runs and can drift into corners)
{ const { config } = await import('dotenv'); config({ path: new globalThis.URL('../../.env', import.meta.url).pathname }); const pg = (await import('pg')).default;
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  await db.query(`UPDATE characters SET map_id='asteria', pos_x=720, pos_y=697.6 WHERE id = ANY($1::uuid[])`, [bots.map((b) => b.id)]); await db.end();
  for (const b of bots) { b.x = 720; b.y = 697.6; } }
const rssBefore = rss();
const stats = { lat: [], patches: 0, corrections: 0, seenMax: 0, errors: 0, reasons: {} };
await Promise.all(bots.map(async (b, i) => {
  b.room = await new Client(WS).joinOrCreate('world', { token: b.token, characterId: b.id, mapId: 'asteria' });
  b.room.onStateChange(() => { stats.patches++; const ps = b.room.state.players; if (!ps) return; stats.seenMax = Math.max(stats.seenMax, ps.size);
    ps.forEach((p) => { if (p.id !== b.id) return; const k = `${p.x},${p.y}`; const t = b.sent?.get(k); if (t) { stats.lat.push(performance.now() - t); b.sent.delete(k); } }); });
  b.room.onMessage('correct', (m) => { stats.corrections++; stats.reasons[m?.reason ?? '?'] = (stats.reasons[m?.reason ?? '?'] ?? 0) + 1; if (m?.pos) { b.x = m.pos.x; b.y = m.pos.y; } if (m?.reason === 'blocked') b.dir *= -1; }); // hit a wall: turn around
  b.room.onError(() => stats.errors++); for (const t of ['chat_history', 'chat', 'social', 'system_notice']) b.room.onMessage(t, () => {});
  b.sent = new Map(); b.dir = i % 2 ? 1 : -1; b.ox = b.x;
}));
const t0 = Date.now();
await new Promise((res) => { const iv = setInterval(() => {
  for (const b of bots) { // walk back and forth horizontally around the spawn (open plaza row)
    b.x += b.dir * SPEED / HZ; if (Math.abs(b.x - b.ox) > 90) b.dir *= -1;
    const x = Math.round(b.x), y = Math.round(b.y); b.sent.set(`${x},${y}`, performance.now()); b.room.send('move', { x, y, facing: b.dir > 0 ? 'right' : 'left', moving: true });
  }
  if (Date.now() - t0 > DURATION * 1000) { clearInterval(iv); res(); }
}, 1000 / HZ); });
await new Promise((r) => setTimeout(r, 500));
const rssAfter = rss();
for (const b of bots) await b.room.leave(true);
const L = stats.lat.sort((a, b) => a - b), q = (f) => L.length ? L[Math.min(L.length - 1, Math.floor(L.length * f))].toFixed(1) : 'n/a';
const sent = bots.length * Math.floor(DURATION * HZ);
console.log(JSON.stringify({ clients: N, durationSec: DURATION, movesSent: sent, echoed: L.length, echoLatencyMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: L.length ? L.at(-1).toFixed(1) : 'n/a' },
  patchesPerClientPerSec: +(stats.patches / N / DURATION).toFixed(1), corrections: stats.corrections, correctionReasons: stats.reasons, maxPlayersSeen: stats.seenMax, errors: stats.errors, serverRssMB: { before: rssBefore, after: rssAfter } }, null, 1));
process.exit(0);
