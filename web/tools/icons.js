// Renders the app logo to the PNG launcher icons Android 7 (API 24/25) needs.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'); const fs = require('fs');
const RES = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
const LOGO = `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
<rect width="96" height="96" rx="RX" fill="#0F5C5A"/>
<path d="M20 38 48 22l28 16" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M26 42v26M38 42v26M58 42v26M70 42v26" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
<path d="M20 74h56" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
<circle cx="48" cy="55" r="12" fill="#F2B84B"/>
<path d="M43 49.5h10M43 53h10M43 49.5h3a3.8 3.8 0 0 1 0 7.5h-3l6.5 5" fill="none" stroke="#0F5C5A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  for (const [d, px] of Object.entries(SIZES)) {
    fs.mkdirSync(path.join(RES, 'mipmap-' + d), { recursive: true });
    for (const [name, rx] of [['ic_launcher', 22], ['ic_launcher_round', 48]]) {
      const inset = Math.round(px * 0.04);
      await p.setViewportSize({ width: px, height: px });
      await p.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${px}px;height:${px}px;padding:${inset}px;box-sizing:border-box">${LOGO.replace('RX', rx)}</div></body></html>`);
      await p.screenshot({ path: path.join(RES, 'mipmap-' + d, name + '.png'), omitBackground: true });
    }
  }
  await p.setViewportSize({ width: 512, height: 512 });
  await p.setContent(`<html><body style="margin:0">${LOGO.replace('RX', 110 / 5.33)}</body></html>`);
  await p.screenshot({ path: path.join(__dirname, '..', 'dist', 'icon-512.png') });
  await b.close();
  console.log('icons written');
})();
