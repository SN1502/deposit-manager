const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto('file://' + path.resolve('dist/DepositManager.html'));
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'tests/out/01-welcome.png', fullPage: true });
  console.log('title:', await p.title());
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await b.close();
})();
