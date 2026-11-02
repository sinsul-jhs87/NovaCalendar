// 날짜 보기(그날의 일정 목록 + 일정 입력 폼).
// 위젯 안의 팝업(날짜를 클릭했을 때)과 별도 창(알림을 클릭했을 때)이 같은 모양으로 쓴다.
import { api, onEventsChanged, onAccountsChanged, onSettingsChanged, toKey, fromKey, addDays, eventsOn, timeLabel, DOW, el, expandRecurring, repeatLabel, doneKey } from './common.js';
import { buildEditor } from './editor.js';
import { dayItems, solarToLunar, lunarLong } from './koreancal.js';

/**
 * root 안에 날짜 보기를 만든다.
 * opts: { date, events?, accounts?, settings?, edit?: { event, defaults }, onClose?, onSaved? }
 *  - edit이 있으면 목록 없이 바로 입력 폼으로 시작한다(여러 날 드래그, 시간표 빈 곳 클릭).
 * 돌려주는 값: { setDate(key), destroy() }
 */
export function createDayView(root, opts = {}) {
  let date = opts.date || toKey(new Date());
  let events = opts.events ? [...opts.events] : [];
  let accounts = opts.accounts ? [...opts.accounts] : [];
  let settings = { showHolidays: true, showSpecial: true, showLunar: true, ...(opts.settings || {}) };
  const startedInEditor = !!opts.edit;
  let editing = startedInEditor ? { event: opts.edit.event ?? null, defaults: opts.edit.defaults ?? {} } : null;
  let alive = true;
  let focus = opts.focus || null; // 처음 열 때 찾아서 보여 줄 일정(완료 키)
  let focusShown = false;
  let done = new Set();
  const unlisten = [];

  const dateTitle = (key) => {
    const d = fromKey(key);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${DOW[d.getDay()]}요일`;
  };

  function rangeLabel(ev) {
    if (ev.startDate === ev.endDate) return timeLabel(ev);
    const f = (k) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;
    return `${f(ev.startDate)} – ${f(ev.endDate)}`;
  }

  /** 날짜 아래에 보여 줄 한 줄: 음력 · 공휴일 · 기념일 · 절기 */
  function subtitle(key) {
    const d = fromKey(key);
    const [y, m, dd] = [d.getFullYear(), d.getMonth() + 1, d.getDate()];
    const parts = [];
    const lun = settings.showLunar ? solarToLunar(y, m, dd) : null;
    if (lun) parts.push(lunarLong(lun));
    for (const it of dayItems(y, m, dd)) if (it.kind === 'holiday' ? settings.showHolidays : settings.showSpecial) parts.push({ name: it.name, off: it.off });
    return parts;
  }

  const calendarName = (id) => (id === 'local' ? null : accounts.find((a) => a.id === id)?.name ?? null);

  function iconButton(label, pathD, onClick) {
    const b = el('button', 'icon-btn');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = `<svg viewBox="0 0 16 16"><path d="${pathD}"/></svg>`;
    b.addEventListener('click', onClick);
    return b;
  }

  const closeBtn = () => iconButton('닫기', 'M4 4l8 8M12 4l-8 8', () => opts.onClose?.());

  function render() {
    if (!alive) return;
    root.replaceChildren();
    const wrap = el('div', 'dv');
    root.append(wrap);
    if (editing) renderEditor(wrap);
    else renderList(wrap);
  }

  function renderList(wrap) {
    const d = fromKey(date);
    const dow = d.getDay();
    const off = dayItems(d.getFullYear(), d.getMonth() + 1, d.getDate()).some((x) => x.off) && settings.showHolidays;
    const head = el('header', 'dv-head');
    const num = el('div', `dv-num${dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''}${off ? ' hol' : ''}`, String(d.getDate()));
    const text = el('div', 'dv-text');
    text.append(el('div', 'dv-ttl', dateTitle(date)));
    const subParts = subtitle(date);
    if (subParts.length) {
      const sub = el('div', 'dv-sub');
      subParts.forEach((p, i) => {
        if (i) sub.append(document.createTextNode(' · '));
        sub.append(typeof p === 'string' ? document.createTextNode(p) : el('span', p.off ? 'off' : '', p.name));
      });
      text.append(sub);
    }
    const nav = el('div', 'dv-nav');
    nav.append(iconButton('이전 날', 'M10 3 5 8l5 5', () => go(-1)), iconButton('다음 날', 'm6 3 5 5-5 5', () => go(1)));
    if (opts.onClose) nav.append(closeBtn());
    head.append(num, text, nav);

    const body = el('div', 'dv-body');
    const list = eventsOn(expandRecurring(events, date, date), date);
    if (list.length === 0) {
      const empty = el('div', 'dv-empty');
      empty.append(el('b', null, '일정이 없는 날'), el('span', null, '아래 버튼으로 일정을 추가해 보세요.'));
      body.append(empty);
    }
    // 맨 위: 전체 완료(모두 완료면 누를 때 모두 풀기)
    if (list.length >= 2) {
      const keys = list.map(doneKey);
      const allDone = keys.every((k) => done.has(k));
      const ar = el('div', 'dv-allrow');
      const lab = el('span', null, allDone ? `전체 완료 (${keys.length})` : `전체 완료 · ${keys.filter((k) => done.has(k)).length}/${keys.length}`);
      const all = el('button', 'dv-check' + (allDone ? ' on' : ''));
      all.type = 'button';
      all.title = allDone ? '전체 완료 취소' : '전체 완료로 표시';
      all.setAttribute('aria-pressed', String(allDone));
      all.innerHTML = '<svg viewBox="0 0 16 16"><path d="m3.5 8.4 2.9 2.9 6.1-6.6"/></svg>';
      all.addEventListener('click', async (e) => {
        e.stopPropagation();
        const on = !allDone;
        const before = new Set(done);
        keys.forEach((k) => (on ? done.add(k) : done.delete(k)));
        render();
        try {
          await api.setDoneMany(keys, on);
        } catch {
          done = before;
          render();
        }
      });
      ar.append(lab, all);
      body.append(ar);
    }
    for (const ev of list) {
      const editable = !ev.readOnly;
      const key = doneKey(ev);
      const isDone = done.has(key);
      const item = el(editable ? 'button' : 'div', (editable ? 'item' : 'item ro') + (isDone ? ' done' : ''));
      if (editable) item.type = 'button';
      item.style.setProperty('--c', ev.color || '#5b9dff');
      // 완료 체크: 누르면 달력에서 설정한 방식(취소선 등)으로 표시된다
      const row = el('div', 'item-row');
      row.dataset.key = key;
      row.style.setProperty('--c', ev.color || '#5b9dff');
      const check = el('button', 'dv-check' + (isDone ? ' on' : ''));
      check.type = 'button';
      check.title = isDone ? '완료 취소' : '완료로 표시';
      check.setAttribute('aria-pressed', String(isDone));
      check.innerHTML = '<svg viewBox="0 0 16 16"><path d="m3.5 8.4 2.9 2.9 6.1-6.6"/></svg>';
      check.addEventListener('click', async (e) => {
        e.stopPropagation();
        const on = !done.has(key);
        on ? done.add(key) : done.delete(key);
        render();
        try {
          await api.setDone(key, on);
        } catch {
          on ? done.delete(key) : done.add(key);
          render();
        }
      });
      const meta = [rangeLabel(ev), repeatLabel(ev.repeat), calendarName(ev.calendarId), editable ? null : '읽기 전용'].filter(Boolean).join(' · ');
      item.append(el('div', 'ttl', ev.title), el('div', 'meta', meta));
      if (ev.memo) item.append(el('div', 'memo', ev.memo));
      if (editable) {
        item.addEventListener('click', () => {
          editing = { event: ev._base || ev, defaults: {} }; // 반복 일정은 원래 일정을 고친다
          render();
        });
      }
      row.append(item, check);
      body.append(row);
    }

    const foot = el('div', 'dv-foot');
    const add = el('button', 'btn primary', '＋ 일정 추가');
    add.type = 'button';
    add.addEventListener('click', () => {
      editing = { event: null, defaults: {} };
      render();
    });
    foot.append(add);
    wrap.append(head, body, foot);
    // 패널에서 연 일정: 1.8초 동안 강조한다. 그 사이 목록이 다시 그려져도(완료 표시 불러오기 등) 새 목록에 다시 건다.
    if (focus) {
      const want = focus;
      requestAnimationFrame(() => {
        const row = [...root.querySelectorAll('.item-row')].find((r) => r.dataset.key === want);
        if (!row) return;
        if (!focusShown) {
          focusShown = true;
          row.scrollIntoView({ block: 'center' });
          setTimeout(() => {
            focus = null;
            root.querySelectorAll('.item-row.flash').forEach((r) => r.classList.remove('flash'));
          }, 1800);
        }
        row.classList.add('flash');
      });
    }
  }

  function leaveEditor() {
    if (startedInEditor) opts.onClose?.();
    else {
      editing = null;
      render();
    }
  }

  function renderEditor(wrap) {
    const head = el('header', 'dv-head slim');
    const back = iconButton(startedInEditor ? '닫기' : '목록으로', startedInEditor ? 'M4 4l8 8M12 4l-8 8' : 'M10 3 5 8l5 5', leaveEditor);
    const text = el('div', 'dv-text');
    text.append(el('div', 'dv-ttl', editing.event ? '일정 수정' : '일정 추가'));
    const base = editing.defaults?.startDate || (editing.event ? editing.event.startDate : date);
    text.append(el('div', 'dv-sub', dateTitle(base)));
    head.append(back, text);

    const body = el('div', 'dv-body');
    const editor = buildEditor({
      event: editing.event,
      defaults: { startDate: date, endDate: date, ...(editing.defaults || {}) },
      calendars: accounts.filter((a) => !a.readOnly),
      accounts,
      onSave: async (ev) => {
        try {
          await api.saveEvent(ev);
        } catch (err) {
          alert(String(err));
          return;
        }
        opts.onSaved?.(ev);
        if (startedInEditor) {
          opts.onClose?.();
          return;
        }
        editing = null;
        events = await api.listEvents();
        render();
      },
      onDelete: async (ev) => {
        try {
          await api.deleteEvent(ev.id);
        } catch (err) {
          alert(String(err));
          return;
        }
        opts.onSaved?.(ev);
        editing = null;
        events = await api.listEvents();
        render();
      },
      onCancel: leaveEditor,
    });
    body.append(editor);
    wrap.append(head, body);
    editor.elements.title.focus();
  }

  function go(delta) {
    date = toKey(addDays(fromKey(date), delta));
    render();
  }

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (editing && !startedInEditor) leaveEditor();
    else opts.onClose?.();
  };
  window.addEventListener('keydown', onKey);

  // 입력 중에는 폼이 날아가지 않도록 목록 보기일 때만 다시 그린다.
  unlisten.push(onEventsChanged(async () => {
    done = new Set(await api.listDone().catch(() => [...done]));
    events = await api.listEvents();
    if (!editing) render();
  }));
  unlisten.push(onAccountsChanged(async () => {
    accounts = await api.listAccounts();
    if (!editing) render();
  }));
  unlisten.push(onSettingsChanged((e) => {
    settings = { ...settings, ...e.payload };
    if (!editing) render();
  }));

  render();
  api.listDone().then((list) => { done = new Set(list); if (!editing) render(); }).catch(() => {});
  if (!opts.events) api.listEvents().then((list) => { events = list; if (!editing) render(); }).catch(() => {});
  if (!opts.accounts) api.listAccounts().then((list) => { accounts = list; if (!editing) render(); }).catch(() => {});
  if (!opts.settings) api.getSettings().then((s) => { settings = { ...settings, ...s }; if (!editing) render(); }).catch(() => {});

  return {
    setDate(key) {
      date = key;
      if (!startedInEditor) editing = null;
      render();
    },
    destroy() {
      alive = false;
      window.removeEventListener('keydown', onKey);
      unlisten.forEach((p) => Promise.resolve(p).then((f) => typeof f === 'function' && f()).catch(() => {}));
    },
  };
}
