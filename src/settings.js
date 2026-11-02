import { parseImport, buildEvents } from './importer.js';
import {
  api, applyTheme, applyLook, fontStack, isFontInstalled, updateSettings, sendSettingsPreview, onAccountsChanged, onSettingsChanged, fmtDateTime, el, panelFlags, THEMES, FONT_GROUPS, UPDATE_DEFAULT } from './common.js';

const { getCurrentWindow } = window.__TAURI__.window;

const $ = (s) => document.querySelector(s);
let accounts = [];

const KIND_LABEL = { google: 'Google', caldav: 'CalDAV', ics: 'ICS 구독', flow: '플로우' };

function setNote(node, text, isError = false) {
  node.textContent = text;
  node.classList.toggle('err', isError);
}

// ───────────────────────── 일반(초안 → 저장/취소) ─────────────────────────
// 화면의 값은 초안(draft)에만 반영되고, [저장]을 눌러야 파일에 기록된다.

const KEYS = ['opacity', 'monthMode', 'weekStart', 'notifyEnabled', 'notifyStyle', 'syncMinutes', 'backupEnabled', 'showHolidays', 'showSpecial', 'showLunar', 'showPanel', 'showToday', 'showUpcoming', 'fontScale', 'fontFamily', 'surface', 'doneStyle', 'uiFont', 'uiSize', 'numFont', 'numSize', 'evFont', 'evSize', 'panelFont', 'panelSize', 'updateSource', 'updateAuto'];
const PREVIEW_KEYS = ['opacity', 'monthMode', 'weekStart', 'showHolidays', 'showSpecial', 'showLunar', 'showPanel', 'showToday', 'showUpcoming', 'fontScale', 'fontFamily', 'surface', 'doneStyle', 'uiFont', 'uiSize', 'numFont', 'numSize', 'evFont', 'evSize', 'panelFont', 'panelSize'];
let saved = {};
let draft = {};
let savedAutostart = false;
let draftAutostart = false;

const isDirty = () => KEYS.some((k) => draft[k] !== saved[k]) || draftAutostart !== savedAutostart;

function updateDirty() {
  const dirty = isDirty();
  $('#btn-save').disabled = !dirty;
  const note = $('#dirty');
  note.textContent = dirty ? '저장하지 않은 변경 사항이 있습니다' : '변경 사항 없음';
  note.classList.toggle('on', dirty);
}

function change(key, value, fromCustomInput = false) {
  draft[key] = value;
  if (key === 'fontFamily') { syncFontUI(fromCustomInput); syncFontGroups(); }
  // 투명도·보기 방식은 위젯에 미리 보여 주기만 한다(저장 아님).
  if (PREVIEW_KEYS.includes(key)) sendSettingsPreview(Object.fromEntries(PREVIEW_KEYS.map((k) => [k, draft[k]])));
  updateDirty();
}

function applyGeneral() {
  $('#opacity').value = Math.round(draft.opacity * 100);
  $('#opacity-val').textContent = `${Math.round(draft.opacity * 100)}%`;
  document.querySelector(`input[name="monthMode"][value="${draft.monthMode}"]`).checked = true;
  document.querySelector(`input[name="weekStart"][value="${draft.weekStart}"]`).checked = true;
  $('#notify').checked = draft.notifyEnabled;
  $('#notify-style').value = draft.notifyStyle;
  $('#backup-enabled').checked = draft.backupEnabled;
  $('#sync-minutes').value = String(draft.syncMinutes);
  syncFontGroups();
  $('#surface').value = Math.round(draft.surface * 100);
  $('#surface-val').textContent = `${Math.round(draft.surface * 100)}%`;
  syncFontUI(false);
  $('#show-holidays').checked = draft.showHolidays;
  $('#show-special').checked = draft.showSpecial;
  $('#show-lunar').checked = draft.showLunar;
  const pf = panelFlags(draft, THEMES.find((t) => t.id === draft.theme)?.layout?.panel || 'none');
  $('#show-today').checked = pf.today;
  $('#update-source').value = draft.updateSource || '';
  $('#update-auto').checked = draft.updateAuto !== false;
  $('#show-upcoming').checked = pf.upcoming;
  $('#done-style').value = draft.doneStyle || 'strike-dim';
  $('#autostart').checked = draftAutostart;
  updateDirty();
}

