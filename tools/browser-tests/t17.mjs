import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const mock = fs.readFileSync('./mock.js', 'utf8'), data = fs.readFileSync('./preview_data.js', 'utf8');
const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
const errors = []; const W = (ms) => new Promise((r) => setTimeout(r, ms)); const out = (k, v) => console.log(k.padEnd(26), typeof v === 'string' ? v : JSON.stringify(v));
async function open(path, w, h, pre = '') {
  const page = await browser.newPage(); await page.setViewport({ width: w, height: h, deviceScaleFactor: 1.3 });
  await page.evaluateOnNewDocument(pre); await page.evaluateOnNewDocument(mock); await page.evaluateOnNewDocument(data);
  page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:8765/' + path, { waitUntil: 'load' }); await W(450); return page;
}
const center = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
let page = await open('index.html', 700, 600, "window.__THEME__='peach';");
await page.click('#title'); await W(250); await page.screenshot({ path: 'shots/93-picker.png' }); await page.keyboard.press('Escape');
const [cx, cy] = await center(page, '.cell[data-key="2026-10-14"]');
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up();
const a = await page.evaluate(() => { const c = document.getElementById('dayview'); return c.getAnimations().map((x) => { const k = x.effect.getKeyframes(); return { prop: x.transitionProperty, from: String(k[0].transform || k[0].opacity).slice(0, 70), to: String(k[k.length - 1].transform || k[k.length - 1].opacity).slice(0, 30) }; }); });
out('효과(전환) 목록', a);
await W(650);
out('카드 위치', await page.evaluate(() => { const c = document.getElementById('dayview').getBoundingClientRect(), w = document.getElementById('widget').getBoundingClientRect(), v = [innerWidth, innerHeight]; return { card: [Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)], widget: [Math.round(w.left), Math.round(w.top), Math.round(w.width), Math.round(w.height)], viewport: v }; }));
await page.screenshot({ path: 'shots/94-overlay-peach.png' });
await page.evaluate(() => [...document.querySelectorAll('.dvcard .btn.primary')].find((b) => b.textContent.includes('일정 추가')).click()); await W(200);
await page.screenshot({ path: 'shots/95-editor-peach.png' });
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await W(450);
await page.close();
// 주 보기: 비어 있는 시간대를 찾아 클릭
page = await open('index.html', 760, 600);
await page.click('#seg button[data-view=week]'); await W(350);
const pt = await page.evaluate(() => { const cols = [...document.querySelectorAll('.col')]; for (const c of cols) { const r = c.getBoundingClientRect(); for (let y = r.top + 40; y < r.bottom - 10; y += 8) { const x = r.left + r.width / 2; const e = document.elementFromPoint(x, y); if (e && c.contains(e) && !e.closest('.tev')) return { x, y, key: c.dataset.key }; } } return null; });
out('빈 시간대', pt);
await page.mouse.click(pt.x, pt.y); await W(650);
out('시간표 클릭 → 입력 폼', await page.evaluate(() => { const f = document.querySelector('.dvcard .editor'); return f && { allDay: f.elements.allDay.checked, start: f.elements.startTime.value, date: f.elements.startDate.value }; }));
await page.screenshot({ path: 'shots/96-week-editor.png' });
await page.close();
out('JS 오류', errors.length ? errors.slice(0, 3).join(' | ') : 0);
await browser.close();
