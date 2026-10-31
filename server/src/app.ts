import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { pool } from './db/pool.js';

export function createGameServer() {
  const app = express();
  app.get('/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'up' }); }
    catch { res.status(503).json({ ok: false, db: 'down' }); }
  });
  const http = createServer(app);
  const gameServer = new Server({ transport: new WebSocketTransport({ server: http }) });
  // Rooms (WorldRoom etc.) are added in PHASE 6. Not implemented yet.
  return { app, http, gameServer };
}
