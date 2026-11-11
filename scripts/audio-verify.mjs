/** Offline render of every BGM track and SFX to WAV, then measure peak/RMS/clipping/silence/duration/loop seams.
 * Mirrors client/src/audio.ts (same note data, envelopes, default volume settings). Cannot replace human listening. */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/audio-analysis');
mkdirSync(OUT, { recursive: true });
const SR = 44100;

// --- copied note data / parser from client/src/audio.ts (keep in sync) ---
const T = {
  title:   { bpm: 92,  lead: 'triangle', bass: 'sine',   loop: true, melody: 'E5:2 G5 A5 B5:2 A5 G5 E5:2 D5 E5 G5:4 E5:2 G5 A5 B5:2 D6 B5 A5:2 G5 A5 E5:4', bassline: 'E3:4 C3:4 G2:4 D3:4 E3:4 C3:4 A2:4 B2:4' },
  town:    { bpm: 112, lead: 'square',   bass: 'triangle', loop: true, gain: 0.7, melody: 'C5 E5 G5 E5 F5:2 A5:2 G5 E5 C5 E5 D5:4 C5 E5 G5 C6 B5:2 A5:2 G5 F5 E5 D5 C5:4', bassline: 'C3:2 G2:2 F2:2 C3:2 G2:2 G2:2 C3:2 G2:2 F2:2 F2:2 G2:2 C3:2' },
  meadow:  { bpm: 128, lead: 'square',   bass: 'triangle', loop: true, gain: 0.6, melody: 'G4 A4 B4 D5 B4 A4 G4:2 A4 B4 C5 E5 D5:4 G4 A4 B4 D5 E5 D5 B4:2 A4 G4 A4 B4 G4:4', bassline: 'G2:2 D3:2 C3:2 D3:2 G2:2 D3:2 C3:2 D3:2' },
  forest:  { bpm: 100, lead: 'triangle', bass: 'sine',   loop: true, melody: 'A4:2 C5 E5 D5:2 C5 B4 A4:2 E4 A4 G4:4 A4:2 C5 E5 G5:2 F5 E5 D5:2 B4 C5 A4:4', bassline: 'A2:4 F2:4 G2:4 E2:4' },
  battle:  { bpm: 144, lead: 'square',   bass: 'sawtooth', loop: true, gain: 0.5, melody: 'A4 C5 E5 A5 G5 E5 C5 E5 F5 A5 C6 A5 G5:2 E5:2 A4 C5 E5 A5 B5 A5 G5 E5 F5 E5 D5 B4 A4:4', bassline: 'A2 A3 A2 A3 F2 F3 F2 F3 G2 G3 G2 G3 E2 E3 E2 E3' },
  dungeon: { bpm: 84,  lead: 'triangle', bass: 'sawtooth', loop: true, gain: 0.55, melody: 'D4:2 F4 A4 G#4:2 F4 E4 D4:2 - A3 D4:4 F4:2 A4 C5 B4:2 G#4 F4 E4:4 D4:4', bassline: 'D2:4 D2:4 A#1:4 A1:4 D2:4 A#1:4 A1:4 D2:4' },
  boss:    { bpm: 152, lead: 'sawtooth', bass: 'square',   loop: true, gain: 0.45, melody: 'D5 D5 F5 D5 G5 F5 D5 C5 D5 D5 A5 G5 F5 E5 C5 E5 D5 D5 F5 D5 A#5 A5 G5 F5 E5 F5 G5 E5 D5:4', bassline: 'D2 D3 D2 D3 D2 D3 D2 D3 A#1 A#2 A#1 A#2 C2 C3 C2 C3' },
  victory: { bpm: 140, lead: 'square',   bass: 'triangle', loop: false, gain: 0.7, melody: 'C5 C5 C5 C5:3 G#4:3 A#4:3 C5:2 A#4 C5:6', bassline: 'C3:4 G#2:3 A#2:3 C3:8' },
  defeat:  { bpm: 70,  lead: 'triangle', bass: 'sine',   loop: false, melody: 'A4:2 G4:2 F4:2 E4:4 D4:2 C#4:2 D4:6', bassline: 'D3:6 A2:6 D2:8' },
};
const FREQ = (n) => { const m = /^([A-G])(#?)(\d)$/.exec(n); if (!m) return 0; const i = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] ? 1 : 0); return 440 * Math.pow(2, (i - 9) / 12 + (Number(m[3]) - 4)); };
const parse = (s) => s.split(/\s+/).filter(Boolean).map((t) => { const [n, d] = t.split(':'); return { f: n === '-' ? 0 : FREQ(n), len: Number(d ?? 1) }; });

const SETTINGS = { bgm: 0.5, sfx: 0.7, muted: false };
const bgmMaster = SETTINGS.muted ? 0 : SETTINGS.bgm * 0.22;
const sfxMaster = SETTINGS.muted ? 0 : SETTINGS.sfx * 0.3;

function wave(type, f, t) {
  const ph = f * t;
  if (type === 'sine') return Math.sin(2 * Math.PI * ph);
  if (type === 'square') return Math.sin(2 * Math.PI * ph) >= 0 ? 1 : -1;
  if (type === 'sawtooth') return 2 * (ph - Math.floor(ph + 0.5));
  if (type === 'triangle') { const x = ph - Math.floor(ph); return x < 0.5 ? 4 * x - 1 : 3 - 4 * x; }
  return Math.sin(2 * Math.PI * ph);
}
/** Same envelope as tone(): 0 → vol in 12ms, exp down to 0.0008 over dur, voice lasts dur+0.05 */
function addTone(buf, type, f, t0, dur, vol, master) {
  const att = 0.012, stop = t0 + dur + 0.05, fade = Math.max(0.05, dur);
  const i0 = Math.max(0, Math.floor(t0 * SR)), i1 = Math.min(buf.length, Math.ceil(stop * SR));
  for (let i = i0; i < i1; i++) {
    const t = i / SR - t0;
    let env;
    if (t < 0) continue;
    if (t < att) env = vol * (t / att);
    else {
      const p = Math.min(1, (t - att) / Math.max(1e-6, fade - att));
      env = vol * Math.exp(Math.log(0.0008 / vol) * p);
    }
    if (t > dur + 0.05) env = 0;
    buf[i] += wave(type, f, i / SR) * env * master;
  }
}

function phraseLength(tr) {
  const e = 60 / tr.bpm / 2;
  return parse(tr.melody).reduce((s, n) => s + n.len * e, 0);
}
function scheduleTrack(buf, tr, start) {
  const e = 60 / tr.bpm / 2, vol = tr.gain ?? 0.8;
  let t = start;
  for (const n of parse(tr.melody)) { if (n.f) addTone(buf, tr.lead, n.f, t, n.len * e * 0.92, 0.35 * vol, bgmMaster); t += n.len * e; }
  const total = t - start; let tb = start;
  while (tb < start + total - 1e-6) for (const n of parse(tr.bassline)) { if (tb >= start + total - 1e-6) break; if (n.f) addTone(buf, tr.bass, n.f, tb, n.len * e * 0.95, 0.3 * vol, bgmMaster); tb += n.len * e; }
  return total;
}

function encodeWav(buf) {
  const n = buf.length, bytes = n * 2, out = Buffer.alloc(44 + bytes);
  out.write('RIFF', 0); out.writeUInt32LE(36 + bytes, 4); out.write('WAVE', 8);
  out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(bytes, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, buf[i]));
    out.writeInt16LE(s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), 44 + i * 2);
  }
  return out;
}

