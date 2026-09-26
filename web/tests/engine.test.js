// Engine tests: schedule generation, statuses, reminders, stats, Excel write/read round trip.
// Run: node tests/engine.test.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '..', 'src', 'js');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('PAGE ERROR', e));
  await page.setContent('<!doctype html><html><body></body></html>');
  for (const f of ['vendor-jszip.min.js', 'core.js', 'xlsx.js', 'data.js']) {
    await page.addScriptTag({ path: path.join(SRC, f) });
  }

  const result = await page.evaluate(async () => {
    const U = DM.util, M = DM.model, fails = [], log = [];
    const eq = (a, b, msg) => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) fails.push(msg + '\n   got ' + A + '\n   exp ' + B); };
    const ok = (c, msg) => { if (!c) fails.push(msg); };

    // --- date helpers
    eq(U.addMonths('2026-01-31', 1, 31), '2026-02-28', 'month-end clamp');
    eq(U.addMonths('2026-01-31', 2, 31), '2026-03-31', 'anchor restored');
    eq(U.addMonths('2026-09-20', 3), '2026-12-20', 'quarter');
    eq(U.addMonths('2026-11-20', 3), '2027-02-20', 'year wrap');
    eq(U.parseFlexibleDate('20-09-2026'), '2026-09-20', 'dd-mm-yyyy');
    eq(U.parseFlexibleDate('20/9/26'), '2026-09-20', 'dd/m/yy');
    eq(U.parseFlexibleDate('20-Sep-2026'), '2026-09-20', 'dd-mmm-yyyy');
    eq(U.parseFlexibleDate('20 September 2026'), '2026-09-20', 'long month');
    eq(U.parseFlexibleDate('Sep 20, 2026'), '2026-09-20', 'us style');
    eq(U.parseFlexibleDate('2026-09-20'), '2026-09-20', 'iso');
    eq(U.parseFlexibleDate('31-02-2026'), null, 'invalid date rejected');
    eq(U.toNumber('₹ 1,00,000.50'), 100000.5, 'indian number');
    eq(U.toNumber('7.5%'), 7.5, 'percent');
    eq(U.fmtMoney(100000), '₹1,00,000', 'money format');
    eq(U.fmtMoney(1812.5), '₹1,812.50', 'money decimals');
    eq(U.maskAccount('30012344582'), 'XXXX4582', 'mask');
    eq(M.parseFrequency('Half yearly'), 'Half-Yearly', 'freq hy');
    eq(M.parseFrequency('qtrly'), 'Quarterly', 'freq q');
    eq(M.parseFrequency('Annual'), 'Annually', 'freq a');

    // --- schedule examples from the spec
    const today = '2026-09-26';
    const mk = (freq, first, maturity) => ({ id: 'X', frequency: freq, firstPaymentDate: first, maturityDate: maturity || '', status: 'Active' });
    eq(M.dueDates(mk('Monthly', '2026-09-20'), today).slice(0, 3), ['2026-09-20', '2026-10-20', '2026-11-20'], 'monthly example');
    eq(M.dueDates(mk('Quarterly', '2026-09-20'), today).slice(0, 3), ['2026-09-20', '2026-12-20', '2027-03-20'], 'quarterly example');
    eq(M.dueDates(mk('Half-Yearly', '2026-09-20'), today).slice(0, 2), ['2026-09-20', '2027-03-20'], 'half-yearly example');
    eq(M.dueDates(mk('Annually', '2026-09-20'), today).slice(0, 2), ['2026-09-20', '2027-09-20'], 'annual example');
    eq(M.dueDates(mk('Quarterly', '2026-09-20', '2027-03-20'), today), ['2026-09-20', '2026-12-20', '2027-03-20'], 'stops at maturity (inclusive)');
    eq(M.totalPayments(mk('Monthly', '2026-10-01', '2031-09-01')), 60, '5-year monthly count');
    eq(M.dueDates(mk('Monthly', '2026-10-01'), today).length, 12, 'rolling 12-month horizon without maturity');

    // --- full flow
    const data = M.emptyData();
    const m1 = M.saveMember(data, { name: 'Lakshmi', village: 'Tambaram', phone: '9876543210' });
    const m2 = M.saveMember(data, { name: 'Ravi', village: 'Chromepet', phone: '' });
    eq([m1.id, m2.id], ['M001', 'M002'], 'member ids');
    ok(Object.keys(M.validateMember(data, { name: 'lakshmi', village: 'TAMBARAM' })).length === 1, 'duplicate member rejected');

    const f1 = { memberId: 'M001', bank: 'SBI Tambaram', accountNumber: '30012344582', depositAmount: '100000', interestRate: '7.25',
      paymentAmount: '', frequency: 'Quarterly', startDate: '2026-03-20', firstPaymentDate: '2026-06-20', maturityDate: '2028-03-20', notes: '' };
    eq(M.validateDeposit(f1), {}, 'valid deposit');
    eq(M.countPastDue(data, f1, today), 2, 'past dues before today (Jun + Sep)');
    const r1 = M.saveDeposit(data, f1, { today, pastAs: 'received' });
    eq(r1.deposit.id, 'D001', 'deposit id');
    eq(r1.deposit.paymentAmount, 1812.5, 'payment auto-calculated 100000*7.25%/4');
    eq(r1.autoReceived, 2, 'two past payments auto-received');
    const ps1 = M.paymentsOf(data, 'D001').map(p => p.dueDate + ':' + p.status);
    eq(ps1, ['2026-06-20:Received', '2026-09-20:Received', '2026-12-20:Pending', '2027-03-20:Pending', '2027-06-20:Pending',
      '2027-09-20:Pending'], 'rolling schedule rows (12 months ahead)');

    const f2 = { memberId: 'M002', bank: 'Indian Bank', accountNumber: '0045678912', depositAmount: '50000', interestRate: '7',
      paymentAmount: '291.67', frequency: 'Monthly', startDate: '2026-08-05', firstPaymentDate: '2026-09-05', maturityDate: '2027-02-05', notes: 'Joint with wife' };
    M.saveDeposit(data, f2, { today, pastAs: 'pending' });
    const d2 = M.paymentsOf(data, 'D002');
    eq(d2.map(p => p.status), ['Overdue', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending'], 'monthly with overdue first');
    eq(M.nextPayment(data, 'D002', today).dueDate, '2026-10-05', 'next payment');

    // mark received -> next date
    const nxt = M.markReceived(data, d2[0].id, { amount: '291.67', date: '2026-09-25' }, today);
    eq(nxt.dueDate, '2026-10-05', 'next after receiving');
    eq(M.payment(data, d2[0].id).status, 'Received', 'marked received');
    M.markNotReceived(data, d2[0].id, today);
    eq(M.payment(data, d2[0].id).status, 'Overdue', 'undo receive -> overdue again');
    M.markReceived(data, d2[0].id, {}, today);

    // edit schedule: change frequency -> unreceived rows replaced, received kept
    const f1b = Object.assign({}, f1, { id: 'D001', frequency: 'Half-Yearly', paymentAmount: '3625' });
    M.saveDeposit(data, f1b, { today });
    eq(M.paymentsOf(data, 'D001').map(p => p.dueDate + ':' + p.status + ':' + p.expectedAmount),
      ['2026-06-20:Received:1812.5', '2026-09-20:Received:1812.5', '2026-12-20:Pending:3625', '2027-06-20:Pending:3625'],
      'reschedule keeps received history, replaces pending');

    // stats
    const st = M.computeStats(data, today);
    eq([st.members, st.active, st.closed, st.principal], [2, 2, 0, 150000], 'stats basics');
    eq(st.byFrequency.find(b => b.frequency === 'Monthly').yearly, 3500.04, 'monthly yearly income');
    eq(st.byFrequency.find(b => b.frequency === 'Half-Yearly').yearly, 7250, 'half-yearly yearly income');
    eq(st.upcoming30, { count: 1, amount: 291.67 }, 'upcoming 30 days');

    // reminders
    const rem = M.buildReminders(data, M.DEFAULT_PREFS, today, 60);
    const oct5 = rem.filter(r => r.eventDate === '2026-10-05').map(r => r.notifyOn + '/' + r.daysBefore);
    eq(oct5, ['2026-09-28/7', '2026-10-02/3', '2026-10-04/1', '2026-10-05/0'], 'payment reminders 7/3/1/0');
    ok(rem.every(r => r.message.indexOf('0045678912') < 0 && r.message.indexOf('30012344582') < 0), 'reminders never show full account numbers');
    const mat = M.buildReminders(data, M.DEFAULT_PREFS, '2027-01-01', 60).filter(r => r.type === 'Maturity').map(r => r.notifyOn + '/' + r.daysBefore);
    eq(mat, ['2027-01-06/30', '2027-01-29/7', '2027-02-04/1', '2027-02-05/0'], 'maturity reminders');

    // close keeps history, drops future unpaid
    const cl = M.closeDeposit(data, 'D002', '2026-10-10', today);
    eq(M.paymentsOf(data, 'D002').map(p => p.dueDate + ':' + p.status), ['2026-09-05:Received', '2026-10-05:Pending'], 'close keeps history & due before close');
    eq(M.computeStats(data, today).closed, 1, 'closed count');
    ok(!M.canDeleteDeposit(data, 'D002'), 'cannot delete deposit with received payments');
    M.reopenDeposit(data, 'D002', today);
    eq(M.paymentsOf(data, 'D002').length, 6, 'reopen regenerates');
    M.closeDeposit(data, 'D002', '2026-10-10', today);

    // search
    eq(M.searchDeposits(data, { q: '4582' }).map(d => d.id), ['D001'], 'search by last digits');
    eq(M.searchDeposits(data, { q: 'ravi' }).map(d => d.id), ['D002'], 'search by name');
    eq(M.searchDeposits(data, { status: 'Active' }).map(d => d.id), ['D001'], 'filter status');

    // --- Excel round trip
    const sheets = M.workbookSheets(data, M.DEFAULT_PREFS, today);
    const bytes = await DM.xlsx.write(sheets);
    window.__xlsx = U.bytesToBase64(bytes);
    const book = await DM.xlsx.read(bytes);
    eq(book.sheets.map(s => s.name), ['FamilyMembers', 'Deposits', 'Payments', 'Notifications'], 'sheet names');
    const prep = M.prepareImport(book, today);
    eq(prep.errors, [], 'no import errors');
    eq(prep.warnings, [], 'no import warnings on own file');
    eq(prep.pastCount, 0, 'nothing new in the past');
    const fin = M.finalizeImport(prep, 'received', today);
    const strip = d => JSON.stringify({ m: d.members, d: d.deposits, p: d.payments.slice().sort((a, b) => a.id < b.id ? -1 : 1) });
    const orig = M.normalizeData(JSON.parse(JSON.stringify(data)));
    eq(strip(fin.data), strip(orig), 'round trip identical');
    eq(fin.data.deposits[1].accountNumber, '0045678912', 'leading zero kept');

    // template
    const tpl = await DM.xlsx.write(M.workbookSheets(M.emptyData(), M.DEFAULT_PREFS, today, { template: true }));
    window.__tpl = U.bytesToBase64(tpl);
    return { fails, log, xlsx: window.__xlsx, tpl: window.__tpl };
  });

  fs.writeFileSync(path.join(OUT, 'roundtrip.xlsx'), Buffer.from(result.xlsx, 'base64'));
  fs.writeFileSync(path.join(OUT, 'template.xlsx'), Buffer.from(result.tpl, 'base64'));
  await browser.close();
  if (result.fails.length) {
    console.log('FAILED ' + result.fails.length + ':\n - ' + result.fails.join('\n - '));
    process.exit(1);
  }
  console.log('engine tests: all passed');
})();
