import express, { type Request, type Response, type NextFunction } from 'express';
import { CLASSES, expTable } from '@astral/shared';
import { HttpError, login, logout, register, resolveSession } from '../services/auth.js';
import { createCharacter, listCharacters } from '../services/characters.js';
import { act, activeBattle, listInventory, startBattle } from '../services/battle.js';
import { listItems, equip, unequip, useItem } from '../services/inventory.js';
import { updatePosition, usePortal, gather, gatherState } from '../services/world.js';
import { listRecipes, startCraft, claimCraft, activeJob, enhance, enhanceInfo } from '../services/crafting.js';
import { rateLimit } from './rateLimit.js';
type Authed = Request & { auth: { sessionId: string; userId: string; role: string } };
const wrap = (fn: (req: any, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const bearer = (req: Request) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
const auth = (req: Request, _res: Response, next: NextFunction) => {
  resolveSession(bearer(req)).then((s) => { if (!s) return next(new HttpError(401, 'unauthorized')); (req as Authed).auth = s; next(); }, next);
};
export function apiRouter(opts: { authLimit?: number; createLimit?: number; battleLimit?: number; actionLimit?: number; moveLimit?: number } = {}) {
  const r = express.Router();
  r.use(express.json({ limit: '10kb' }));
  const authRl = rateLimit('auth', opts.authLimit ?? 20, 60_000);
  r.get('/classes', (_q, res) => { res.json(Object.values(CLASSES).map(({ id, name, role, equippable }) => ({ id, name, role, equippable }))); });
  r.get('/exp-table', (_q, res) => { res.json(expTable()); });
  r.post('/auth/register', authRl, wrap(async (req, res) => res.status(201).json(await register(req.body?.email, req.body?.password))));
  r.post('/auth/login', authRl, wrap(async (req, res) => res.json(await login(req.body?.email, req.body?.password))));
  r.post('/auth/logout', auth, wrap(async (req: Authed, res) => { await logout(req.auth.sessionId); res.status(204).end(); }));
  r.get('/me', auth, wrap(async (req: Authed, res) => res.json({ userId: req.auth.userId })));
  r.get('/characters', auth, wrap(async (req: Authed, res) => res.json(await listCharacters(req.auth.userId))));
  r.post('/characters', auth, rateLimit('charcreate', opts.createLimit ?? 10, 60_000), wrap(async (req: Authed, res) => res.status(201).json(await createCharacter(req.auth.userId, req.body))));
  r.get('/characters/:id/inventory', auth, wrap(async (req: Authed, res) => res.json(await listInventory(req.auth.userId, String(req.params.id)))));
  // PHASE 3 battle (server-authoritative). Client sends only commands; damage/rewards are computed here.
  const battleRl = rateLimit('battle', opts.battleLimit ?? 120, 60_000);
  r.get('/characters/:id/battle', auth, wrap(async (req: Authed, res) => res.json({ battle: await activeBattle(req.auth.userId, String(req.params.id)) })));
  r.post('/battles', auth, battleRl, wrap(async (req: Authed, res) => res.status(201).json(await startBattle(req.auth.userId, String(req.body?.characterId ?? ''), String(req.body?.zone ?? ''), typeof req.body?.lead === 'string' ? req.body.lead : undefined))));
  r.post('/battles/:id/action', auth, battleRl, wrap(async (req: Authed, res) => {
    if (!Number.isInteger(req.body?.turn) || typeof req.body?.command !== 'object') throw new HttpError(400, 'invalid_request');
    res.json(await act(req.auth.userId, String(req.params.id), req.body.turn, req.body.command));
  }));
  // PHASE 4: items / equipment / gathering / crafting / enhancement / position — all server-authoritative.
  const actRl = rateLimit('action', opts.actionLimit ?? 180, 60_000), moveRl = rateLimit('move', opts.moveLimit ?? 400, 60_000);
  const U = (req: Authed) => req.auth.userId, P = (req: Authed) => String(req.params.id), B = (req: Authed) => req.body ?? {};
  r.get('/characters/:id/items', auth, wrap(async (req: Authed, res) => res.json(await listItems(U(req), P(req)))));
  r.post('/characters/:id/equip', auth, actRl, wrap(async (req: Authed, res) => res.json(await equip(U(req), P(req), B(req).inventoryId, B(req).slot))));
  r.post('/characters/:id/unequip', auth, actRl, wrap(async (req: Authed, res) => res.json(await unequip(U(req), P(req), B(req).slot))));
  r.post('/characters/:id/use', auth, actRl, wrap(async (req: Authed, res) => res.json(await useItem(U(req), P(req), B(req).inventoryId, B(req).requestId))));
  r.put('/characters/:id/position', auth, moveRl, wrap(async (req: Authed, res) => { const o = await updatePosition(U(req), P(req), B(req)); res.status(o.ok ? 200 : 409).json(o); }));
  r.post('/characters/:id/portal', auth, actRl, wrap(async (req: Authed, res) => res.json(await usePortal(U(req), P(req), B(req).portalId))));
  r.get('/characters/:id/gathering', auth, wrap(async (req: Authed, res) => res.json(await gatherState(U(req), P(req)))));
  r.post('/characters/:id/gather', auth, actRl, wrap(async (req: Authed, res) => res.json(await gather(U(req), P(req), B(req).nodeId, B(req).requestId))));
  r.get('/recipes', wrap(async (_q, res) => res.json(await listRecipes())));
  r.get('/enhance-info/:level', (req, res) => { res.json(enhanceInfo(Math.max(0, Math.floor(Number(req.params.level) || 0)))); });
  r.get('/characters/:id/crafting', auth, wrap(async (req: Authed, res) => res.json(await activeJob(U(req), P(req)))));
  r.post('/characters/:id/craft', auth, actRl, wrap(async (req: Authed, res) => res.status(201).json(await startCraft(U(req), P(req), B(req).recipeId, B(req).requestId))));
  r.post('/characters/:id/craft/:jobId/claim', auth, actRl, wrap(async (req: Authed, res) => res.json(await claimCraft(U(req), P(req), String(req.params.jobId)))));
  r.post('/characters/:id/enhance', auth, actRl, wrap(async (req: Authed, res) => res.json(await enhance(U(req), P(req), B(req).inventoryId, B(req).requestId))));
  r.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.code });
    if (err?.type === 'entity.parse.failed') return void res.status(400).json({ error: 'invalid_json' });
    if (err?.type === 'entity.too.large') return void res.status(413).json({ error: 'too_large' });
    console.error('[api]', err); res.status(500).json({ error: 'internal' }); // no stack/DB details to client
  });
  return r;
}