function analyze(buf, label) {
  let peak = 0, sum2 = 0, clipped = 0, first = -1, last = -1;
  const TH = 0.01; // -40 dB-ish activity
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
    sum2 += buf[i] * buf[i];
    if (a >= 1) clipped++;
    if (a >= TH) { if (first < 0) first = i; last = i; }
  }
  const rms = Math.sqrt(sum2 / Math.max(1, buf.length));
  const dur = buf.length / SR;
  const lead = first < 0 ? dur : first / SR;
  const trail = first < 0 ? 0 : (buf.length - 1 - last) / SR;
  const active = first < 0 ? 0 : (last - first + 1) / SR;
  const peakDb = peak <= 0 ? -Infinity : 20 * Math.log10(peak);
  const rmsDb = rms <= 0 ? -Infinity : 20 * Math.log10(rms);
  return { label, durationSec: +dur.toFixed(3), peak: +peak.toFixed(4), peakDb: +peakDb.toFixed(2), rms: +rms.toFixed(4), rmsDb: +rmsDb.toFixed(2),
    clippedSamples: clipped, leadingSilenceSec: +lead.toFixed(3), trailingSilenceSec: +trail.toFixed(3), activeSec: +active.toFixed(3), silent: first < 0 };
}

/** Loop seam: render two phrases with the same 40ms early restart the client uses; measure a jump at the join. */
function loopSeam(tr, total) {
  const pad = 0.2;
  const buf = new Float32Array(Math.ceil((total * 2 - 0.04 + pad) * SR));
  scheduleTrack(buf, tr, 0.02);
  scheduleTrack(buf, tr, 0.02 + total - 0.04); // 40ms early, same as setTimeout(..., total*1000-40)
  const join = 0.02 + total; // start of phrase 2 if there were no overlap
  const w = Math.floor(0.01 * SR); // 10ms window
  const mid = Math.floor(join * SR);
  let maxJump = 0, maxDeriv = 0, energy = 0, n = 0;
  for (let i = mid - w; i < mid + w && i > 0 && i < buf.length; i++) {
    const d = Math.abs(buf[i] - buf[i - 1]);
    if (d > maxDeriv) maxDeriv = d;
    energy += buf[i] * buf[i]; n++;
  }
  // hard-cut discontinuity if we had concatenated without overlap (diagnostic)
  const a = new Float32Array(Math.ceil((total + 0.2) * SR));
  scheduleTrack(a, tr, 0.02);
  const iEnd = Math.floor((0.02 + total) * SR);
  const iStart = Math.floor(0.02 * SR);
  const hardJump = Math.abs((a[Math.min(iEnd, a.length - 1)] ?? 0) - (a[iStart] ?? 0));
  for (let i = 1; i < w && iEnd - i >= 0 && iStart + i < a.length; i++) {
    const j = Math.abs(a[iEnd - 1] - a[iStart]); // already captured
    if (j > maxJump) maxJump = j;
  }
  maxJump = Math.max(maxJump, hardJump);
  return { joinAtSec: +join.toFixed(3), overlapRestartSec: 0.04, maxSampleDeltaAtJoin: +maxDeriv.toFixed(4),
    hardCutEndpointJump: +hardJump.toFixed(4), joinWindowRms: +Math.sqrt(energy / Math.max(1, n)).toFixed(4),
    /* a click is flagged when the overlapped join still has a large sample-to-sample jump */
    clickLikely: maxDeriv > 0.25 };
}

