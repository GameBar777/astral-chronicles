// E2E PHASE 10: title-screen maintenance/announcements, appearance recolour (BUG-008), cobble (BUG-009), audio state, main menu
// + character/skills/map/news/settings panels, whisper, block/unblock, persistent mute, admin maintenance push, mobile joystick
import { chromium } from 'playwright';
import { newDb } from './lib.mjs';
const URL = process.env.E2E_URL ?? 'http://127.0.0.1:5173/';
const SHOT = new globalThis.URL('../../docs/screenshots/', import.meta.url).pathname;
const db = newDb();
const results = []; const ok = (name, cond, info = '') => { results.push({ name, pass: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${info}`); };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const kana = (n) => String.fromCharCode(0x30a2 + (n % 40), 0x30a2 + (Math.floor(n / 40) % 40), 0x30a2 + (Math.floor(n / 1600) % 40));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn().catch(() => null); if (v) return v; await sleep(150); } return null; };
const watch = (p, tag) => { p.on('pageerror', (e) => errors.push(tag + ': ' + e)); p.on('console', (m) => m.type() === 'error' && !/status of (4\d\d|503)/.test(m.text()) && errors.push(tag + ': ' + m.text())); };
async function player(tag, cls, k, opts = {}, look = null) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, ...opts }); const p = await ctx.newPage(); watch(p, tag);
  await p.goto(URL); await p.waitForSelector('#email');
  await p.fill('#email', `e10${tag}_${Date.now()}@example.com`); await p.fill('#pw', 'correct-horse-9'); await p.click('#reg');
  await p.waitForSelector('#new'); await p.click('#new'); await p.waitForSelector('#name');
  const name = tag + kana(Date.now() + k * 7); await p.fill('#name', name); await p.check(`input[value=${cls}]`);
  if (look) { await p.selectOption('#hc', { index: look.hc }); await p.selectOption('#sk', { index: look.sk }); await p.selectOption('#body', look.body); }
  await p.click('#create');
  await p.waitForFunction(() => window.__astral?.scene.isActive('World'), null, { timeout: 15000 });
  const id = (await db.query('SELECT id, user_id FROM characters WHERE name=$1', [name])).rows[0];
  return { ctx, p, name, id: id.id, userId: id.user_id, tag };
}
const shot = (P, f, clip) => P.p.screenshot({ path: SHOT + f, ...(clip ? { clip } : {}) });
const press = async (P, key) => { await P.p.evaluate(() => document.activeElement?.blur?.()); await P.p.keyboard.press(key); };
const say = async (P, text) => { await P.p.click('#chat input'); await P.p.fill('#chat input', text); await P.p.keyboard.press('Enter'); };
const chat = (P) => P.p.textContent('#chat .log');
const chatErr = (P) => P.p.textContent('#chat .c-err');

// ---------- 1. title screen: maintenance banner + announcement, login blocked during maintenance
const ann = `E2Eお知らせ${Date.now() % 100000}`;
await db.query(`INSERT INTO announcements(title, body) VALUES($1, '週末イベント開催予定です')`, [ann]);
await db.query(`UPDATE server_settings SET value='{"on":true,"message":"E2E点検中"}' WHERE key='maintenance'`);
await sleep(2300);
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage(); watch(p, 'title');
  await p.goto(URL); await p.waitForSelector('#email');
  ok('maintenance banner on title', await waitFor(async () => (await p.textContent('#news')).includes('E2E点検中')));
  ok('announcement on title', (await p.textContent('#news')).includes(ann));
  await p.fill('#email', `e10m_${Date.now()}@example.com`); await p.fill('#pw', 'correct-horse-9'); await p.click('#reg');
  ok('login refused during maintenance', await waitFor(async () => (await p.textContent('#err')).includes('メンテナンス')), await p.textContent('#err'));
  await p.screenshot({ path: SHOT + 'phase10-title-maintenance.png' });
  await ctx.close();
}
await db.query(`UPDATE server_settings SET value='{"on":false,"message":""}' WHERE key='maintenance'`);
await sleep(2300);

// ---------- 2. appearance + cobble + audio
const A = await player('甲', 'warrior', 1, {}, { hc: 3, sk: 2, body: 'b' });
const B = await player('乙', 'priest', 2);
const lookKey = await A.p.evaluate(() => window.__astral.scene.getScene('World').player.texture.key);
ok('own sprite uses recoloured appearance texture', lookKey === 'ch_warrior_h3s2bb', lookKey);
ok('other player sees A with A\'s appearance', await waitFor(() => B.p.evaluate(() => window.__astral.textures.exists('ch_warrior_h3s2bb'))));
await A.p.mouse.click(640, 300); // user gesture -> audio unlock
ok('town BGM selected in Asteria', await waitFor(() => A.p.evaluate(() => window.__astralAudio.track === 'town')), await A.p.evaluate(() => window.__astralAudio.track));
await A.p.evaluate(() => { const w = window.__astral.scene.getScene('World'); w.pos.x += 70; });
await sleep(600);
await shot(A, 'phase10-appearance.png', { x: 440, y: 200, width: 400, height: 400 });
// camera onto a cobblestone plaza and capture the new seamless tile
await A.p.evaluate(() => { const w = window.__astral.scene.getScene('World'); const m = w.map, g = m.layers.find((l) => l.name === 'ground').data;
  let best = null; for (let y = 2; y < m.height - 2 && !best; y++) for (let x = 2; x < m.width - 2; x++) { let n = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) n += g[(y + dy) * m.width + x + dx] === 2; if (n === 25) { best = [x, y]; break; } }
  if (best) { w.cameras.main.stopFollow(); w.cameras.main.centerOn(best[0] * 32, best[1] * 32); } });
await sleep(400); await shot(A, 'phase10-cobble.png', { x: 440, y: 250, width: 400, height: 300 });
await A.p.evaluate(() => { const w = window.__astral.scene.getScene('World'); w.cameras.main.startFollow(w.player, true); });

// ---------- 3. menu and its panels
await press(A, 'm'); await A.p.waitForSelector('#p4.menu');
const entries = await A.p.$$eval('#p4.menu .mn', (bs) => bs.map((x) => x.dataset.m));
ok('menu lists 10 entries', entries.length === 10, entries.join(','));
await shot(A, 'phase10-menu.png');
await A.p.click('[data-m="char"]'); await A.p.waitForSelector('#p4.char');
ok('character panel shows name & stats', (await A.p.textContent('#p4.char')).includes(A.name) && (await A.p.textContent('#p4.char')).includes('STR'));
await press(A, 'Escape'); await press(A, 'k'); await A.p.waitForSelector('#p4.skills');
ok('skills panel [K] shows class skill', (await A.p.textContent('#p4.skills')).includes('パワースラッシュ'));
await press(A, 'Escape'); await press(A, 'n'); await A.p.waitForSelector('#p4.mapp canvas.minimap');
ok('map panel [N] draws minimap', (await A.p.textContent('#p4.mapp')).includes('アステリア'));
await shot(A, 'phase10-map.png');
await press(A, 'Escape'); await A.p.click('#menu-btn'); await A.p.waitForSelector('#p4.menu'); await A.p.click('[data-m="news"]');
ok('news panel shows announcement', await waitFor(async () => (await A.p.textContent('#p4.news')).includes(ann)));
await press(A, 'Escape'); await press(A, 'm'); await A.p.click('[data-m="settings"]'); await A.p.waitForSelector('#st-bgm');
await A.p.$eval('#st-bgm', (e) => { e.value = '20'; e.dispatchEvent(new Event('input')); });
await A.p.check('#st-mute');
const saved = await A.p.evaluate(() => JSON.parse(localStorage.getItem('astral.audio') || '{}'));
ok('settings persist volume + mute', saved.muted === true && Math.abs(saved.bgm - 0.2) < 0.01, JSON.stringify(saved));
await shot(A, 'phase10-settings.png');
await A.p.uncheck('#st-mute'); await press(A, 'Escape');
ok('menu entries opened as real panels (market/ranking via menu)', await (async () => { await press(A, 'm'); await A.p.click('[data-m="rank"]'); return !!(await A.p.waitForSelector('#p4.ranking', { timeout: 5000 }).catch(() => null)); })());
await press(A, 'Escape');

// ---------- 4. whisper / block / mute
await say(A, `/w ${B.name} こんにちは内緒です`);
ok('B receives whisper', await waitFor(async () => (await chat(B)).includes('こんにちは内緒です') && (await chat(B)).includes('ささやき')));
ok('A sees own whisper echo', await waitFor(async () => (await chat(A)).includes('こんにちは内緒です')));
await shot(B, 'phase10-whisper.png');
await say(A, '/w 存在しない人ですよ テスト');
ok('whisper to unknown name -> error', await waitFor(async () => (await chatErr(A)).length > 0), await chatErr(A));
// B blocks A via the social panel (pause: server chat limit is 5 msgs / 10 s)
await sleep(10500);
await press(B, 'o'); await B.p.waitForSelector('#s-pname'); await B.p.fill('#s-pname', A.name); await B.p.click('[data-a="block"]');
ok('block listed in social panel', await waitFor(async () => (await B.p.textContent('#social')).includes('ブロック中 (1)')));
await shot(B, 'phase10-block.png');
await say(A, `/w ${B.name} 届かないはず`);
ok('whisper to blocker refused', await waitFor(async () => (await chatErr(A)).includes('届きません')), await chatErr(A));
await sleep(1500); await say(A, 'ローカルも届かないはず');
await waitFor(async () => (await chat(A)).includes('ローカルも届かないはず'), 5000); await sleep(800);
const tagged = `${A.name}: ローカルも届かないはず`; // (chat history also holds earlier runs' messages)
ok('blocked sender\'s local chat hidden from B', !(await chat(B)).includes(tagged) && (await chat(A)).includes(tagged), `B:${(await chat(B)).includes('ローカルも届かないはず')} A:${(await chat(A)).includes('ローカルも届かないはず')} err:${await chatErr(A)} `);
await sleep(10500); await B.p.click('[data-a="unblock"]');
ok('unblock clears list', await waitFor(async () => (await B.p.textContent('#social')).includes('ブロック中 (0)')));
await press(B, 'o');
await say(A, `/w ${B.name} 解除後です`);
ok('whisper works again after unblock', await waitFor(async () => (await chat(B)).includes('解除後です')));
await db.query(`INSERT INTO chat_mutes(character_id, until, reason) VALUES($1, now() + interval '10 minutes', 'gm') ON CONFLICT (character_id) DO UPDATE SET until=EXCLUDED.until`, [A.id]);
await say(A, 'ミュート中の発言');
ok('persistent mute blocks chat', await waitFor(async () => (await chatErr(A)).includes('制限')), await chatErr(A));
await db.query('DELETE FROM chat_mutes WHERE character_id=$1', [A.id]);

// ---------- 5. admin maintenance push (A promoted to admin in DB; role is read from DB per request)
await db.query(`UPDATE users SET role='admin' WHERE id=$1`, [A.userId]);
const call = (P, path, body) => P.p.evaluate(async ([path, body]) => { const r = await fetch('/api' + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + sessionStorage.getItem('astral.token') }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; }, [path, body]);
ok('non-admin cannot toggle maintenance', (await call(B, '/admin/maintenance', { on: true, message: 'x' })).s === 403);
ok('admin toggles maintenance', (await call(A, '/admin/maintenance', { on: true, message: 'E2E緊急メンテ' })).s === 200);
ok('online player gets maintenance notice in chat', await waitFor(async () => (await chat(B)).includes('E2E緊急メンテ')));
await sleep(2200);
ok('player API gated with 503 during maintenance', (await call(B, '/characters')).s === 503);
ok('staff API still works', (await call(A, '/characters')).s === 200);
await shot(B, 'phase10-maintenance-notice.png');
ok('admin turns maintenance off', (await call(A, '/admin/maintenance', { on: false })).s === 200);
const logs = await call(A, '/admin/logs');
ok('audit log has the maintenance actions', logs.s === 200 && JSON.stringify(logs.j).includes('maintenance'));
await db.query(`UPDATE users SET role='player' WHERE id=$1`, [A.userId]);
await sleep(2200);

// ---------- 6. mobile: joystick moves the player, action/menu buttons
const M = await player('携', 'knight', 3, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
ok('touch controls shown on mobile', await M.p.isVisible('#touch .joy') && await M.p.isVisible('#touch .act'));
const pos0 = await M.p.evaluate(() => ({ ...window.__astral.scene.getScene('World').pos }));
await M.p.evaluate(() => { const j = document.querySelector('#touch .joy'), r = j.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  j.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, clientX: cx, clientY: cy + 45, bubbles: true })); window.__joyEnd = () => j.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true })); });
await sleep(900); await shot(M, 'phase10-mobile.png');
await M.p.evaluate(() => window.__joyEnd());
const pos1 = await M.p.evaluate(() => ({ ...window.__astral.scene.getScene('World').pos }));
ok('joystick down moves player south', pos1.y - pos0.y > 40, `${pos0.y} -> ${pos1.y}`);
await M.p.tap('#touch .menu'); ok('touch MENU opens menu', !!(await M.p.waitForSelector('#p4.menu', { timeout: 5000 }).catch(() => null)));
await shot(M, 'phase10-mobile-menu.png');
const desktopTouch = await A.p.isVisible('#touch .joy').catch(() => false);
ok('no touch controls on desktop', !desktopTouch);

ok('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
for (const P of [A, B, M]) await P.ctx.close();
await b.close(); await db.end();
const fail = results.filter((r) => !r.pass); console.log(`\n${results.length - fail.length}/${results.length} passed`); process.exit(fail.length ? 1 : 0);
