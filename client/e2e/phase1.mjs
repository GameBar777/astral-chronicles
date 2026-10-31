// PHASE 1 browser test: map render, 8-dir movement, camera follow, collision. Run: node client/e2e/phase1.mjs (dev server on :5173)
import { chromium } from 'playwright';
import { isBlocked } from '@astral/shared';
import { readFileSync } from 'node:fs';
const map = JSON.parse(readFileSync(new URL('../../assets/maps/asteria.json', import.meta.url)));
const url = process.env.URL ?? 'http://127.0.0.1:5173/';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(url); await p.waitForFunction(() => window.__astral?.scene?.isActive('World'), null, { timeout: 15000 });
const st = () => p.evaluate(() => { const s = window.__astral.scene.getScene('World'); return { x: s.pos.x, y: s.pos.y, f: s.facing, cx: s.cameras.main.scrollX, cy: s.cameras.main.scrollY, tiles: s.children.list.length }; });
const hold = async (keys, ms) => { for (const k of keys) await p.keyboard.down(k); await p.waitForTimeout(ms); for (const k of keys) await p.keyboard.up(k); await p.waitForTimeout(50); };
const results = []; const check = (name, ok, info) => { results.push({ name, ok, info }); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
const s0 = await st(); check('scene loaded at spawn', Math.abs(s0.x - map.spawn.x) < 1 && Math.abs(s0.y - map.spawn.y) < 1, s0);
await p.screenshot({ path: 'docs/screenshots/phase1-spawn.png' });
await hold(['KeyD'], 500); const s1 = await st(); check('move east (D)', s1.x > s0.x + 30 && Math.abs(s1.y - s0.y) < 1 && s1.f === 'e', s1);
await hold(['ArrowLeft'], 500); const s2 = await st(); check('move west (ArrowLeft)', s2.x < s1.x - 30 && s2.f === 'w', s2);
await hold(['KeyW', 'KeyD'], 400); const s3 = await st();
const dx = s3.x - s2.x, dy = s2.y - s3.y; check('diagonal NE normalised', dx > 10 && dy > 10 && Math.abs(dx - dy) < 4 && s3.f === 'ne', { dx, dy, f: s3.f });
for (const [keys, f] of [[['KeyS'], 's'], [['KeyS','KeyA'], 'sw'], [['KeyW','KeyA'], 'nw'], [['KeyW'], 'n'], [['KeyS','KeyD'], 'se']]) { await hold(keys, 120); const s = await st(); check(`facing ${f}`, s.f === f, s); }
// collision: walk north for a long time -> must stop before border/houses and never be inside solid tile
await hold(['KeyW'], 6000); const s4 = await st(); check('collision north stops on walkable', !isBlocked(map, s4) && s4.y > 32, s4);
await hold(['KeyA'], 9000); const s5 = await st(); check('collision west stops at border', !isBlocked(map, s5) && s5.x >= 32 + 10 - 0.01, s5);
check('camera follows (scrolled)', s5.cx !== s0.cx || s5.cy !== s0.cy, { s0: [s0.cx, s0.cy], s5: [s5.cx, s5.cy] });
check('camera within bounds', s5.cx >= 0 && s5.cy >= 0 && s5.cx <= map.width * 32 - 800 && s5.cy <= map.height * 32 - 600, s5);
await p.screenshot({ path: 'docs/screenshots/phase1-after.png' });
check('no page errors', errors.length === 0, errors);
await b.close();
const failed = results.filter((r) => !r.ok).length; console.log(`${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
