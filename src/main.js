import './scrollfx.js';
import { parseQuick } from './quickadd.js';
import {
  api, THEMES, applyTheme, applyLook, expandRecurring, repeatLabel, fromKey, onEventsChanged, onSettingsChanged, onAccountsChanged, onSettingsPreview,
  updateSettings, toKey, addDays, eventsOn, isAllDayLike, timeLabel, hmToMin, minToHm, DOW, el, pad, doneKey, DONE_STYLES, panelFlags, groupZoom, onUpdateAvailable, onQuickAdd, COLORS } from './common.js';
import { createDayView } from './dayview.js';
import { dayItems, solarToLunar, lunarText, lunarLong, setCustomHolidays } from './koreancal.js';

const $ = (sel) => document.querySelector(sel);
const root = document.documentElement;
/** 완료로 체크한 일정 키 */
let done = new Set();
const isDone = (ev) => done.has(doneKey(ev));
const grid = $('#grid');

let events = [];
let viewEvents = []; // 반복 일정을 보이는 구간의 날짜로 펼친 목록(화면 표시용)
let accounts = [];
let settings = { opacity: 0.85, monthMode: 'month', weekStart: 0, view: 'month', theme: 'midnight', showHolidays: true, showSpecial: true, showLunar: true, showPanel: true, fontScale: 1, fontFamily: '', surface: 0.5 };
let anchor = new Date(); // 화면에 보여줄 기준 날짜
let tlScroll = null;     // 주·일 보기의 세로 스크롤 위치(다시 그려도 유지)
let moveMode = false;

let HP = 48; // 주·일 보기에서 1시간의 높이(px). 글자 크기에 맞춰 커진다.

// ───────────────────────── 날짜 계산 ─────────────────────────

const startOfWeek = (d) => addDays(d, -((d.getDay() - settings.weekStart + 7) % 7));

function monthRange() {
  if (settings.monthMode === 'rolling') {
    // 오늘이 있는 주를 가운데 두고 위 2주, 아래 2주
    return { start: addDays(startOfWeek(anchor), -14), rows: 5 };
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  const offset = (first.getDay() - settings.weekStart + 7) % 7;
  return { start: startOfWeek(first), rows: Math.ceil((offset + daysInMonth) / 7) };
}

const weekDays = () => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

function titleText() {
  const y = anchor.getFullYear();
  if (settings.view === 'month') return `${y}년 ${anchor.getMonth() + 1}월`;
  if (settings.view === 'day') return `${y}년 ${anchor.getMonth() + 1}월 ${anchor.getDate()}일 (${DOW[anchor.getDay()]})`;
  const [a, b] = [weekDays()[0], weekDays()[6]];
  return a.getMonth() === b.getMonth()
    ? `${y}년 ${a.getMonth() + 1}월 ${a.getDate()}일 – ${b.getDate()}일`
    : `${a.getMonth() + 1}월 ${a.getDate()}일 – ${b.getMonth() + 1}월 ${b.getDate()}일`;
}

// ───────────────────────── 공통 조각 ─────────────────────────

/** 하루치 일정 칩 목록(.events). 넘치면 아래가 흐려지고 hover하면 내려간다. */
function eventsBox(list) {
  const box = el('div', 'events');
  for (const ev of list) {
    if (ev._label) {
      // 공휴일·기념일·절기 이름
      // 좁은 칸에서 잘리지 않게 "대체공휴일(개천절)" → "개천절 대체"로 줄여 보이고, 전체 이름은 마우스를 올리면 보인다.
      const shown = ev.title.replace(/^대체공휴일\((.+)\)$/, '$1 대체');
      const h = el('div', `hday ${ev.off ? 'off' : ev.kind === 'term' ? 'term' : 'sp'}`, shown);
      h.title = ev.title;
      box.append(h);
      continue;
    }
    const chip = el('div', 'chip');
    chip.style.setProperty('--c', ev.color || '#5b9dff');
    if (ev._cont) chip.classList.add('cont'); // 여러 날 일정의 둘째 날부터
    if (ev.readOnly) chip.classList.add('ro');
    if (isDone(ev)) chip.classList.add('done');
    chip.dataset.id = ev.id;
    if (ev.repeat) {
      chip.dataset.rep = '1';
      chip.title = `${ev.title} (${repeatLabel(ev.repeat)})`;
    }
    if (!isAllDayLike(ev)) chip.append(el('span', 't', ev.startTime));
    chip.append(el('span', 'x', ev.title));
    if (!ev.repeat) chip.title = ev.title;
    box.append(chip);
  }
  return box;
}

const withCont = (list, key) => list.map((e) => ({ ...e, _cont: key !== e.startDate }));

/** 그 날짜에 표시할 공휴일·기념일·절기 (설정의 표시 여부 반영) */
function labelItems(date) {
  return dayItems(date.getFullYear(), date.getMonth() + 1, date.getDate())
    .filter((it) => (it.kind === 'holiday' ? settings.showHolidays : settings.showSpecial))
    .map((it) => ({ _label: true, title: it.name, off: it.off, kind: it.kind }));
}
const lunarOf = (date) => (settings.showLunar ? solarToLunar(date.getFullYear(), date.getMonth() + 1, date.getDate()) : null);
function lunarEl(lun) {
  const e = el('span', `lunar${lun.day === 1 ? ' first' : ''}${lun.leap ? ' leap' : ''}`, lunarText(lun));
  e.title = lunarLong(lun);
  return e;
}
const wkOn = () => root.dataset.wk === 'on';

// ───────────────────────── 월 보기 ─────────────────────────

function renderMonth() {
  const { start, rows } = monthRange();
  const todayKey = toKey(new Date());
  grid.style.setProperty('--rows', rows);

  for (let i = 0; i < rows * 7; i++) {
    const date = addDays(start, i);
    if (wkOn() && i % 7 === 0) {
      // 한 행의 월요일이 속한 주의 번호(ISO)
      grid.append(el('div', 'wk', String(isoWeek(addDays(date, settings.weekStart === 0 ? 1 : 0)))));
    }
    const key = toKey(date);
    const cell = el('div', 'cell');
    cell.dataset.key = key;
    if (date.getDay() === 0) cell.classList.add('sun');
    if (date.getDay() === 6) cell.classList.add('sat');
    if (key === todayKey) cell.classList.add('today');
    if (settings.monthMode === 'month' && date.getMonth() !== anchor.getMonth()) cell.classList.add('dim');
    const labels = labelItems(date);
    if (labels.some((l) => l.off)) cell.classList.add('hol');
    // 양력 숫자 바로 옆에 음력을 작게 붙인다.
    const nrow = el('div', 'nrow');
    nrow.append(el('div', 'num', String(date.getDate())));
    const lun = lunarOf(date);
    if (lun) nrow.append(lunarEl(lun));
    cell.append(nrow);
    cell.append(eventsBox([...labels, ...withCont(eventsOn(viewEvents, key), key)]));
    grid.append(cell);
  }
}

// ───────────────────────── 주·일 보기 ─────────────────────────

/** 겹치는 일정을 나란히 배치한다. */
function layoutSegments(segs) {
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const s of cluster) {
      let c = cols.findIndex((end) => end <= s.s);
      if (c < 0) {
        c = cols.length;
        cols.push(s.e);
      } else cols[c] = s.e;
      s.col = c;
    }
    cluster.forEach((s) => (s.cols = cols.length));
    out.push(...cluster);
    cluster = [];
  };
  for (const s of segs) {
    if (cluster.length && s.s >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, s.e);
  }
  if (cluster.length) flush();
  return out;
}

