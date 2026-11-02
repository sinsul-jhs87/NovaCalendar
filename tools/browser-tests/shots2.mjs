import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const mock = fs.readFileSync('./mock.js', 'utf8'), data = fs.readFileSync('./preview_data.js', 'utf8');
const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
async function shot(path, w, h, theme, out, transparent = true) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1.5 });
  await page.evaluateOnNewDocument(`window.__THEME__='${theme}';`);
  await page.evaluateOnNewDocument(mock); await page.evaluateOnNewDocument(data);
  await page.goto('http://127.0.0.1:8765/' + path, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: out, omitBackground: transparent });
  await page.close();
}
fs.mkdirSync('theme_raw', { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const THEMES = (process.argv[2] || 'midnight,maple,forest,lavender,graphite,aurora,hanji,ocean,sakura,apple').split(',');
for (const t of THEMES) {
  await shot('index.html', 680, 580, t, `theme_raw/${t}_widget.png`);
  await shot('detail.html?date=' + today, 440, 520, t, `theme_raw/${t}_detail.png`, false);
  await shot('toast.html?title=' + encodeURIComponent('주간 팀 회의') + '&body=' + encodeURIComponent('10분 후 시작 · 14:00') + '&color=%235b9dff&date=' + today, 380, 112, t, `theme_raw/${t}_toast.png`);
}
// 360px 단풍 헤더 확인
const p = await browser.newPage(); await p.setViewport({ width: 360, height: 420 });
await p.evaluateOnNewDocument("window.__THEME__='maple';"); await p.evaluateOnNewDocument(mock);
await p.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle0' });
console.log('maple 360 bar overflow:', await p.$eval('.bar', (b) => b.scrollWidth > b.clientWidth + 1));
await browser.close();
