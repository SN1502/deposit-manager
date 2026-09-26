// End-to-end test in a plain phone browser (no Android bridge, no file-system access API).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const APP = 'file://' + path.resolve(__dirname, '..', 'dist', 'DepositManager.html');
const OUT = path.join(__dirname, 'out');
const fails = [];
function check(c, m) { if (!c) { fails.push(m); console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true, locale: 'en-IN' });
  await ctx.addInitScript(() => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const settle = ms => page.waitForTimeout(ms || 350);
  const shot = n => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });

  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await settle(500);
  check(await page.evaluate(() => DM.platform.kind) === 'basic', 'runs in basic browser mode');

  console.log('1. Start empty and add members');
  await page.click('text=Start with an empty book');
  await page.waitForSelector('.sheet h3:has-text("Add family member")');
  await page.click('.sheet .btn.primary');
  check(/Please enter a name/.test(await page.locator('.sheet').innerText()), 'name is required');
  await page.fill('.sheet input[placeholder="Full name"]', 'Kamala');
  await page.fill('.sheet input[placeholder="Village or town"]', 'Vandalur');
  await page.fill('.sheet input[placeholder="Mobile number"]', '98-4001-2345');
  await page.click('.sheet .btn.primary');
  await settle();
  await page.click('.fab');
  await page.fill('.sheet input[placeholder="Full name"]', 'Kamala');
  await page.fill('.sheet input[placeholder="Village or town"]', 'vandalur');
  await page.click('.sheet .btn.primary');
  check(/already exists/.test(await page.locator('.sheet').innerText()), 'duplicate member (same name + village) blocked');
  await page.fill('.sheet input[placeholder="Full name"]', 'Suresh');
  await page.click('.sheet .btn.primary');
  await settle();
  check(await page.locator('#main .item').count() === 2, 'two members listed');

  console.log('2. Add deposit — validation, then save');
  await page.click('.tab:has-text("Deposits")'); await settle();
  await page.click('.fab'); await settle();
  await page.click('.sticky-actions .btn.primary');
  await settle();
  const errs = await page.locator('.field.err').count();
  check(errs >= 4, 'empty form shows field errors (' + errs + ')');
  await shot('b01-form-errors');
  await page.selectOption('#main select', { label: 'Kamala — Vandalur' });
  await page.fill('input[placeholder^="e.g. SBI, Indian"]', 'IOB');
  await page.fill('input[placeholder="e.g. SBI001245"]', '1234 5678 9012');
  await page.locator('.input-wrap.has-prefix input').first().fill('2,50,000');
  await page.fill('input[placeholder="e.g. 7.1"]', '7');
  const dates = page.locator('input[type=date]');
  await dates.nth(0).fill('2026-04-10');
  await page.fill('input[placeholder="e.g. 365"]', '180');
  await settle(200);
  check((await dates.nth(1).inputValue()) === '2026-10-07', 'Deposit Date + 180 days fills the Mature Date');
  check((await dates.nth(2).inputValue()) === '2026-10-07', 'Income Date follows the Mature Date');
  check(/position: Maturing Soon/.test(await page.locator('.preview-dates').innerText()), 'live preview shows the position');
  await dates.nth(1).fill('2026-10-10');
  await settle(200);
  check((await page.locator('input[placeholder="e.g. 365"]').inputValue()) === '183', 'changing the Mature Date updates No of Days');
  await page.fill('input[placeholder="e.g. 365"]', '180');
  await page.click('.sticky-actions .btn.primary');
  await settle(1600);
  check(await page.locator('.dialog').count() === 0, 'no reminder prompt when the browser has notifications blocked');
  const dep = await page.evaluate(() => DM.app.data.deposits[0]);
  check(dep.id === '1' && dep.depositAmount === 250000 && dep.interestAmount === 8750 && dep.accountNumber === '123456789012' && dep.maturityDate === '2026-10-07',
    'saved as S.No 1: ₹2,50,000 @7% for 180 days → ₹8,750 interest, Deposit No spaces removed');

  console.log('3. Mark received and check status indicator');
  await page.click('.tab:has-text("Payments")'); await settle();
  await page.click('.seg button:has-text("Upcoming")');
  await page.click('.fchip:has-text("90 days")'); await settle();
  await page.locator('.recv-btn').first().click();
  await page.fill('.sheet .input-wrap input', '8700');
  await page.click('.sheet .btn.ok'); await settle(500);
  const p1 = await page.evaluate(() => DM.app.data.payments.find(p => p.status === 'Received'));
  check(p1 && p1.receivedAmount === 8700 && p1.dueDate === '2026-10-07', 'amount actually received recorded against the 7 Oct Income Date');
  check(/Not exported/.test(await page.locator('.save-pill').innerText()), 'status says changes not exported yet');

  console.log('4. Export Excel + template');
  await page.click('.tab:has-text("Settings")'); await settle();
  await shot('b02-settings-basic');
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Export Excel file')]);
  const exp = path.join(OUT, 'export.xlsx'); await dl.saveAs(exp);
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Download blank template')]);
  const tpl = path.join(OUT, 'template-dl.xlsx'); await dl.saveAs(tpl);
  await settle();
  check(/Up to date/.test(await page.locator('.save-pill').innerText()), 'status becomes Up to date after export');
  const py = execSync(`python3 -c "
import openpyxl
wb=openpyxl.load_workbook('${exp}')
d=wb['Deposits']; p=wb['Payments']
print(wb.sheetnames)
print(d['A2'].value, d['C2'].value, d['E2'].value, d['G2'].value, d['I2'].value, d['J2'].value.date(), d['K2'].value, d['N2'].value)
print(p.max_row-1, [c.value for c in p[2]][5:9])
t=openpyxl.load_workbook('${tpl}'); print(t.sheetnames, t['Deposits'].max_row)
"`).toString();
  console.log(py.split('\n').map(l => '     ' + l).join('\n'));
  check(/\['Deposits', 'FamilyMembers', 'Payments', 'Notifications'\]/.test(py), 'exported workbook: Deposits first, then supporting sheets');
  check(/1 123456789012 Simple 250000 180 2026-10-07 Maturing Soon 8750/.test(py), 'exported row in the 16-column layout (text Deposit No, real date, derived position)');
  check(/\[8750, 8700, datetime/.test(py), 'Payments sheet has expected and received interest');
  check(/\['Instructions', 'Deposits', 'FamilyMembers', 'Payments', 'Notifications'\] 1/.test(py), 'template: instructions + empty sheets');
  fs.rmSync(path.join(OUT, 'lo2'), { recursive: true, force: true });
  execSync(`cd ${OUT} && timeout 90 soffice --headless --convert-to pdf --outdir lo2 export.xlsx >/dev/null 2>&1 || true`);
  check(fs.existsSync(path.join(OUT, 'lo2', 'export.pdf')), 'LibreOffice opens and renders the exported workbook');

  console.log('5. Import over existing data, backup and restore');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=Import Excel file')]);
  await fc.setFiles(path.join(__dirname, 'fixtures', 'family-16-columns.xlsx'));
  await page.waitForSelector('.sheet h3:has-text("Import from Excel")');
  check(/This replaces the data in the app/.test(await page.locator('.sheet').innerText()), 'warns that import replaces current data');
  await page.click('.sheet .sheet-actions .btn.primary'); await settle(800);
  check(await page.evaluate(() => DM.app.data.deposits.length) === 20, 'imported the 20 family deposits');
  await page.click('.tab:has-text("Settings")'); await settle();
  await page.click('text=Restore previous data');
  await page.click('.dialog .btn.primary'); await settle(600);
  const back = await page.evaluate(() => DM.app.data.members.map(m => m.name).join(','));
  check(back === 'Kamala,Suresh', 'restore brings back the data from before the import');

  console.log('6. Damaged file is rejected politely');
  const bad = path.join(OUT, 'not-excel.xlsx'); fs.writeFileSync(bad, 'hello this is not a zip');
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=Import Excel file')]);
  await fc2.setFiles(bad);
  await page.waitForSelector('.dialog');
  check(/not an Excel .xlsx workbook/.test(await page.locator('.dialog').innerText()), 'clear message for a non-Excel file');
  await page.click('.dialog .btn'); await settle();

  console.log('7. Data survives a reload; erase all');
  await page.reload(); await settle(600);
  check(await page.evaluate(() => DM.app.data.deposits.length) === 1, 'data kept in the browser across reloads');
  await page.click('.tab:has-text("Settings")'); await settle();
  await page.click('text=Erase all data');
  await page.click('.dialog .btn.danger-solid'); await settle(500);
  check(await page.evaluate(() => DM.app.data.members.length) === 0, 'erase all empties the app');
  await page.click('.tab:has-text("Home")'); await settle();
  await shot('b03-home-empty');
  check(await page.locator('text=Your book is empty').count() === 1, 'empty dashboard offers next steps');

  check(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails.length ? '\nFAILED: ' + fails.length : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
