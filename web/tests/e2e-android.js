// End-to-end test of the app running with a simulated Android bridge.
// Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/e2e-android.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const APP = 'file://' + path.resolve(__dirname, '..', 'dist', 'DepositManager.html');
const OUT = path.join(__dirname, 'out');
const MESSY = fs.readFileSync(path.join(OUT, 'family-messy.xlsx')).toString('base64');

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

  console.log('1. Bulk import from Excel');
  await page.evaluate(b64 => { window.__mock.nextOpen = b64; }, MESSY);
  await page.click('text=Open my Excel file');
  await page.waitForSelector('.sheet h3');
  await settle();
  await shot('a01-import-preview');
  const warnText = await page.locator('.warn-list').innerText();
  check(/Added family member "Selvi"/.test(warnText), 'member only named in Deposits is added (Selvi)');
  check(/weekly/.test(warnText), 'unrecognised frequency "weekly" is reported');
  check(/MyNotes/.test(await page.locator('.sheet').innerText()), 'extra sheet MyNotes is mentioned');
  const linkSwitch = page.locator('.sheet input[type=checkbox]');
  check(!(await linkSwitch.isChecked()), 'linking is off by default when the file has other sheets');
  check(await page.locator('.radio-card.on').count() === 1, 'past-payments question shown with a default');
  await page.click('.sheet .btn.primary');
  await page.waitForSelector('.dialog h3:has-text("Get payment reminders?")', { timeout: 4000 }).catch(() => {});
  check(await page.locator('.dialog h3:has-text("Get payment reminders?")').count() === 1, 'asks once to allow reminders after the first import');
  await page.click('.dialog .btn.primary');
  await settle(600);
  check((await page.evaluate(() => window.__mock.notif)) === true, 'notification permission requested from the phone');
  await shot('a02-home-after-import');

  const d = await app(() => {
    const D = DM.app.data, M = DM.model;
    const dep = id => D.deposits.find(x => x.id === id);
    return {
      members: D.members.map(m => m.id + ':' + m.name + ':' + m.phone),
      d2: dep('D002') || D.deposits.find(x => x.bank === 'Indian Bank Chromepet'),
      d3: dep('D003'), d4: dep('D004'), d6: dep('D006'),
      d1pays: M.paymentsOf(D, 'D001').slice(0, 4).map(p => p.dueDate + ':' + p.status + ':' + p.receivedDate),
      overdue: D.payments.filter(p => p.status === 'Overdue').length,
      d4pays: M.paymentsOf(D, 'D004').map(p => p.status)
    };
  });
  check(d.members.length === 4 && d.members.includes('M004:Ravi Kumar:9840012345'), 'members imported, missing ID assigned, numeric phone kept: ' + d.members.join(', '));
  check(d.d2 && d.d2.depositAmount === 150000 && d.d2.interestRate === 7 && d.d2.firstPaymentDate === '2025-09-05' && d.d2.maturityDate === '2027-08-05',
    'text amounts "1,50,000", "7%" and dd-mm-yyyy dates parsed');
  check(d.d2 && d.d2.accountNumber === '0045678912', 'leading-zero account number kept');
  check(d.d3 && d.d3.interestRate === 7.4 && d.d3.accountNumber === '987654321012', 'percent-formatted 0.074 → 7.4; numeric account → text');
  check(d.d4 && d.d4.status === 'Closed' && d.d4.firstPaymentDate === '2022-09-15', 'closed deposit kept; first payment derived from start + 6 months');
  check(d.d6 && d.d6.frequency === '' , 'bad frequency left blank for fixing');
  check(d.d1pays[0] === '2025-09-20:Received:2025-09-22' && d.d1pays[1] === '2025-12-20:Received:2025-12-20', 'payment history from the sheet kept');
  check(d.d1pays[2].startsWith('2026-03-20:Received:2026-03-20'), 'generated past payments marked received (user choice)');
  check(d.overdue === 0, 'no overdue payments after choosing "already received"');
  check(d.d4pays.length > 0 && d.d4pays.every(s => s === 'Received'), 'closed deposit history generated as received');

  console.log('2. Linking an Excel file');
  let mk = await mock();
  check(!mk.linked, 'file with extra sheets was not overwritten');
  check(await page.locator('text=Changes are not being saved to Excel').count() === 1, 'home warns that changes are not saved to Excel');
  await page.click('text=Choose Excel file');
  await settle(1200);
  mk = await mock();
  check(mk.linked && mk.linked.name === 'DepositManager.xlsx', 'new Excel file created and linked');
  const pill = await page.locator('.save-pill').innerText();
  check(/Saved/.test(pill), 'save indicator shows Saved (' + pill + ')');
  await shot('a03-home-linked');

  console.log('3. Mark a payment received from the dashboard');
  const writesBefore = (await mock()).writes;
  await page.locator('.recv-btn').first().click();
  await page.waitForSelector('.sheet h3:has-text("Mark as received")');
  await shot('a04-receive-sheet');
  await page.click('.sheet .btn.ok');
  await settle(1300);
  const toast = await page.locator('.toast').innerText().catch(() => '');
  check(/Next payment/.test(toast), 'toast tells the next payment date: ' + toast.replace(/\n/g, ' '));
  mk = await mock();
  check(mk.writes > writesBefore, 'change was autosaved into the linked Excel file (' + (mk.writes - writesBefore) + ' writes)');
  // verify the Excel content now has that payment as Received
  const rec = await page.evaluate(async () => {
    const book = await DM.xlsx.read(DM.util.base64ToBytes(window.__mock.linkedBytes));
    return { sheets: book.sheets.map(s => s.name), payments: book.sheets[2].rows.length - 1, notif: book.sheets[3].rows.length - 1 };
  });
  check(rec.sheets.join() === 'FamilyMembers,Deposits,Payments,Notifications', 'linked workbook has the four sheets');
  check(rec.payments > 50, 'Payments sheet filled (' + rec.payments + ' rows)');
  check(rec.notif > 0, 'Notifications sheet filled (' + rec.notif + ' rows)');
  check(mk.reminders && mk.reminders.items.length > 0 && mk.reminders.enabled, 'reminders handed to the phone (' + (mk.reminders && mk.reminders.items.length) + ')');
  check(mk.reminders.items.every(r => !/30012344582|0045678912|987654321012/.test(r.text)), 'reminder texts never contain full account numbers');

  console.log('4. Screens');
  await page.click('.tab:has-text("Deposits")'); await settle(); await shot('a05-deposits-active');
  await page.click('.seg button:has-text("Closed")'); await settle(); await shot('a06-deposits-closed');
  await page.click('.seg button:has-text("Active")'); await settle();
  await page.locator('.item:has-text("SBI Tambaram")').first().click(); await settle(); await shot('a07-deposit-details');
  check(/XXXX4582/.test(await page.locator('.hero-card').innerText()), 'account masked on details page');
  await page.click('.hero-card .acct button'); await settle(300);
  check(/30012344582/.test(await page.locator('.hero-card').innerText()), 'Show reveals full number (no lock set)');
  await page.click('.tab:has-text("Payments")'); await settle(); await shot('a08-payments-upcoming');
  await page.click('.seg button:has-text("History")'); await settle(); await shot('a09-payments-history');
  await page.click('.tab:has-text("Family")'); await settle(); await shot('a10-members');
  await page.locator('.item:has-text("Lakshmi")').first().click(); await settle(); await shot('a11-member-detail');
  await page.click('.tab:has-text("Home")'); await settle();
  await page.click('.appbar [aria-label=Search]'); await settle();
  await page.fill('.search-box input', '4582'); await settle(400); await shot('a12-search');
  check(await page.locator('#main .item:has-text("SBI Tambaram")').count() === 1, 'search by last 4 digits finds the deposit');
  const back1 = await page.evaluate(() => window.DMNativeEvent('back'));
  check(back1 === true, 'Android back handled inside the app');
  await page.click('.tab:has-text("Settings")'); await settle(); await shot('a13-settings');

  console.log('5. Add a deposit with the form');
  await page.click('.tab:has-text("Deposits")'); await settle();
  await page.click('.fab'); await settle();
  await page.selectOption('#main select', { label: 'Meena — Pallavaram' });
  await page.fill('input[placeholder^="e.g. SBI"]', 'Union Bank');
  await page.fill('input[placeholder^="As in the passbook"]', '5566778899001');
  await page.locator('.input-wrap.has-prefix input').first().fill('300000');
  await page.fill('input[placeholder="e.g. 7.25"]', '7.5');
  await page.click('.freq-pick button:has-text("Quarterly")');
  const dates = page.locator('input[type=date]');
  await dates.nth(0).fill('2026-02-01');
  await dates.nth(1).fill('2026-05-01');
  await dates.nth(2).fill('2031-02-01');
  await settle(300);
  await shot('a14-add-deposit-form');
  const suggestion = await page.locator('.quick button:has-text("Use")').innerText().catch(() => '');
  check(/5,625/.test(suggestion), 'payment amount suggestion ₹5,625 (300000 × 7.5% ÷ 4): ' + suggestion);
  check(/2 payment dates before today/.test(await page.locator('#main').innerText()), 'form asks about the 2 past payment dates');
  await page.click('.sticky-actions .btn.primary');
  await settle(900);
  await shot('a15-new-deposit-details');
  const nd = await app(() => { const D = DM.app.data; const x = D.deposits[D.deposits.length - 1]; return { x, pays: DM.model.paymentsOf(D, x.id).map(p => p.dueDate + ':' + p.status) }; });
  check(nd.x.paymentAmount === 5625 && nd.x.accountNumber === '5566778899001', 'deposit saved with calculated payment');
  check(nd.pays[0] === '2026-05-01:Received' && nd.pays[1] === '2026-08-01:Received' && nd.pays[2] === '2026-11-01:Pending', 'schedule generated (' + nd.pays.slice(0, 3).join(', ') + ')');

  console.log('6. Close and keep history');
  await page.click('button:has-text("Close deposit")'); await settle();
  await page.click('.sheet .btn.primary'); await settle(700);
  const closed = await app(() => { const D = DM.app.data; const x = D.deposits[D.deposits.length - 1]; return { s: x.status, pays: DM.model.paymentsOf(D, x.id).map(p => p.status) }; });
  check(closed.s === 'Closed' && closed.pays.filter(s => s === 'Received').length === 2 && !closed.pays.includes('Pending'), 'closing keeps received history, drops future dates');

  console.log('7. Outside edit of the Excel file is noticed');
  await settle(1500);
  await page.evaluate(b64 => { window.__mock.linkedBytes = b64; }, MESSY);
  await page.evaluate(() => window.DMNativeEvent('resume'));
  await page.waitForSelector('.dialog h3:has-text("Excel file was changed")', { timeout: 3000 }).catch(() => {});
  check(await page.locator('.dialog h3:has-text("Excel file was changed")').count() === 1, 'dialog asks whether to load outside changes');
  await shot('a16-external-change');
  await page.click('.dialog .btn:has-text("Keep app data")'); await settle(1200);
  const restored = await page.evaluate(async () => (await DM.xlsx.read(DM.util.base64ToBytes(window.__mock.linkedBytes))).sheets.length);
  check(restored === 4, 'choosing "Keep app data" rewrites the file from the app');

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
  const lock = await app(() => DM.app.prefs.lock);
  check(lock.enabled && lock.length === 4 && lock.biometric && lock.algo === 'pbkdf2' && lock.hash.length === 64 && !JSON.stringify(lock).includes('1234'), 'PIN stored only as a salted PBKDF2 hash');
  await page.reload(); await settle(900);
  check(await page.locator('.lock').count() === 1, 'app opens locked after restart');
  await shot('a17-lock');
  for (const k of '1111') await page.click(`.lock .keypad button[aria-label="${k}"]`);
  await settle(1200);
  check(/Wrong PIN/.test(await page.locator('.lock').innerText()), 'wrong PIN rejected');
  for (const k of '1234') await page.click(`.lock .keypad button[aria-label="${k}"]`);
  await settle(1400);
  check(await page.locator('.lock').count() === 0, 'correct PIN unlocks');
  await page.evaluate(() => { window.__mock.bioOk = true; });
  await page.click('.tab:has-text("Deposits")'); await settle();
  await page.locator('.item:has-text("SBI Tambaram")').first().click(); await settle();
  await page.click('.hero-card .acct button'); await settle(500);
  check(/30012344582/.test(await page.locator('.hero-card').innerText()), 'with lock on, fingerprint confirms before revealing the account number');

  console.log('9. Dark theme');
  await page.click('.tab:has-text("Settings")'); await settle();
  await page.click('.seg button:has-text("Dark")'); await settle();
  await page.click('.tab:has-text("Home")'); await settle(); await shot('a18-home-dark');
  await page.click('.tab:has-text("Settings")'); await settle();
  await page.click('.seg button:has-text("Light")'); await settle();

  check(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails.length ? '\nFAILED: ' + fails.length : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
