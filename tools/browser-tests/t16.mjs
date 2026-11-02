import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const mock = fs.readFileSync('./mock.js', 'utf8'), data = fs.readFileSync('./preview_data.js', 'utf8');
const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
const errors = []; const W = (ms) => new Promise((r) => setTimeout(r, ms)); const out = (k, v) => console.log(k.padEnd(30), typeof v === 'string' ? v : JSON.stringify(v));
async function open(path, w, h, pre = '') {
  const page = await browser.newPage(); await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(pre); await page.evaluateOnNewDocument(mock); await page.evaluateOnNewDocument(data);
  page.on('pageerror', (e) => errors.push(path + ': ' + e)); page.on('console', (m) => { if (m.type() === 'error') errors.push(path + ': ' + m.text()); });
  await page.goto('http://127.0.0.1:8765/' + path, { waitUntil: 'load' }); await W(450); return page;
}
const center = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
// ── 1) 연·월 바로 가기 ──
let page = await open('index.html', 700, 600);
await page.click('#title'); await W(150);
out('1 선택창 열림', await page.evaluate(() => ({ open: !document.getElementById('ympop').hidden, year: document.getElementById('ym-year').value, months: document.querySelectorAll('.ym-m').length, on: document.querySelector('.ym-cur')?.textContent, now: document.querySelector('.ym-now')?.textContent })));
await page.click('#ym-prev'); await page.click('#ym-prev'); await W(60);
await page.evaluate(() => [...document.querySelectorAll('.ym-m')].find((b) => b.textContent === '3월').click()); await W(200);
out('2 2024년 3월로 이동', await page.evaluate(() => ({ title: document.getElementById('title').textContent, closed: document.getElementById('ympop').hidden, cell: !!document.querySelector('.cell[data-key="2024-03-15"]') })));
await page.click('#title'); await W(100);
await page.$eval('#ym-year', (i) => { i.value = '2031'; i.dispatchEvent(new Event('change', { bubbles: true })); });
await page.evaluate(() => [...document.querySelectorAll('.ym-m')].find((b) => b.textContent === '12월').click()); await W(200);
out('3 연도 직접 입력 → 2031-12', await page.$eval('#title', (t) => t.textContent));
await page.click('#title'); await page.$eval('#ym-year', (i) => { i.value = '3000'; i.dispatchEvent(new Event('change', { bubbles: true })); });
out('4 범위 밖(3000) → 보정', await page.$eval('#ym-year', (i) => i.value));
await page.keyboard.press('Escape'); await W(80);
out('5 Esc로 닫힘', await page.$eval('#ympop', (e) => e.hidden));
await page.click('#title'); await page.click('#ym-today'); await W(150);
out('6 오늘로 이동', await page.$eval('#title', (t) => t.textContent));
// ── 2) 날짜 팝업: 클릭한 칸에서 펼쳐짐 ──
await page.evaluate(() => { window.__tf = []; const c = document.getElementById('dayview'); new MutationObserver(() => window.__tf.push(c.style.transform)).observe(c, { attributes: true, attributeFilter: ['style'] }); });
const [cx, cy] = await center(page, '.cell[data-key="2026-10-14"]');
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up(); await W(60);
const anim = await page.evaluate(() => window.__tf.filter(Boolean));
await W(600);
out('7 팝업 열림', await page.evaluate(() => { const c = document.getElementById('dayview').getBoundingClientRect(), w = document.getElementById('widget').getBoundingClientRect(); return { open: !document.getElementById('dayov').hidden, num: document.querySelector('.dv-num')?.textContent, ttl: document.querySelector('.dv-ttl')?.textContent, sub: document.querySelector('.dv-sub')?.textContent, items: document.querySelectorAll('.dvcard .item').length, inside: c.left >= w.left && c.right <= w.right && c.top >= w.top && c.bottom <= w.bottom, centered: Math.abs((c.left + c.right) / 2 - (w.left + w.right) / 2) < 3 }; }));
out('8 시작 변형(칸에서 출발)', { first: anim[0]?.slice(0, 60), last: anim[anim.length - 1], startsSmall: /scale\(0\.[0-9]+\)/.test(anim[0] || '') });
await page.screenshot({ path: 'shots/90-overlay-list.png' });
// 일정 추가 → 저장
await page.evaluate(() => [...document.querySelectorAll('.dvcard .btn.primary')].find((b) => b.textContent.includes('일정 추가')).click()); await W(150);
await page.type('.dvcard input[name=title]', '팝업에서 추가한 일정');
await page.screenshot({ path: 'shots/91-overlay-editor.png' });
await page.evaluate(() => document.querySelector('.dvcard .editor').requestSubmit()); await W(300);
out('9 저장 → 목록으로 복귀', await page.evaluate(() => ({ saved: window.__calls.filter((c) => c[0] === 'save_event').map((c) => c[1].event?.title ?? c[1].title), listShown: !!document.querySelector('.dv-foot'), stillOpen: !document.getElementById('dayov').hidden })));
await page.keyboard.press('Escape'); await W(450);
out('10 Esc로 닫힘', await page.evaluate(() => ({ hidden: document.getElementById('dayov').hidden, cardCleared: document.getElementById('dayview').children.length })));
// 바깥 클릭으로 닫힘
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up(); await W(500);
await page.mouse.click(5, 5); await W(450);
out('11 바깥 클릭으로 닫힘', await page.$eval('#dayov', (e) => e.hidden));
// ── 3) 여러 날 드래그 → 바로 입력 폼 ──
const [ax, ay] = await center(page, '.cell[data-key="2026-10-20"]'); const [bx, by] = await center(page, '.cell[data-key="2026-10-22"]');
await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(bx, by, { steps: 4 }); await page.mouse.up(); await W(600);
out('12 드래그 → 입력 폼', await page.evaluate(() => { const f = document.querySelector('.dvcard .editor'); return f && { start: f.elements.startDate.value, end: f.elements.endDate.value, head: document.querySelector('.dv-ttl')?.textContent }; }));
await page.keyboard.press('Escape'); await W(450);
await page.close();
// ── 4) 주 보기 시간표 빈 곳 클릭 ──
page = await open('index.html', 760, 600, 'window.__VIEW__="week";');
await page.click('#seg button[data-view=week]'); await W(300);
const [tx, ty] = await page.$eval('.col[data-key="2026-10-29"]', (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + 120]; });
await page.mouse.click(tx, ty); await W(600);
out('13 시간표 클릭 → 입력 폼', await page.evaluate(() => { const f = document.querySelector('.dvcard .editor'); return f && { allDay: f.elements.allDay.checked, start: f.elements.startTime.value }; }));
await page.close();
// ── 5) 큰 글자(140%)에서 팝업이 위젯 안에 들어오는지, 테마별 모습 ──
page = await open('index.html', 560, 560, 'window.__FS__=1.4;');
const [fx, fy] = await center(page, '.cell[data-key="2026-10-14"]'); await page.mouse.move(fx, fy); await page.mouse.down(); await page.mouse.up(); await W(650);
out('14 글자 140%: 팝업', await page.evaluate(() => { const c = document.getElementById('dayview').getBoundingClientRect(), w = document.getElementById('widget').getBoundingClientRect(); return { inside: c.left >= w.left - 1 && c.right <= w.right + 1 && c.top >= w.top - 1 && c.bottom <= w.bottom + 1, w: Math.round(c.width), h: Math.round(c.height), bodyScrolls: (() => { const b = document.querySelector('.dv-body'); return b.scrollHeight > b.clientHeight; })() }; }));
await page.screenshot({ path: 'shots/92-overlay-fs140.png' }); await page.close();
// ── 6) 알림을 눌렀을 때 뜨는 별도 창도 같은 모양 ──
page = await open('detail.html?date=2026-10-14', 440, 640);
out('15 별도 창(알림 클릭)', await page.evaluate(() => ({ cls: document.getElementById('detail').className, num: document.querySelector('.dv-num')?.textContent, items: document.querySelectorAll('.item').length })));
await page.close();
out('JS 오류', errors.length ? errors.slice(0, 4).join(' | ') : 0);
await browser.close();
