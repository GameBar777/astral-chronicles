#!/usr/bin/env python3
"""Generate walkable multi-room dungeon floor maps (Tiled-compatible JSON) and add overworld entrances."""
import json, os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/maps'
TW = 32

# 4 rooms in a 2x2, connected by 2-tile corridors. 36x28 tiles.
W, H = 36, 28
ROOMS = [  # x,y,w,h
    (2, 2, 13, 10),    # NW A
    (21, 2, 13, 10),   # NE B
    (2, 16, 13, 10),   # SW C  spawn
    (21, 16, 13, 10),  # SE D
]
# corridors (x,y,w,h) inclusive carves
CORRIDORS = [
    (14, 6, 8, 2),    # A--B
    (14, 20, 8, 2),   # C--D
    (7, 11, 2, 6),    # A--C
    (26, 11, 2, 6),   # B--D
]

THEMES = {
    'ancient_ruins':   {'floor': 2, 'alt': 3, 'decos': ['rocks', 'barrel', 'crate', 'lamp']},
    'forgotten_mine':  {'floor': 3, 'alt': 2, 'decos': ['rocks', 'boulder', 'crate', 'barrel']},
    'dark_forest':     {'floor': 1, 'alt': 3, 'decos': ['stump', 'bush', 'grass_tuft', 'oak']},
    'desert_temple':   {'floor': 3, 'alt': 2, 'decos': ['rocks', 'boulder', 'signpost', 'lamp']},
    'star_tower':      {'floor': 2, 'alt': 3, 'decos': ['lamp', 'crate', 'banner', 'fountain']},
}

FLOORS = {
    'ancient_ruins': [
        ('地下1階 崩れた回廊', True, True, False),
        ('地下2階 封印の間', True, True, False),
        ('最深部 守護者の祭壇', True, False, True),
    ],
    'forgotten_mine': [
        ('坑道1 廃れた採掘場', True, True, False),
        ('坑道2 崩落した縦坑', True, True, False),
        ('最深部 岩石の守護者', True, False, True),
    ],
    'dark_forest': [
        ('森の入口 霧の小径', True, True, False),
        ('中層 古木の広場', True, True, False),
        ('奥地 封印の大樹', True, False, True),
    ],
    'desert_temple': [
        ('神殿1 熱砂の回廊', True, True, False),
        ('神殿2 壁画の間', True, True, False),
        ('最深部 砂漠の守護像', True, False, True),
    ],
    'star_tower': [
        ('塔1 星屑の階段室', True, True, False),
        ('塔2 水晶の回廊', True, True, False),
        ('最上部 星晶の間', True, False, True),
    ],
}

def carve(walk, x, y, w, h):
    for ty in range(y, y + h):
        for tx in range(x, x + w):
            if 0 <= tx < W and 0 <= ty < H:
                walk[ty][tx] = True

def blocked(walk, tx, ty):
    if tx < 0 or ty < 0 or tx >= W or ty >= H: return True
    return not walk[ty][tx]

def px(tx, ty):
    return tx * TW + TW // 2, ty * TW + 20

