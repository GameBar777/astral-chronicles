import type { RequestHandler } from 'express';
/** Simple fixed-window in-memory limiter (single process). Replace with shared store when scaling out. */
export function rateLimit(name: string, max: number, windowMs: number): RequestHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req, res, next) => {
    const key = `${name}:${req.ip}`; const now = Date.now(); let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    if (++h.n > max) { res.setHeader('Retry-After', Math.ceil((h.reset - now) / 1000)); return void res.status(429).json({ error: 'rate_limited' }); }
    next();
  };
}