$('#opacity').addEventListener('input', (e) => {
  $('#opacity-val').textContent = `${e.target.value}%`;
  change('opacity', Number(e.target.value) / 100);
});
document.querySelectorAll('input[name="monthMode"]').forEach((r) => r.addEventListener('change', () => change('monthMode', r.value)));
document.querySelectorAll('input[name="weekStart"]').forEach((r) => r.addEventListener('change', () => change('weekStart', Number(r.value))));
$('#notify').addEventListener('change', (e) => change('notifyEnabled', e.target.checked));
// ── 글자 크기 · 글꼴 · 바탕 진하기 ──
const FONT_PRESETS = [
  ['Malgun Gothic', '맑은 고딕'], ['Pretendard', 'Pretendard'], ['NanumGothic', '나눔고딕'], ['NanumSquare', '나눔스퀘어'],
  ['NanumMyeongjo', '나눔명조'], ['Noto Sans KR', 'Noto Sans KR'], ['Noto Serif KR', 'Noto Serif KR'],
  ['Gulim', '굴림'], ['Dotum', '돋움'], ['Batang', '바탕 (명조)'], ['Gungsuh', '궁서'], ['Consolas', 'Consolas (고정폭)'], ['D2Coding', 'D2Coding (고정폭)'],
];

function setupFontSelect() {
  const sel = $('#font-select');
  sel.replaceChildren();
  const add = (v, t) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t;
    sel.append(o);
  };
  add('', '기본 (Segoe UI · 맑은 고딕)');
  for (const [v, t] of FONT_PRESETS) if (isFontInstalled(v)) add(v, t);
  add('__custom', '직접 입력…');
}

/** 묶음별 글꼴·크기 줄을 만든다(한 번). */
function setupFontGroups() {
  const box = $('#font-groups');
  box.replaceChildren();
  for (const g of FONT_GROUPS) {
    const row = el('div', 'fgroup');
    const name = el('div', 'fg-name', g.label);
    name.append(el('small', null, g.hint));
    const font = document.createElement('select');
    font.id = `fg-${g.key}-font`;
    const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; font.append(o); };
    add('', '기본 글꼴 따름');
    for (const [v, t] of FONT_PRESETS) if (isFontInstalled(v)) add(v, t);
    const size = document.createElement('select');
    size.id = `fg-${g.key}-size`;
    const sample = el('div', 'fg-sample', g.key === 'num' ? '1 2 3 30 · 9.20' : '가나다 ABC 123');
    font.addEventListener('change', () => { change(g.key + 'Font', font.value); syncFontGroups(); });
    size.addEventListener('change', () => { change(g.key + 'Size', Number(size.value)); syncFontGroups(); });
    row.append(name, font, size, sample);
    box.append(row);
  }
}

/** 묶음별 글꼴·크기 선택을 draft 값에 맞춘다. */
function syncFontGroups() {
  for (const g of FONT_GROUPS) {
    const font = $(`#fg-${g.key}-font`), size = $(`#fg-${g.key}-size`);
    if (!font || !size) continue;
    const f = draft[g.key + 'Font'] || '';
    if (f && ![...font.options].some((o) => o.value === f)) { const o = document.createElement('option'); o.value = f; o.textContent = f; font.append(o); }
    font.value = f;
    // 기본 크기: 예전 % 배율이 있으면 그만큼 반영해 보여 준다
    const def = Math.round(g.base * Math.min(1.6, Math.max(0.8, Number(draft.fontScale) || 1)));
    size.replaceChildren();
    const add = (v, t) => { const o = document.createElement('option'); o.value = String(v); o.textContent = t; size.append(o); };
    add(0, `기본 (${def}px)`);
    for (let px = 8; px <= 28; px++) add(px, `${px}px`);
    size.value = String(Number(draft[g.key + 'Size']) || 0);
    const px = Number(draft[g.key + 'Size']) || def;
    const sample = font.parentElement.querySelector('.fg-sample');
    sample.style.fontFamily = fontStack(f || draft.fontFamily);
    sample.style.fontSize = `${px}px`;
  }
}

/** 글꼴 선택·입력란·견본을 draft 값에 맞춘다. */
function syncFontUI(fromCustomInput) {
  const sel = $('#font-select');
  const listed = [...sel.options].some((o) => o.value === draft.fontFamily && o.value !== '__custom');
  if (!fromCustomInput) {
    sel.value = !draft.fontFamily ? '' : listed ? draft.fontFamily : '__custom';
    $('#font-custom').hidden = sel.value !== '__custom';
    $('#font-custom').value = sel.value === '__custom' ? draft.fontFamily : '';
  }
  $('#font-sample').style.fontFamily = fontStack(draft.fontFamily);
}