def gen_floor(dung, fi, name, has_enc, has_chest, is_boss, theme):
    walk = [[False] * W for _ in range(H)]
    for r in ROOMS: carve(walk, *r)
    for c in CORRIDORS: carve(walk, *c)
    # a couple of internal pillars (still leaves rooms connected)
    pillars = [(7, 5), (27, 5), (7, 21), (27, 21), (16, 13)]
    for tx, ty in pillars:
        walk[ty][tx] = False
        if ty + 1 < H: walk[ty + 1][tx] = False

    ground, coll = [], []
    for ty in range(H):
        for tx in range(W):
            if walk[ty][tx]:
                alt = ((tx * 5 + ty * 11 + fi * 3) % 7) == 0
                ground.append(theme['alt'] if alt else theme['floor'])
                coll.append(0)
            else:
                ground.append(0)
                coll.append(1)

    def mid(room):
        x, y, w, h = room
        return x + w // 2, y + h // 2

    # spawn SW room C, encounter/boss NE room B, chest NW A, stairs SE D
    sx, sy = mid(ROOMS[2])
    ex, ey = mid(ROOMS[1])
    cx, cy = mid(ROOMS[0])
    stx, sty = mid(ROOMS[3])
    # ensure those tiles are walkable (not pillars)
    for tx, ty in [(sx, sy), (ex, ey), (cx, cy), (stx, sty)]:
        walk[ty][tx] = True
        ground[ty * W + tx] = theme['floor']
        coll[ty * W + tx] = 0

    objects = [{
        'id': 'spawn', 'type': 'spawn', 'tx': sx, 'ty': sy, 'fw': 1, 'fh': 1,
        'x': px(sx, sy)[0], 'y': px(sx, sy)[1],
    }]
    if has_enc:
        objects.append({
            'id': 'encounter', 'type': 'encounter', 'tx': ex, 'ty': ey, 'fw': 1, 'fh': 1,
            'x': px(ex, ey)[0], 'y': px(ex, ey)[1],
            'label': 'ボス' if is_boss else '魔物', 'props': {'boss': is_boss},
        })
    if has_chest:
        objects.append({
            'id': 'chest', 'type': 'chest', 'tx': cx, 'ty': cy, 'fw': 1, 'fh': 1,
            'x': px(cx, cy)[0], 'y': px(cx, cy)[1], 'label': '宝箱',
        })
    if not is_boss:
        objects.append({
            'id': 'stairs', 'type': 'stairs', 'tx': stx, 'ty': sty, 'fw': 1, 'fh': 1,
            'x': px(stx, sty)[0], 'y': px(stx, sty)[1], 'label': '下り階段',
        })

    # decorations in room corners (walkable)
    kinds = theme['decos']
    spots = [(3, 3), (12, 3), (22, 3), (31, 3), (3, 17), (12, 24), (22, 17), (31, 24), (4, 9), (30, 9)]
    for i, (tx, ty) in enumerate(spots):
        if not walk[ty][tx]: continue
        if (tx, ty) in {(sx, sy), (ex, ey), (cx, cy), (stx, sty)}: continue
        kind = kinds[i % len(kinds)]
        objects.append({
            'id': f'deco_{fi}_{i}', 'type': 'deco', 'kind': kind,
            'tx': tx, 'ty': ty, 'fw': 1, 'fh': 1,
            'x': px(tx, ty)[0], 'y': px(tx, ty)[1] + 8,
        })

    mid_id = f'dg_{dung}_{fi}'
    return {
        'id': mid_id, 'name': name, 'projection': 'orthogonal',
        'width': W, 'height': H, 'tilewidth': TW, 'tileheight': TW,
        'recommendedLevel': [1, 99],
        'spawn': {'x': px(sx, sy)[0], 'y': px(sx, sy)[1]},
        'layers': [
            {'name': 'ground', 'data': ground},
            {'name': 'collision', 'data': coll},
        ],
        'objects': objects,
        '_note': 'generated by scripts/gen-dungeon-maps.py (multi-room walkable dungeon floor)',
    }

def count_rooms(walk_or_coll):
    # connected components of walkable tiles
    vis = [False] * (W * H)
    def idx(x, y): return y * W + x
    n = 0
    large = 0
    for y in range(H):
        for x in range(W):
            if walk_or_coll[idx(x, y)] != 0 or vis[idx(x, y)]: continue
            n += 1
            stack = [(x, y)]
            vis[idx(x, y)] = True
            size = 0
            while stack:
                cx, cy = stack.pop(); size += 1
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx, ny = cx+dx, cy+dy
                    if 0<=nx<W and 0<=ny<H and walk_or_coll[idx(nx,ny)]==0 and not vis[idx(nx,ny)]:
                        vis[idx(nx,ny)] = True; stack.append((nx, ny))
            if size > 20: large += 1
    return n, large

def patch_meadow():
    p = OUT / 'green_meadow.json'
    m = json.loads(p.read_text())
    # remove previously generated entrances (keep ruins)
    m['objects'] = [o for o in m['objects'] if not (o.get('type')=='dungeon' and o.get('id')!='ruins_entrance')]
    extras = [
        ('mine_entrance', 'forgotten_mine', '忘れられた鉱山', 2, 2),
        ('forest_entrance', 'dark_forest', '闇の森林', 22, 2),
        ('temple_entrance', 'desert_temple', '砂漠の神殿', 40, 2),
        ('tower_entrance', 'star_tower', '星晶の塔', 6, 7),
    ]
    for oid, did, label, tx, ty in extras:
        m['objects'].append({
            'id': oid, 'type': 'dungeon', 'tx': tx, 'ty': ty, 'fw': 1, 'fh': 1,
            'x': tx * 32 + 16, 'y': ty * 32 + 16, 'label': label,
            'props': {'dungeonId': did},
        })
    p.write_text(json.dumps(m, ensure_ascii=False, separators=(',', ':')))
    print('patched green_meadow entrances')

def main():
    written = []
    for dung, floors in FLOORS.items():
        theme = THEMES[dung]
        for i, (name, enc, chest, boss) in enumerate(floors, 1):
            m = gen_floor(dung, i, name, enc, chest, boss, theme)
            coll = m['layers'][1]['data']
            comps, large = count_rooms(coll)
            # all objects must be mutually reachable — one walkable component
            assert large == 1, (m['id'], comps, large)
            # spawn not blocked
            from math import nan
            sx, sy = m['spawn']['x'], m['spawn']['y']
            # tile of feet
            assert coll[int((sy-0.001)//TW) * W + int(sx//TW)] == 0, m['id']
            path = OUT / f"{m['id']}.json"
            path.write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n')
            written.append(f"{m['id']} rooms_components={large} objects={len(m['objects'])}")
    patch_meadow()
    print('\n'.join(written))

if __name__ == '__main__':
    main()
