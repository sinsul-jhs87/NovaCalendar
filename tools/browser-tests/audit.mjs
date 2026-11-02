import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const THEMES = (process.argv[2] || '').split(',');
const mock = fs.readFileSync('./mock.js', 'utf8');
const data = fs.readFileSync('./preview_data.js', 'utf8');
const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
fs.mkdirSync('audit', { recursive: true });
const meta = [];
const errors = {};

const collect = () => {
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const t = n.textContent.trim();
    if (!t) continue;
    const p = n.parentElement;
    if (!p || p.closest('[hidden]') || p.closest('script,style,option')) continue;
    const ovEl = document.getElementById('dayov');
    if (ovEl && !ovEl.hidden && !p.closest('#dayview')) continue;   // 팝업이 열려 있으면 팝업 카드 안의 글자만 잰다(뒤의 달력은 어둡게 가려져 있음)
    const cs = getComputedStyle(p);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let op = 1; for (let e = p; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    if (op < 0.9) continue;                       // 일부러 흐리게 둔 글자(다른 달 날짜 등)
    const box = p.closest('.events');
    const sc = p.closest('.tl-scroll');
    const r = document.createRange(); r.selectNodeContents(n);
    const clip = cs.overflow !== 'visible' ? p.getBoundingClientRect() : null;   // 줄임표로 잘리는 글자는 요소 영역까지만
    for (const raw of r.getClientRects()) {
      const rc = clip ? { left: Math.max(raw.left, clip.left), right: Math.min(raw.right, clip.right), top: raw.top, bottom: raw.bottom, width: Math.min(raw.right, clip.right) - Math.max(raw.left, clip.left), height: raw.height } : raw;
      if (rc.width < 2 || rc.height < 2 || rc.right < 0 || rc.bottom < 0 || rc.left > innerWidth || rc.top > innerHeight) continue;
      if (sc) { const b = sc.getBoundingClientRect(); if (rc.top < b.top || rc.bottom > b.bottom) continue; }
      if (box) { const b = box.getBoundingClientRect(); if (rc.bottom > b.bottom - 1) continue; if (box.classList.contains('more') && rc.bottom > b.bottom - 24) continue; if (box.classList.contains('scrolled') && rc.top < b.top + 10) continue; }
      out.push({ x: rc.left, y: rc.top, w: rc.width, h: rc.height, color: cs.color, size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight), text: t.slice(0, 16), cls: (p.className || '') + '|' + (p.parentElement?.className || '') });
    }
  }
  return out;
};

async function capture(name, path, w, h, theme, { bg = null, view = 'month', alpha = 0.85, full = false, action = null } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(`window.__THEME__='${theme}';window.__VIEW__='${view}';window.__ALPHA__=${alpha};`);
  await page.evaluateOnNewDocument(mock);
  await page.evaluateOnNewDocument(data);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('http://127.0.0.1:8765/' + path, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 300));
  if (bg) await page.addStyleTag({ content: `html{background:${bg}!important}` });
  if (action) await action(page);
  const rects = await page.evaluate(collect);
  await page.screenshot({ path: `audit/${name}_text.png`, fullPage: full });
  await page.addStyleTag({ content: '*{transition:none!important;animation:none!important;color:transparent!important;caret-color:transparent!important}' });
  await new Promise((r) => setTimeout(r, 250));
  await page.screenshot({ path: `audit/${name}_bg.png`, fullPage: full });
  meta.push({ name, theme, rects });
  (errors[theme] ||= []).push(...errs);
  await page.close();
}

const openOverlay = async (page) => {
  const [cx, cy] = await page.$eval('.cell[data-key="2026-10-14"]', (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up();
  await new Promise((r) => setTimeout(r, 800));
};
const openEditor = async (page) => {
  await openOverlay(page);
  await page.evaluate(() => [...document.querySelectorAll('.dvcard .btn.primary')].find((b) => b.textContent.includes('일정 추가')).click());
  await new Promise((r) => setTimeout(r, 300));
};
for (const t of THEMES) {
  if (process.env.ONLYOV) {
    await capture(`${t}_overlay_white`, 'index.html', 680, 580, t, { bg: '#ffffff', action: openOverlay });
    await capture(`${t}_editor_black`, 'index.html', 680, 580, t, { bg: '#000000', action: openEditor });
    continue;
  }
  await capture(`${t}_month_white`, 'index.html', 680, 580, t, { bg: '#ffffff' });
  await capture(`${t}_month_black`, 'index.html', 680, 580, t, { bg: '#000000' });
  if (!process.env.FAST) {
  await capture(`${t}_detail`, 'detail.html?date=' + new Date().toISOString().slice(0, 10), 440, 580, t);
  }
}
fs.writeFileSync(`audit/meta_${THEMES.join('_')}.json`, JSON.stringify(meta));
console.log(JSON.stringify(Object.fromEntries(Object.entries(errors).filter(([, v]) => v.length)), null, 1) || '{}');
console.log('captured', meta.length);
await browser.close();
