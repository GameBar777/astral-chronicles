// Shared E2E helpers. PHASE 4: position is server-authoritative, so a test "teleport" must move the DB row too
// (otherwise the client is correctly snapped back by the server's speed check).
import pg from 'pg';
export const newDb = () => new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://astral:astral_dev_pw@127.0.0.1:5433/astral' });
export const charIdByName = async (db, name) => (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
export const makeTp = (p, db, getId) => async (x, y, mapId) => {
  const id = await getId();
  // PHASE 6: moves also go through the room; let any in-flight room move land before rewriting the DB row
  await p.evaluate(() => { const s = window.__astral.scene.getScene('World'); s.netMoving = false; });
  await p.waitForTimeout(250);
  await db.query(`UPDATE characters SET pos_x=$2,pos_y=$3,pos_updated_at=now()-interval '1 hour'${mapId ? ',map_id=$4' : ''} WHERE id=$1`, mapId ? [id, Math.round(x), Math.round(y), mapId] : [id, Math.round(x), Math.round(y)]);
  await p.evaluate(([x, y]) => { const s = window.__astral.scene.getScene('World'); s.pos = { x: Math.round(x), y: Math.round(y) }; s.lastSent = { ...s.pos }; }, [x, y]);
};
