/**
 * PHASE 10 sound (TD-018): every BGM and SFX is synthesised at runtime with the Web Audio API from note data written for
 * this project — no third-party recordings or samples, so there is no licensing question (SECTION 18).
 * BGM: short looping chiptune phrases (lead + bass + soft pulse) per scene. SFX: tiny envelopes.
 * Settings (BGM / SFX volume, mute) persist in localStorage. Browsers only allow audio after a user gesture;
 * the context is resumed on the first pointer/key event.
 */
type Track = { bpm: number; lead: OscillatorType; bass: OscillatorType; melody: string; bassline: string; loop: boolean; gain?: number };
// note syntax: "C4" "D#5" "-" (rest), each token = one 8th note; "C4:2" holds for 2 eighths
const T: Record<string, Track> = {
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
const FREQ = (n: string) => { const m = /^([A-G])(#?)(\d)$/.exec(n); if (!m) return 0; const i = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]]! + (m[2] ? 1 : 0); return 440 * Math.pow(2, (i - 9) / 12 + (Number(m[3]) - 4)); };
const parse = (s: string) => s.split(/\s+/).filter(Boolean).map((t) => { const [n, d] = t.split(':'); return { f: n === '-' ? 0 : FREQ(n), len: Number(d ?? 1) }; });
const KEY = 'astral.audio';
type Settings = { bgm: number; sfx: number; muted: boolean };
let settings: Settings = { bgm: 0.5, sfx: 0.7, muted: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { /* defaults */ }
let ctx: AudioContext | null = null, bgmGain: GainNode, sfxGain: GainNode, current = '', timer: number | undefined, voices: OscillatorNode[] = [];
const state = { track: '', played: [] as string[], sfx: [] as string[] }; // exposed for tests
(window as any).__astralAudio = state;
function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as any).webkitAudioContext; if (!AC) return null;
  ctx = new AC(); bgmGain = ctx.createGain(); sfxGain = ctx.createGain(); bgmGain.connect(ctx.destination); sfxGain.connect(ctx.destination); apply();
  return ctx;
}
function apply() { if (!ctx) return; bgmGain.gain.value = settings.muted ? 0 : settings.bgm * 0.22; sfxGain.gain.value = settings.muted ? 0 : settings.sfx * 0.3; }
const unlock = () => { const c = ensure(); if (c && c.state === 'suspended') c.resume().catch(() => {}); if (current && !voices.length) { const t = current; current = ''; playBgm(t); } };
window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
function tone(dest: GainNode, type: OscillatorType, f: number, t0: number, dur: number, vol: number) {
  const c = ctx!, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0008, t0 + Math.max(0.05, dur));
  o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05); voices.push(o); o.onended = () => { voices = voices.filter((v) => v !== o); };
  return o;
}
function schedule(name: string) {
  const tr = T[name], c = ctx!, e = 60 / tr.bpm / 2, start = c.currentTime + 0.06, vol = tr.gain ?? 0.8;
  let t = start; for (const n of parse(tr.melody)) { if (n.f) tone(bgmGain, tr.lead, n.f, t, n.len * e * 0.92, 0.35 * vol); t += n.len * e; }
  const total = t - start; let tb = start;
  while (tb < start + total - 1e-6) for (const n of parse(tr.bassline)) { if (tb >= start + total - 1e-6) break; if (n.f) tone(bgmGain, tr.bass, n.f, tb, n.len * e * 0.95, 0.3 * vol); tb += n.len * e; }
  if (tr.loop) timer = window.setTimeout(() => { if (current === name) schedule(name); }, total * 1000 - 40);
}
function stopVoices() { if (timer) clearTimeout(timer); timer = undefined; for (const v of voices) { try { v.stop(); } catch { /* already */ } } voices = []; }
/** switch BGM (no-op if already playing). Unknown names stop the music. */
export function playBgm(name: string) {
  if (name === current) return; stopVoices(); current = T[name] ? name : ''; state.track = current; if (current) state.played.push(current);
  const c = ensure(); if (!c || !current || c.state !== 'running') return; schedule(current);
}
export const stopBgm = () => { stopVoices(); current = ''; state.track = ''; };
const SFX: Record<string, (t: number) => void> = {
  attack: (t) => { tone(sfxGain, 'square', 220, t, 0.06, 0.5); tone(sfxGain, 'sawtooth', 110, t + 0.03, 0.09, 0.4); },
  magic: (t) => { for (let i = 0; i < 5; i++) tone(sfxGain, 'triangle', 600 + i * 180, t + i * 0.035, 0.12, 0.35); },
  heal: (t) => { [523, 659, 784, 1046].forEach((f, i) => tone(sfxGain, 'sine', f, t + i * 0.07, 0.2, 0.4)); },
  levelup: (t) => { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(sfxGain, 'square', f, t + i * 0.09, 0.16, 0.35)); },
  item: (t) => { tone(sfxGain, 'square', 988, t, 0.07, 0.35); tone(sfxGain, 'square', 1319, t + 0.07, 0.14, 0.35); },
  enhance: (t) => { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(sfxGain, 'triangle', f, t + i * 0.05, 0.12, 0.35)); tone(sfxGain, 'sawtooth', 1568, t + 0.32, 0.3, 0.2); },
  menu: (t) => tone(sfxGain, 'square', 880, t, 0.04, 0.25),
  hit: (t) => tone(sfxGain, 'sawtooth', 90, t, 0.12, 0.45),
};
export function sfx(name: keyof typeof SFX | string) { state.sfx.push(name); const c = ensure(); if (!c || c.state !== 'running' || !SFX[name]) return; SFX[name](c.currentTime + 0.01); }
export const audioSettings = () => ({ ...settings });
export function setAudio(p: Partial<Settings>) { settings = { ...settings, ...p }; localStorage.setItem(KEY, JSON.stringify(settings)); apply(); }
export const TRACKS = Object.keys(T);
export const __test = { parse, FREQ };