/** 그날 시간표에 그릴 구간(분 단위) 목록 */
function timedSegments(key, list) {
  const segs = [];
  for (const ev of list) {
    if (isAllDayLike(ev)) continue;
    const s = ev.startDate === key ? hmToMin(ev.startTime) : 0;
    let e = ev.endDate === key ? (ev.endTime ? hmToMin(ev.endTime) : s + 60) : 1440;
    e = Math.min(1440, Math.max(e, s + 25)); // 너무 짧아도 읽을 수 있게 최소 높이
    segs.push({ ev, s: Math.min(s, 1440 - 25), e });
  }
  segs.sort((a, b) => a.s - b.s || b.e - a.e);
  return layoutSegments(segs);
}

function renderTimeline(days) {
  const todayKey = toKey(new Date());
  const n = days.length;
  grid.style.setProperty('--n', n);
  grid.style.setProperty('--hp', `${HP}px`);

  // 머리줄: 요일·날짜 + 종일 일정
  const head = el('div', 'tl-head');
  head.append(el('div', 'tl-gutter'));
  const hdays = el('div', 'tl-days');
  for (const d of days) {
    const key = toKey(d);
    const dh = el('div', 'dh');
    dh.dataset.key = key;
    if (d.getDay() === 0) dh.classList.add('sun');
    if (d.getDay() === 6) dh.classList.add('sat');
    if (key === todayKey) dh.classList.add('today');
    const top = el('div', 'dh-top');
    top.append(el('span', 'dw', DOW[d.getDay()]), el('span', 'dn', String(d.getDate())));
    const lun = lunarOf(d);
    if (lun) top.append(lunarEl(lun));
    const labels = labelItems(d);
    if (labels.some((l) => l.off)) dh.classList.add('hol');
    const allDay = eventsOn(viewEvents, key).filter(isAllDayLike);
    dh.append(top, eventsBox([...labels, ...withCont(allDay, key)]));
    hdays.append(dh);
  }
  head.append(hdays);

  // 본문: 시간 눈금 + 날짜별 열
  const scroll = el('div', 'tl-scroll');
  const body = el('div', 'tl-body');
  const gutter = el('div', 'tl-gutter hours');
  for (let h = 1; h < 24; h++) {
    const lab = el('span', null, `${pad(h)}:00`);
    lab.style.top = `${h * HP}px`;
    gutter.append(lab);
  }
  const cols = el('div', 'tl-cols');
  for (const d of days) {
    const key = toKey(d);
    const col = el('div', 'col');
    col.dataset.key = key;
    if (key === todayKey) col.classList.add('today');
    for (const seg of timedSegments(key, eventsOn(viewEvents, key))) {
      const { ev } = seg;
      const b = el('div', 'tev');
      b.style.setProperty('--c', ev.color || '#5b9dff');
      b.style.top = `${(seg.s / 60) * HP}px`;
      b.style.height = `${((seg.e - seg.s) / 60) * HP - 2}px`;
      b.style.left = `calc(${(seg.col / seg.cols) * 100}% + 2px)`;
      b.style.width = `calc(${100 / seg.cols}% - 4px)`;
      if (ev.readOnly) b.classList.add('ro');
      if (isDone(ev)) b.classList.add('done');
      b.append(el('div', 'tt', ev.title));
      if (((seg.e - seg.s) / 60) * HP >= 38) {
        b.append(el('div', 'tm', ev.endTime ? `${ev.startTime}–${ev.endTime}` : ev.startTime));
      }
      b.title = ev.title;
      col.append(b);
    }
    if (key === todayKey) col.append(el('div', 'now'));
    cols.append(col);
  }
  body.append(gutter, cols);
  scroll.append(body);
  grid.append(head, scroll);
  updateNowLine();

  const hasToday = days.some((d) => toKey(d) === todayKey);
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  scroll.scrollTop = tlScroll ?? (hasToday ? Math.max(0, ((nowMin - 90) / 60) * HP) : 8 * HP);
  scroll.addEventListener('scroll', () => (tlScroll = scroll.scrollTop));
}

function updateNowLine() {
  const t = new Date();
  const y = ((t.getHours() * 60 + t.getMinutes()) / 60) * HP;
  grid.querySelectorAll('.now').forEach((n) => (n.style.top = `${y}px`));
}

// 빈 시간대를 클릭하면 그 시각으로 새 일정, 일정 위를 클릭하면 상세 창
grid.addEventListener('click', (e) => {
  const col = e.target.closest('.col');
  if (!col || dragging) return;
  const key = col.dataset.key;
  if (e.target.closest('.tev')) {
    openDayOverlay(key, e.target.closest('.tev'));
    return;
  }
  const y = e.clientY - col.getBoundingClientRect().top;
  const start = Math.max(0, Math.min(23 * 60 + 30, Math.floor((y / HP) * 2) * 30));
  openQuickAdd(key, key, { allDay: false, startTime: minToHm(start), endTime: minToHm(Math.min(start + 60, 23 * 60 + 59)) });
});

// ───────────────────────── 보조 패널(테마에 따라 표시) ─────────────────────────

const sortKey = (e) => (isAllDayLike(e) ? '' : e.startTime);

/** 오늘 이후의 일정(진행 중인 여러 날 일정은 오늘로 취급) */
function upcoming(limit, skipToday = false) {
  const today = toKey(new Date());
  const from = skipToday ? toKey(addDays(new Date(), 1)) : today;
  return viewEvents // 반복 일정은 펼친 날짜로
    .filter((e) => e.endDate >= from && !(root.dataset.done === 'hide' && isDone(e)))
    .map((e) => ({ e, day: e.startDate > from ? e.startDate : from }))
    .sort((a, b) => a.day.localeCompare(b.day) || sortKey(a.e).localeCompare(sortKey(b.e)) || a.e.title.localeCompare(b.e.title, 'ko'))
    .slice(0, limit);
}

/** 패널 일정 하나. 누르면 달력 날짜를 누를 때와 같은 날짜 팝업이 그 일정에서 펼쳐진다. */
function openFromPanel(it, ev, day) {
  it.tabIndex = 0;
  it.setAttribute('role', 'button');
  it.title = `${ev.title} — 눌러서 열기`;
  const go = () => openDayOverlay(day, it, null, doneKey(ev));
  it.addEventListener('click', go);
  it.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
}

function pitem(ev, day) {
  const it = el('div', 'pitem');
  if (day) openFromPanel(it, ev, day);
  it.style.setProperty('--c', ev.color || '#5b9dff');
  if (isDone(ev)) it.classList.add('done');
  it.append(el('div', 'pt', timeLabel(ev)), el('div', 'pn', ev.title));
  return it;
}

const dayLabel = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return `${m}월 ${d}일 (${DOW[new Date(y, m - 1, d).getDay()]})`;
};

/** 옆 패널의 안쪽 경계 손잡이: 끌어서 폭을 바꾸고(저장), 두 번 누르면 기본 폭으로 */
function panelGrip(side, where) {
  const g = el('div', `pgrip ${where}`);
  g.title = '끌어서 폭 조절 · 두 번 누르면 기본 폭';
  let lastDown = 0;
  const reset = () => {
    settings.panelWidth = 0;
    side.style.width = '';
    updateSettings({ panelWidth: 0 });
  };
  g.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // 두 번 누르기(0.4초 안): 기본 폭으로
    const now = Date.now();
    if (now - lastDown < 400) {
      lastDown = 0;
      reset();
      return;
    }
    lastDown = now;
    g.setPointerCapture(e.pointerId);
    g.classList.add('on');
    const stageW = side.parentElement.getBoundingClientRect().width;
    const r = side.getBoundingClientRect();
    let w = r.width;
    const move = (ev) => {
      const raw = where === 'right' ? r.right - ev.clientX : ev.clientX - r.left;
      w = Math.max(140, Math.min(stageW * 0.6, raw));
      side.style.width = `${Math.round(w)}px`;
    };
    const up = () => {
      g.classList.remove('on');
      g.removeEventListener('pointermove', move);
      g.removeEventListener('pointerup', up);
      if (Math.abs(w - r.width) < 2) return; // 누르기만 했으면 저장하지 않는다
      settings.panelWidth = Math.round(w);
      updateSettings({ panelWidth: settings.panelWidth });
    };
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', up);
  });

  return g;
}

