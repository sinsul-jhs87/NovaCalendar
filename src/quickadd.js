// 빠른 입력: "내일 3시 노형초 방문" 같은 한 줄을 날짜·시간·제목으로 나눈다.
// 날짜: 오늘/내일/모레/글피, N일 후·뒤, N주 후, (이번·다음·다다음)주 X요일, X요일, M/D, M월 D일, YYYY-MM-DD, D일
// 시간: (오전|오후|아침|점심|저녁|밤)? H시(M분|반)? / HH:MM, 범위는 ~ - 부터·까지, '종일'
// 시간이 없으면 종일. 오전·오후 없이 1~6시는 오후로 본다(업무 시간 기준).

const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const DOW = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const KNUM = { 한: 1, 하루: 1, 두: 2, 이틀: 2, 세: 3, 사흘: 3, 네: 4, 나흘: 4, 다섯: 5, 일주일: 7 };

function validDate(y, m, d) {
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d ? t : null;
}

function hour24(h, mer) {
  if (mer === '오전' || mer === '아침' || mer === '새벽') return h === 12 ? 0 : h;
  if (mer === '오후' || mer === '저녁' || mer === '밤' || mer === '점심') return h < 12 ? h + 12 : h;
  return h >= 1 && h <= 6 ? h + 12 : h; // 표시 없으면 1~6시는 오후
}

/** text → { title, startDate, endDate, allDay, startTime, endTime, label } 또는 { error } */
export function parseQuick(text, now = new Date()) {
  let s = ` ${String(text || '').replace(/\s+/g, ' ').trim()} `;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let date = null, allDay = false, t1 = null, t2 = null;
  const take = (re, fn) => {
    const m = s.match(re);
    if (!m) return false;
    const r = fn(m);
    if (r === false) return false;
    s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    return true;
  };

  if (take(/하루\s*종일|종일/, () => { allDay = true; })) { /* 종일 */ }

  // ── 날짜 ──
  take(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})일?/, (m) => { const d = validDate(+m[1], +m[2], +m[3]); if (!d) return false; date = d; }) ||
  take(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/, (m) => { let d = validDate(today.getFullYear(), +m[1], +m[2]); if (!d) return false; if (d < addDays(today, -60)) d = validDate(today.getFullYear() + 1, +m[1], +m[2]) || d; date = d; }) ||
  take(/(?<![\d:])(\d{1,2})\/(\d{1,2})(?![\d:])/, (m) => { let d = validDate(today.getFullYear(), +m[1], +m[2]); if (!d) return false; if (d < addDays(today, -60)) d = validDate(today.getFullYear() + 1, +m[1], +m[2]) || d; date = d; }) ||
  take(/(\d+|한|두|세|네|다섯)\s*주\s*(?:후|뒤)/, (m) => { date = addDays(today, 7 * (+m[1] || KNUM[m[1]])); }) ||
  take(/(\d+|하루|이틀|사흘|나흘|일주일)\s*일?\s*(?:후|뒤)/, (m) => { date = addDays(today, +m[1] || KNUM[m[1]]); }) ||
  take(/(이번\s*주|다음\s*주|다다음\s*주|담주)\s*([일월화수목금토])(?:요일)?/, (m) => {
    const w = /다다음/.test(m[1]) ? 2 : /다음|담주/.test(m[1]) ? 1 : 0;
    const monday = addDays(today, -((today.getDay() + 6) % 7)); // 이번 주 월요일
    date = addDays(monday, w * 7 + ((DOW[m[2]] + 6) % 7));
  }) ||
  take(/(?:^|\s)([일월화수목금토])요일/, (m) => { const diff = (DOW[m[1]] - today.getDay() + 7) % 7; date = addDays(today, diff); }) ||
  take(/(?:^|\s)(오늘|내일|낼|모레|글피|어제)(?=\s|$|에|부터)/, (m) => { date = addDays(today, { 오늘: 0, 내일: 1, 낼: 1, 모레: 2, 글피: 3, 어제: -1 }[m[1]]); }) ||
  take(/(?:^|\s)(\d{1,2})\s*일(?=\s|$|에)/, (m) => { let d = validDate(today.getFullYear(), today.getMonth() + 1, +m[1]); if (!d) return false; if (d < today) d = validDate(today.getFullYear(), today.getMonth() + 2, +m[1]) || d; date = d; });

  // ── 시간(범위 포함) ──
  const T = String.raw`(오전|오후|아침|점심|저녁|밤|새벽)?\s*(\d{1,2})(?::(\d{2})|\s*시\s*(?:(\d{1,2})\s*분|(반))?)`;
  const parseT = (mer, h, mm, mm2, half) => {
    let H = +h, M = mm ? +mm : mm2 ? +mm2 : half ? 30 : 0;
    if (H > 24 || M > 59) return null;
    return { h: mer || mm !== undefined || H > 12 ? (mer ? hour24(H, mer) : H) : hour24(H, null), m: M, mer: !!mer };
  };
  if (!allDay) {
    take(new RegExp(`${T}\\s*(?:에|부터)?\\s*(?:~|-|부터)\\s*${T}\\s*(?:까지|에)?`), (m) => {
      t1 = parseT(m[1], m[2], m[3], m[4], m[5]);
      t2 = parseT(m[6] || m[1], m[7], m[8], m[9], m[10]);
      if (!t1 || !t2) return false;
      if (t2.h * 60 + t2.m <= t1.h * 60 + t1.m && t2.h < 12) t2.h += 12; // "3시~5시"처럼 뒤가 작으면 오후로
    }) ||
    take(new RegExp(`${T}\\s*(?:에|부터)?`), (m) => {
      // 날짜만 쓰인 "15일" 같은 것을 시간으로 잡지 않도록 '시'나 ':'가 있어야 한다
      if (!/시|:/.test(m[0])) return false;
      t1 = parseT(m[1], m[2], m[3], m[4], m[5]);
      if (!t1) return false;
    });
  }

  const title = s.replace(/\s+/g, ' ').replace(/^\s*(에|에는|부터|까지)\s+/, '').trim();
  if (!title) return { error: '일정 제목을 같이 적어 주세요. 예: 내일 3시 노형초 방문' };
  const d = date || today;
  const startDate = key(d);
  const hm = (t) => `${pad(Math.min(23, t.h))}:${pad(t.m)}`;
  if (!t1) allDay = true;
  let startTime = null, endTime = null, endDate = startDate;
  if (!allDay) {
    startTime = hm(t1);
    if (!t2) { t2 = { h: t1.h + 1, m: t1.m }; }
    if (t2.h >= 24) { endDate = key(addDays(d, 1)); t2 = { h: t2.h - 24, m: t2.m }; }
    endTime = hm(t2);
  }
  const DW = '일월화수목금토';
  const label = `${d.getMonth() + 1}월 ${d.getDate()}일(${DW[d.getDay()]}) ${allDay ? '종일' : `${startTime}~${endTime}`} · ${title}`;
  return { title, startDate, endDate, allDay, startTime, endTime, label };
}