$('#done-style').addEventListener('change', (e) => change('doneStyle', e.target.value));
$('#surface').addEventListener('input', (e) => {
  $('#surface-val').textContent = `${e.target.value}%`;
  change('surface', Number(e.target.value) / 100);
});
$('#font-select').addEventListener('change', (e) => {
  if (e.target.value === '__custom') {
    $('#font-custom').hidden = false;
    $('#font-custom').focus();
    return;
  }
  change('fontFamily', e.target.value);
});
$('#font-custom').addEventListener('input', (e) => change('fontFamily', e.target.value.trim(), true));

$('#show-holidays').addEventListener('change', (e) => change('showHolidays', e.target.checked));
$('#show-special').addEventListener('change', (e) => change('showSpecial', e.target.checked));
$('#show-lunar').addEventListener('change', (e) => change('showLunar', e.target.checked));
$('#show-today').addEventListener('change', (e) => { change('showToday', e.target.checked); change('showPanel', true); });
$('#show-upcoming').addEventListener('change', (e) => { change('showUpcoming', e.target.checked); change('showPanel', true); });
$('#btn-open-data').addEventListener('click', () => api.openDataFolder().catch(() => {}));
$('#notify-style').addEventListener('change', (e) => change('notifyStyle', e.target.value));
$('#sync-minutes').addEventListener('change', (e) => change('syncMinutes', Number(e.target.value)));
$('#backup-enabled').addEventListener('change', (e) => {
  change('backupEnabled', e.target.checked);
  loadBackup();
});
$('#autostart').addEventListener('change', (e) => {
  draftAutostart = e.target.checked;
  updateDirty();
});

$('#btn-test-notify').addEventListener('click', async () => {
  // 테스트는 저장 여부와 관계없이, 지금 고른 표시 방식으로 보여 준다.
  await api.testNotification(draft.notifyStyle);
  setNote($('#notify-msg'), '알림을 보냈습니다. 화면에 나타나는지 확인하세요. 윈도우 기본 알림이 보이지 않으면 윈도우 설정 → 시스템 → 알림에서 NovaCalendar와 집중 지원(방해 금지)을 확인하세요.');
});

$('#btn-cancel').addEventListener('click', () => getCurrentWindow().close());
$('#btn-save').addEventListener('click', async () => {
  const btn = $('#btn-save');
  btn.disabled = true;
  try {
    await updateSettings(Object.fromEntries(KEYS.map((k) => [k, draft[k]])));
    if (draftAutostart !== savedAutostart) await api.setAutostart(draftAutostart);
  } catch (err) {
    setNote($('#notify-msg'), `저장하지 못했습니다: ${err}`, true);
    btn.disabled = false;
    return;
  }
  await getCurrentWindow().close();
});

// ───────────────────────── 동기화 ─────────────────────────

function renderAccounts() {
  const box = $('#accounts');
  box.replaceChildren();
  if (accounts.length === 0) {
    box.append(el('div', 'empty small', '연결된 캘린더가 없습니다. 아래에서 추가하세요.'));
    return;
  }
  for (const a of accounts) {
    const card = el('div', 'acct');
    card.style.setProperty('--c', a.color);
    const info = el('div', 'acct-info');
    const title = el('div', 'acct-title');
    title.append(el('span', 'dot'), el('b', null, a.name), el('span', 'badge', KIND_LABEL[a.kind] ?? a.kind));
    if (a.readOnly) title.append(el('span', 'badge ro', '읽기 전용'));
    info.append(title, el('div', 'acct-detail', a.detail));
    info.append(
      a.lastError
        ? el('div', 'acct-status err', `오류: ${a.lastError}`)
        : el('div', 'acct-status', `마지막 동기화: ${fmtDateTime(a.lastSync)}`),
    );

    const actions = el('div', 'acct-actions');
    const sync = el('button', 'btn', '동기화');
    sync.addEventListener('click', async () => {
      sync.disabled = true;
      sync.textContent = '동기화 중…';
      setNote($('#sync-msg'), '');
      try {
        await api.syncNow(a.id);
      } catch (err) {
        setNote($('#sync-msg'), String(err), true);
      }
      await loadAccounts();
    });
    const del = el('button', 'btn danger-text', '삭제');
    let armed = false;
    del.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        del.textContent = '정말 삭제?';
        setTimeout(() => {
          armed = false;
          del.textContent = '삭제';
        }, 3000);
        return;
      }
      await api.removeAccount(a.id);
      setNote($('#sync-msg'), `'${a.name}' 연결을 해제했습니다. 이 PC에서 가져온 일정만 지워지고, 서버의 일정은 그대로입니다.`);
      await loadAccounts();
    });
    const colorBtn = el('button', 'btn acct-color-btn');
    colorBtn.title = '표시 색 바꾸기';
    colorBtn.append(el('i', 'swatch'), document.createTextNode('색'));
    colorBtn.addEventListener('click', () => {
      const open = card.querySelector('.acct-colors');
      if (open) { open.remove(); colorOpenId = null; return; }
      colorOpenId = a.id;
      card.append(colorPanel(a));
    });
    actions.append(colorBtn, sync, del);
    card.append(info, actions);
    // 색을 바꾸면 목록이 다시 그려지므로, 열어 둔 색 고르기는 그대로 다시 연다
    if (colorOpenId === a.id) card.append(colorPanel(a));
    box.append(card);
  }
}

