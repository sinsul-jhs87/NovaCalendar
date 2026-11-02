// 테스트용: Tauri API를 브라우저 안에서 흉내 낸다.
(() => {
  const pad = (n) => String(n).padStart(2, '0');
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const T = new Date();
  const day = (n) => { const d = new Date(T); d.setDate(d.getDate() + n); return key(d); };
  const base = { allDay: false, startTime: null, endTime: null, memo: '', reminders: [], calendarId: 'local', remoteId: null, updatedAt: 1, deleted: false, readOnly: false, dirty: false };
  let seq = 0;
  const ev = (o) => ({ ...base, id: 'e' + ++seq, color: '#5b9dff', ...o });
  let events = [
    ev({ title: '주간 회의', startDate: day(0), endDate: day(0), startTime: '14:00', endTime: '15:00' }),
    ev({ title: '아주 긴 제목의 일정입니다 가로로 넘치면 말줄임표가 나와야 합니다', startDate: day(0), endDate: day(0), allDay: true, color: '#ff6b7a' }),
    ev({ title: '운동', startDate: day(0), endDate: day(0), startTime: '07:00', endTime: '08:00', color: '#3ec99a' }),
    ev({ title: '치과', startDate: day(0), endDate: day(0), startTime: '16:30', endTime: '17:00', color: '#f2a93b' }),
    ev({ title: '독서 모임', startDate: day(0), endDate: day(0), startTime: '21:00', endTime: '22:00', color: '#a98bff' }),
    ev({ title: '점심 약속', startDate: day(0), endDate: day(0), startTime: '12:00', endTime: '13:00', color: '#34c5d8' }),
    ev({ title: '제주 출장', startDate: day(1), endDate: day(3), allDay: true, color: '#f272b0' }),
    ev({ title: '디자인 리뷰', startDate: day(2), endDate: day(2), startTime: '10:00', endTime: '11:30' }),
    ev({ title: '코드 리뷰', startDate: day(2), endDate: day(2), startTime: '10:30', endTime: '11:00', color: '#3ec99a' }),
    ev({ title: '구독 캘린더 일정', startDate: day(-2), endDate: day(-2), allDay: true, color: '#8b94a8', readOnly: true, calendarId: 'acc-ics' }),
    ev({ title: '월말 정산', startDate: day(5), endDate: day(5), allDay: true, color: '#ff6b7a' }),
  ];
  let settings = { opacity: window.__ALPHA__ ?? 0.85, monthMode: 'month', weekStart: 0, view: window.__VIEW__ || 'month', syncMinutes: 15, backupEnabled: true, notifyEnabled: true, notifyStyle: 'popup', theme: window.__THEME__ || 'midnight', showHolidays: window.__HOL__ !== false, showSpecial: window.__SPE__ !== false, showLunar: window.__LUN__ !== false, showPanel: window.__PANEL__ !== false, fontScale: window.__FS__ ?? 1, fontFamily: window.__FONT__ ?? '', surface: window.__SURF__ ?? 0.5 };
  const accounts = [
    { id: 'acc-g', kind: 'google', name: 'Google 캘린더', color: '#3ec99a', detail: 'Google 캘린더', lastSync: Date.now() - 600000, lastError: '', readOnly: false },
    { id: 'acc-ics', kind: 'ics', name: '회사 일정 (ICS)', color: '#8b94a8', detail: 'https://example.com/team.ics', lastSync: Date.now() - 3600000, lastError: 'Connection refused', readOnly: true },
  ];
  const listeners = {};
  const emit = (name, payload = null) => (listeners[name] || []).forEach((cb) => cb({ payload }));
  window.__calls = [];
  const handlers = {
    list_events: () => events.filter((e) => !e.deleted),
    save_event: ({ event }) => { const i = events.findIndex((e) => e.id === event.id); if (i >= 0) events[i] = event; else events.push(event); emit('events-changed'); },
    delete_event: ({ id }) => { events = events.filter((e) => e.id !== id); emit('events-changed'); },
    get_settings: () => settings,
    save_settings: ({ settings: s }) => { settings = s; emit('settings-changed', s); window.__saves = (window.__saves || 0) + 1; return s; },
    get_autostart: () => false, set_autostart: () => {}, test_notification: () => {},
    open_detail: () => {}, open_settings: () => {}, hide_widget: () => {}, quit_app: () => {},
    list_accounts: () => accounts,
    google_login_available: () => window.__GOOGLE_READY__ !== false,
    save_google_client: (a) => { window.__savedClient = a; if (!a.clientId.endsWith('.apps.googleusercontent.com')) throw 'Client ID 형식이 올바르지 않습니다.'; window.__GOOGLE_READY__ = true; },
    add_google_account: (a) => { window.__googleArgs = a; if (window.__GOOGLE_ERR__) throw window.__GOOGLE_ERR__; },
    add_caldav_account: () => {}, add_ics_account: () => {}, remove_account: () => {}, sync_now: () => {},
    backup_now: () => 'C:\\Users\\me\\Documents\\WidgetCalendar',
    backup_info: () => ({ dir: 'C:\\Users\\me\\Documents\\WidgetCalendar', lastBackup: Date.now() - 120000, enabled: true, hasAccounts: true }),
    get_custom_holidays: () => window.__CUSTOM__ || [], open_data_folder: () => {},
    restore_backup: () => 3, open_backup_folder: () => {}, set_move_mode: () => {},
  };
  window.__TAURI__ = {
    core: { invoke: async (cmd, args) => { window.__calls.push([cmd, args]); const h = handlers[cmd]; if (!h) throw 'unknown ' + cmd; return h(args || {}); } },
    event: { listen: async (name, cb) => { (listeners[name] ||= []).push(cb); return () => {}; }, emit: async (name, payload) => emit(name, payload) },
    window: { getCurrentWindow: () => ({ close: async () => { window.__closed = true; } }) },
  };
  window.__mock = { get events() { return events; }, get settings() { return settings; }, emit };
})();
