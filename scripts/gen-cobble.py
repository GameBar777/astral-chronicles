"""BUG-009: non-mirrored seamless cobblestone (toroidal Voronoi, original procedural art). Writes the cobble slot (x 256..511) of ground.png."""
import random, math
from PIL import Image
import numpy as np
random.seed(20261112); S = 256
# jittered grid of stone centres (~22px stones at 256 → ~11px after the client's half-scale)
pts = []; g = 12
for gy in range(g):
    for gx in range(g):
        pts.append(((gx + 0.5 + random.uniform(-0.38, 0.38)) * S / g, (gy + 0.5 + random.uniform(-0.38, 0.38)) * S / g))
P = np.array(pts); yy, xx = np.mgrid[0:S, 0:S]
d1 = np.full((S, S), 1e9); d2 = np.full((S, S), 1e9); idx = np.zeros((S, S), int)
for i, (px, py) in enumerate(P):
    dx = np.abs(xx - px); dx = np.minimum(dx, S - dx); dy = np.abs(yy - py); dy = np.minimum(dy, S - dy)
    d = np.sqrt(dx * dx + (dy * 1.08) ** 2)
    closer = d < d1; d2 = np.where(closer, d1, np.minimum(d2, d)); idx = np.where(closer, i, idx); d1 = np.where(closer, d, d1)
edge = d2 - d1  # distance to the stone border
rng = np.random.default_rng(7)
base = rng.uniform(0.82, 1.12, len(P)); tint = rng.uniform(-10, 10, len(P))
stone = np.stack([150 + tint[idx], 140 + tint[idx] * 0.8, 118 + tint[idx] * 0.6], -1) * base[idx][..., None]
# rounded shading: lighter towards top-left of each stone, darker near the border
cx = P[idx, 0]; cy = P[idx, 1]
ox = xx - cx; ox = (ox + S / 2) % S - S / 2; oy = yy - cy; oy = (oy + S / 2) % S - S / 2
dome = np.sqrt(np.clip((edge - 2.4) / 7.0, 0, 1)); light = np.clip(1.08 - 0.014 * (ox + oy), 0.78, 1.25) * (0.55 + 0.5 * dome)
noise = rng.normal(0, 6, (S, S))
img = stone * light[..., None] + noise[..., None]
grout = np.array([58, 54, 46]) + rng.normal(0, 5, (S, S, 1))
mask = (edge < 2.6)[..., None]
img = np.where(mask, grout, img)
img = (np.round(np.clip(img, 0, 255) / 6) * 6).astype(np.uint8)  # light posterise → pixel-art look
g_img = Image.open('client/public/sprites/ground.png').convert('RGBA')
g_img.paste(Image.fromarray(img, 'RGB').convert('RGBA'), (256, 0))
g_img.save('client/public/sprites/ground.png')
Image.fromarray(img, 'RGB').resize((512, 512), Image.NEAREST).save('/tmp/cobble_new.png')
print('ok')
