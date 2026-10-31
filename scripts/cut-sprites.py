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
report=[]
def save(name, im): im.save(f'{OUT}/{name}.png'); report.append(f'{name} {im.size}')
# houses
im,fg=key(Image.open(f'{RAW}/houses.jpg')); bs=comps(fg, 20000, 10)
print('houses', len(bs), [ (b[1].start,b[0].start,b[1].stop-b[1].start,b[0].stop-b[0].start) for b in bs])
hs=[tight(crop(im,b)) for b in bs]
widths={'house_wide':192,'house_sign':176,'house':160}
for name,h in zip(['house_wide','house_sign','house'], hs): save(name, shrink(h, w=widths[name]))
# props
im,fg=key(Image.open(f'{RAW}/props.jpg')); bs=comps(fg, 2500, 8, 300)
print('props', len(bs), [(b[1].start,b[0].start) for b in bs])
names=['tree','pine','fountain','barrel','crate','lamp','sign','fence_h','flowers','bush','stall','banner']
hts={'tree':104,'pine':104,'fountain':None,'barrel':30,'crate':30,'lamp':72,'sign':52,'fence_h':None,'flowers':34,'bush':34,'stall':None,'banner':64}
for n,b in zip(names,bs):
    p=tight(crop(im,b))
    if n=='fountain': p=shrink(p,w=136)
    elif n=='fence_h': p=shrink(p,w=64)
    elif n=='stall': p=shrink(p,w=96)
    else: p=shrink(p,h=hts[n])
    save(n,p)
# characters: 4 rows x 6 cols; use cols 0(front) 1(left) 2(right) 5(back)
im,fg=key(Image.open(f'{RAW}/chars.jpg')); bs=comps(fg, 3000, 4)
print('chars', len(bs))
rows={}
for b in bs: rows.setdefault((b[0].start//240),[]).append(b)
cls=['warrior','knight','mage','priest']
for ri,(k,row) in enumerate(sorted(rows.items())):
    row=sorted(row,key=lambda s:s[1].start); print(' row',k,len(row))
    cells=[tight(crop(im,row[i])) for i in (0,1,2,5)]
    H=max(c.size[1] for c in cells); f=56/H
    cells=[shrink(c,h=max(1,round(c.size[1]*f))) for c in cells]
    sheet=Image.new('RGBA',(48*4,60))
    for i,c in enumerate(cells): sheet.paste(c,(i*48+(48-c.size[0])//2, 60-c.size[1]-1),c)
    save(f'char_{cls[ri]}', sheet)
# ground: 4 quadrants -> 256x256 seamless (mirror) textures, tileset of 8x8 frames each
g=Image.open(f'{RAW}/ground.jpg').convert('RGB'); W,H=g.size; q=[]
for (x,y) in [(0,0),(1,0),(0,1),(1,1)]:
    c=g.crop((x*W//2+16, y*H//2+16, x*W//2+16+448, y*H//2+16+448)).resize((128,128), Image.BOX)
    t=Image.new('RGB',(256,256)); t.paste(c,(0,0)); t.paste(c.transpose(Image.FLIP_LEFT_RIGHT),(128,0))
    t.paste(c.transpose(Image.FLIP_TOP_BOTTOM),(0,128)); t.paste(c.transpose(Image.ROTATE_180),(128,128)); q.append(t)
ts=Image.new('RGB',(256*4,256))
for i,t in enumerate(q): ts.paste(t,(i*256,0))
save('ground', ts.convert('RGBA'))
print('\n'.join(report))

# --- post-process: fence_v from fence_h post, grass tone toward olive palette ---
from PIL import ImageEnhance
_d = 'client/public/sprites/'
_f = Image.open(_d + 'fence_h.png'); _v = Image.new('RGBA', (32, _f.size[1])); _p = _f.crop((0, 0, 12, _f.size[1])); _v.paste(_p, (10, 0), _p); _v.save(_d + 'fence_v.png')
_g = Image.open(_d + 'ground.png').convert('RGB'); _gr = _g.crop((0, 0, 256, 256))
_gr = ImageEnhance.Brightness(ImageEnhance.Color(_gr).enhance(0.8)).enhance(0.88); _g.paste(_gr, (0, 0)); _g.save(_d + 'ground.png')
