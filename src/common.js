// 위젯, 상세, 설정, 알림 창이 함께 쓰는 모듈.
import { THEMES } from './themes.js';

const { invoke } = window.__TAURI__.core;
const { listen, emit } = window.__TAURI__.event;

export { THEMES };

export const DEFAULT_FONT = "'Segoe UI Variable Text', 'Segoe UI', 'Malgun Gothic', system-ui, sans-serif";
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/** 글꼴 이름 → CSS font-family 값. 이름이 비어 있으면 기본 글꼴. 없는 글꼴이면 뒤의 기본 글꼴로 대체된다. */
export function fontStack(name) {
  const n = String(name ?? '').replace(/["'\\;{}<>]/g, '').trim();
  return n ? `"${n}", ${DEFAULT_FONT}` : DEFAULT_FONT;
}

/** 이 PC에 설치된 글꼴인지(같은 글자를 기본 글꼴과 폭으로 비교) */
export function isFontInstalled(name) {
  const ctx = document.createElement('canvas').getContext('2d');
  const text = '가나다라마바사 abcdefghijklmnopqrstuvwxyz 0123456789';
  const width = (f) => {
    ctx.font = `72px ${f}`;
    return ctx.measureText(text).width;
  };
  return ['monospace', 'serif', 'sans-serif'].some((base) => {
    const w0 = width(base);
    return width(`"${name}", ${base}`) !== w0;
  });
}

/**
 * 글꼴·글자 크기·바탕 진하기·후광을 적용한다.
 * - scale: 글자 크기 배율을 쓸지(설정 창은 끈다)   - surface: 칸·일정 바탕 진하기를 쓸지(위젯만 켠다)
 */
export function applyLook(s, { scale = true, surface = false } = {}) {
  const root = document.documentElement;
  root.style.setProperty('--font', fontStack(s.fontFamily));
  // 사용자가 글꼴을 골랐으면 테마가 정한 제목용 글꼴(한지의 바탕체 등)보다 사용자의 선택을 우선한다.
  if (s.fontFamily) root.style.setProperty('--font-display', 'inherit');
  else root.style.removeProperty('--font-display');
  // 묶음별 확대율(시스템 / 날짜 / 일정 / 다가오는 일정)과 글꼴
  for (const g of FONT_GROUPS) {
    root.style.setProperty(`--z-${g.key}`, scale ? groupZoom(s, g.key) : 1);
    const f = (s[g.key + 'Font'] || '').trim();
    if (f) root.style.setProperty(`--font-${g.key}`, fontStack(f));
    else root.style.removeProperty(`--font-${g.key}`);
  }
  const fs = scale ? groupZoom(s, 'ui') : 1;
  root.style.setProperty('--fs', fs);
  root.style.setProperty('--fs-toast', Math.min(fs, 1.2));

  // 칸·일정 바탕 진하기: 테마가 정한 바탕 투명도에 곱한다.
  root.style.removeProperty('--cell');
  root.style.removeProperty('--cell-hover');
  const k = surface ? clamp(s.surface ?? 0.5, 0, 1) : 1;
  root.style.setProperty('--sk', k);
  if (surface) {
    const cs = getComputedStyle(root);
    for (const name of ['--cell', '--cell-hover']) {
      const m = cs.getPropertyValue(name).match(/rgba?\(([^)]+)\)/);
      if (!m) continue;
      const [r, g, b, a = '1'] = m[1].split(',').map((x) => x.trim());
      root.style.setProperty(name, `rgba(${r}, ${g}, ${b}, ${(parseFloat(a) * k).toFixed(4)})`);
    }
  }

  // 후광: 위젯이 불투명할 때는 보이지 않고, 투명해질수록 글자 뒤에 배경색을 살짝 깔아 읽히게 한다.
  const opacity = clamp(s.opacity ?? 0.85, 0.2, 1);
  const pct = Math.round(clamp((0.93 - opacity) * 1.75, 0, 0.9) * 100);
  root.style.setProperty('--halo-pct', `${pct}%`);
}

/** 테마를 적용한다: 색은 data-theme, 레이아웃은 data-hdr/grid/chip/panel/num/wk 속성으로 */
export function applyTheme(id) {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  const root = document.documentElement;
  root.dataset.theme = t.id;
  root.dataset.dark = t.dark ? '1' : '0';
  for (const [k, v] of Object.entries(t.layout)) root.dataset[k] = v;
  return t;
}

export const api = {
  // 일정
  // 외부 계정 일정은 계정 설정에 따라 계정 색으로 바꿔 돌려준다(달력·다가오는 일정·팝업·검색 공통).
  listEvents: async () => {
    const [list, accs] = await Promise.all([invoke('list_events'), invoke('list_accounts').catch(() => [])]);
    return withAccountColors(list, accs);
  },
  listDone: () => invoke('list_done'),
  setDone: (key, done) => invoke('set_done', { key, done }),
  setDoneMany: (keys, done) => invoke('set_done_many', { keys, done }),
  setAccountColor: (a) => invoke('set_account_color', a),
  saveEvent: (event) => invoke('save_event', { event }),
  deleteEvent: (id) => invoke('delete_event', { id }),
  // 설정
  getSettings: () => invoke('get_settings'),
  saveSettings: (settings) => invoke('save_settings', { settings }),
  getAutostart: () => invoke('get_autostart'),
  setAutostart: (enabled) => invoke('set_autostart', { enabled }),
  flowCalendars: (apiKey) => invoke('flow_calendars', { apiKey }),
  addFlowAccount: (a) => invoke('add_flow_account', a),
  importEvents: (events) => invoke('import_events', { events }),
  saveGoogleClient: (a) => invoke('save_google_client', a),
  getCustomHolidays: () => invoke('get_custom_holidays'),
  openDataFolder: () => invoke('open_data_folder'),
  testNotification: (style) => invoke('test_notification', { style }),
  // 창
  openDetail: (date) => invoke('open_detail', { date }),
  openSettings: () => invoke('open_settings'),
  hideWidget: () => invoke('hide_widget'),
  setMoveMode: (enabled) => invoke('set_move_mode', { enabled }),
  quitApp: () => invoke('quit_app'),
  // 동기화
  listAccounts: () => invoke('list_accounts'),
  googleLoginAvailable: () => invoke('google_login_available'),
  addGoogle: (a) => invoke('add_google_account', a),
  addCaldav: (a) => invoke('add_caldav_account', a),
  addIcs: (a) => invoke('add_ics_account', a),
  removeAccount: (id) => invoke('remove_account', { id }),
  syncNow: (id = null) => invoke('sync_now', { id }),
  // 백업
  backupNow: () => invoke('backup_now'),
  backupInfo: () => invoke('backup_info'),
  checkUpdate: (source = null) => invoke('check_update', { source }),
  installUpdate: () => invoke('install_update'),
  restoreBackup: (withSettings = false) => invoke('restore_backup', { withSettings }),
  openBackupFolder: () => invoke('open_backup_folder'),
};

// 다른 창에서 바뀌면 Rust가 이 이벤트를 모든 창에 보낸다.
export const onEventsChanged = (fn) => listen('events-changed', fn);
export const onSettingsChanged = (fn) => listen('settings-changed', fn);
export const onAccountsChanged = (fn) => listen('accounts-changed', fn);
export const onUpdateAvailable = (fn) => listen('update-available', fn);
// 설정 창에서 아직 저장하지 않은 값을 위젯에 미리 보여 줄 때 쓴다(저장되지 않음).
export const onSettingsPreview = (fn) => listen('settings-preview', fn);
export const sendSettingsPreview = (patch) => emit('settings-preview', patch);

/** 다른 창이 바꾼 값을 덮어쓰지 않도록, 항상 최신 설정에 일부만 덮어 저장한다. */
export async function updateSettings(patch) {
  const cur = await api.getSettings();
  return api.saveSettings({ ...cur, ...patch });
}

// ── 날짜 유틸 (모두 로컬 시간 기준, 키는 "YYYY-MM-DD") ──
export const pad = (n) => String(n).padStart(2, '0');
export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
export const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export const hmToMin = (s) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};
export const minToHm = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