let colorOpenId = null;
const ACCOUNT_COLORS = ['#5b9dff', '#3ec99a', '#f59e0b', '#ff6b6b', '#a78bfa', '#22c3ee', '#f472b6', '#84cc16', '#fb923c', '#14b8a6', '#6366f1', '#94a3b8'];

/** 계정 색 고르기: 색을 누르면 바로 저장되고, 이 계정의 일정이 달력·다가오는 일정에 그 색으로 보인다. */
function colorPanel(a) {
  const p = el('div', 'acct-colors');
  const row = el('div', 'swatches');
  let cur = (a.color || '').toLowerCase();
  const card = () => p.closest('.acct');
  const save = async (color, keep) => {
    try {
      await api.setAccountColor({ id: a.id, color, keepEventColor: keep });
      a.color = color;
      a.keepEventColor = keep;
      cur = color;
      card()?.style.setProperty('--c', color);
      row.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.c === color));
      custom.value = color;
      setNote($('#sync-msg'), keep ? `'${a.name}' 일정은 원래 정해진 색으로 표시합니다.` : `'${a.name}' 일정을 이 색으로 표시합니다.`);
    } catch (err) {
      setNote($('#sync-msg'), String(err), true);
    }
  };
  // 색을 고르면 '원래 색 그대로 쓰기'는 자동으로 꺼서 고른 색이 바로 보이게 한다
  for (const c of ACCOUNT_COLORS) {
    const b = el('button', 'sw' + (c === cur ? ' on' : ''));
    b.type = 'button';
    b.dataset.c = c;
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => { keepCb.checked = false; save(c, false); });
    row.append(b);
  }
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.value = /^#[0-9a-f]{6}$/.test(cur) ? cur : '#5b9dff';
  custom.title = '직접 고르기';
  custom.addEventListener('change', () => { keepCb.checked = false; save(custom.value.toLowerCase(), false); });
  row.append(custom);
  p.append(row);
  const keepCb = document.createElement('input');
  keepCb.type = 'checkbox';
  keepCb.checked = !!a.keepEventColor && a.kind !== 'ics';
  if (a.kind !== 'ics') {
    const lab = el('label', 'radio');
    const txt = el('span', null, '원래 일정 색 그대로 쓰기');
    txt.append(el('small', null, a.kind === 'flow' ? '켜면 플로우에서 일정마다 정한 색으로 보입니다. 끄면(기본) 이 계정의 일정이 모두 위에서 고른 색으로 보입니다.' : '켜면 Google·캘린더에서 일정마다 정한 색으로 보입니다. 끄면(기본) 이 계정의 일정이 모두 위에서 고른 색으로 보입니다.'));
    lab.append(keepCb, txt);
    keepCb.addEventListener('change', () => save(cur || '#5b9dff', keepCb.checked));
    p.append(lab);
  }
  p.append(el('small', 'hint', '달력·다가오는 일정·날짜 팝업·검색에 함께 적용됩니다.'));
  return p;
}

async function loadAccounts() {
  accounts = await api.listAccounts();
  renderAccounts();
  loadBackup();
}

$('#btn-sync-all').addEventListener('click', async (e) => {
  if (accounts.length === 0) {
    setNote($('#sync-msg'), '연결된 캘린더가 없습니다.', true);
    return;
  }
  const b = e.currentTarget;
  b.disabled = true;
  setNote($('#sync-msg'), '동기화 중…');
  try {
    await api.syncNow();
    setNote($('#sync-msg'), '동기화를 마쳤습니다.');
  } catch (err) {
    setNote($('#sync-msg'), String(err), true);
  }
  b.disabled = false;
  loadAccounts();
});

