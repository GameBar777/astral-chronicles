// Production-build smoke: NODE_ENV=production server serving client/dist on one origin (E2E_URL, default :2577).
// Checks CSP doesn't break the game, same-origin WS connects, world loads, no console/CSP errors.
import { chromium } from 'playwright';
const URL = process.env.E2E_URL ?? 'http://127.0.0.1:2577/';
const SHOT = new globalThis.URL('../../docs/screenshots/', import.meta.url).pathname;
const results = []; const ok = (n, c, i = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${i}`); };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); const errors = [];
p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(URL); await p.waitForSelector('#email');
await p.fill('#email', `prod_${Date.now()}@example.com`); await p.fill('#pw', 'correct-horse-9'); await p.click('#reg');
await p.waitForSelector('#new'); await p.click('#new'); await p.waitForSelector('#name');
const k = Date.now(); await p.fill('#name', '本番' + String.fromCharCode(0x30a2 + (k % 40), 0x30a2 + ((k >> 6) % 40))); await p.check('input[value=mage]'); await p.click('#create');
ok('world loads from production bundle', await p.waitForFunction(() => window.__astral?.scene.isActive('World'), null, { timeout: 20000 }).then(() => true).catch(() => false));
ok('same-origin WebSocket online', await p.waitForFunction(() => window.__astral.scene.getScene('World').netText?.text.includes('オンライン'), null, { timeout: 15000 }).then(() => true).catch(() => false));
await p.waitForTimeout(800); await p.screenshot({ path: SHOT + 'phase10-production-build.png' });
ok('no console / CSP errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await b.close(); process.exit(results.every(Boolean) ? 0 : 1);
