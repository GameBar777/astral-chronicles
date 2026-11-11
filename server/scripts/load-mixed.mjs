/** Mixed load: concurrent field battles, local chat, and market list/buy/history. Starts its own server. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'colyseus.js';
import { createGameServer } from '../src/app.ts';
import { pool } from '../src/db/pool.ts';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const PORT = +(process.env.MIXED_PORT ?? 2588);
const HTTP = `http://127.0.0.1:${PORT}/api`;
const WS = `ws://127.0.0.1:${PORT}`;
const N = +(process.env.N ?? 12); // 4 battle + 4 chat/walk + 4 market
const DURATION = +(process.env.DURATION ?? 25);
const LIMITS = { authLimit: 5000, createLimit: 5000, battleLimit: 20000, actionLimit: 20000, moveLimit: 50000 };

const call = async (method, path, body, token) => {
  for (;;) {
    const r = await fetch(HTTP + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (r.status === 429) { await new Promise((z) => setTimeout(z, 400)); continue; }
    return { status: r.status, body: j };
  }
};
const kana = (n) => String.fromCharCode(0x30a2 + (n % 40), 0x30a2 + ((n / 40) | 0) % 40);
const rssOf = (pid) => { try { return Math.round(+readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1] * 4096 / 1048576); } catch { return NaN; } };

const stats = { errors: 0, errorSamples: [], battlesStarted: 0, battlesEnded: 0, battleTurns: 0, chats: 0, chatErr: 0,
  listings: 0, buys: 0, history: 0, moves: 0, corrections: 0 };

const { gameServer } = createGameServer(LIMITS);
await gameServer.listen(PORT);
const rssBefore = rssOf(process.pid);
const tEnd = Date.now() + DURATION * 1000;

const mkUser = async (i, namePrefix, cls) => {
  const email = `mixbot${i}@example.com`, password = 'correct-horse-9';
  let r = await call('POST', '/auth/login', { email, password });
  if (r.status !== 200) { await call('POST', '/auth/register', { email, password }); r = await call('POST', '/auth/login', { email, password }); }
  if (r.status !== 200) throw new Error('login ' + JSON.stringify(r));
  const token = r.body.token;
  const list = await call('GET', '/characters', undefined, token);
  const arr = list.body.characters ?? list.body;
  let ch = Array.isArray(arr) ? arr[0] : null;
  if (!ch) {
    const c = await call('POST', '/characters', { name: '負荷' + namePrefix + kana(Date.now() + i * 17), class: cls, appearance: { bodyType: 'a', hairStyle: 0, hairColor: 0, skinColor: 0 } }, token);
    if (c.status !== 201 && c.status !== 200) throw new Error('create ' + JSON.stringify(c));
    ch = c.body.character ?? c.body;
  }
  return { token, id: ch.id, name: ch.name };
};

const bots = [];
for (let i = 0; i < N; i++) {
  const role = i < Math.ceil(N / 3) ? 'battle' : i < Math.ceil((2 * N) / 3) ? 'chat' : 'market';
  bots.push({ ...(await mkUser(i, role[0].toUpperCase(), ['warrior', 'mage', 'knight', 'priest'][i % 4])), role });
}

// seed positions / gold / trade goods
await pool.query(`UPDATE characters SET map_id='green_meadow', pos_x=400, pos_y=500, gold=GREATEST(gold, 5000), pos_updated_at=now()-interval '1 hour' WHERE id = ANY($1)`, [bots.filter((b) => b.role === 'battle').map((b) => b.id)]);
await pool.query(`UPDATE characters SET map_id='asteria', pos_x=720, pos_y=697.6, gold=GREATEST(gold, 5000), pos_updated_at=now()-interval '1 hour' WHERE id = ANY($1)`, [bots.filter((b) => b.role !== 'battle').map((b) => b.id)]);
await pool.query('DELETE FROM chat_mutes WHERE character_id = ANY($1)', [bots.map((b) => b.id)]);
const placeMeadow = (id) => pool.query(`UPDATE characters SET map_id='green_meadow', pos_x=400, pos_y=500, pos_updated_at=now()-interval '1 hour' WHERE id=$1`, [id]);

for (const b of bots.filter((x) => x.role === 'market')) {
  await pool.query(`WITH u AS (
  UPDATE inventory SET quantity = GREATEST(quantity, 80) WHERE character_id=$1 AND item_id='herb' AND enhance_level=0 RETURNING 1
) INSERT INTO inventory(character_id,item_id,quantity) SELECT $1,'herb',80 WHERE NOT EXISTS (SELECT 1 FROM u)`, [b.id]);
}

const note = (kind, e) => { stats.errors++; if (stats.errorSamples.length < 12) stats.errorSamples.push(kind + ': ' + (e?.message ?? e)); };

const battleLoop = async (b) => {
  while (Date.now() < tEnd) {
    try {
      let cur = (await call('POST', '/battles', { characterId: b.id, zone: 'green_meadow' }, b.token)).body;
      if (cur?.error === 'wrong_map' || cur?.error === 'character_down') { await placeMeadow(b.id); if (cur.error === 'character_down') await pool.query('UPDATE character_stats SET hp=GREATEST(hp, 1) WHERE character_id=$1', [b.id]); continue; }
      if (cur?.error) { if (cur.error === 'in_battle') { const a = (await call('GET', `/characters/${b.id}/battle`, undefined, b.token)).body?.battle; if (a) cur = a; else { await new Promise((r) => setTimeout(r, 200)); continue; } } else { note('battle_start', cur.error); await new Promise((r) => setTimeout(r, 200)); continue; } }
      if (!cur?.id) { note('battle_start', 'no id'); continue; }
      stats.battlesStarted++;
      let guard = 0;
      while (cur.status === 'active' && Date.now() < tEnd && guard++ < 80) {
        const tgt = cur.combatants.find((c) => c.side === 'enemy' && c.hp > 0);
        const act = await call('POST', `/battles/${cur.id}/action`, { turn: cur.turn, command: tgt ? { type: 'attack', target: tgt.id } : { type: 'defend' } }, b.token);
        if (act.body?.error === 'stale_turn' || act.body?.error === 'battle_over') { cur = (await call('GET', `/characters/${b.id}/battle`, undefined, b.token)).body?.battle ?? cur; if (!cur || cur.status !== 'active') break; continue; }
        if (act.body?.error) { note('battle_act', act.body.error); break; }
        cur = act.body; stats.battleTurns++;
      }
      if (cur?.status && cur.status !== 'active') { stats.battlesEnded++; if (cur.status === 'defeat') await placeMeadow(b.id); }
    } catch (e) { note('battle', e); await new Promise((r) => setTimeout(r, 200)); }
  }
};

const chatLoop = async (b) => {
  const room = await new Client(WS).joinOrCreate('world', { token: b.token, characterId: b.id, mapId: 'asteria' });
  b.room = room;
  room.onMessage('correct', () => { stats.corrections++; });
  room.onMessage('chat_error', () => { stats.chatErr++; });
  for (const t of ['chat', 'chat_history', 'social', 'system_notice']) room.onMessage(t, () => {});
  let x = 720, dir = 1, n = 0;
  while (Date.now() < tEnd) {
    x += dir * 14; if (x > 800 || x < 640) dir *= -1;
    room.send('move', { x: Math.round(x), y: 698, facing: dir > 0 ? 'right' : 'left', moving: true });
    stats.moves++;
    if (n % 10 === 0) { room.send('chat', { channel: 'local', body: `負荷チャット ${b.name} ${n} ${Date.now()}` }); stats.chats++; }
    n++; await new Promise((r) => setTimeout(r, 250));
  }
  try { await room.leave(true); } catch { /* */ }
};

