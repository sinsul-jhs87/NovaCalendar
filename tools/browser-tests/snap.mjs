// 정리 전후 비교용 화면 촬영: node snap.mjs <폴더>
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const dir = process.argv[2]; fs.mkdirSync(dir, { recursive: true });
const mock = fs.readFileSync('./mock.js', 'utf8'), data = fs.readFileSync('./preview_data.js', 'utf8');
const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
const W = (ms) => new Promise((r) => setTimeout(r, ms));
const freeze = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
async function shot(name, path, w, h, pre, after) {
  const page = await browser.newPage(); await page.setViewport({ width: w, height: h });
  await page.evaluateOnNewDocument(pre); await page.evaluateOnNewDocument(mock); await page.evaluateOnNewDocument(data);
  await page.goto('http://127.0.0.1:8765/' + path, { waitUntil: 'load' }); await W(400);
  await page.addStyleTag({ content: freeze }); if (after) await after(page); await W(250);
  await page.screenshot({ path: `${dir}/${name}.png` }); await page.close();
}
for (const t of ['midnight', 'hanji', 'sakura', 'apple', 'neon', 'glacier', 'pop', 'blueprint', 'lagoon', 'concrete']) {
  await shot(`${t}-month`, 'index.html', 680, 560, `window.__THEME__='${t}';`);
}
await shot('forest-week', 'index.html', 760, 560, "window.__THEME__='forest';", async (p) => { await p.click('#seg button[data-view=week]'); });
await shot('aurora-menu', 'index.html', 680, 560, "window.__THEME__='aurora';", async (p) => { await p.click('#btn-menu'); });
await shot('sepia-picker', 'index.html', 640, 520, "window.__THEME__='sepia';", async (p) => { await p.click('#btn-menu'); await p.click('#mi-theme'); });
await shot('peach-popup', 'index.html', 680, 560, "window.__THEME__='peach';", async (p) => { await p.evaluate(() => document.querySelector('.cell[data-key="2026-10-14"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))); await p.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))); await W(500); });
await shot('midnight-settings', 'settings.html', 600, 1400, "window.__THEME__='midnight';");
await shot('cobalt-detail', 'detail.html?date=2026-10-14', 440, 600, "window.__THEME__='cobalt';");
await browser.close();
console.log('촬영 완료', fs.readdirSync(dir).length, '장');