// 계정 추가 폼
const FORMS = {
  'google-simple': {
    title: 'Google 캘린더 연결',
    help: [
      '[Google로 로그인]을 누르면 기본 브라우저에서 Google 로그인 창이 열립니다.',
      '로그인한 뒤 "허용"을 누르면 이 창으로 돌아와 일정을 가져옵니다.',
    ],
    fields: [['name', '표시 이름', 'text', 'Google 캘린더']],
    submit: (v) => api.addGoogle({ name: v.name, clientId: null, clientSecret: null }),
    busy: '브라우저에서 Google 로그인을 완료해 주세요 (최대 3분)…',
    submitLabel: 'Google로 로그인',
  },
  // 로그인 정보가 앱에 없을 때만 나온다: 관리자가 최초 1회만 입력하면 이후에는 버튼 하나로 로그인한다.
  'google-setup': {
    title: 'Google 로그인 준비 (최초 1회)',
    help: [
      'Google은 앱마다 등록된 "Client ID"가 있어야 로그인을 허용합니다. 이 PC에 한 번만 입력해 두면, 이후에는 [Google로 로그인] 버튼만 누르면 됩니다.',
      '※ 이 등록을 마쳐야 Google과 양방향(앱에서 만든 일정이 Google에도 올라감) 동기화가 됩니다. 등록 없이 지금 바로 Google 일정을 보고 싶다면 아래 [키 없이 읽기 전용으로 연결]을 쓰세요(보기만 가능).',
      'Client ID는 Google Cloud Console에서 "OAuth 클라이언트 ID(데스크톱 앱)"로 만듭니다. 만드는 방법은 README의 "Google 로그인 설정"에 있습니다. (개발자가 앱에 미리 넣어 두면 이 단계는 나타나지 않습니다)',
    ],
    fields: [
      ['clientId', 'Client ID', 'text', '1234567890-abc.apps.googleusercontent.com'],
      ['clientSecret', 'Client Secret', 'password', ''],
    ],
    submit: (v) => api.saveGoogleClient({ clientId: v.clientId, clientSecret: v.clientSecret }),
    busy: '저장하는 중…',
    submitLabel: '저장하고 로그인 화면으로',
    next: 'google',
    advanced: 'ics',
    advancedLabel: '키 없이 읽기 전용으로 연결 (iCal 주소)',
  },
  naver: {
    title: '네이버 캘린더 연결 (CalDAV)',
    help: [
      '네이버 아이디와 비밀번호를 입력합니다. 2단계 인증을 사용 중이면 계정 보안 설정에서 만든 "애플리케이션 비밀번호"를 입력하세요.',
      '네이버 쪽 보안 설정이나 정책에 따라 CalDAV 접속이 막혀 있으면 연결되지 않을 수 있습니다. 이때는 오류 메시지를 확인하고, ICS 구독을 대신 사용할 수 있습니다.',
    ],
    fields: [
      ['name', '표시 이름', 'text', '네이버 캘린더'],
      ['username', '네이버 아이디', 'text', ''],
      ['password', '비밀번호', 'password', ''],
    ],
    submit: (v) => api.addCaldav({ name: v.name, preset: 'naver', url: '', username: v.username, password: v.password }),
    busy: '네이버 서버에 연결하는 중…',
  },
  caldav: {
    title: 'CalDAV 서버 연결',
    help: ['CalDAV를 지원하는 서비스(iCloud, Nextcloud, Synology 등)의 서버 주소와 계정을 입력합니다. 캘린더는 자동으로 찾습니다.'],
    fields: [
      ['name', '표시 이름', 'text', 'CalDAV 캘린더'],
      ['url', '서버 주소', 'text', 'https://caldav.example.com'],
      ['username', '아이디', 'text', ''],
      ['password', '비밀번호', 'password', ''],
    ],
    submit: (v) => api.addCaldav({ name: v.name, preset: 'custom', url: v.url, username: v.username, password: v.password }),
    busy: '서버에 연결하는 중…',
  },
  flow: {
    title: '플로우 캘린더 (읽기 전용)',
    help: [
      '플로우의 키 관리 페이지에서 API 키를 발급받아 아래에 붙여넣습니다. 키는 이 PC의 윈도우 사용자만 풀 수 있게 암호화해서 저장합니다.',
      '[캘린더 불러오기]를 누르면 내 캘린더(수정 가능·읽기 전용·프로젝트)가 나옵니다. 가져올 캘린더를 고르세요. "모든 캘린더"를 고르면 나중에 생기는 캘린더도 함께 가져옵니다.',
      '플로우 일정은 읽기 전용으로 표시되고(과거 90일~미래 1년), 주기적으로 다시 받아옵니다. 장소는 메모에 붙습니다.',
    ],
    fields: [
      ['name', '표시 이름', 'text', '플로우 캘린더'],
      ['apiKey', 'API 키', 'password', 'dd9dcb4c-…'],
    ],
    extra: (form, inputs, msg) => {
      const row = el('div', 'inline');
      const load = el('button', 'btn', '캘린더 불러오기');
      load.type = 'button';
      const list = el('div', 'flow-cals');
      list.hidden = true;
      row.append(load);
      form.append(row, list);
      load.addEventListener('click', async () => {
        load.disabled = true;
        setNote(msg, '캘린더 목록을 불러오는 중…');
        try {
          const cals = await api.flowCalendars(inputs.apiKey.value);
          list.replaceChildren();
          const all = el('label', 'radio');
          all.innerHTML = '<input type="checkbox" data-all checked><span>모든 캘린더<small>나중에 생기는 캘린더도 함께 가져옵니다</small></span>';
          list.append(all);
          let group = '';
          for (const c of cals) {
            if (c.group !== group) {
              group = c.group;
              list.append(el('div', 'flow-group', `${group} 캘린더`));
            }
            const lab = el('label', 'radio');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.dataset.id = c.id;
            cb.checked = true;
            cb.disabled = true;
            const sw = el('i', 'flow-dot');
            if (c.color) sw.style.background = c.color;
            const t = el('span', null, c.name);
            t.prepend(sw);
            lab.append(cb, t);
            list.append(lab);
          }
          const allCb = list.querySelector('[data-all]');
          allCb.addEventListener('change', () => list.querySelectorAll('[data-id]').forEach((x) => { x.disabled = allCb.checked; if (allCb.checked) x.checked = true; }));
          list.hidden = false;
          setNote(msg, cals.length ? `캘린더 ${cals.length}개를 찾았습니다. 가져올 캘린더를 고르고 [연결]을 누르세요.` : '캘린더가 없습니다.');
        } catch (err) {
          setNote(msg, String(err), true);
        } finally {
          load.disabled = false;
        }
      });
    },
    submit: (v, form) => {
      const allCb = form.querySelector('.flow-cals [data-all]');
      const calendars = !allCb || allCb.checked ? [] : [...form.querySelectorAll('.flow-cals [data-id]:checked')].map((x) => x.dataset.id);
      if (allCb && !allCb.checked && !calendars.length) return Promise.reject('가져올 캘린더를 하나 이상 고르세요.');
      return api.addFlowAccount({ name: v.name, apiKey: v.apiKey, calendars });
    },
    busy: '플로우에 연결하는 중…',
  },
  ics: {
    title: 'ICS 구독 (읽기 전용)',
    help: [
      'Google 캘린더: 웹(calendar.google.com) → 왼쪽 "내 캘린더"에서 캘린더 옆 ⋮ → "설정 및 공유" → "캘린더 통합" → "iCal 형식의 비공개 주소"를 복사해 아래에 붙여넣습니다. (Outlook·삼성 등도 같은 형식의 주소가 있으면 됩니다. 내 PC의 .ics 파일 경로도 가능)',
      '이 주소는 비밀번호와 같으니 다른 사람에게 알려 주지 마세요. 읽기 전용이라 앱에서 만든 일정은 Google에 올라가지 않습니다.',
      '일정은 읽기 전용으로 표시되고, 주기적으로 다시 받아옵니다.',
    ],
    fields: [
      ['name', '표시 이름', 'text', 'ICS 캘린더'],
      ['url', '주소 또는 파일 경로', 'text', 'https://… / webcal://… / C:\\Users\\…\\calendar.ics'],
    ],
    submit: (v) => api.addIcs({ name: v.name, url: v.url }),
    busy: '캘린더를 가져오는 중…',
  },
};

