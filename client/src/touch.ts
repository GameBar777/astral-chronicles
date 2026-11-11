/** PHASE 10 mobile controls: virtual joystick (8-dir) + action [E] + menu buttons. Shown only on touch / coarse-pointer devices. */
export const touchState = { up: false, down: false, left: false, right: false, onAction: () => {}, onMenu: () => {} };
export const isTouch = () => 'ontouchstart' in window || matchMedia('(pointer: coarse)').matches;
export function mountTouch(root: HTMLElement) {
  document.getElementById('touch')?.remove();
  if (!isTouch()) return null;
  const el = document.createElement('div'); el.id = 'touch';
  el.innerHTML = '<div class="joy"><div class="knob"></div></div><button class="tb act">E</button><button class="tb menu">MENU</button>';
  root.appendChild(el);
  const joy = el.querySelector('.joy') as HTMLDivElement, knob = el.querySelector('.knob') as HTMLDivElement; let pid = -1;
  const set = (dx: number, dy: number) => { const r = Math.hypot(dx, dy), m = 45, k = r > m ? m / r : 1; knob.style.transform = `translate(${dx * k}px,${dy * k}px)`;
    const dead = 14; touchState.left = dx < -dead && Math.abs(dx) > Math.abs(dy) * 0.4; touchState.right = dx > dead && Math.abs(dx) > Math.abs(dy) * 0.4;
    touchState.up = dy < -dead && Math.abs(dy) > Math.abs(dx) * 0.4; touchState.down = dy > dead && Math.abs(dy) > Math.abs(dx) * 0.4; };
  const at = (e: PointerEvent) => { const b = joy.getBoundingClientRect(); set(e.clientX - b.left - b.width / 2, e.clientY - b.top - b.height / 2); };
  joy.addEventListener('pointerdown', (e) => { pid = e.pointerId; try { joy.setPointerCapture(pid); } catch { /* synthetic events */ } at(e); e.preventDefault(); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === pid) at(e); });
  const end = (e: PointerEvent) => { if (e.pointerId !== pid) return; pid = -1; set(0, 0); };
  joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
  (el.querySelector('.act') as HTMLButtonElement).addEventListener('pointerdown', (e) => { e.preventDefault(); touchState.onAction(); });
  (el.querySelector('.menu') as HTMLButtonElement).addEventListener('pointerdown', (e) => { e.preventDefault(); touchState.onMenu(); });
  return el;
}