const marketLoop = async (b, i) => {
  while (Date.now() < tEnd) {
    try {
      const items = (await call('GET', `/characters/${b.id}/items`, undefined, b.token)).body?.items ?? [];
      const herb = items.find((x) => x.itemId === 'herb' && !x.equipped && x.qty > 0);
      if (herb && i % 2 === 0) {
        const list = await call('POST', `/characters/${b.id}/market/list`, { inventoryId: herb.id, qty: 1, price: 20 + (i % 5), hours: 1, requestId: randomUUID() }, b.token);
        if (list.status === 200) stats.listings++;
        else if (list.body?.error && list.body.error !== 'too_many_listings' && list.body.error !== 'not_enough_materials') note('list', list.body.error);
      }
      const browse = await call('GET', `/market?search=${encodeURIComponent('薬草')}`, undefined, b.token);
      const listing = (browse.body?.listings ?? []).find((l) => l.sellerId !== b.id && l.status === 'active');
      if (listing) {
        const buy = await call('POST', `/characters/${b.id}/market/buy`, { listingId: listing.id, expectedPrice: listing.price, requestId: randomUUID() }, b.token);
        if (buy.status === 200) stats.buys++;
        else if (buy.body?.error && !['own_listing', 'listing_closed', 'listing_not_found', 'price_changed', 'not_enough_gold'].includes(buy.body.error)) note('buy', buy.body.error);
      }
      const hist = await call('GET', '/market/history/herb', undefined, b.token);
      if (hist.status === 200) stats.history++;
      else note('history', hist.body?.error ?? hist.status);
    } catch (e) { note('market', e); }
    await new Promise((r) => setTimeout(r, 300));
  }
};

await Promise.all(bots.map((b, i) => b.role === 'battle' ? battleLoop(b) : b.role === 'chat' ? chatLoop(b) : marketLoop(b, i)));
const rssAfter = rssOf(process.pid);
await gameServer.gracefullyShutdown(false).catch(() => {});
await pool.end().catch(() => {});
const report = { clients: N, durationSec: DURATION, roles: { battle: bots.filter((b) => b.role === 'battle').length, chat: bots.filter((b) => b.role === 'chat').length, market: bots.filter((b) => b.role === 'market').length },
  battlesStarted: stats.battlesStarted, battlesEnded: stats.battlesEnded, battleTurns: stats.battleTurns,
  chatsSent: stats.chats, chatErrors: stats.chatErr, listings: stats.listings, buys: stats.buys, historyReads: stats.history,
  moves: stats.moves, corrections: stats.corrections, errors: stats.errors, errorSamples: stats.errorSamples,
  serverRssMB: { before: rssBefore, after: rssAfter } };
console.log(JSON.stringify(report, null, 2));
process.exit((stats.errors > 0 && stats.battlesStarted === 0) || stats.battlesStarted === 0 || stats.chats === 0 || (stats.listings + stats.buys) === 0 ? 1 : 0);
