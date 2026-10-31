/** PHASE 8: pushes that arrive on the world-room seat (leader pulled the party into an instance). */
export const dungeonBus = { onMsg: null as null | ((m: any) => void) };
/** small modal confirm (DOM, font-safe) */
export function confirmBox(html: string, okLabel: string): Promise<boolean> {
  return new Promise((res) => {
    const d = document.createElement('div'); d.id = 'confirm'; d.className = 'confirm';
    d.innerHTML = `<div class="c-box"><div class="c-msg">${html}</div><div class="c-btns"><button id="c-ok">${okLabel}</button><button id="c-no" class="ghost">やめる</button></div></div>`;
    document.getElementById('ui')!.appendChild(d);
    const done = (v: boolean) => { d.remove(); res(v); };
    (d.querySelector('#c-ok') as HTMLButtonElement).onclick = () => done(true); (d.querySelector('#c-no') as HTMLButtonElement).onclick = () => done(false);
  });
}