function renderPanels() {
  // 오늘의 일정·다가오는 일정을 각각 켜고 끈다(메뉴의 스위치 두 개).
  // 자리: 테마가 원래 가진 패널을 따른다 — hero 테마는 왼쪽 패널, 그 밖은 오른쪽 패널, 카드 줄 테마의 다가오는 일정은 아래 카드 줄.
  refreshView();
  const native = root.dataset.panel || 'none';
  const { today: showToday, upcoming: showUp } = panelFlags(settings, native);
  const hero = $('#hero'), agenda = $('#agenda'), strip = $('#strip');
  hero.hidden = agenda.hidden = strip.hidden = true;
  const side = native === 'hero' ? hero : agenda;
  const upInStrip = native === 'strip';
  const today = toKey(new Date());
  const parts = [];

  if (showToday) {
    const now = new Date();
    const list = el('div', 'plist');
    const todays = eventsOn(viewEvents, today).filter((e) => !(root.dataset.done === 'hide' && isDone(e)));
    if (todays.length === 0) list.append(el('div', 'pempty', '오늘은 일정이 없어요.'));
    todays.forEach((ev) => list.append(pitem(ev, today)));
    if (native === 'hero') {
      const lunNow = lunarOf(now);
      const sub = [lunNow ? lunarLong(lunNow) : null, ...labelItems(now).map((l) => l.title)].filter(Boolean).join(' · ');
      parts.push(
        el('div', 'hero-day', String(now.getDate())),
        el('div', 'hero-dow', `${DOW[now.getDay()]}요일`),
        el('div', 'hero-month', `${now.getFullYear()}년 ${now.getMonth() + 1}월`),
        ...(sub ? [el('div', 'hero-sub', sub)] : []),
      );
    }
    parts.push(el('h3', null, '오늘의 일정'), list);
  }

  if (showUp && !upInStrip) {
    const list = el('div', 'plist');
    const items = upcoming(14, showToday); // 오늘의 일정을 따로 보여 주면 내일부터
    if (items.length === 0) list.append(el('div', 'pempty', '다가오는 일정이 없어요.'));
    let last = '';
    for (const { e, day } of items) {
      if (day !== last) {
        list.append(el('div', 'pgroup', day === today ? `${dayLabel(day)} · 오늘` : dayLabel(day)));
        last = day;
      }
      list.append(pitem(e, day));
    }
    parts.push(el('h3', parts.length ? 'psec' : null, '다가오는 일정'), list);
  }
  if (parts.length) {
    side.replaceChildren(...parts, panelGrip(side, native === 'hero' ? 'left' : 'right'));
    side.classList.toggle('both', showToday && showUp && !upInStrip);
    side.style.width = settings.panelWidth > 0 ? `min(${Math.round(settings.panelWidth)}px, 60%)` : '';
    side.hidden = false;
  }

  if (showUp && upInStrip) {
    const items = upcoming(8, showToday); // 오늘의 일정을 옆에 보여 주면 카드 줄은 내일부터
    strip.replaceChildren();
    if (items.length === 0) strip.append(el('div', 'pempty', '다가오는 일정이 없어요.'));
    for (const { e, day } of items) {
      const c = el('div', 'scard');
      c.style.setProperty('--c', e.color || '#5b9dff');
      if (isDone(e)) c.classList.add('done');
      const [, m, d] = day.split('-').map(Number);
      c.append(el('div', 'sd', `${m}/${d} · ${timeLabel(e)}`), el('div', 'sn', e.title));
      openFromPanel(c, e, day);
      strip.append(c);
    }
    strip.hidden = false;
  }
}

// ───────────────────────── 렌더 ─────────────────────────

function renderDow() {
  const dow = $('#dow');
  dow.replaceChildren();
  if (wkOn()) dow.append(el('div', 'wk-sp'));
  for (let i = 0; i < 7; i++) {
    const d = (settings.weekStart + i) % 7;
    dow.append(el('div', d === 0 ? 'sun' : d === 6 ? 'sat' : '', DOW[d]));
  }
}

/** 반복 일정을 화면에 필요한 구간의 날짜로 펼친다(기준 날짜 ±50일과 오늘부터 30일). */
function refreshView() {
  const keys = [toKey(addDays(anchor, -50)), toKey(addDays(anchor, 50)), toKey(addDays(new Date(), -1)), toKey(addDays(new Date(), 30))].sort();
  viewEvents = expandRecurring(events.filter(isVisible), keys[0], keys[3]); // 숨긴 캘린더는 뺀다
}

function render() {
  refreshView();
  renderStatus();
  const view = settings.view;
  grid.className = `grid ${view === 'month' ? 'month' : 'tl'}`;
  grid.replaceChildren();
  $('#dow').hidden = view !== 'month';
  document.querySelectorAll('#seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  $('#title').textContent = titleText();
  $('#seg').style.setProperty('--i', ['day', 'week', 'month'].indexOf(view));

  if (view === 'month') renderMonth();
  else renderTimeline(view === 'week' ? weekDays() : [new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())]);
  requestAnimationFrame(refreshOverflow);
}

/** 테마·설정이 바뀌었을 때 전체를 다시 그린다. */
function applyAll() {
  root.dataset.done = DONE_STYLES.includes(settings.doneStyle) ? settings.doneStyle : 'strike-dim';
  const t = applyTheme(settings.theme);
  root.style.setProperty('--alpha', settings.opacity);
  applyLook(settings, { scale: true, surface: true }); // 글꼴·글자 크기·바탕 진하기·후광
  HP = Math.round(48 * Math.min(1.8, groupZoom(settings, 'ev')));
  $('#mi-theme-state').textContent = t.name;
  const pf = panelFlags(settings, root.dataset.panel || 'none');
  $('#mi-today').setAttribute('aria-checked', String(pf.today));
  $('#mi-upcoming').setAttribute('aria-checked', String(pf.upcoming));
  renderDow();
  render();
  renderPanels();
}

// ───────────────────── 넘침 처리: 흐림 + hover 자동 스크롤 ─────────────────────

const FADE_ZONE = 30;      // 흐려진 영역(아래쪽 px)에 마우스가 들어오면 내려가기 시작
const SCROLL_DOWN = 0.035; // px/ms. 초당 약 35px
const SCROLL_UP = 0.15;    // 마우스가 벗어나면 맨 위로 되돌아오는 속도

function updateMore(box) {
  box.classList.toggle('more', box.scrollTop + box.clientHeight < box.scrollHeight - 1);
  box.classList.toggle('scrolled', box.scrollTop > 0);
}

function refreshOverflow() {
  document.querySelectorAll('.events').forEach(updateMore);
}

function stopScroll(box) {
  cancelAnimationFrame(box._raf);
  box._dir = 0;
}

function startScroll(box, dir) {
  if (box._dir === dir) return;
  stopScroll(box);
  box._dir = dir;
  // scrollTop은 소수점이 잘릴 수 있어 위치를 직접 들고 있는다.
  let pos = box.scrollTop;
  let last = performance.now();
  const step = (now) => {
    const dt = now - last;
    last = now;
    pos += dir * (dir > 0 ? SCROLL_DOWN : SCROLL_UP) * dt;
    const max = box.scrollHeight - box.clientHeight;
    pos = Math.max(0, Math.min(max, pos));
    box.scrollTop = pos;
    updateMore(box);
    if ((dir > 0 && pos >= max) || (dir < 0 && pos <= 0)) {
      box._dir = 0;
      return;
    }
    box._raf = requestAnimationFrame(step);
  };
  box._raf = requestAnimationFrame(step);
}

grid.addEventListener('mousemove', (e) => {
  if (dragging) return;
  const box = e.target.closest('.events');
  if (!box) return;
  const rect = box.getBoundingClientRect();
  const inFadeZone = box.classList.contains('more') && e.clientY > rect.bottom - FADE_ZONE;
  if (inFadeZone) startScroll(box, 1);
  else if (box._dir > 0) stopScroll(box); // 흐린 곳을 벗어나면 현재 위치에서 멈춤
});

