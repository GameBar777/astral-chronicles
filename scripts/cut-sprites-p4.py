"""Cut AI-generated original art (assets/raw/*.jpg, magenta bg) into transparent sprites (client/public/sprites)."""
import os, numpy as np
from PIL import Image
from scipy import ndimage
RAW='assets/raw'; OUT='client/public/sprites'; os.makedirs(OUT, exist_ok=True)
def key(img):
    a=np.asarray(img.convert('RGB')).astype(int); r,g,b=a[...,0],a[...,1],a[...,2]
    bg=(r>140)&(g<110)&(b>60)&(r-g>90)&(b-g>30)
    bg=ndimage.binary_opening(bg, iterations=1)
    fg=~bg; fg=ndimage.binary_opening(fg, iterations=2)
    rgba=np.dstack([a, fg*255]).astype(np.uint8)
    # de-spill: pull magenta fringe toward neighbors
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
    # premultiplied downscale, then hard alpha for crisp pixel edges
    a=np.asarray(im).astype(float); a[...,:3]*=a[...,3:]/255
    s=np.asarray(Image.fromarray(a.astype(np.uint8),'RGBA').resize((nw,nh), Image.BOX)).astype(float)
    al=s[...,3:]; s[...,:3]=np.where(al>0, s[...,:3]*255/np.maximum(al,1), 0); s[...,3]=np.where(al[...,0]>110,255,0)
    return Image.fromarray(np.clip(s,0,255).astype(np.uint8),'RGBA')
def crop(im, s): return im.crop((s[1].start, s[0].start, s[1].stop, s[0].stop))
def tight(im):
    bb=im.getbbox(); return im.crop(bb) if bb else im

# PHASE 4/5 art: item icons (32px), gathering nodes, NPC sprites
def fit(im, box):
    W,H=im.size; f=min(box/W, box/H); return shrink(im, h=max(1,round(H*f)))
def pad(im, w, h):
    c=Image.new('RGBA',(w,h)); c.paste(im,((w-im.size[0])//2, h-im.size[1] if h>im.size[1] else 0)); return c
im,fg=key(Image.open(f'{RAW}/items.jpg')); bs=comps(fg, 600, 4, 220)
names=['wooden_sword','copper_sword','iron_sword','oak_staff','copper_dagger','wooden_shield','leather_cap','leather_armor','leather_gloves','leather_boots','copper_ring','iron_helm',
 'wood','fine_wood','copper_ore','iron_ore','herb','high_herb','beast_hide','magic_stone','potion_small','ether_small','iron_armor','silver_ore']
print('items', len(bs)); assert len(bs)==24
for n,b in zip(names,bs):
    p=fit(tight(crop(im,b)),30); c=Image.new('RGBA',(32,32)); c.paste(p,((32-p.size[0])//2,(32-p.size[1])//2)); c.save(f'{OUT}/icon_{n}.png')
im,fg=key(Image.open(f'{RAW}/world_props2.jpg')); bs=comps(fg, 3000, 6, 300)
print('props2', len(bs)); assert len(bs)==8
for n,b,h in zip(['node_copper','node_iron','node_logging','node_herb'],bs[:4],[44,44,44,38]):
    shrink(tight(crop(im,b)),h=h).save(f'{OUT}/{n}.png')
for n,b in zip(['npc_shop','npc_inn','npc_chief','npc_smith'],bs[4:]):
    p=shrink(tight(crop(im,b)),h=56); pad(p,48,60).save(f'{OUT}/{n}.png')
print('ok')
