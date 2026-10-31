import { describe, it, expect } from 'vitest';
import { inputToVector, vectorToDirection, moveWithCollision, isBlocked, type MapData } from '../src/index.js';
import asteria from '../../../assets/maps/asteria.json';

const tiny: MapData = { id: 't', name: 't', width: 4, height: 4, tilewidth: 32, tileheight: 32, recommendedLevel: [1, 1],
  spawn: { x: 48, y: 48 }, objects: [],
  layers: [{ name: 'ground', data: Array(16).fill(1) }, { name: 'collision', data: [1,1,1,1, 1,0,0,1, 1,0,0,1, 1,1,1,1] }] };

describe('8-direction movement', () => {
  it('normalises diagonals', () => {
    const v = inputToVector({ up: true, down: false, left: false, right: true });
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
    expect(vectorToDirection(v)).toBe('ne');
  });
  it('maps all 8 directions', () => {
    const c = (u: boolean, d: boolean, l: boolean, r: boolean) => vectorToDirection(inputToVector({ up: u, down: d, left: l, right: r }));
    expect(c(true,false,false,false)).toBe('n');
    expect(c(false,true,false,false)).toBe('s'); expect(c(false,false,true,false)).toBe('w'); expect(c(false,false,false,true)).toBe('e');
    expect(c(true,false,true,false)).toBe('nw'); expect(c(false,true,true,false)).toBe('sw'); expect(c(false,true,false,true)).toBe('se');
    expect(c(false,false,false,false)).toBeNull(); expect(c(true,true,false,false)).toBeNull();
  });
});
describe('collision', () => {
  it('blocks walls and outside map', () => {
    expect(isBlocked(tiny, { x: 48, y: 60 })).toBe(false);
    expect(isBlocked(tiny, { x: 10, y: 60 })).toBe(true);
    expect(isBlocked(tiny, { x: -100, y: -100 })).toBe(true);
  });
  it('stops at wall and slides along it', () => {
    const p = moveWithCollision(tiny, { x: 64, y: 80 }, { x: 200, y: 0 });
    expect(p.x).toBeLessThanOrEqual(96 - 10); expect(p.x).toBeGreaterThan(80);
    const s = moveWithCollision(tiny, { x: 85, y: 80 }, { x: 50, y: -10 });
    expect(s.y).toBeCloseTo(70);
  });
  it('no tunnelling with huge delta', () => {
    const p = moveWithCollision(tiny, { x: 48, y: 80 }, { x: 0, y: 10000 });
    expect(isBlocked(tiny, p)).toBe(false); expect(p.y).toBeLessThanOrEqual(96);
  });
});
describe('asteria map data', () => {
  const m = asteria as unknown as MapData;
  it('layers have correct size', () => { for (const l of m.layers) expect(l.data.length).toBe(m.width * m.height); });
  it('spawn is walkable', () => expect(isBlocked(m, m.spawn)).toBe(false));
  it('border is solid', () => { expect(isBlocked(m, { x: 5, y: 20 })).toBe(true); });
});
