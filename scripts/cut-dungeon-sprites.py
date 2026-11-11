"""Cut PHASE-follow-up dungeon mob/boss sheets and battle backdrops into client/public/sprites.
Does not touch existing meadow/character sprites. Magenta-key logic copied from cut-sprites.py.
"""
import os, sys, numpy as np
from PIL import Image
from scipy import ndimage
RAW='assets/raw'; OUT='client/public/sprites'; os.makedirs(OUT, exist_ok=True)
def key(img):
    a=np.asarray(img.convert('RGB')).astype(int); r,g,b=a[...,0],a[...,1],a[...,2]
    bg=(r>140)&(g<110)&(b>60)&(r-g>90)&(b-g>30)
    bg=ndimage.binary_opening(bg, iterations=1)
    fg=~bg; fg=ndimage.binary_opening(fg, iterations=2)
    rgba=np.dstack([a, fg*255]).astype(np.uint8)
    edge=fg & ndimage.binary_dilation(bg, iterations=2)
    m=edge & (r>g+40) & (b>g+20)
    rgba[m,0]=np.minimum(rgba[m,0], rgba[m,1]+30); rgba[m,2]=np.minimum(rgba[m,2], rgba[m,1]+30)
    return Image.fromarray(rgba,'RGBA'), fg
def comps(fg, min_area=1500, merge=6, row=120):
    lab,n=ndimage.label(ndimage.binary_dilation(fg, iterations=merge))
    boxes=[s for i,s in enumerate(ndimage.find_objects(lab)) if (s[0].stop-s[0].start)*(s[1].stop-s[1].start)>min_area]
    return sorted(boxes, key=lambda s:((s[0].start//row), s[1].start))
def shrink(im, h=None, w=None):
    W,H=im.size; f=(h/H) if h else (w/W); nw,nh=max(1,round(W*f)),max(1,round(H*f))
    a=np.asarray(im).astype(float); a[...,:3]*=a[...,3:]/255
    s=np.asarray(Image.fromarray(a.astype(np.uint8),'RGBA').resize((nw,nh), Image.BOX)).astype(float)
    al=s[...,3:]; s[...,:3]=np.where(al>0, s[...,:3]*255/np.maximum(al,1), 0); s[...,3]=np.where(al[...,0]>110,255,0)
    return Image.fromarray(np.clip(s,0,255).astype(np.uint8),'RGBA')
def crop(im, s): return im.crop((s[1].start, s[0].start, s[1].stop, s[0].stop))
def tight(im):
    bb=im.getbbox(); return im.crop(bb) if bb else im
def main_blob(im):
    a=np.asarray(im).copy(); lab,n=ndimage.label(a[...,3]>0)
    if n>1:
        sizes=ndimage.sum(np.ones_like(lab),lab,range(1,n+1)); keep=np.isin(lab,[i+1 for i,s in enumerate(sizes) if s>=0.02*sizes.max()]); a[~keep,3]=0
    return tight(Image.fromarray(a,'RGBA'))
report=[]
def save(name, im): im.save(f'{OUT}/{name}.png'); report.append(f'{name} {im.size}')

# mobs A: bat, skeleton, slime-bat, miner goblin, cave beetle
im,fg=key(Image.open(f'{RAW}/dungeon_mobs_a.jpg')); bs=comps(fg, 2000, 6, 2000)
print('mobs_a', len(bs), [(b[1].stop-b[1].start, b[0].stop-b[0].start) for b in bs])
names_a=['ruins_bat','ruins_skeleton','mine_slimebat','mine_goblin','mine_beetle']
hs_a={'ruins_bat':64,'ruins_skeleton':84,'mine_slimebat':64,'mine_goblin':84,'mine_beetle':64}
for n,b in zip(names_a, bs):
    p=main_blob(tight(crop(im,b))); save(f'mon_{n}', shrink(p, h=hs_a[n]))

# mobs B: wisp, sapling, scarab, mummy, crystal shard
im,fg=key(Image.open(f'{RAW}/dungeon_mobs_b.jpg')); bs=comps(fg, 2000, 6, 2000)
print('mobs_b', len(bs), [(b[1].stop-b[1].start, b[0].stop-b[0].start) for b in bs])
names_b=['forest_wisp','forest_sapling','desert_scarab','desert_mummy','tower_shard']
hs_b={'forest_wisp':64,'forest_sapling':84,'desert_scarab':64,'desert_mummy':84,'tower_shard':84}
for n,b in zip(names_b, bs):
    p=main_blob(tight(crop(im,b))); save(f'mon_{n}', shrink(p, h=hs_b[n]))

# bosses: ruins golem, mine golem, forest treant, desert sphinx, tower sentinel
im,fg=key(Image.open(f'{RAW}/dungeon_bosses.jpg')); bs=comps(fg, 20000, 1, 2000)
print('bosses', len(bs), [(b[1].stop-b[1].start, b[0].stop-b[0].start) for b in bs])
names_c=['ruins_golem','mine_golem','forest_treant','desert_sphinx','tower_sentinel']
for n,b in zip(names_c, bs):
    p=main_blob(tight(crop(im,b))); save(f'mon_{n}', shrink(p, h=128))

for name in ['ruins','mine','darkforest','desert','tower']:
    bg=Image.open(f'{RAW}/battle_{name}.jpg').convert('RGB').resize((512,288), Image.BOX)
    save(f'battle_{name}', bg)

print('\n'.join(report))
if any(n not in [r.split()[0] for r in report] for n in
       [f'mon_{x}' for x in names_a+names_b+names_c]+[f'battle_{x}' for x in ['ruins','mine','darkforest','desert','tower']]):
    sys.exit('missing sprites')