const SFX = {
  attack: (buf, t) => { addTone(buf, 'square', 220, t, 0.06, 0.5, sfxMaster); addTone(buf, 'sawtooth', 110, t + 0.03, 0.09, 0.4, sfxMaster); },
  magic: (buf, t) => { for (let i = 0; i < 5; i++) addTone(buf, 'triangle', 600 + i * 180, t + i * 0.035, 0.12, 0.35, sfxMaster); },
  heal: (buf, t) => { [523, 659, 784, 1046].forEach((f, i) => addTone(buf, 'sine', f, t + i * 0.07, 0.2, 0.4, sfxMaster)); },
  levelup: (buf, t) => { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => addTone(buf, 'square', f, t + i * 0.09, 0.16, 0.35, sfxMaster)); },
  item: (buf, t) => { addTone(buf, 'square', 988, t, 0.07, 0.35, sfxMaster); addTone(buf, 'square', 1319, t + 0.07, 0.14, 0.35, sfxMaster); },
  enhance: (buf, t) => { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => addTone(buf, 'triangle', f, t + i * 0.05, 0.12, 0.35, sfxMaster)); addTone(buf, 'sawtooth', 1568, t + 0.32, 0.3, 0.2, sfxMaster); },
  menu: (buf, t) => addTone(buf, 'square', 880, t, 0.04, 0.25, sfxMaster),
  hit: (buf, t) => addTone(buf, 'sawtooth', 90, t, 0.12, 0.45, sfxMaster),
};

