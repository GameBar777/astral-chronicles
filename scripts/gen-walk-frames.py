"""PHASE 4 art: derive 2 walk frames per direction from the 4-frame class sheets (procedural leg motion).
Output sheet: frames 0-3 = idle front/left/right/back (unchanged), 4-11 = walk A/B for front,left,right,back."""
import numpy as np
from PIL import Image
OUT='client/public/sprites'
def legs_box(a):
    ys=np.where(a[...,3].max(1)>0)[0]; return ys.max()+1  # feet bottom
def step(fr, mode, phase):
    a=np.asarray(fr).copy(); bot=legs_box(a); top=bot-13; out=a.copy()
    xs=np.where(a[top:bot,:,3].max(0)>0)[0]
    if not len(xs): return fr
    mid=(xs.min()+xs.max())//2
    if mode=='fb':  # lift one leg 2px, other planted
        l,r=(slice(0,mid),slice(mid,48)) if phase==0 else (slice(mid,48),slice(0,mid))
        out[top:bot, l]=0; out[top-2:bot-2, l]=a[top:bot, l]; out[top-2:top, l]=np.where(a[top-2:top,l,3:]>0,a[top-2:top,l],out[top-2:top,l])
    else:           # side: stride, front/back halves of the lower legs move apart / together
        sd=2 if phase==0 else -2
        reg=a[top+4:bot].copy(); out[top+4:bot]=0
        def sh(r, dx):
            o=np.zeros_like(r)
            if dx>0: o[:, dx:]=r[:, :-dx]
            elif dx<0: o[:, :dx]=r[:, -dx:]
            else: o=r.copy()
            return o
        L=reg.copy(); L[:, mid:]=0; R=reg.copy(); R[:, :mid]=0
        A=sh(L,-sd); B=sh(R,sd)
        out[top+4:bot]=np.where(B[...,3:]>0, B, A)
    img=Image.fromarray(out,'RGBA')
    return img
for c in ['warrior','knight','mage','priest']:
    sh=Image.open(f'{OUT}/char_{c}.png').convert('RGBA'); sh=sh.crop((0,0,192,60))
    fr=[sh.crop((i*48,0,i*48+48,60)) for i in range(4)]
    new=Image.new('RGBA',(48*12,60))
    for i,f in enumerate(fr): new.paste(f,(i*48,0))
    for d,f in enumerate(fr):
        mode='fb' if d in (0,3) else 'side'
        for p in (0,1): new.paste(step(f,mode,p),((4+d*2+p)*48,0))
    new.save(f'{OUT}/char_{c}.png')
print('ok')