async function showForm(kind) {
  let spec;
  if (kind === 'google') {
    // 앱에 로그인 정보가 있으면 버튼 하나로, 없으면 최초 1회 설정 화면으로
    const ready = await api.googleLoginAvailable().catch(() => false);
    spec = ready ? FORMS['google-simple'] : FORMS['google-setup'];
  } else {
    spec = FORMS[kind];
  }
  const box = $('#addform');
  box.replaceChildren();
  const form = el('form', 'subform');
  form.noValidate = true;
  form.append(el('h3', null, spec.title));
  const ol = el('ol', 'steps');
  spec.help.forEach((t) => ol.append(el('li', null, t)));
  form.append(ol);

  const inputs = {};
  for (const [key, label, type, ph] of spec.fields) {
    const wrap = el('label', 'field');
    wrap.append(el('span', null, label));
    const input = document.createElement('input');
    input.type = type;
    input.placeholder = ph;
    input.autocomplete = 'off';
    wrap.append(input);
    form.append(wrap);
    inputs[key] = input;
  }
  const msg = el('div', 'note');
  if (spec.extra) spec.extra(form, inputs, msg); // 형식마다 추가 영역(예: 플로우 캘린더 고르기)
  const actions = el('div', 'actions');
  const cancel = el('button', 'btn', '취소');
  cancel.type = 'button';
  cancel.addEventListener('click', () => box.replaceChildren());
  const ok = el('button', 'btn primary', spec.submitLabel ?? '연결');
  ok.type = 'submit';
  actions.append(cancel, ok);
  let adv = null;
  if (spec.advanced) {
    adv = el('button', 'btn', spec.advancedLabel ?? '고급');
    adv.type = 'button';
    adv.style.marginRight = 'auto';
    adv.addEventListener('click', () => showForm(spec.advanced));
    actions.prepend(adv);
  }
  form.append(msg, actions);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
    ok.disabled = true;
    cancel.disabled = true;
    if (adv) adv.disabled = true;
    setNote(msg, spec.busy);
    try {
      await spec.submit(values, form);
      if (spec.next) {
        await showForm(spec.next);
        return;
      }
      box.replaceChildren();
      setNote($('#sync-msg'), '연결되었습니다. 일정을 가져오는 중입니다…');
      await loadAccounts();
    } catch (err) {
      setNote(msg, String(err), true);
      ok.disabled = false;
      cancel.disabled = false;
      if (adv) adv.disabled = false;
    }
  });

  box.append(form);
  Object.values(inputs)[0].focus();
  form.scrollIntoView({ block: 'center' }); // 화면 아래 고정된 저장 막대에 가려지지 않게
}