grid.addEventListener('mouseout', (e) => {
  const box = e.target.closest('.events');
  if (!box || box.contains(e.relatedTarget)) return;
  if (box.scrollTop > 0) startScroll(box, -1); // 칸을 벗어나면 맨 위로 복귀
  else stopScroll(box);
});

new ResizeObserver(() => refreshOverflow()).observe(grid);

// ───────────────────── 날짜 클릭 / 드래그 선택 ─────────────────────

let dragging = false;
let dragStart = null;
let dragEnd = null;

const SELECTABLE = '.cell, .dh'; // 월 보기의 날짜 칸, 주·일 보기의 날짜 머리줄

function paintSelection() {
  const [a, b] = dragStart <= dragEnd ? [dragStart, dragEnd] : [dragEnd, dragStart];
  grid.querySelectorAll(SELECTABLE).forEach((c) => {
    c.classList.toggle('sel', c.dataset.key >= a && c.dataset.key <= b);
  });
}

// 일정 끌어서 옮기기: 일정 칩을 다른 날짜 칸에 놓으면 기간을 유지한 채 그만큼 옮긴다.
// 읽기 전용·반복 일정은 끌 수 없다(반복 일정은 날짜 팝업에서 수정).
let chipDrag = null;
async function moveEvent(id, delta) {
  const ev = events.find((x) => x.id === id);
  if (!ev || ev.readOnly || ev.repeat || !delta) return;
  const sh = (k) => toKey(addDays(fromKey(k), delta));
  try {
    await api.saveEvent({ ...ev, startDate: sh(ev.startDate), endDate: sh(ev.endDate), updatedAt: Date.now() });
  } catch (err) {
    alert(String(err));
  }
  await loadEvents();
}

grid.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const cell = e.target.closest(SELECTABLE);
  if (!cell) return;
  const chip = e.target.closest('.chip');
  if (chip && !chip.classList.contains('ro') && !chip.dataset.rep && chip.dataset.id) {
    e.preventDefault();
    chipDrag = { id: chip.dataset.id, from: cell.dataset.key, to: cell.dataset.key, chip, x: e.clientX, y: e.clientY, moved: false };
    return;
  }
  e.preventDefault(); // 드래그 중 글자가 선택되지 않게
  dragging = true;
  dragStart = dragEnd = cell.dataset.key;
  paintSelection();
});

window.addEventListener('mousemove', (e) => {
  if (!chipDrag) return;
  if (!chipDrag.moved && Math.hypot(e.clientX - chipDrag.x, e.clientY - chipDrag.y) > 5) {
    chipDrag.moved = true;
    chipDrag.chip.classList.add('dragging');
    document.body.classList.add('chip-drag');
  }
  if (!chipDrag.moved) return;
  const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest(SELECTABLE);
  grid.querySelectorAll('.drop').forEach((c) => c.classList.remove('drop'));
  if (cell) {
    chipDrag.to = cell.dataset.key;
    cell.classList.add('drop');
  }
});

grid.addEventListener('mouseover', (e) => {
  if (!dragging) return;
  const cell = e.target.closest(SELECTABLE);
  if (!cell || cell.dataset.key === dragEnd) return;
  dragEnd = cell.dataset.key;
  paintSelection();
});

window.addEventListener('mouseup', () => {
  if (chipDrag) {
    const d = chipDrag;
    chipDrag = null;
    document.body.classList.remove('chip-drag');
    d.chip.classList.remove('dragging');
    grid.querySelectorAll('.drop').forEach((c) => c.classList.remove('drop'));
    if (!d.moved) {
      openDayOverlay(d.from, grid.querySelector(`[data-key="${d.from}"]`)); // 끌지 않고 누르기만 했으면 날짜 팝업
      return;
    }
    const delta = Math.round((fromKey(d.to) - fromKey(d.from)) / 86400000);
    if (delta) moveEvent(d.id, delta);
    return;
  }
  if (!dragging) return;
  const [a, b] = dragStart <= dragEnd ? [dragStart, dragEnd] : [dragEnd, dragStart];
  grid.querySelectorAll('.sel').forEach((c) => c.classList.remove('sel'));
  // click 이벤트(시간표 열)와 겹치지 않도록 다음 틱에 해제
  setTimeout(() => (dragging = false), 0);
  if (a === b) openDayOverlay(a, grid.querySelector(`[data-key="${a}"]`)); // 한 칸 클릭 → 그 칸에서 펼쳐지는 날짜 팝업
  else openQuickAdd(a, b);          // 여러 칸 드래그 → 기간 일정 등록
});

// ───────────────────── 빠른 등록 · 테마 선택 창 ─────────────────────

const modal = $('#modal');

function closeModal() {
  modal.hidden = true;
  modal.replaceChildren();
}

// 여러 날을 끌어서 고르거나 시간표의 빈 곳을 눌렀을 때: 그 칸에서 바로 입력 폼이 펼쳐진다.
function openQuickAdd(startDate, endDate, extra = {}) {
  openDayOverlay(startDate, grid.querySelector(`[data-key="${startDate}"]`), { event: null, defaults: { startDate, endDate, ...extra } });
}

// ───────────────────── 날짜 팝업: 클릭한 칸에서 달력 앞으로 펼쳐진다 ─────────────────────

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let dayOv = null;
let ovSeq = 0;

