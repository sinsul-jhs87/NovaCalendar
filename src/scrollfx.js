// 목록 스크롤 다듬기
//  - 기본 스크롤바는 숨기고, 마우스로 잡아 끌어서 스크롤한다(휠도 그대로 된다).
//  - 끌다가 놓았을 때는 그 아래 일정이 눌리지 않게 한 번의 클릭을 막는다.
//  - 일정 목록은 맨 위가 아니면 ▲(맨 위로), 맨 아래가 아니면 ▼(맨 아래로) 버튼을 보여 준다. 가로 카드 줄은 ◀ ▶.

const SCROLLERS = '.plist, .strip, .dv-body, .tl-scroll, .detail .body, .sheet-body';
const WITH_JUMP = '.plist, .strip, .dv-body';
const NO_DRAG = 'input, textarea, select, [contenteditable], .pgrip, .rz, .sjump';
const THRESHOLD = 6;

let drag = null;

const canScroll = (sc) => sc.scrollHeight > sc.clientHeight + 1 || sc.scrollWidth > sc.clientWidth + 1;
const isHoriz = (sc) => sc.scrollWidth > sc.clientWidth + 1 && sc.scrollHeight <= sc.clientHeight + 1;

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.pointerType === 'touch' || e.target.closest(NO_DRAG)) return;
  const sc = e.target.closest(SCROLLERS);
  if (!sc || !canScroll(sc)) return;
  drag = { sc, horiz: isHoriz(sc), x: e.clientX, y: e.clientY, st: sc.scrollTop, sl: sc.scrollLeft, moved: false, id: e.pointerId };
}, true);

document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < THRESHOLD) return;
    drag.moved = true;
    drag.sc.classList.add('ds-drag');
    try { drag.sc.setPointerCapture(e.pointerId); } catch {}
  }
  if (drag.horiz) drag.sc.scrollLeft = drag.sl - dx;
  else drag.sc.scrollTop = drag.st - dy;
  e.preventDefault();
}, true);

function endDrag() {
  if (!drag) return;
  const moved = drag.moved;
  drag.sc.classList.remove('ds-drag');
  drag = null;
  if (moved) {
    // 끌기를 마친 직후의 클릭은 막는다(일정이 열리지 않게)
    const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', stop, true);
    setTimeout(() => document.removeEventListener('click', stop, true), 40);
  }
}
document.addEventListener('pointerup', endDrag, true);
document.addEventListener('pointercancel', endDrag, true);

// ───────── 맨 위로 / 맨 아래로 버튼 ─────────
const pairs = new Map(); // 스크롤 영역 → { a, b }
const ICON = {
  up: '<svg viewBox="0 0 16 16"><path d="M4 10l4-4 4 4"/></svg>',
  down: '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>',
  left: '<svg viewBox="0 0 16 16"><path d="M10 4l-4 4 4 4"/></svg>',
  right: '<svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4"/></svg>',
};

function makeButton(label, icon, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sjump';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = icon;
  b.hidden = true;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function ensurePair(sc) {
  let p = pairs.get(sc);
  if (p) return p;
  const host = sc.parentElement;
  if (!host) return null;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const horiz = () => isHoriz(sc);
  const a = makeButton('맨 처음으로', ICON.up, () => (horiz() ? sc.scrollTo({ left: 0, behavior: 'smooth' }) : sc.scrollTo({ top: 0, behavior: 'smooth' })));
  const b = makeButton('맨 끝으로', ICON.down, () => (horiz() ? sc.scrollTo({ left: sc.scrollWidth, behavior: 'smooth' }) : sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' })));
  host.append(a, b);
  p = { a, b, host };
  pairs.set(sc, p);
  return p;
}

function place(sc) {
  const p = ensurePair(sc);
  if (!p) return;
  const { a, b, host } = p;
  const visible = sc.offsetParent !== null && sc.clientHeight > 40;
  const horiz = isHoriz(sc);
  const atStart = horiz ? sc.scrollLeft <= 4 : sc.scrollTop <= 4;
  const atEnd = horiz ? sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 4 : sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4;
  a.hidden = !visible || atStart;
  b.hidden = !visible || atEnd;
  if (a.hidden && b.hidden) return;
  const hr = host.getBoundingClientRect(), r = sc.getBoundingClientRect();
  const top = r.top - hr.top - host.clientTop, left = r.left - hr.left - host.clientLeft;
  const S = 26, M = 6;
  a.innerHTML = horiz ? ICON.left : ICON.up;
  b.innerHTML = horiz ? ICON.right : ICON.down;
  a.title = horiz ? '맨 처음으로' : '맨 위로';
  b.title = horiz ? '맨 끝으로' : '맨 아래로';
  if (horiz) {
    const y = top + r.height / 2 - S / 2;
    Object.assign(a.style, { top: `${y}px`, left: `${left + M}px`, right: '', bottom: '' });
    Object.assign(b.style, { top: `${y}px`, left: `${left + r.width - S - M}px`, right: '', bottom: '' });
  } else {
    const x = left + r.width - S - M;
    Object.assign(a.style, { top: `${top + M}px`, left: `${x}px`, right: '', bottom: '' });
    Object.assign(b.style, { top: `${top + r.height - S - M}px`, left: `${x}px`, right: '', bottom: '' });
  }
}

function updateAll() {
  for (const [sc, p] of pairs) {
    if (!sc.isConnected) {
      p.a.remove();
      p.b.remove();
      pairs.delete(sc);
    }
  }
  document.querySelectorAll(WITH_JUMP).forEach(place);
}

let queued = false;
export function refreshScroll() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; updateAll(); });
}

document.addEventListener('scroll', (e) => {
  const sc = e.target;
  if (sc instanceof Element && sc.matches(WITH_JUMP)) place(sc);
}, true);
window.addEventListener('resize', refreshScroll);
document.addEventListener('transitionend', refreshScroll, true);
document.addEventListener('animationend', refreshScroll, true);
new MutationObserver((list) => {
  // 버튼 자신을 고친 것은 무시
  if (list.every((m) => m.target instanceof Element && m.target.closest?.('.sjump'))) return;
  refreshScroll();
}).observe(document.documentElement, { childList: true, subtree: true });
refreshScroll();