document.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => showForm(b.dataset.add)));

// ───────────────────────── 백업 ─────────────────────────

async function loadBackup() {
  try {
    const info = await api.backupInfo();
    $('#backup-dir').textContent = info.dir;
    $('#backup-last').textContent = info.lastBackup ? fmtDateTime(info.lastBackup) : '아직 없음';
    $('#backup-state').textContent = draft.backupEnabled
      ? '일정·완료 표시·설정을 바꿀 때마다 자동으로 백업합니다.'
      : '자동 백업이 꺼져 있습니다. 아래 [지금 백업]은 언제든 사용할 수 있습니다.';
  } catch (err) {
    $('#backup-dir').textContent = String(err);
  }
}

$('#btn-backup').addEventListener('click', async () => {
  try {
    const dir = await api.backupNow();
    setNote($('#backup-msg'), `백업했습니다: ${dir}`);
  } catch (err) {
    setNote($('#backup-msg'), String(err), true);
  }
  loadBackup();
});
$('#btn-open-backup').addEventListener('click', () => api.openBackupFolder().catch((e) => setNote($('#backup-msg'), String(e), true)));
$('#btn-restore').addEventListener('click', async () => {
  try {
    const withSettings = $('#restore-settings').checked;
    const r = await api.restoreBackup(withSettings);
    const parts = [r.events ? `일정 ${r.events}개` : null, r.done ? `완료 표시 ${r.done}개` : null, r.settings ? '설정' : null].filter(Boolean);
    setNote($('#backup-msg'), parts.length ? `복원했습니다: ${parts.join(', ')}` : '복원할 새로운 내용이 없습니다. (이미 모두 들어 있습니다)');
    if (r.settings) {
      saved = await api.getSettings();
      draft = { ...saved };
      applyGeneral();
    }
  } catch (err) {
    setNote($('#backup-msg'), String(err), true);
  }
});

// ───────────────────────── 시작 ─────────────────────────

(async () => {
  saved = await api.getSettings();
  draft = { ...saved };
  applyTheme(saved.theme);
  applyLook(saved, { scale: false }); // 설정 창 자신은 저장된 글꼴로, 크기는 그대로
  setupFontSelect();
  setupFontGroups();
  savedAutostart = await api.getAutostart().catch(() => false);
  draftAutostart = savedAutostart;
  applyGeneral();
  await loadAccounts();
  onAccountsChanged(loadAccounts);
  // 위젯 메뉴에서 테마를 바꾸면 이 창의 색도 따라 바꾼다(편집 중인 값은 건드리지 않는다).
  onSettingsChanged((e) => applyTheme(e.payload.theme));
})();

