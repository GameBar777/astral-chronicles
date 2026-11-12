// Snapshots of the four new meadow dungeon entrances (and a step inside floor 1).
import { chromium } from 'playwright';
import { newDb, makeTp } from './lib.mjs';
const URL = process.env.E2E_URL ?? 'http://127.0.0.1:5173/';
const SHOT = new globalThis.URL('../../docs/screenshots/', import.meta.url).pathname;
const db = newDb();
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
await p.goto(URL); await p.waitForSelector('#email');
await p.fill('#email', `e11ent_${Date.now()}@example.com`); await p.fill('#pw', 'correct-horse-9'); await p.click('#reg');
await p.waitForSelector('#new'); await p.click('#new'); await p.waitForSelector('#name');
const name = '入口' + String.fromCharCode(0x30a2 + (Date.now() % 40), 0x30a2 + 3);
await p.fill('#name', name); await p.check('input[value=warrior]'); await p.click('#create');
await p.waitForFunction(() => window.__astral?.scene.isActive('World'), null, { timeout: 15000 });
const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
const tp = makeTp(p, db, async () => id);
await tp(42.2 * 32, 17.6 * 32);
await p.keyboard.down('ArrowRight'); await p.waitForTimeout(700); await p.keyboard.up('ArrowRight');
await p.waitForFunction(() => window.__astral.scene.getScene('World').map?.id === 'green_meadow' && !window.__astral.scene.getScene('World').inBattle, null, { timeout: 8000 });
const spots = [
  { file: 'dungeon-entrance-forgotten-mine.png', x: 80, y: 140, label: '忘れられた鉱山' },
  { file: 'dungeon-entrance-dark-forest.png', x: 720, y: 140, label: '闇の森林' },
  { file: 'dungeon-entrance-desert-temple.png', x: 1296, y: 140, label: '砂漠の神殿' },
  { file: 'dungeon-entrance-star-tower.png', x: 208, y: 300, label: '星晶の塔' },
];
const results = [];
const ok = (n, c, i = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${i}`); };
for (const s of spots) {
  await tp(s.x, s.y, 'green_meadow');
  await p.waitForTimeout(500);
  const shown = await p.evaluate(() => { const w = window.__astral.scene.getScene('World'); return !!(w.prompt?.visible && /入場/.test(w.prompt.text || '')); }).catch(() => false);
  ok(`${s.label} prompt`, shown);
  await p.screenshot({ path: SHOT + s.file });
}
// enter the mine and shoot walkable floor 1
await tp(80, 140, 'green_meadow'); await p.waitForTimeout(300);
await p.keyboard.press('e');
const confirm = await p.waitForFunction(() => document.body.innerText.includes('忘れられた鉱山') || document.body.innerText.includes('入場する'), null, { timeout: 5000 }).then(() => true).catch(() => false);
ok('mine confirm dialog', confirm);
if (confirm) {
  const clicked = await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /入場/.test(x.textContent || ''));
    if (b) { b.click(); return true; } return false;
  });
  if (clicked) {
    const inDg = await p.waitForFunction(() => window.__astral.scene.isActive('Dungeon'), null, { timeout: 10000 }).then(() => true).catch(() => false);
    ok('entered forgotten_mine', inDg);
    await p.waitForTimeout(600);
    await p.screenshot({ path: SHOT + 'dungeon-f1-forgotten-mine.png' });
  } else ok('entered forgotten_mine', false);
}
await b.close(); await db.end();
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