/** 팝업 카드를 클릭한 칸의 위치·크기로 줄여 놓는 변형값 */
function cardFrom(card, rect) {
  const f = card.getBoundingClientRect();
  if (!rect || !f.width || !f.height) return 'scale(0.92)';
  const s = Math.max(0.1, Math.min(rect.width / f.width, rect.height / f.height));
  const dx = rect.left + rect.width / 2 - (f.left + f.width / 2);
  const dy = rect.top + rect.height / 2 - (f.top + f.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${s})`;
}

function openDayOverlay(key, anchor, edit = null, focus = null) {
  if (dayOv) closeDayOverlay(true);
  setMenu(false);
  setYm(false);
  const my = ++ovSeq;
  const ov = $('#dayov');
  const card = $('#dayview');
  const rect = anchor ? anchor.getBoundingClientRect() : null;
  card.replaceChildren();
  card.style.transition = 'none';
  card.style.transform = '';
  card.style.opacity = '';
  ov.hidden = false;
  ov.classList.remove('in');
  const view = createDayView(card, {
    date: key,
    edit,
    focus, // 패널에서 누른 일정: 팝업 목록에서 찾아 보이게 하고 잠깐 강조
    events: events.filter(isVisible),
    filter: isVisible,
    accounts,
    settings,
    onClose: () => closeDayOverlay(),
    onSaved: () => loadEvents(),
  });
  dayOv = { view, rect, my };
  if (reducedMotion()) {
    card.style.opacity = '1';
  } else {
    card.style.transform = cardFrom(card, rect);
    card.style.opacity = '0';
    card.getBoundingClientRect(); // 시작 상태를 확정한 뒤
    card.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.9, 0.25, 1.06), opacity 0.22s ease-out';
    card.style.transform = 'none';
    card.style.opacity = '1';
  }
  ov.classList.add('in');
}

function closeDayOverlay(immediate = false) {
  if (!dayOv) return;
  const { view, rect } = dayOv;
  dayOv = null;
  const my = ++ovSeq;
  const ov = $('#dayov');
  const card = $('#dayview');
  const finish = () => {
    view.destroy();
    if (my !== ovSeq) return; // 그 사이 새 팝업이 열렸으면 건드리지 않는다
    ov.hidden = true;
    ov.classList.remove('in');
    card.replaceChildren();
    card.style.transition = 'none';
    card.style.transform = '';
    card.style.opacity = '';
  };
  if (immediate || reducedMotion()) {
    finish();
    return;
  }
  ov.classList.remove('in');
  card.style.transition = 'transform 0.28s cubic-bezier(0.4, 0, 0.8, 0.4), opacity 0.2s ease-in 0.06s';
  card.style.transform = cardFrom(card, rect);
  card.style.opacity = '0';
  setTimeout(finish, 300);
}

$('#dayov').addEventListener('mousedown', (e) => {
  if (e.target === e.currentTarget) closeDayOverlay(); // 바깥을 누르면 닫힌다
});

// ───────────────────── 연·월 바로 가기 ─────────────────────

const ym = $('#ympop');
const YM_MIN = 1900;
const YM_MAX = 2100;
let ymYear = new Date().getFullYear();

function renderYm() {
  const now = new Date();
  const g = $('#ym-grid');
  g.replaceChildren();
  for (let m = 0; m < 12; m++) {
    const b = el('button', 'ym-m', `${m + 1}월`);
    b.type = 'button';
    if (ymYear === anchor.getFullYear() && m === anchor.getMonth()) b.classList.add('ym-cur');
    if (ymYear === now.getFullYear() && m === now.getMonth()) b.classList.add('ym-now');
    b.addEventListener('click', () => {
      jumpTo(ymYear, m);
      setYm(false);
    });
    g.append(b);
  }
  $('#ym-year').value = String(ymYear);
}

function setYm(open) {
  if (open) {
    ymYear = anchor.getFullYear();
    const w = $('#widget').getBoundingClientRect();
    const t = $('#title').getBoundingClientRect();
    const width = ym.getBoundingClientRect().width || 240;
    ym.hidden = false;
    const left = Math.max(6, Math.min(t.left - w.left, w.width - (ym.getBoundingClientRect().width || width) - 6));
    ym.style.left = `${Math.round(left)}px`;
    ym.style.top = `${Math.round(t.bottom - w.top + 8)}px`;
    renderYm();
  } else {
    ym.hidden = true;
  }
}

/** 그 연·월로 이동(같은 날짜 번호를 유지하되 그 달의 마지막 날을 넘지 않게) */
function jumpTo(y, m) {
  const last = new Date(y, m + 1, 0).getDate();
  anchor = new Date(y, m, Math.min(anchor.getDate(), last));
  render();
}

const clampYear = (v) => Math.min(YM_MAX, Math.max(YM_MIN, Math.round(Number(v)) || ymYear));
$('#ym-prev').addEventListener('click', () => { ymYear = clampYear(ymYear - 1); renderYm(); });
$('#ym-next').addEventListener('click', () => { ymYear = clampYear(ymYear + 1); renderYm(); });
$('#ym-year').addEventListener('change', (e) => { ymYear = clampYear(e.target.value); renderYm(); });
$('#ym-year').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    ymYear = clampYear(e.target.value);
    renderYm();
  }
});
$('#ym-today').addEventListener('click', () => {
  goToday();
  setYm(false);
});
document.addEventListener('mousedown', (e) => {
  if (!ym.hidden && !ym.contains(e.target) && !$('#title').contains(e.target)) setYm(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !ym.hidden) setYm(false);
});

const HDR_NAME = { top: '상단 막대', journal: '큰 월 제목', centered: '가운데 제목', minimal: '미니멀 선', bottom: '하단 막대', pill: '알약 막대', stack: '2단 헤더', rail: '세로 막대', compact: '컴팩트 막대' };
const PANEL_NAME = { hero: '오늘 패널', agenda: '다가오는 일정', strip: '카드 줄' };

const THEME_CATS = ['깔끔한', '포근한', '눈이 편안한', '특별한', '시원한'];

function openThemePicker() {
  const sheet = el('div', 'sheet wide');
  sheet.append(el('h2', null, '테마'));
  const body = el('div', 'sheet-body'); // 목록만 스크롤되고, 아래 닫기 버튼은 늘 보인다
  sheet.append(body);
  const cards = [];
  for (const cat of THEME_CATS) {
    const list = THEMES.filter((t) => t.cat === cat);
    if (!list.length) continue;
    body.append(el('h3', 'theme-cat', cat));
    const gridEl = el('div', 'theme-grid');
    for (const t of list) {
      const b = el('button', 'tcard');
      b.type = 'button';
      b.style.setProperty('--tp', t.colors.panel);
      b.style.setProperty('--ti', t.colors.ink);
      b.style.setProperty('--tm', t.colors.muted);
      b.style.setProperty('--ta', t.colors.accent);
      if (t.id === settings.theme) b.classList.add('cur');
      const dots = el('div', 'dots');
      for (const c of [t.colors.accent, t.colors.sun, t.colors.sat]) {
        const i = document.createElement('i');
        i.style.background = c;
        dots.append(i);
      }
      const layout = [HDR_NAME[t.layout.hdr], PANEL_NAME[t.layout.panel]].filter(Boolean).join(' · ');
      b.append(dots, el('b', null, t.name), el('small', null, t.mood), el('small', null, layout));
      b.addEventListener('click', () => {
        settings.theme = t.id;
        applyAll();
        updateSettings({ theme: t.id });
        cards.forEach((x) => x.classList.toggle('cur', x === b));
      });
      cards.push(b);
      gridEl.append(b);
    }
    body.append(gridEl);
  }
  const foot = el('div', 'foot-row');
  const done = el('button', 'btn primary', '닫기');
  done.addEventListener('click', closeModal);
  foot.append(done);
  sheet.append(foot);
  modal.replaceChildren(sheet);
  modal.hidden = false;
}

modal.addEventListener('mousedown', (e) => {
  if (e.target === modal) closeModal();
});

// ───────────────────── 이동 · 보기 전환 ─────────────────────

function shift(dir) {
  if (settings.view === 'day') anchor = addDays(anchor, dir);
  else if (settings.view === 'week') anchor = addDays(anchor, dir * 7);
  else if (settings.monthMode === 'rolling') anchor = addDays(anchor, dir * 7);
  else anchor = new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  render();
}

$('#prev').addEventListener('click', () => shift(-1));
$('#next').addEventListener('click', () => shift(1));
const goToday = () => {
  anchor = new Date();
  tlScroll = null;
  render();
};
$('#today').addEventListener('click', goToday);
$('#title').addEventListener('click', (e) => {
  e.stopPropagation();
  setYm(ym.hidden);
}); // 제목을 누르면 연·월 선택

$('#seg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b || b.dataset.view === settings.view) return;
  settings.view = b.dataset.view;
  tlScroll = null;
  updateSettings({ view: settings.view });
  render();
});

// ───────────────────── 메뉴 · 이동 모드 ─────────────────────

const menu = $('#menu');
// 메뉴는 테마(헤더 높이)와 상관없이 항상 메뉴 아이콘 바로 아래, 아이콘의 오른쪽 끝에 맞춰 연다.
const setMenu = (open) => {
  if (open) {
    const w = $('#widget').getBoundingClientRect();
    const b = $('#btn-menu').getBoundingClientRect();
    menu.style.top = `${Math.round(b.bottom - w.top + 6)}px`;
    menu.style.right = `${Math.max(6, Math.round(w.right - b.right))}px`;
    menu.style.bottom = 'auto';
    menu.style.left = 'auto';
  }
  menu.hidden = !open;
};

$('#btn-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  setMenu(menu.hidden);
});
document.addEventListener('mousedown', (e) => {
  if (!menu.hidden && !menu.contains(e.target) && !$('#btn-menu').contains(e.target)) setMenu(false);
});

async function setMove(on) {
  moveMode = on;
  $('#movelayer').hidden = !on;
  $('#mi-move').classList.toggle('on', on);
  $('#mi-move-state').textContent = on ? '이동 중' : '고정됨';
  await api.setMoveMode(on).catch(() => {});
}

$('#mi-move').addEventListener('click', () => {
  setMenu(false);
  setMove(!moveMode);
});
$('#move-done').addEventListener('click', () => setMove(false));
// 이동 모드의 크기 조절 손잡이: 잡으면 윈도우 크기 조절을 바로 시작한다(얇은 기본 테두리 대신 넓은 손잡이).
document.querySelectorAll('#movelayer .rz').forEach((h) => {
  h.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    window.__TAURI__?.window?.getCurrentWindow?.().startResizeDragging(h.dataset.dir).catch(() => {});
  });
});
$('#mi-theme').addEventListener('click', () => {
  setMenu(false);
  openThemePicker();
});
// 슬라이딩 스위치: 누르면 바로 적용·저장하고, 움직이는 모습을 볼 수 있게 메뉴는 열어 둔다.
for (const [id, key, flag] of [['#mi-today', 'showToday', 'today'], ['#mi-upcoming', 'showUpcoming', 'upcoming']]) {
  $(id).addEventListener('click', () => {
    const cur = panelFlags(settings, root.dataset.panel || 'none')[flag];
    settings[key] = !cur;
    if (settings.showPanel === false) settings.showPanel = true; // 예전 스위치 값은 더 쓰지 않는다
    applyAll();
    updateSettings({ [key]: settings[key], showPanel: settings.showPanel });
  });
}
// 새 버전 알림: 메뉴에 [업데이트 설치]를 보여 준다
let updArmed = false;
onUpdateAvailable((e) => {
  const v = e.payload?.latest?.version;
  if (!v) return;
  $('#mi-update').hidden = false;
  $('#mi-update-state').textContent = v;
  $('#btn-menu').classList.add('has-update');
});
$('#mi-update').addEventListener('click', async () => {
  // 실수로 누르지 않게 한 번 더 누르면 설치
  if (!updArmed) {
    updArmed = true;
    $('#mi-update-state').textContent = '한 번 더 누르면 설치';
    setTimeout(() => { updArmed = false; }, 4000);
    return;
  }
  $('#mi-update-state').textContent = '받는 중…';
  try {
    await api.installUpdate();
  } catch (err) {
    $('#mi-update-state').textContent = '실패: 설정 → 업데이트 확인';
    console.error(err);
  }
});
$('#mi-settings').addEventListener('click', () => {
  setMenu(false);
  api.openSettings();
});
$('#mi-hide').addEventListener('click', () => {
  setMenu(false);
  api.hideWidget();
});
$('#mi-quit').addEventListener('click', () => api.quitApp());

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (closeTools()) return;
  if (!modal.hidden) closeModal();
  else if (!menu.hidden) setMenu(false);
  else if (moveMode) setMove(false);
});

// ───────────────────── 시작 ─────────────────────

async function loadEvents() {
  done = new Set(await api.listDone().catch(() => []));
  events = await api.listEvents();
  render();
  renderPanels();
}

async function loadAccounts() {
  accounts = await api.listAccounts();
}

async function init() {
  settings = { ...settings, ...(await api.getSettings()) };
  await loadAccounts();
  done = new Set(await api.listDone().catch(() => []));
  events = await api.listEvents();
  setCustomHolidays(await api.getCustomHolidays().catch(() => []));
  applyAll();

  // 다른 창에서 바뀐 내용을 반영
  onEventsChanged(loadEvents);
  onAccountsChanged(loadAccounts);
  onSettingsChanged((e) => {
    const prevView = settings.view;
    settings = { ...settings, ...e.payload };
    if (prevView !== settings.view) tlScroll = null;
    applyAll();
    // 사용자가 holidays_custom.json 을 고쳤을 수 있으니 저장 때마다 다시 읽는다.
    api.getCustomHolidays().then((l) => { setCustomHolidays(l); applyAll(); }).catch(() => {});
  });
  // 설정 창에서 저장하기 전의 값을 미리 보여 준다(저장되지 않음. 취소하면 저장된 값으로 되돌아감).
  onSettingsPreview((e) => {
    settings = { ...settings, ...e.payload };
    applyAll();
  });

  // 1분마다: 현재 시각 선을 옮기고, 자정이 지나면 오늘 표시를 갱신한다.
  let day = toKey(new Date());
  setInterval(() => {
    const now = toKey(new Date());
    if (now !== day) {
      day = now;
      render();
      renderPanels();
    } else if (settings.view !== 'month') {
      updateNowLine();
    }
  }, 60_000);
}

init();


// ───────────────────── 일정 검색 (메뉴 또는 Ctrl+F) ─────────────────────

const searchOv = $('#searchov');
let searchSel = 0;

function nextOccurrence(ev) {
  if (!ev.repeat) return ev.startDate;
  const today = toKey(new Date());
  const ahead = expandRecurring([ev], today, toKey(addDays(new Date(), 400)));
  return ahead[0]?.startDate ?? ev.startDate;
}

/** 글자 안의 검색어를 <mark>로 강조한 요소(HTML을 쓰지 않고 글자 노드로 만든다) */
function markText(tag, cls, text, terms) {
  const e = el(tag, cls);
  const low = text.toLowerCase();
  let i = 0;
  while (i < text.length) {
    let best = -1, len = 0;
    for (const t of terms) {
      const j = low.indexOf(t, i);
      if (j >= 0 && (best < 0 || j < best)) { best = j; len = t.length; }
    }
    if (best < 0) { e.append(text.slice(i)); break; }
    if (best > i) e.append(text.slice(i, best));
    const m = document.createElement('mark');
    m.textContent = text.slice(best, best + len);
    e.append(m);
    i = best + len;
  }
  return e;
}

function runSearch() {
  const q = $('#sr-input').value.trim().toLowerCase();
  const box = $('#sr-list');
  box.replaceChildren();
  if (!q) {
    box.append(el('div', 'dv-empty', '제목과 내용(메모)에 들어 있는 글자로 찾습니다. 여러 단어는 띄어 쓰면 모두 들어간 일정을 찾습니다.'));
    return;
  }
  const terms = q.split(/\s+/).filter(Boolean);
  const calName = (id) => (id === 'local' ? '내 캘린더' : accounts.find((a) => a.id === id)?.name || '');
  const today = toKey(new Date());
  const hits = events
    .filter((ev) => {
      if (ev.deleted) return false;
      const hay = `${ev.title} ${ev.memo || ''} ${calName(ev.calendarId)}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    })
    .map((ev) => ({ ev, day: nextOccurrence(ev) }))
    .sort((a, b) => (a.day >= today) !== (b.day >= today) ? (a.day >= today ? -1 : 1) : a.day >= today ? a.day.localeCompare(b.day) : b.day.localeCompare(a.day))
    .slice(0, 60);
  if (!hits.length) {
    box.append(el('div', 'dv-empty', '찾는 일정이 없습니다.'));
    return;
  }
  hits.forEach(({ ev, day }, i) => {
    const b = el('button', `item${i === searchSel ? ' on' : ''}`);
    b.type = 'button';
    b.style.setProperty('--c', ev.color || '#5b9dff');
    const d = fromKey(day);
    const when = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} (${DOW[d.getDay()]})${ev.allDay || !ev.startTime ? '' : ' ' + ev.startTime}`;
    b.append(markText('div', 'ttl', ev.title, terms), el('div', 'meta', [when, repeatLabel(ev.repeat), ev.calendarId !== 'local' ? calName(ev.calendarId) : null, day < today ? '지난 일정' : null].filter(Boolean).join(' · ')));
    // 내용(메모)에서 찾았으면 그 부분을 보여 준다
    const memo = (ev.memo || '').replace(/\s+/g, ' ').trim();
    const hitAt = terms.map((t) => memo.toLowerCase().indexOf(t)).filter((i) => i >= 0).sort((x, y) => x - y)[0];
    if (hitAt !== undefined) {
      const from = Math.max(0, hitAt - 18);
      const snip = (from > 0 ? '…' : '') + memo.slice(from, from + 70) + (memo.length > from + 70 ? '…' : '');
      b.append(markText('div', 'memo sr-snip', snip, terms));
    }
    b.addEventListener('click', () => goToResult(day));
    box.append(b);
  });
}

function goToResult(day) {
  closeSearch();
  anchor = fromKey(day);
  render();
  requestAnimationFrame(() => openDayOverlay(day, grid.querySelector(`[data-key="${day}"]`)));
}

function openSearch() {
  setMenu(false);
  setYm(false);
  if (dayOv) closeDayOverlay(true);
  searchSel = 0;
  searchOv.hidden = false;
  searchOv.classList.add('in');
  $('#sr-input').value = '';
  runSearch();
  $('#sr-input').focus();
}
function closeSearch() {
  searchOv.hidden = true;
  searchOv.classList.remove('in');
}

$('#sr-input').addEventListener('input', () => { searchSel = 0; runSearch(); });
$('#sr-input').addEventListener('keydown', (e) => {
  const items = [...$('#sr-list').querySelectorAll('.item')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!items.length) return;
    searchSel = (searchSel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((it, i) => it.classList.toggle('on', i === searchSel));
    items[searchSel].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && items[searchSel]) {
    items[searchSel].click();
  } else if (e.key === 'Escape') {
    closeSearch();
  }
});
$('#sr-close').addEventListener('click', closeSearch);
searchOv.addEventListener('mousedown', (e) => {
  if (e.target === e.currentTarget) closeSearch();
});
$('#mi-search').addEventListener('click', openSearch);
$('#btn-search').addEventListener('click', openSearch);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    openSearch();
  }
});


// ───────────────────── 캘린더 보이기·숨기기(아래 막대) ─────────────────────
function hiddenSet() { return new Set(settings.hiddenCals || []); }
function isVisible(ev) { return !hiddenSet().has(ev.calendarId || 'local'); }
function calNameOf(id) { return !id || id === 'local' ? '내 캘린더' : accounts.find((a) => a.id === id)?.name || ''; }
function calList() {
  return [{ id: 'local', name: '내 캘린더', color: COLORS[0] }, ...accounts.map((a) => ({ id: a.id, name: a.name, color: a.color || '#94a3b8' }))];
}
function renderStatus() {
  const box = $('#calchips');
  const hid = hiddenSet();
  const cals = calList();
  box.hidden = cals.length < 2; // 캘린더가 하나뿐이면 숨길 필요가 없다
  box.replaceChildren(...cals.map((c) => {
    const off = hid.has(c.id);
    const b = el('button', 'calchip' + (off ? ' off' : ''));
    b.type = 'button';
    b.style.setProperty('--c', c.color);
    b.title = `${c.name} — 눌러서 ${off ? '보이기' : '숨기기'}`;
    b.setAttribute('aria-pressed', String(!off));
    b.append(el('i', 'dot'), el('span', null, c.name));
    b.addEventListener('click', () => toggleCal(c.id));
    return b;
  }));
  // 밀린 일: 처음 쓰는 날부터 센다
  if (!settings.overdueSince) {
    settings.overdueSince = toKey(new Date());
    updateSettings({ overdueSince: settings.overdueSince });
  }
  const n = overdueList().length;
  const pill = $('#od-pill');
  pill.hidden = n === 0;
  pill.textContent = `밀린 일 ${n}`;
  $('#mi-overdue-state').textContent = n ? `${n}건` : '없음';
  if (!$('#odov').hidden) renderOverdue();
  if (!$('#exov').hidden) renderExport();
}
function toggleCal(id) {
  const s = hiddenSet();
  s.has(id) ? s.delete(id) : s.add(id);
  settings.hiddenCals = [...s];
  render();
  updateSettings({ hiddenCals: settings.hiddenCals });
}

// ───────────────────── 도구 창 공통(빠른 입력·밀린 일·내보내기) ─────────────────────
const TOOL_OVS = ['#qaov', '#odov', '#exov'];
function openTool(sel) {
  setMenu(false);
  setYm(false);
  if (dayOv) closeDayOverlay(true);
  closeSearch();
  closeTools();
  const ov = $(sel);
  ov.hidden = false;
  ov.classList.add('in');
}
/** 열려 있는 도구 창을 닫는다. 닫은 게 있으면 true */
function closeTools() {
  let closed = false;
  for (const sel of TOOL_OVS) {
    const ov = $(sel);
    if (!ov.hidden) { ov.hidden = true; ov.classList.remove('in'); closed = true; }
  }
  return closed;
}
for (const sel of TOOL_OVS) $(sel).addEventListener('click', (e) => { if (e.target === e.currentTarget) closeTools(); });
$('#qa-close').addEventListener('click', closeTools);
$('#od-close').addEventListener('click', closeTools);
$('#ex-close').addEventListener('click', closeTools);

// ───────────────────── 밀린 일 ─────────────────────
function overdueList() {
  const since = settings.overdueSince;
  if (!since) return [];
  const limit = toKey(addDays(new Date(), -60)); // 너무 오래된 것은 보지 않는다(최근 60일)
  const from = since > limit ? since : limit;
  const today = toKey(new Date());
  const yesterday = toKey(addDays(new Date(), -1));
  if (from > yesterday) return [];
  return expandRecurring(events.filter((e) => isVisible(e) && !e.deleted), from, yesterday)
    .filter((e) => e.endDate < today && e.endDate >= from && !isDone(e))
    .sort((a, b) => `${b.startDate} ${b.startTime || ''}`.localeCompare(`${a.startDate} ${a.startTime || ''}`));
}
function renderOverdue() {
  const list = overdueList();
  const box = $('#od-list');
  $('#od-count').textContent = list.length ? `${list.length}건` : '';
  box.replaceChildren();
  if (!list.length) {
    box.append(el('div', 'dv-empty', '밀린 일이 없습니다. 지난 일정을 날짜 팝업에서 완료로 체크하면 여기서 빠집니다.'));
    return;
  }
  let last = '';
  for (const ev of list) {
    if (ev.startDate !== last) { box.append(el('div', 'pgroup', dayLabel(ev.startDate))); last = ev.startDate; }
    const row = el('div', 'od-item');
    row.style.setProperty('--c', ev.color || COLORS[0]);
    const info = el('div', 'od-info');
    info.append(el('div', 'ttl', ev.title), el('div', 'meta', [timeLabel(ev), calNameOf(ev.calendarId)].filter(Boolean).join(' · ')));
    const acts = el('div', 'od-acts');
    const btn = (label, fn) => {
      const b = el('button', 'btn sm', label);
      b.type = 'button';
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        b.disabled = true;
        try { await fn(); } catch (err) { b.disabled = false; alert(String(err)); }
      });
      return b;
    };
    acts.append(btn('완료', () => api.setDone(doneKey(ev), true)));
    const base = events.find((x) => x.id === (ev._base || ev).id);
    // 기간을 그대로 둔 채 오늘·내일로 옮긴다(끌어서 옮기기와 같은 moveEvent 사용)
    const daysTo = (k) => Math.round((fromKey(k) - fromKey(base.startDate)) / 86400000);
    if (base && !base.readOnly && !base.repeat) {
      acts.append(btn('오늘로', () => moveEvent(base.id, daysTo(toKey(new Date())))), btn('내일로', () => moveEvent(base.id, daysTo(toKey(addDays(new Date(), 1))))));
    } else {
      acts.append(el('span', 'od-note', base?.repeat ? '반복 일정' : '읽기 전용'));
    }
    row.append(info, acts);
    box.append(row);
  }
}
$('#od-pill').addEventListener('click', () => { openTool('#odov'); renderOverdue(); });
$('#mi-overdue').addEventListener('click', () => { openTool('#odov'); renderOverdue(); });

// ───────────────────── 보고용 내보내기 ─────────────────────
let exPeriod = 'thisweek';
const WD = '일월화수목금토';
function exRange(p) {
  const t = new Date();
  const d0 = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const mon = addDays(d0, -((d0.getDay() + 6) % 7));
  if (p === 'thisweek') return [mon, addDays(mon, 6)];
  if (p === 'lastweek') return [addDays(mon, -7), addDays(mon, -1)];
  if (p === 'thismonth') return [new Date(t.getFullYear(), t.getMonth(), 1), new Date(t.getFullYear(), t.getMonth() + 1, 0)];
  if (p === 'lastmonth') return [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)];
  const a = $('#ex-from').value || toKey(d0), b = $('#ex-to').value || a;
  return a <= b ? [fromKey(a), fromKey(b)] : [fromKey(b), fromKey(a)];
}
function exTable() {
  const [a, b] = exRange(exPeriod);
  const from = toKey(a), to = toKey(b);
  const src = events.filter((e) => !e.deleted && ($('#ex-visible').checked ? isVisible(e) : true));
  const rows = expandRecurring(src, from, to)
    .filter((e) => e.startDate <= to && e.endDate >= from)
    .sort((x, y) => `${x.startDate} ${x.allDay ? '' : x.startTime || ''}`.localeCompare(`${y.startDate} ${y.allDay ? '' : y.startTime || ''}`));
  const data = rows.map((e) => ({
    날짜: e.startDate === e.endDate ? e.startDate : `${e.startDate}~${e.endDate}`,
    요일: WD[fromKey(e.startDate).getDay()],
    시간: e.allDay || !e.startTime ? '종일' : `${e.startTime}~${e.endTime || ''}`,
    제목: e.title,
    캘린더: calNameOf(e.calendarId),
    완료: isDone(e) ? '완료' : '',
    메모: (e.memo || '').replace(/\s+/g, ' ').trim(),
  }));
  return { from, to, data };
}
function exText({ from, to, data }) {
  const lines = [`■ 일정 보고 (${from} ~ ${to}) · 총 ${data.length}건, 완료 ${data.filter((r) => r.완료).length}건`];
  let last = '';
  for (const r of data) {
    const day = r.날짜.slice(0, 10);
    if (day !== last) { lines.push('', `[${day.slice(5).replace('-', '/')} ${r.요일}]`); last = day; }
    lines.push(`${r.완료 ? '☑' : '☐'} ${r.시간 === '종일' ? '' : r.시간 + ' '}${r.제목}${r.날짜.length > 10 ? ` (~${r.날짜.slice(16).replace('-', '/')})` : ''}${r.캘린더 && r.캘린더 !== '내 캘린더' ? ` [${r.캘린더}]` : ''}${r.메모 ? ` - ${r.메모}` : ''}`);
  }
  return lines.join('\n');
}
const csvCell = (v) => { const t = String(v ?? ''); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
function renderExport(msg = '') {
  if (exPeriod !== 'custom') { const [a, b] = exRange(exPeriod); $('#ex-from').value = toKey(a); $('#ex-to').value = toKey(b); }
  $('#ex-from').disabled = $('#ex-to').disabled = exPeriod !== 'custom';
  document.querySelectorAll('#ex-period button').forEach((b) => b.classList.toggle('on', b.dataset.p === exPeriod));
  const t = exTable();
  $('#ex-summary').textContent = msg || `${t.from} ~ ${t.to} · 일정 ${t.data.length}건 (완료 ${t.data.filter((r) => r.완료).length}건)`;
  const text = exText(t).split('\n');
  $('#ex-preview').textContent = text.slice(0, 16).join('\n') + (text.length > 16 ? '\n…' : '');
}
document.querySelectorAll('#ex-period button').forEach((b) => b.addEventListener('click', () => { exPeriod = b.dataset.p; renderExport(); }));
['#ex-from', '#ex-to', '#ex-visible'].forEach((sel) => $(sel).addEventListener('change', () => renderExport()));
$('#ex-save').addEventListener('click', async () => {
  const t = exTable();
  const head = ['날짜', '요일', '시간', '제목', '캘린더', '완료', '메모'];
  const csv = [head.join(','), ...t.data.map((r) => head.map((k) => csvCell(r[k])).join(','))].join('\r\n');
  try {
    const path = await api.exportFile(`일정보고_${t.from}_${t.to}.csv`, csv);
    renderExport(`저장했습니다: ${path}`);
  } catch (err) {
    renderExport(`저장하지 못했습니다: ${err}`);
  }
});
$('#ex-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(exText(exTable()));
    renderExport('텍스트를 복사했습니다. 메일·메신저·보고서에 붙여 넣으세요.');
  } catch (err) {
    renderExport(`복사하지 못했습니다: ${err}`);
  }
});
$('#mi-export').addEventListener('click', () => { openTool('#exov'); renderExport(); });

// ───────────────────── 아침 요약 알림 ─────────────────────
async function maybeBrief() {
  if (settings.briefEnabled === false || !events) return;
  const now = new Date();
  const today = toKey(now);
  if (settings.briefLast === today) return;
  const [hh, mm] = String(settings.briefTime || '08:30').split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < (hh || 0) * 60 + (mm || 0)) return;
  settings.briefLast = today;
  updateSettings({ briefLast: today });
  const todays = eventsOn(expandRecurring(events.filter((e) => isVisible(e) && !e.deleted), today, today), today).filter((e) => !isDone(e));
  const od = overdueList().length;
  const lines = todays.slice(0, 3).map((e) => `${e.allDay || !e.startTime ? '종일' : e.startTime} ${e.title}`);
  if (todays.length > 3) lines.push(`외 ${todays.length - 3}건`);
  try {
    await api.notifyBrief(`오늘 일정 ${todays.length}건${od ? ` · 밀린 일 ${od}건` : ''}`, lines.join('\n') || '오늘은 일정이 없어요.');
  } catch (err) {
    console.error(err);
  }
}
setTimeout(maybeBrief, 8000);
setInterval(maybeBrief, 60000);

// ───────────────────── 빠른 입력 ─────────────────────
let qaParsed = null;
function openQuick() {
  openTool('#qaov');
  $('#qa-input').value = '';
  qaUpdate();
  setTimeout(() => $('#qa-input').focus(), 30);
}
function qaUpdate() {
  const v = $('#qa-input').value.trim();
  const pv = $('#qa-preview');
  pv.classList.remove('err');
  qaParsed = null;
  $('#qa-save').disabled = true;
  if (!v) { pv.textContent = '날짜·시간을 같이 쓰면 알아서 넣습니다. 시간이 없으면 종일 일정이 됩니다.'; return; }
  const r = parseQuick(v);
  if (r.error) { pv.textContent = r.error; pv.classList.add('err'); return; }
  qaParsed = r;
  pv.textContent = `→ ${r.label}  ·  내 캘린더${r.allDay ? '' : ' · 10분 전 알림'}`;
  $('#qa-save').disabled = false;
}
async function qaSave() {
  if (!qaParsed) return;
  const r = qaParsed;
  $('#qa-save').disabled = true;
  try {
    await api.saveEvent({ id: crypto.randomUUID(), calendarId: 'local', title: r.title, startDate: r.startDate, endDate: r.endDate, allDay: r.allDay, startTime: r.allDay ? null : r.startTime, endTime: r.allDay ? null : r.endTime, color: COLORS[0], reminders: r.allDay ? [] : [10], memo: '' });
    closeTools();
    anchor = fromKey(r.startDate); // 저장한 날짜가 보이게
    render();
  } catch (err) {
    $('#qa-preview').textContent = `저장하지 못했습니다: ${err}`;
    $('#qa-preview').classList.add('err');
    $('#qa-save').disabled = false;
  }
}
$('#qa-input').addEventListener('input', qaUpdate);
$('#qa-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); qaSave(); } });
$('#qa-save').addEventListener('click', qaSave);
$('#mi-quick').addEventListener('click', openQuick);
onQuickAdd(() => openQuick());
// 위젯 안에서는 Ctrl+N 으로도
window.addEventListener('keydown', (e) => { if (e.ctrlKey && !e.altKey && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); openQuick(); } });