// 설정 창 아래에 현재 버전을 보여 준다.
window.__TAURI__?.app?.getVersion?.().then((v) => { $('#app-version').textContent = `NovaCalendar 버전 ${v}`; }).catch(() => {});


// ───────── 다른 캘린더에서 가져오기 ─────────
let importParsed = null;
const importMsg = (text, ok = true) => {
  const n = $('#import-msg');
  n.textContent = text;
  n.hidden = !text;
  n.classList.toggle('err', !ok);
};
function importPreview() {
  if (!importParsed) return;
  const evs = buildEvents(importParsed, { merge: $('#import-merge').checked, color: $('#import-color').value });
  const p = importParsed;
  $('#import-summary').textContent = `형식: ${p.format} · 항목 ${p.items.length}건(${p.days}일) · ${p.range[0]} ~ ${p.range[1]} → 일정 ${evs.length}개로 가져옵니다.`;
}
$('#btn-import-file').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  importMsg('');
  try {
    importParsed = parseImport(await f.text());
    $('#import-box').hidden = false;
    importPreview();
  } catch (err) {
    importParsed = null;
    $('#import-box').hidden = true;
    importMsg(err.message || String(err), false);
  }
});
$('#import-merge').addEventListener('change', importPreview);
$('#import-color').addEventListener('change', importPreview);
$('#btn-import-cancel').addEventListener('click', () => { importParsed = null; $('#import-box').hidden = true; importMsg(''); });
$('#btn-import-go').addEventListener('click', async () => {
  if (!importParsed) return;
  const btn = $('#btn-import-go');
  btn.disabled = true;
  try {
    const r = await api.importEvents(buildEvents(importParsed, { merge: $('#import-merge').checked, color: $('#import-color').value }));
    importParsed = null;
    $('#import-box').hidden = true;
    importMsg(`${r.added}건을 가져왔습니다.${r.skipped ? ` 이미 있는 일정 ${r.skipped}건은 건너뛰었습니다.` : ''}`);
  } catch (err) {
    importMsg(`가져오지 못했습니다: ${err}`, false);
  } finally {
    btn.disabled = false;
  }
});


// ───────────────────────── 업데이트 ─────────────────────────
window.__TAURI__?.app?.getVersion?.().then((v) => { $('#upd-current').textContent = v; }).catch(() => {});
$('#upd-default').textContent = `기본 위치: ${UPDATE_DEFAULT} (다른 곳을 쓰려면 위에 입력, 확인을 멈추려면 '자동으로 확인'을 끄세요)`;
const effSource = (v) => (v || '').trim() || UPDATE_DEFAULT;
$('#update-source').addEventListener('input', (e) => change('updateSource', e.target.value.trim()));
$('#update-auto').addEventListener('change', (e) => change('updateAuto', e.target.checked));
$('#btn-upd-check').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  const src = effSource($('#update-source').value);
  $('#btn-upd-install').hidden = true;
  b.disabled = true;
  setNote($('#upd-msg'), '확인하는 중…');
  try {
    const r = await api.checkUpdate(src);
    const m = r.latest || {};
    if (r.newer) {
      const savedSrc = effSource(saved.updateSource);
      setNote($('#upd-msg'), `새 버전 ${m.version}이 있습니다 (지금 ${r.current}).${m.notes ? ' ' + m.notes : ''}${src !== savedSrc ? ' 설치하려면 먼저 [저장]을 누르세요.' : ''}`);
      $('#btn-upd-install').hidden = src !== savedSrc;
      $('#btn-upd-install').textContent = `${m.version} 설치`;
    } else {
      setNote($('#upd-msg'), `최신 버전입니다 (${r.current}).`);
    }
  } catch (err) {
    setNote($('#upd-msg'), String(err), true);
  } finally {
    b.disabled = false;
  }
});
$('#btn-upd-install').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  setNote($('#upd-msg'), '설치 파일을 받아 확인하는 중… 확인되면 위젯이 잠시 꺼졌다가 새 버전으로 다시 켜집니다.');
  try {
    await api.installUpdate();
  } catch (err) {
    setNote($('#upd-msg'), String(err), true);
    b.disabled = false;
  }
});