const reports = [];
const issues = [];

for (const [name, tr] of Object.entries(T)) {
  const total = phraseLength(tr);
  const loops = tr.loop ? 2 : 1;
  const start = 0.02;
  const dur = tr.loop ? start + total * loops - 0.04 + 0.25 : start + total + 0.3;
  const buf = new Float32Array(Math.ceil(dur * SR));
  scheduleTrack(buf, tr, start);
  if (tr.loop) scheduleTrack(buf, tr, start + total - 0.04);
  writeFileSync(join(OUT, `bgm_${name}.wav`), encodeWav(buf));
  const a = analyze(buf, `bgm:${name}`);
  a.phraseSec = +total.toFixed(3);
  a.loop = tr.loop;
  if (tr.loop) Object.assign(a, { seam: loopSeam(tr, total) });
  reports.push(a);
  if (a.silent) issues.push(`${name}: completely silent`);
  if (a.clippedSamples > 0) issues.push(`${name}: ${a.clippedSamples} clipped samples (peak ${a.peak})`);
  if (a.peak > 0.99) issues.push(`${name}: peak ${a.peak} is at/over full scale`);
  if (a.leadingSilenceSec > 0.2) issues.push(`${name}: leading silence ${a.leadingSilenceSec}s`);
  if (tr.loop && a.seam.clickLikely) issues.push(`${name}: loop seam click likely (Δ=${a.seam.maxSampleDeltaAtJoin})`);
}

for (const [name, fn] of Object.entries(SFX)) {
  const buf = new Float32Array(Math.ceil(1.2 * SR));
  fn(buf, 0.02);
  writeFileSync(join(OUT, `sfx_${name}.wav`), encodeWav(buf));
  const a = analyze(buf, `sfx:${name}`);
  reports.push(a);
  if (a.silent) issues.push(`sfx ${name}: silent`);
  if (a.clippedSamples > 0) issues.push(`sfx ${name}: ${a.clippedSamples} clipped samples`);
  if (a.peak > 0.99) issues.push(`sfx ${name}: peak ${a.peak} at/over full scale`);
  if (a.leadingSilenceSec > 0.1) issues.push(`sfx ${name}: leading silence ${a.leadingSilenceSec}s`);
  if (a.activeSec < 0.015) issues.push(`sfx ${name}: extremely short active region (${a.activeSec}s)`);
}

const out = { renderedAt: new Date().toISOString(), sampleRate: SR, settings: SETTINGS,
  note: 'Objective offline render of the WebAudio synth. Human listening is still pending.',
  issues, tracks: reports };
writeFileSync(join(OUT, 'report.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ issues, counts: { tracks: Object.keys(T).length, sfx: Object.keys(SFX).length }, worstPeak: Math.max(...reports.map((r) => r.peak)), anyClip: reports.some((r) => r.clippedSamples > 0) }, null, 2));
for (const r of reports) console.log(`${r.label.padEnd(14)} peak=${r.peak.toFixed(3)} (${r.peakDb}dB) rms=${r.rms.toFixed(3)} dur=${r.durationSec}s clip=${r.clippedSamples} lead=${r.leadingSilenceSec}s${r.seam ? ` seamΔ=${r.seam.maxSampleDeltaAtJoin} click=${r.seam.clickLikely}` : ''}`);
if (issues.length) console.log('ISSUES:\n' + issues.map((x) => ' - ' + x).join('\n'));
process.exit(0);
