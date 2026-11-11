import express, { type Request, type Response, type NextFunction } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { pool } from './db/pool.js';
import { apiRouter } from './http/api.js';
import { WorldRoom } from './rooms/WorldRoom.js';
import { DungeonRoom } from './rooms/DungeonRoom.js';
import { startDungeonSweep } from './services/dungeon.js';

export function createGameServer(opts: { authLimit?: number; createLimit?: number; battleLimit?: number } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY); // behind a TLS-terminating proxy: real client IP for rate limits/audit
  app.use(securityHeaders);
  app.use('/api', apiRouter(opts));
  // production: serve the built client from the same origin (single process deploy, TD-019)
  const dist = process.env.CLIENT_DIST ?? fileURLToPath(new URL('../../client/dist', import.meta.url));
  if (process.env.NODE_ENV === 'production' && existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '7d', setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get(/^\/(?!api|health).*/, (_q, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.get('/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'up' }); }
    catch { res.status(503).json({ ok: false, db: 'down' }); }
  });
  const http = createServer(app);
  const origins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const gameServer = new Server({ transport: new WebSocketTransport({ server: http, maxPayload: 16 * 1024,
    verifyClient: (info: { origin?: string }, cb: (ok: boolean, code?: number) => void) => cb(!origins.length || origins.includes(info.origin ?? ''), 403) }) });
  gameServer.define('world', WorldRoom).filterBy(['mapId']); // one shared room per map
  gameServer.define('dungeon', DungeonRoom).filterBy(['instanceId']); // PHASE 8: one room per instance
  startDungeonSweep();
  return { app, http, gameServer };
}

/** SECTION 20 security headers (CSP allows only same-origin scripts; ws/wss to the game server; images from self/data/blob) */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  const ws = process.env.PUBLIC_WS_ORIGIN ?? '';
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss: ${ws}; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`);
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
  next();
}
