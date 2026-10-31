import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { pool } from './db/pool.js';
import { apiRouter } from './http/api.js';
import { WorldRoom } from './rooms/WorldRoom.js';

export function createGameServer(opts: { authLimit?: number; createLimit?: number; battleLimit?: number } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', apiRouter(opts));
  app.get('/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'up' }); }
    catch { res.status(503).json({ ok: false, db: 'down' }); }
  });
  const http = createServer(app);
  const gameServer = new Server({ transport: new WebSocketTransport({ server: http }) });
  gameServer.define('world', WorldRoom).filterBy(['mapId']); // one shared room per map
  return { app, http, gameServer };
}
