import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const mock = fs.readFileSync('./mock.js', 'utf8'), data = fs.readFileSync('./preview_data.js', 'utf8');
const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
const errors = [];
const W = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(path, w, h, pre = '', withData = true) {
  const page = await browser.newPage(); await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(pre); await page.evaluateOnNewDocument(mock); if (withData) await page.evaluateOnNewDocument(data);
  page.on('pageerror', (e) => errors.push(path + ': ' + e)); page.on('console', (m) => { if (m.type() === 'error') errors.push(path + ': ' + m.text()); });
  await page.goto('http://127.0.0.1:8765/' + path, { waitUntil: 'load' }); await W(350); return page;
}
// 1) 20개 테마: 헤더(연월·일주월·메뉴)가 위에 있는지, 메뉴가 아래로 열리는지, 음력이 양력 옆에 붙는지
const THEMES = ['midnight','maple','forest','lavender','graphite','aurora','hanji','ocean','sakura','apple','snow','concrete','wine','peach','sage','sepia','neon','dancheong','cobalt','glacier'];
const bad = [], rows = [];
let page = await open('index.html', 680, 580);
for (const t of THEMES) {
  await page.evaluate((id) => { window.__mock.settings.theme = id; document.dispatchEvent(new Event('x')); }, t);
  await page.evaluate((id) => window.__TAURI__.event.emit?.('settings-changed', { ...window.__mock.settings, theme: id }), t).catch(() => {});
  // 가장 확실한 방법: 선택창에서 눌러 적용
  await page.click('#btn-menu'); await page.click('#mi-theme'); await W(80);
  await page.evaluate((id) => { const names = { midnight: '미드나잇', maple: '단풍', forest: '숲', lavender: '라벤더', graphite: '그래파이트', aurora: '오로라', hanji: '한지', ocean: '바다', sakura: '벚꽃', apple: '청사과', snow: '스노우', concrete: '콘크리트', wine: '와인', peach: '피치', sage: '세이지', sepia: '세피아', neon: '네온 시티', dancheong: '단청', cobalt: '코발트', glacier: '글래시어' }; [...document.querySelectorAll('.tcard')].find((c) => c.querySelector('b').textContent === names[id]).click(); document.querySelector('.sheet .btn.primary').click(); }, t);
  await W(150);
  const r = await page.evaluate(() => {
    const bar = document.querySelector('.bar').getBoundingClientRect(), w = document.getElementById('widget').getBoundingClientRect();
    const mb = document.getElementById('btn-menu').getBoundingClientRect(), seg = document.getElementById('seg').getBoundingClientRect(), h1 = document.getElementById('title').getBoundingClientRect();
    document.getElementById('btn-menu').click();
    const menu = document.getElementById('menu').getBoundingClientRect();
    document.getElementById('btn-menu').click();
    const cell = document.querySelector('.cell:not(.dim) .nrow'), num = cell.querySelector('.num').getBoundingClientRect(), lun = cell.querySelector('.lunar').getBoundingClientRect();
    const gap = Math.min(Math.abs(lun.left - num.right), Math.abs(num.left - lun.right));
    return { theme: document.documentElement.dataset.theme, hdr: document.documentElement.dataset.hdr, topY: Math.round(Math.max(bar.top, mb.top, seg.top, h1.top) - w.top), maxBottom: Math.round(Math.max(mb.bottom, seg.bottom, h1.bottom) - w.top), menuBelow: menu.top >= mb.bottom - 2, menuTop: Math.round(menu.top - w.top), gap: Math.round(gap), vdiff: Math.round(Math.abs((lun.top + lun.bottom) / 2 - (num.top + num.bottom) / 2)) };
  });
  rows.push(r);
  if (r.maxBottom > 130 || !r.menuBelow || r.gap > 10 || r.vdiff > 12) bad.push(r);
}
console.log('헤더 종류:', [...new Set(rows.map((r) => r.hdr))].join(','), '| 헤더 맨 아래(위젯 위쪽 기준 px) 최대', Math.max(...rows.map((r) => r.maxBottom)), '| 음력-양력 간격 최대', Math.max(...rows.map((r) => r.gap)), 'px, 세로 어긋남 최대', Math.max(...rows.map((r) => r.vdiff)), 'px');
console.log('기준 밖:', bad.length, JSON.stringify(bad).slice(0, 400));
await page.close();
// 2) 오늘 일정 패널 스위치(메뉴): 패널 있는 테마 3종 + 없는 테마
for (const [t, sel] of [['aurora', '#hero'], ['forest', '#agenda'], ['sakura', '#strip']]) {
  page = await open('index.html', 680, 580, `window.__THEME__='${t}';`);
  const before = await page.$eval(sel, (e) => !e.hidden);
  await page.click('#btn-menu'); await W(60);
  const sw0 = await page.$eval('#mi-panel', (b) => b.getAttribute('aria-checked'));
  await page.click('#mi-panel'); await W(250);
  const after = await page.evaluate((s) => ({ shown: !document.querySelector(s).hidden, saved: window.__mock.settings.showPanel, sw: document.getElementById('mi-panel').getAttribute('aria-checked'), knob: getComputedStyle(document.querySelector('#mi-panel .switch'), '::after').transform }), sel);
  await page.click('#mi-panel'); await W(250);
  const again = await page.$eval(sel, (e) => !e.hidden);
  console.log(`${t}: 처음 패널 ${before} 스위치 ${sw0} → 끔: 패널 ${after.shown}, 저장 ${after.saved}, 스위치 ${after.sw} → 다시 켬: 패널 ${again}`);
  if (t === 'aurora') await page.screenshot({ path: 'shots/80-menu-switch.png' });
  await page.close();
}
page = await open('index.html', 680, 580, "window.__THEME__='graphite';"); await page.click('#btn-menu'); await W(60);
console.log('패널 없는 테마(그래파이트): 메뉴 항목 흐림', await page.$eval('#mi-panel', (b) => b.classList.contains('dim')), '| 안내:', await page.$eval('#mi-panel', (b) => b.title)); await page.close();
// 3) 설정 창: 모든 켜고 끄기가 슬라이딩 스위치로, 새 항목 동작
page = await open('settings.html', 600, 1500, '', false);
const sw = await page.evaluate(() => [...document.querySelectorAll('.card input[type=checkbox]')].map((c) => ({ id: c.id, w: Math.round(c.getBoundingClientRect().width), h: Math.round(c.getBoundingClientRect().height), ap: getComputedStyle(c).appearance })));
console.log('설정 창 스위치:', sw.length, '개, 모두 36x20 슬라이딩:', sw.every((s) => s.w === 36 && s.h === 20 && s.ap === 'none'), '| 항목:', sw.map((s) => s.id).join(','));
await page.evaluate(() => { window.__prev = []; window.__TAURI__.event.listen('settings-preview', (e) => window.__prev.push(e.payload)); });
await page.click('#show-panel'); await W(150);
console.log('설정 스위치로 끔 → 미리보기 showPanel:', await page.evaluate(() => window.__prev.slice(-1)[0]?.showPanel), '| 저장 전 저장 횟수:', await page.evaluate(() => window.__saves || 0));
await page.evaluate(() => document.getElementById('show-holidays').scrollIntoView({ block: 'start' })); await page.screenshot({ path: 'shots/81-settings-switch.png' });
await page.close();
console.log('JS 오류:', errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
