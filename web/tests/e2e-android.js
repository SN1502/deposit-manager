// End-to-end test of the app running with a simulated Android bridge.
// Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/e2e-android.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const APP = 'file://' + path.resolve(__dirname, '..', 'dist', 'DepositManager.html');
const OUT = path.join(__dirname, 'out');
const FAMILY = fs.readFileSync(path.join(__dirname, 'fixtures', 'family-16-columns.xlsx')).toString('base64');

const MOCK = `
(() => {
  const persisted = JSON.parse(localStorage.getItem('mock.persist') || '{}');
  const m = window.__mock = Object.assign({ files: {}, linked: null, linkedBytes: null, writes: 0, reminders: null,
    notifications: [], secure: false, shared: [], nextOpen: null, bioOk: false, launch: '', notif: false }, persisted);
  const keep = () => localStorage.setItem('mock.persist', JSON.stringify({ files: m.files, linked: m.linked, linkedBytes: m.linkedBytes, notif: m.notif }));
  const cb = (id, obj) => setTimeout(() => window.DMNativeCallback(id, JSON.stringify(obj)), 15);
  window.AndroidBridge = {
    getInfo: () => JSON.stringify({ version: '1.0.0', sdk: 34, biometric: true }),
    loadFile: k => m.files[k] || '',
    saveFile: (k, s) => { m.files[k] = s; keep(); return 'ok'; },
    deleteFile: k => { delete m.files[k]; keep(); },
    getLinkedFile: () => m.linked ? JSON.stringify(m.linked) : '',
    openExcel: id => cb(id, m.nextOpen ? { ok: true, name: 'family.xlsx', uri: 'content://docs/family.xlsx', base64: m.nextOpen } : { ok: false, cancelled: true }),
    linkFile: (uri, name) => { m.linked = { uri, name }; keep(); return JSON.stringify({ ok: true }); },
    createExcel: (id, name, b64) => { m.linked = { uri: 'content://docs/' + name, name }; m.linkedBytes = b64; keep(); cb(id, { ok: true, name }); },
    writeLinked: b64 => { m.linkedBytes = b64; m.writes++; keep(); return JSON.stringify({ ok: true }); },
    readLinked: () => JSON.stringify(m.linkedBytes ? { ok: true, base64: m.linkedBytes } : { ok: false }),
    unlinkFile: () => { m.linked = null; keep(); },
    saveCopy: (id, name, mime, b64) => { m.saved = { name, b64 }; cb(id, { ok: true, name }); },
    shareFile: (name, mime, b64) => { m.shared.push(name); return JSON.stringify({ ok: true }); },
    setReminders: json => { m.reminders = JSON.parse(json); },
    notificationStatus: () => JSON.stringify({ granted: m.notif }),
    requestNotificationPermission: id => { m.notif = true; keep(); cb(id, { granted: true }); },
    showNotification: (t, b, tag) => m.notifications.push(t),
    authenticate: (id, title) => cb(id, { ok: m.bioOk }),
    setSecureScreen: on => { m.secure = on; },
    exitApp: () => { m.exited = true; },
    consumeLaunchTarget: () => { const t = m.launch; m.launch = ''; return t; },
    setSystemBars: () => {}
  };
})();`;

