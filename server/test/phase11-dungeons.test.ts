import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createGameServer } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { resetDb } from './setup-db.js';
import { MAPS } from '../src/world/maps.js';
import { DUNGEONS, isBlocked } from '@astral/shared';
const PORT = 25683, API = `http://127.0.0.1:${PORT}/api`;
const { gameServer } = createGameServer({ authLimit: 1000, createLimit: 1000, actionLimit: 10000, battleLimit: 10000, moveLimit: 100000 } as any);
const call = async (method: string, path: string, body?: unknown, token = '') => {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const user = async (email: string, name: string, cls = 'warrior') => {
  await call('POST', '/auth/register', { email, password: 'password123' });
  const t = (await call('POST', '/auth/login', { email, password: 'password123' })).body.token;
  const c = await call('POST', '/characters', { name, class: cls, appearance: { bodyType: 'a', hairStyle: 1, hairColor: 2, skinColor: 0 } }, t);
  return { t, id: c.body.id as string };
};
const S = (u: any, path: string, body: any = {}) => call('POST', `/characters/${u.id}/${path}`, body, u.t);
const G = (u: any, path: string) => call('GET', `/characters/${u.id}/${path}`, undefined, u.t);
const put = (u: any, path: string, body: any) => call('PUT', `/characters/${u.id}/${path}`, body, u.t);
const toEntrance = async (id: string, dungeonId: string) => {
  const def = DUNGEONS[dungeonId]; const o = MAPS[def.entryMap].objects.find((x) => x.id === def.entrance)!;
  await pool.query(`UPDATE characters SET map_id=$2, pos_x=$3, pos_y=$4, pos_updated_at=now()-interval '1 hour', level=$5 WHERE id=$1`,
    [id, def.entryMap, Math.round(o.x), Math.round(o.y), Math.max(def.minLevel, 1)]);
};
let A: any;
beforeAll(async () => {
  await resetDb(); await gameServer.listen(PORT);
  A = await user('dg11@example.com', '踏破者');
});
afterAll(async () => { await gameServer.gracefullyShutdown(false).catch(() => {}); await pool.end(); });

describe('five planned dungeons and walkable multi-room maps', () => {
  it('defines all five dungeons with three connected floor maps each, plus meadow entrances', () => {
    expect(Object.keys(DUNGEONS).sort()).toEqual(['ancient_ruins', 'dark_forest', 'desert_temple', 'forgotten_mine', 'star_tower']);
    for (const d of Object.values(DUNGEONS)) {
      expect(d.floors).toHaveLength(3);
      expect(d.floors[2].boss).toBeTruthy();
      expect(MAPS[d.entryMap].objects.some((o) => o.id === d.entrance && o.type === 'dungeon')).toBe(true);
      for (let i = 0; i < 3; i++) {
        const m = MAPS[d.floors[i].mapId];
        expect(m, d.floors[i].mapId).toBeTruthy();
        expect(m.width * m.height).toBeGreaterThan(20 * 16);
        const walk = m.layers.find((l) => l.name === 'collision')!.data;
        // BFS: a single walkable component (rooms joined by corridors)
        const W = m.width, seen = new Set<number>();
        const start = walk.findIndex((v) => v === 0);
        const q = [start]; seen.add(start);
        while (q.length) {
          const i = q.pop()!, x = i % W, y = (i / W) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy, ni = ny * W + nx;
            if (nx >= 0 && ny >= 0 && nx < W && ny < m.height && walk[ni] === 0 && !seen.has(ni)) { seen.add(ni); q.push(ni); }
          }
        }
        const walkable = walk.filter((v) => v === 0).length;
        expect(seen.size).toBe(walkable);
        expect(walkable).toBeGreaterThan(200);
        expect(isBlocked(m, m.spawn)).toBe(false);
        const kinds = new Set(m.objects.map((o) => o.type));
        expect(kinds.has('encounter')).toBe(true);
        if (i < 2) expect(kinds.has('stairs')).toBe(true);
      }
    }
  });
  it('new monsters and bosses exist in the database', async () => {
    const ids = ['mine_golem', 'forest_treant', 'desert_sphinx', 'tower_sentinel', 'ruins_golem', 'mine_beetle', 'forest_wisp', 'desert_mummy', 'tower_shard'];
    const r = await pool.query('SELECT id, is_boss FROM monster_definitions WHERE id = ANY($1)', [ids]);
    expect(r.rows).toHaveLength(ids.length);
    expect(r.rows.filter((x) => x.is_boss).map((x) => x.id).sort()).toEqual(['desert_sphinx', 'forest_treant', 'mine_golem', 'ruins_golem', 'tower_sentinel']);
  });
  it('can enter every dungeon and walk the first floor toward the encounter', async () => {
    for (const id of Object.keys(DUNGEONS)) {
      await pool.query('UPDATE dungeon_members SET left_at=now() WHERE character_id=$1 AND left_at IS NULL', [A.id]);
      await toEntrance(A.id, id);
      const ent = await S(A, 'dungeon/enter', { dungeonId: id });
      expect(ent.status, id).toBe(201);
      const view = ent.body.dungeon;
      expect(view.mapId).toBe(DUNGEONS[id].floors[0].mapId);
      expect(view.backdrop).toBe(DUNGEONS[id].backdrop);
      const map = MAPS[view.mapId];
      expect(view.pos.x).toBe(Math.round(map.spawn.x));
      // a 40px step is within slack; a 500px teleport is too_fast
      const step = await put(A, 'dungeon/position', { x: view.pos.x + 24, y: view.pos.y });
      expect(step.status, id + ' walk').toBe(200);
      expect(step.body.ok).toBe(true);
      const fast = await put(A, 'dungeon/position', { x: view.pos.x + 24, y: view.pos.y - 400 });
      expect(fast.body.ok).toBe(false);
      expect(fast.body.reason).toBe('too_fast');
      const wall = map.objects[0];
      // blocked tile (0,0 is the border wall on these maps)
      const blocked = await put(A, 'dungeon/position', { x: 8, y: 8 });
      expect(blocked.body.ok).toBe(false);
      expect(['blocked', 'too_fast']).toContain(blocked.body.reason);
      await S(A, 'dungeon/leave');
    }
  });
  it('starts a battle that uses the dungeon-specific monsters', async () => {
    await toEntrance(A.id, 'forgotten_mine');
    expect((await S(A, 'dungeon/enter', { dungeonId: 'forgotten_mine' })).status).toBe(201);
    const b = await S(A, 'dungeon/battle');
    expect(b.body?.combatants, JSON.stringify(b)).toBeTruthy();
    const enemies = b.body.combatants.filter((c: any) => c.side === 'enemy');
    expect(enemies.length).toBeGreaterThan(0);
    expect(enemies.every((e: any) => e.monsterId.startsWith('mine_'))).toBe(true);
    expect(b.body.zone).toBe('forgotten_mine');
  });
});
