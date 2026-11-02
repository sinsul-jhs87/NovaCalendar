// 다른 캘린더의 백업 파일(JSON)을 읽어 NovaCalendar 일정으로 바꾼다.
// 지원 형식
//  1) 날짜별 제목 목록:  { "2026-05-18": ["회의", "출장"], ... }   (값이 문자열 하나거나 {title, time, memo} 객체여도 됨)
//  2) NovaCalendar 백업:  { "events": [ {title, startDate, endDate, allDay, startTime, ...}, ... ] }
//  3) 일정 배열:          [ {title|name|summary, date|startDate|start, endDate|end, time|startTime, memo|description}, ... ]

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');
const keyAdd = (k, n) => {
  const d = new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10) + n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const asDate = (v) => {
  if (typeof v !== 'string') return null;
  const m = v.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : null;
};
const asTime = (v) => {
  if (typeof v !== 'string') return null;
  const m = v.match(/(?:T|\s|^)(\d{1,2}):(\d{2})/);
  return m ? `${pad(m[1])}:${m[2]}` : null;
};
const titleOf = (o) => (typeof o === 'string' ? o : o && (o.title ?? o.name ?? o.summary ?? o.text ?? o.content ?? ''))?.toString().trim();

/** 파일 내용 → { format, items: [{title, startDate, endDate, startTime, endTime, memo, extra}], days, range } */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON 파일이 아니거나 내용이 깨져 있습니다.');
  }
  const items = [];
  let format;
  if (data && !Array.isArray(data) && Array.isArray(data.events)) {
    format = 'NovaCalendar(위젯 캘린더) 백업';
    for (const e of data.events) {
      if (!e || e.deleted) continue;
      const sd = asDate(e.startDate);
      if (!sd) continue;
      items.push({ title: titleOf(e), startDate: sd, endDate: asDate(e.endDate) || sd, allDay: e.allDay !== false && !e.startTime, startTime: e.startTime || null, endTime: e.endTime || null, memo: e.memo || '', color: e.color || null, reminders: Array.isArray(e.reminders) ? e.reminders : [], repeat: e.repeat || null });
    }
  } else if (Array.isArray(data)) {
    format = '일정 목록';
    for (const e of data) {
      const sd = asDate(e?.startDate ?? e?.date ?? e?.start);
      if (!sd) continue;
      const st = e.startTime || asTime(e.time) || asTime(e.start);
      items.push({ title: titleOf(e), startDate: sd, endDate: asDate(e.endDate ?? e.end) || sd, allDay: !st, startTime: st || null, endTime: e.endTime || asTime(e.end) || null, memo: (e.memo ?? e.description ?? '').toString() });
    }
  } else if (data && typeof data === 'object' && Object.keys(data).length && Object.keys(data).filter((k) => DATE.test(k)).length >= Object.keys(data).length * 0.8) {
    format = '날짜별 제목 목록';
    for (const [day, v] of Object.entries(data)) {
      if (!DATE.test(day)) continue;
      for (const it of Array.isArray(v) ? v : [v]) {
        const st = typeof it === 'object' && it ? it.startTime || asTime(it.time) : null;
        items.push({ title: titleOf(it), startDate: day, endDate: day, allDay: !st, startTime: st || null, endTime: (typeof it === 'object' && it && it.endTime) || null, memo: (typeof it === 'object' && it && (it.memo ?? it.description)) || '' });
      }
    }
  } else {
    throw new Error('알 수 없는 형식입니다. 날짜별 제목 목록, NovaCalendar 백업, 일정 배열 형식을 지원합니다.');
  }
  const ok = items.filter((x) => x.title);
  if (!ok.length) throw new Error('가져올 일정이 없습니다.');
  const days = new Set(ok.map((x) => x.startDate));
  const sorted = [...days].sort();
  return { format, items: ok, days: days.size, range: [sorted[0], sorted[sorted.length - 1]] };
}

/** 해석 결과 → 저장할 일정. merge면 연속된 날짜의 같은 제목(종일·시간 없음)을 기간 일정 하나로 합친다. */
export function buildEvents(parsed, { merge = true, color = '#5b9dff' } = {}) {
  const out = [];
  const now = Date.now();
  const mk = (it, sd, ed) => ({
    id: '', calendarId: 'local', title: it.title, startDate: sd, endDate: ed, allDay: it.allDay !== false,
    startTime: it.allDay === false ? it.startTime : null, endTime: it.allDay === false ? it.endTime : null,
    memo: it.memo || '', color: it.color || color, reminders: it.reminders || [], repeat: it.repeat || null, updatedAt: now,
  });
  if (!merge) {
    for (const it of parsed.items) out.push(mk(it, it.startDate, it.endDate));
    return out;
  }
  const simple = parsed.items.filter((it) => it.allDay !== false && it.startDate === it.endDate && !it.repeat);
  const rest = parsed.items.filter((it) => !simple.includes(it));
  const byTitle = new Map();
  for (const it of simple) {
    if (!byTitle.has(it.title)) byTitle.set(it.title, new Map());
    byTitle.get(it.title).set(it.startDate, it);
  }
  for (const [, map] of byTitle) {
    const days = [...map.keys()].sort();
    let start = days[0], prev = days[0];
    for (let i = 1; i <= days.length; i++) {
      const d = days[i];
      if (d && d === keyAdd(prev, 1)) { prev = d; continue; }
      out.push(mk(map.get(start), start, prev));
      start = prev = d;
    }
  }
  for (const it of rest) out.push(mk(it, it.startDate, it.endDate));
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate));
}