const fails = [];
function check(cond, msg) { if (!cond) { fails.push(msg); console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(MOCK);
  // The expected dates below are for 26 Sep 2026; fix the clock there so the tests pass on any day.
  await ctx.clock.setFixedTime(new Date('2026-09-26T10:00:00+05:30'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  const shot = async (name) => page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
  const mock = () => page.evaluate(() => window.__mock);
  const app = (fn, arg) => page.evaluate(fn, arg);
  const settle = (ms) => page.waitForTimeout(ms || 350);

  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await settle(600);
  check((await page.evaluate(() => DM.app.today)) === '2026-09-26', 'test runs on 26 Sep 2026 (the dates below depend on it)');

  console.log('1. Import the family 16-column workbook');
  await page.evaluate(b64 => { window.__mock.nextOpen = b64; }, FAMILY);
  await page.click('text=Open my Excel file');
  await page.waitForSelector('.sheet h3');
  await settle();
  await shot('c01-import-preview');
  const sheetText = await page.locator('.sheet').innerText();
  check(/20\s*family members/.test(sheetText) && /20\s*deposits/.test(sheetText), 'preview: 20 family members and 20 deposits');
  check(/20 family members created from the Depositer Name column/.test(sheetText), 'preview explains members come from Depositer Name');
  check(/2 interest payments are already due or on closed deposits/.test(sheetText), 'asks about the 2 closed deposits\' interest');
  check(await page.locator('.sheet input[type=checkbox]').isChecked(), 'keeps saving into the same file (it has no other sheets)');
  await page.click('.sheet .sheet-actions .btn.primary');
  await page.waitForSelector('.dialog h3:has-text("Get payment reminders?")', { timeout: 4000 }).catch(() => {});
  check(await page.locator('.dialog h3:has-text("Get payment reminders?")').count() === 1, 'asks once to allow reminders');
  await page.click('.dialog .btn.primary');
  await settle(1500);
  let mk = await mock();
  check(mk.linked && mk.linked.name === 'family.xlsx', 'the opened file became the linked Excel file');
  check(mk.writes >= 1, 'app saved into the linked file');
  const wb = await page.evaluate(async () => {
    const book = await DM.xlsx.read(DM.util.base64ToBytes(window.__mock.linkedBytes));
    const dep = book.sheets[0];
    return { names: book.sheets.map(s => s.name), header: dep.rows[0].map(c => c && c.v), row1: dep.rows[1].map(c => c ? (c.date || c.v) : null), rows: dep.rows.length - 1 };
  });
  check(wb.names.join() === 'Deposits,FamilyMembers,Payments,Notifications', 'workbook sheets: ' + wb.names.join(', '));
  check(wb.header.join('|') === 'S.No|Bank Name|Deposit No|Depositer Name|Interest type|percentage|Deposit Value|Deposit Date|No of Days|Mature Date|Deposit position|monthly Renewal Date|Income Date|Amount of Intersest|Deposited Village|Remarks',
    'Deposits sheet keeps the family\'s 16 headings');
  check(wb.row1.join('|') === '1|SBI|SBI001245|Arun Kumar|Simple|7.1|50000|2026-01-15|365|2027-01-15|Active|2026-10-15|2027-01-15|3550|Mudichur|Regular deposit', 'row 1 written back unchanged');
  await shot('c02-home');
  const home = await page.locator('#main').innerText();
  check(/3 deposits maturing soon/.test(home), 'dashboard: 3 deposits maturing soon');
  check(/Expected interest income/i.test(home) && /Cumulative/.test(home), 'dashboard: interest by type');

  console.log('2. Mark the 12 Oct interest received');
  await page.locator('.item:has-text("Vijay Anand") .recv-btn').first().click();
  await page.waitForSelector('.sheet h3:has-text("Mark interest as received")');
  check(/S\.No 7/.test(await page.locator('.sheet .sub').innerText()), 'sheet names S.No 7');
  const w0 = (await mock()).writes;
  await page.click('.sheet .btn.ok');
  await settle(1400);
  check(/Interest received/.test(await page.locator('.toast').innerText().catch(() => '')), 'toast confirms');
  check((await mock()).writes > w0, 'change autosaved into Excel');

  console.log('3. Screens');
  await page.click('.tab:has-text("Deposits")'); await settle(); await shot('c03-deposits');
  check(await page.locator('#main .item').count() === 18, '18 open deposits listed');
  check(await page.locator('#main .chip:has-text("Maturing Soon")').count() === 3, 'Maturing Soon chips on 3 deposits');
  await page.click('.seg button:has-text("Closed")'); await settle(); await shot('c04-closed');
  check(await page.locator('#main .item').count() === 2, '2 closed deposits');
  await page.click('.seg button:has-text("Active")'); await settle();
  await page.locator('.item:has-text("Arun Kumar")').first().click(); await settle(); await shot('c05-details');
  const det = await page.locator('#main').innerText();
  check(/S\.No 1 · Active/.test(det) && /XXXX1245/.test(det) && !/SBI001245/.test(det), 'details: S.No, position, masked Deposit No');
  check(/Monthly Renewal Date\s*15 Oct 2026/.test(det) && /Amount of Interest\s*₹3,550/.test(det) && /365 \(1 year\)/.test(det), 'details show the 16 columns');
  check(/Amount at maturity\s*₹53,550/.test(det), 'amount at maturity = value + interest');
  await page.click('.hero-card .acct button'); await settle(300);
  check(/SBI001245/.test(await page.locator('.hero-card').innerText()), 'Show reveals the full Deposit No (no lock set)');
  await page.click('.tab:has-text("Payments")'); await settle();
  await page.click('.fchip:has-text("30 days")'); await settle(); await shot('c06-payments');
  const pay = await page.locator('#main').innerText();
  check(/MONTHLY RENEWAL DATES/i.test(pay), 'Payments shows monthly renewal dates');
  await page.click('.seg button:has-text("History")'); await settle(); await shot('c07-history');
  check(/Vijay Anand/.test(await page.locator('#main').innerText()), 'history lists the received interest');
  await page.click('.tab:has-text("Home")'); await settle();
  await page.click('.stat:has-text("Maturing soon")'); await settle(); await shot('c08-maturing-soon');
  check(await page.locator('#main .item').count() === 3, 'Maturing Soon filter lists S.No 7, 9 and 19');
  await page.click('.tab:has-text("Settings")'); await settle(); await shot('c09-settings');

  console.log('4. Add a deposit');
  await page.click('.tab:has-text("Deposits")'); await settle();
  await page.click('.fab'); await settle();
  await page.selectOption('#main select', { label: 'Lakshmi — Tambaram' });
  await page.fill('input[placeholder^="e.g. SBI, Indian"]', 'Post Office');
  await page.fill('input[placeholder="e.g. SBI001245"]', 'PO556677');
  await page.click('.freq-pick button:has-text("Cumulative")');
  await page.locator('.input-wrap.has-prefix input').first().fill('1,00,000');
  await page.fill('input[placeholder="e.g. 7.1"]', '7.5');
  await page.locator('input[type=date]').first().fill('2026-09-26');
  await page.click('.quick button:has-text("730")');
  await settle(300);
  const matVal = await page.locator('input[type=date]').nth(1).inputValue();
  check(matVal === '2028-09-25', 'No of Days 730 fills the Mature Date (' + matVal + ')');
  const sug = await page.locator('.quick button:has-text("Use ₹")').innerText().catch(() => '');
  check(/₹15,000/.test(sug), 'interest suggestion ₹15,000 (1,00,000 × 7.5% × 24 months ÷ 12): ' + sug);
  await shot('c10-form');
  await page.click('.sticky-actions .btn.primary');
  await settle(800);
  const nd = await app(() => DM.model.deposit(DM.app.data, '21'));
  check(nd && nd.interestType === 'Cumulative' && nd.days === 730 && nd.interestAmount === 15000 && nd.incomeDate === '2028-09-25', 'saved as S.No 21 with calculated interest');

  console.log('5. Renew a maturing deposit');
  await page.click('.tab:has-text("Deposits")'); await settle();
  await page.locator('.item:has-text("Mohan Raj")').first().click(); await settle();
  await page.click('button:has-text("Renew at maturity")'); await settle();
  await shot('c11-renew-form');
  check(/Renewing S\.No 9/.test(await page.locator('#main').innerText()), 'renew form explains what happens');
  await page.click('.sticky-actions .btn.primary'); await settle(800);
  const rn = await app(() => ({ old: DM.model.deposit(DM.app.data, '9'), nu: DM.model.deposit(DM.app.data, '22') }));
  check(rn.old.status === 'Closed' && /Renewed as S\.No 22/.test(rn.old.notes), 'S.No 9 closed and linked to its renewal');
  check(rn.nu && rn.nu.startDate === '2026-10-15' && rn.nu.days === 270 && rn.nu.depositAmount === 90000, 'renewal starts on the old mature date with the same term');

  console.log('6. Close early keeps the date in Remarks');
  await page.click('.tab:has-text("Deposits")'); await settle();
  await page.locator('.item:has-text("Prakash")').first().click(); await settle();
  await page.click('button:has-text("Close deposit")'); await settle();
  check(/Closed early on/.test(await page.locator('.sheet').innerText()), 'close sheet mentions the Remarks note');
  await page.click('.sheet .sheet-actions .btn.primary'); await settle(600);
  check(/Closed early on 26-09-2026/.test(await app(() => DM.model.deposit(DM.app.data, '15').notes)), 'Remarks: Closed early on 26-09-2026');

  console.log('7. Outside edit of the Excel file is noticed');
  await settle(1500);
  await page.evaluate(b64 => { window.__mock.linkedBytes = b64; }, FAMILY);
  await page.evaluate(() => window.DMNativeEvent('resume'));
  await page.waitForSelector('.dialog h3:has-text("Excel file was changed")', { timeout: 3000 }).catch(() => {});
  check(await page.locator('.dialog h3:has-text("Excel file was changed")').count() === 1, 'dialog asks whether to load outside changes');
  await page.click('.dialog .btn:has-text("Keep app data")'); await settle(1200);

  console.log('8. PIN lock + fingerprint');
  await page.click('.tab:has-text("Settings")'); await settle();
  await page.locator('.switch-row:has-text("App lock") .switch input').click({ force: true });
  await page.waitForSelector('.sheet .keypad');
  for (const k of '1234') await page.click(`.sheet .keypad button[aria-label="${k}"]`);
  await page.click('.sheet .keypad button[aria-label="OK"]');
  await settle(200);
  for (const k of '1234') await page.click(`.sheet .keypad button[aria-label="${k}"]`);
  await page.waitForSelector('.dialog h3:has-text("fingerprint")', { timeout: 5000 });
  await page.click('.dialog .btn.primary'); await settle(400);
  await page.reload(); await settle(900);
  check(await page.locator('.lock').count() === 1, 'app opens locked after restart');
  for (const k of '1234') await page.click(`.lock .keypad button[aria-label="${k}"]`);
  await settle(1400);
  check(await page.locator('.lock').count() === 0, 'correct PIN unlocks');
  check((await app(() => DM.app.data.deposits.length)) === 22, 'all 22 deposits still there after restart');

  console.log('9. Dark theme');
  await page.click('.tab:has-text("Settings")'); await settle();
  await page.click('.seg button:has-text("Dark")'); await settle();
  await page.click('.tab:has-text("Home")'); await settle(); await shot('c12-home-dark');
  await page.click('.tab:has-text("Settings")'); await settle();
  await page.click('.seg button:has-text("Light")'); await settle();

  check(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails.length ? '\nFAILED: ' + fails.length : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