// ── 일정 ──
export const COLORS = ['#5b9dff', '#ff6b7a', '#3ec99a', '#f2a93b', '#a98bff', '#34c5d8', '#f272b0', '#8b94a8'];

/** 알림 선택지(분). 0은 정시. */
export const REMINDER_CHOICES = [0, 5, 10, 30, 60, 180, 1440, 10080];

export function reminderLabel(m) {
  if (m === 0) return '정시';
  if (m % 10080 === 0) return `${m / 10080}주 전`;
  if (m % 1440 === 0) return `${m / 1440}일 전`;
  if (m % 60 === 0) return `${m / 60}시간 전`;
  return `${m}분 전`;
}

/** 종일(또는 시간 없는) 일정인지 */
export const isAllDayLike = (e) => e.allDay || !e.startTime;

/** 해당 날짜에 걸쳐 있는 일정. 종일 → 시간 순 → 제목 순. */
export function eventsOn(events, key) {
  const sortKey = (e) => (isAllDayLike(e) ? '' : e.startTime);
  return events
    .filter((e) => e.startDate <= key && key <= e.endDate)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.title.localeCompare(b.title, 'ko'));
}

export function timeLabel(ev) {
  if (isAllDayLike(ev)) return '종일';
  return ev.endTime ? `${ev.startTime}–${ev.endTime}` : ev.startTime;
}

