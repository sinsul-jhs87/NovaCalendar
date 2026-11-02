import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const mock = fs.readFileSync('./mock.js', 'utf8'), data = fs.readFileSync('./preview_data.js', 'utf8');
const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
const errors = []; const W = (ms) => new Promise((r) => setTimeout(r, ms)); const out = (k, v) => console.log(k.padEnd(30), typeof v === 'string' ? v : JSON.stringify(v));
async function open(path, w, h, pre = '', withData = true) {
  const page = await browser.newPage(); await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(pre); await page.evaluateOnNewDocument(mock); if (withData) await page.evaluateOnNewDocument(data);
  page.on('pageerror', (e) => errors.push(path + ': ' + e)); page.on('console', (m) => { if (m.type() === 'error') errors.push(path + ': ' + m.text()); });
  await page.goto('http://127.0.0.1:8765/' + path, { waitUntil: 'load' }); await W(450); return page;
}
const center = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
// 1) 설정 창 목록 상자 항목 색(어두운 테마)
let page = await open('settings.html', 600, 900, "window.__THEME__='midnight';", false);
out('1 목록 항목 색', await page.evaluate(() => { const o = document.querySelector('#font-select option'); const cs = getComputedStyle(o); return { bg: cs.backgroundColor, fg: cs.color, panel: getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() }; }));
await page.close();
// 2) 테마 선택창: 닫기 버튼이 스크롤 없이 보이는지
page = await open('index.html', 640, 520);
await page.click('#btn-menu'); await page.click('#mi-theme'); await W(250);
out('2 테마창 닫기 버튼', await page.evaluate(() => { const s = document.querySelector('.sheet.wide').getBoundingClientRect(), b = document.querySelector('.sheet.wide .foot-row .btn').getBoundingClientRect(), body = document.querySelector('.sheet-body'); return { buttonVisible: b.bottom <= s.bottom + 1 && b.bottom <= innerHeight, listScrolls: body.scrollHeight > body.clientHeight, sheetH: Math.round(s.height) }; }));
await page.click('.sheet.wide .foot-row .btn'); await W(150);
// 3) 반복 일정 만들기(매주) → 여러 주에 표시
let [cx, cy] = await center(page, '.cell[data-key="2026-10-06"]');
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up(); await W(600);
await page.evaluate(() => [...document.querySelectorAll('.dvcard .btn.primary')].find((b) => b.textContent.includes('일정 추가')).click()); await W(200);
await page.type('.dvcard input[name=title]', '주간 점검');
await page.select('.dvcard select[name=repeatFreq]', 'weekly'); await W(80);
out('3a 반복 종료일 칸 보임', await page.$eval('.dvcard [data-role=repeat-until]', (e) => !e.hidden));
await page.evaluate(() => document.querySelector('.dvcard .editor').requestSubmit()); await W(400);
const saved = await page.evaluate(() => window.__calls.filter((c) => c[0] === 'save_event').map((c) => c[1].event).filter((e) => e.title === '주간 점검')[0]);
out('3b 저장된 반복 규칙', saved && saved.repeat);
await page.keyboard.press('Escape'); await W(450);
out('3c 매주 표시된 날짜', await page.evaluate(() => [...document.querySelectorAll('.cell')].filter((c) => [...c.querySelectorAll('.chip .x')].some((x) => x.textContent === '주간 점검')).map((c) => c.dataset.key)));
// 4) 반복 날짜 계산 규칙(매월 31일은 31일이 없는 달을 건너뜀, 종료일)
out('4 매월 31일 규칙', await page.evaluate(async () => { const m = await import('./common.js'); return { monthly31: m.occurrenceStarts({ startDate: '2026-01-31', endDate: '2026-01-31', repeat: { freq: 'monthly', interval: 1 } }, '2026-01-01', '2026-06-30'), until: m.occurrenceStarts({ startDate: '2026-10-01', endDate: '2026-10-01', repeat: { freq: 'daily', interval: 2, until: '2026-10-07' } }, '2026-10-01', '2026-10-31'), leap: m.occurrenceStarts({ startDate: '2024-02-29', endDate: '2024-02-29', repeat: { freq: 'yearly', interval: 1 } }, '2024-01-01', '2032-12-31') }; }));
// 5) 끌어서 옮기기: 10/22 '제품 발표' → 10/23
const chipSel = await page.evaluate(() => { const c = [...document.querySelectorAll('.cell[data-key="2026-10-22"] .chip')].find((x) => x.textContent.includes('제품 발표')); if (!c) return null; c.id = 'dragme'; return true; });
if (chipSel) {
  const [ax, ay] = await center(page, '#dragme'); const [bx, by] = await center(page, '.cell[data-key="2026-10-23"]');
  await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(ax + 20, ay, { steps: 3 }); await page.mouse.move(bx, by, { steps: 6 }); await page.mouse.up(); await W(500);
  out('5 끌어서 옮기기', await page.evaluate(() => { const s = window.__calls.filter((c) => c[0] === 'save_event').map((c) => c[1].event).filter((e) => e.title === '제품 발표').pop(); return s && { start: s.startDate, end: s.endDate, popupOpened: !document.getElementById('dayov').hidden }; }));
} else out('5 끌어서 옮기기', '칩을 찾지 못함');
// 6) 반복 일정 칩은 끌리지 않고, 누르면 날짜 팝업(원래 일정 수정)
const [rx, ry] = await page.evaluate(() => { const c = [...document.querySelectorAll('.cell[data-key="2026-10-13"] .chip')].find((x) => x.textContent.includes('주간 점검')); const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
const before = await page.evaluate(() => window.__calls.filter((c) => c[0] === 'save_event').length);
await page.mouse.move(rx, ry); await page.mouse.down(); await page.mouse.move(rx + 120, ry + 60, { steps: 5 }); await page.mouse.up(); await W(500);
out('6 반복 칩 끌기 막힘', await page.evaluate((n) => ({ saves: window.__calls.filter((c) => c[0] === 'save_event').length - n }), before));
await page.keyboard.press('Escape'); await W(400);
[cx, cy] = await center(page, '.cell[data-key="2026-10-13"]');
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up(); await W(600);
const item = await page.evaluate(() => { const it = [...document.querySelectorAll('.dvcard .item')].find((x) => x.textContent.includes('주간 점검')); return it && it.querySelector('.meta').textContent; });
out('6b 팝업의 반복 표시', item);
await page.evaluate(() => [...document.querySelectorAll('.dvcard .item')].find((x) => x.textContent.includes('주간 점검')).click()); await W(200);
out('6c 원래 일정으로 수정 폼', await page.evaluate(() => { const f = document.querySelector('.dvcard .editor'); return { start: f.elements.startDate.value, freq: f.elements.repeatFreq.value, note: document.querySelector('.dvcard [data-role=repeat-note]').textContent }; }));
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await W(450);
// 7) 검색: Ctrl+F → '출장' → Enter
await page.keyboard.down('Control'); await page.keyboard.press('f'); await page.keyboard.up('Control'); await W(200);
await page.type('#sr-input', '출장'); await W(150);
out('7a 검색 결과', await page.evaluate(() => [...document.querySelectorAll('#sr-list .item')].map((x) => x.textContent).slice(0, 3)));
await page.screenshot({ path: 'shots/98-search.png' });
await page.keyboard.press('Enter'); await W(700);
out('7b 결과로 이동', await page.evaluate(() => ({ searchClosed: document.getElementById('searchov').hidden, popup: !document.getElementById('dayov').hidden, day: document.querySelector('.dv-num')?.textContent, title: document.getElementById('title').textContent })));
await page.close();
// 8) 주 보기에서도 반복 일정 표시
page = await open('index.html', 760, 600);
await page.evaluate(() => window.__TAURI__.core.invoke('save_event', { event: { id: 'rep-w', title: '매일 스탠드업', startDate: '2026-10-01', endDate: '2026-10-01', allDay: false, startTime: '09:30', endTime: '09:45', memo: '', color: '#34d399', reminders: [], calendarId: 'local', repeat: { freq: 'daily', interval: 1, until: null } } }));
await W(400);
await page.click('#seg button[data-view=week]'); await W(400);
out('8 주 보기 매일 반복', await page.evaluate(() => [...document.querySelectorAll('.col')].filter((c) => c.textContent.includes('매일 스탠드업')).length));
await page.close();
out('JS 오류', errors.length ? errors.slice(0, 4).join(' | ') : 0);
await browser.close();
