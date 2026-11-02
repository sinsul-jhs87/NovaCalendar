import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const mock = fs.readFileSync('./mock.js', 'utf8'), data = fs.readFileSync('./preview_data.js', 'utf8');
const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
const page = await browser.newPage(); await page.setViewport({ width: 700, height: 760, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(mock); await page.evaluateOnNewDocument(data);
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'load' }); await new Promise((r) => setTimeout(r, 500));
await page.click('#btn-menu'); await page.click('#mi-theme'); await new Promise((r) => setTimeout(r, 300));
const info = await page.evaluate(() => ({ cats: [...document.querySelectorAll('.theme-cat')].map((h) => h.textContent), perCat: [...document.querySelectorAll('.theme-cat')].map((h) => h.nextElementSibling.querySelectorAll('.tcard').length), total: document.querySelectorAll('.tcard').length, names: [...document.querySelectorAll('.tcard b')].map((b) => b.textContent) }));
console.log('범주:', JSON.stringify(info.cats), '범주별 개수:', JSON.stringify(info.perCat), '전체:', info.total);
console.log('이름:', info.names.join(' '));
await page.screenshot({ path: 'shots/70-picker.png' });
const n = info.total, bad = [];
for (let i = 0; i < n; i++) {
  await page.evaluate((k) => document.querySelectorAll('.tcard')[k].click(), i); await new Promise((r) => setTimeout(r, 120));
  const r = await page.evaluate(() => { const ds = document.documentElement.dataset; const art = getComputedStyle(document.getElementById('widget'), '::before').backgroundImage; return { theme: ds.theme, hdr: ds.hdr, grid: ds.grid, chip: ds.chip, panelBg: getComputedStyle(document.documentElement).getPropertyValue('--panel').trim(), art: art && art !== 'none', saved: window.__mock.settings.theme, cells: document.querySelectorAll('.cell').length }; });
  if (!r.art || r.saved !== r.theme || r.cells < 28 || !r.panelBg) bad.push(r);
}
console.log('20개 테마 순서대로 적용: 이상 있는 것', bad.length, JSON.stringify(bad).slice(0, 300));
console.log('JS 오류:', errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