/** 작은 DOM 헬퍼. 텍스트는 항상 textContent로 넣어 HTML 주입을 막는다. */
export function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

export function fmtDateTime(ms) {
  if (!ms) return '아직 없음';
  const d = new Date(ms);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


// ───────────────────── 반복 일정 ─────────────────────
// Rust(recur.rs)와 같은 규칙: 매월·매년 반복에서 그 달에 같은 날짜가 없으면(31일, 2월 29일) 건너뛴다.
const DAY_MS = 86400000;
const k2t = (k) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
const t2k = (t) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
function addMonthsKey(k, n) {
  const y = +k.slice(0, 4), m = +k.slice(5, 7) - 1 + n, d = +k.slice(8, 10);
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  const dt = new Date(Date.UTC(yy, mm, d));
  return dt.getUTCMonth() === mm ? t2k(dt.getTime()) : null;
}

/** [from, to] 구간에 걸치는 반복 일정의 시작 날짜들(YYYY-MM-DD) */
export function occurrenceStarts(ev, from, to) {
  const span = Math.max(0, Math.round((k2t(ev.endDate || ev.startDate) - k2t(ev.startDate)) / DAY_MS));
  const r = ev.repeat;
  if (!r) return ev.startDate <= to && (ev.endDate || ev.startDate) >= from ? [ev.startDate] : [];
  const step = Math.max(1, r.interval || 1);
  const period = r.freq === 'daily' ? step : r.freq === 'weekly' ? 7 * step : 0;
  let k = 0;
  if (period) {
    const gap = Math.round((k2t(from) - k2t(ev.startDate)) / DAY_MS) - span;
    if (gap > 0) k = Math.floor(gap / period);
  }
  const out = [];
  for (let guard = 0; guard < 20000; guard++, k++) {
    let d;
    if (period) d = t2k(k2t(ev.startDate) + k * period * DAY_MS);
    else if (r.freq === 'monthly') d = addMonthsKey(ev.startDate, k * step);
    else if (r.freq === 'yearly') d = addMonthsKey(ev.startDate, 12 * k * step);
    else return [ev.startDate];
    if (d === null) {
      if (+ev.startDate.slice(0, 4) + Math.floor((k * step * (r.freq === 'yearly' ? 12 : 1)) / 12) > +to.slice(0, 4) + 1) break;
      continue;
    }
    if ((r.until && d > r.until) || d > to) break;
    if (t2k(k2t(d) + span * DAY_MS) >= from) out.push(d);
  }
  return out;
}

/** 일정 목록에서 반복 일정을 [from, to] 구간의 날짜들로 펼친다. 펼친 항목의 _base는 원래 일정. */
export function expandRecurring(list, from, to) {
  const out = [];
  for (const ev of list) {
    if (!ev.repeat) {
      out.push(ev);
      continue;
    }
    const span = Math.round((k2t(ev.endDate || ev.startDate) - k2t(ev.startDate)) / DAY_MS);
    for (const s of occurrenceStarts(ev, from, to)) out.push({ ...ev, startDate: s, endDate: t2k(k2t(s) + span * DAY_MS), _base: ev });
  }
  return out;
}

const REPEAT_UNIT = { daily: '일', weekly: '주', monthly: '개월', yearly: '년' };
export const REPEAT_NAME = { daily: '매일', weekly: '매주', monthly: '매월', yearly: '매년' };
/** "매주", "2주마다 · 12/31까지" */
export function repeatLabel(r) {
  if (!r || !REPEAT_NAME[r.freq]) return '';
  const base = (r.interval || 1) > 1 ? `${r.interval}${REPEAT_UNIT[r.freq]}마다` : REPEAT_NAME[r.freq];
  return r.until ? `${base} · ${Number(r.until.slice(5, 7))}/${Number(r.until.slice(8, 10))}까지` : base;
}


/** 외부 캘린더 일정의 표시 색: 기본은 계정(캘린더)마다 정한 색. '원래 일정 색 그대로 쓰기'를 켠 계정만 일정 자체 색. */
export function withAccountColors(list, accs) {
  const map = new Map((accs || []).map((a) => [a.id, a]));
  return (list || []).map((e) => {
    const a = e.calendarId && e.calendarId !== 'local' ? map.get(e.calendarId) : null;
    return a && a.color && !(a.keepEventColor && a.kind !== 'ics') ? { ...e, color: a.color } : e;
  });
}

/** 완료 체크 키: 원래 일정 ID + 그 날짜에 시작하는 일정의 시작일(반복 일정은 날짜마다 따로) */
export const doneKey = (ev) => `${(ev._base || ev).id}@${ev.startDate}`;
export const DONE_STYLES = ['strike-dim', 'strike', 'dim', 'check', 'hide'];

/** 오늘의 일정·다가오는 일정 표시 여부. 직접 켜고 끈 적이 없으면 테마 기본값(테마가 가진 패널 종류)을 따른다. */
export function panelFlags(settings, nativePanel) {
  const off = settings.showPanel === false; // 예전 '오늘 일정 패널' 스위치를 끈 경우
  const today = settings.showToday ?? (off ? false : nativePanel === 'hero');
  const upcoming = settings.showUpcoming ?? (off ? false : nativePanel === 'agenda' || nativePanel === 'strip');
  return { today, upcoming };
}

/** 글자 묶음: 크기(px)는 묶음의 대표 글자 기준이고, 같은 묶음의 다른 글자도 같은 비율로 커진다. */
export const FONT_GROUPS = [
  { key: 'ui', label: '시스템 글자', base: 12, hint: '상단 막대·요일·메뉴·날짜 팝업·검색' },
  { key: 'num', label: '달력 날짜', base: 12, hint: '칸의 날짜 숫자·음력' },
  { key: 'ev', label: '달력 일정', base: 11, hint: '칸 안의 일정·공휴일 이름·주/일 보기 일정' },
  { key: 'panel', label: '다가오는 일정', base: 12, hint: '오늘·다가오는 일정 패널과 카드 줄' },
];
/** 묶음 확대율: px를 정했으면 px/기본, 아니면 예전 % 배율(fontScale) */
export function groupZoom(s, key) {
  const g = FONT_GROUPS.find((x) => x.key === key);
  const px = Number(s?.[key + 'Size']) || 0;
  if (px > 0 && g) return Math.min(2.6, Math.max(0.6, px / g.base));
  return Math.min(1.6, Math.max(0.8, Number(s?.fontScale) || 1));
}

/** 기본 업데이트 위치(설정에서 비워 두면 이 위치를 쓴다) */
export const UPDATE_DEFAULT = '\\\\DESKTOP-2KBH0F7\\NovaCalendarUpdateServer';
