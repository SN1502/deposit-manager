// Engine tests for the 16-column deposit model: import of the family's workbook, derived columns,
// income tracking, reminders, stats, renewal, and the Excel round trip.
// Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/engine.test.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '..', 'src', 'js');
const OUT = path.join(__dirname, 'out');
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'family-16-columns.xlsx')).toString('base64');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('PAGE ERROR', e));
  await page.setContent('<!doctype html><html><body></body></html>');
  for (const f of ['vendor-jszip.min.js', 'core.js', 'xlsx.js', 'data.js']) await page.addScriptTag({ path: path.join(SRC, f) });

  const result = await page.evaluate(async (fixtureB64) => {
    const U = DM.util, M = DM.model, fails = [];
    const eq = (a, b, msg) => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) fails.push(msg + '\n   got ' + A + '\n   exp ' + B); };
    const ok = (c, msg) => { if (!c) fails.push(msg); };
    const today = '2026-09-26';

    /* ---------- helpers */
    eq(M.parseInterestType('cumulative'), 'Cumulative', 'interest type cumulative');
    eq(M.parseInterestType('Non-Cumulative'), 'Simple', 'non-cumulative → Simple');
    eq(M.parseDepositStatus('Maturing Soon'), 'Active', 'Maturing Soon is still open');
    eq(M.parseDepositStatus('Closed'), 'Closed', 'Closed');
    eq([180, 270, 365, 730].map(M.tenureMonths), [6, 9, 12, 24], 'tenure months');
    eq(M.suggestInterest(40000, 6.75, 180), 1350, 'interest 180 days like the sheet');
    eq(M.suggestInterest(90000, 7, 270), 4725, 'interest 270 days like the sheet');
    eq(M.suggestInterest(200000, 7, 730), 28000, 'interest 730 days like the sheet');
    eq(M.resolveTerm('2026-06-01', 180, ''), { start: '2026-06-01', days: 180, maturity: '2026-11-28' }, 'days → mature date');
    eq(M.resolveTerm('2026-01-05', '', '2028-01-05').days, 730, 'mature date → days');

    /* ---------- import the family's own workbook */
    const book = await DM.xlsx.read(U.base64ToBytes(fixtureB64));
    const prep = M.prepareImport(book, today);
    eq(prep.errors, [], 'no import errors');
    eq(prep.counts.deposits, 20, '20 deposits read');
    eq(prep.counts.membersAdded, 20, '20 depositers become family members');
    eq(prep.warnings, ['20 family members created from the Depositer Name column.'], 'only an informational note');
    eq(prep.usedSheets, ['Deposit Test Data'], 'deposits found on "Deposit Test Data" by its headings');
    eq(prep.pastCount, 2, 'two income dates already passed (the closed deposits)');
    const fin = M.finalizeImport(prep, 'received', today);
    const data = fin.data;
    const dep = n => data.deposits.find(d => d.id === String(n));
    const d1 = dep(1);
    eq([d1.bank, d1.accountNumber, M.memberName(data, d1.memberId), d1.interestType, d1.interestRate, d1.depositAmount, d1.startDate, d1.days,
      d1.maturityDate, d1.status, d1.incomeDate, d1.interestAmount, d1.village, d1.notes],
      ['SBI', 'SBI001245', 'Arun Kumar', 'Simple', 7.1, 50000, '2026-01-15', 365, '2027-01-15', 'Active', '2027-01-15', 3550, 'Mudichur', 'Regular deposit'],
      'row 1 read exactly');
    eq([dep(4).interestType, dep(6).days, dep(6).maturityDate, dep(6).interestAmount], ['Cumulative', 180, '2026-11-28', 1350], 'rows 4 and 6');
    eq([dep(11).status, dep(11).closedDate, dep(12).status], ['Closed', '2026-09-30', 'Closed'], 'closed deposits closed on their mature date');
    eq(M.paymentsOf(data, '11').map(p => p.status), ['Received'], 'closed deposit interest recorded as received');
    eq(M.paymentsOf(data, '1').map(p => p.dueDate + ':' + p.expectedAmount + ':' + p.status), ['2027-01-15:3550:Pending'], 'one income row on the Income Date');

    /* ---------- derived columns match the sheet */
    const pos = {};
    data.deposits.forEach(d => { pos[d.id] = M.position(d, today); });
    eq(['7', '9', '19'].map(k => pos[k]), ['Maturing Soon', 'Maturing Soon', 'Maturing Soon'], 'Maturing Soon rows as in the sheet');
    eq(['11', '12'].map(k => pos[k]), ['Closed', 'Closed'], 'Closed rows as in the sheet');
    eq(Object.values(pos).filter(p => p === 'Active').length, 15, '15 Active as in the sheet');
    const sheetRenewal = { 1: '2026-10-15', 3: '2026-10-05', 4: '2026-10-20', 5: '2026-10-25', 6: '2026-10-01', 7: '2026-10-12', 8: '2026-10-08',
      10: '2026-10-28', 11: '2026-09-30', 12: '2026-08-15', 13: '2026-10-22', 14: '2026-10-10', 15: '2026-10-05', 16: '2026-10-20',
      17: '2026-10-01', 18: '2026-10-12', 19: '2026-10-25', 20: '2026-10-02' };
    // The sheet looks filled in on ~29 Sep: on that day the rule reproduces every row except 2 and 9.
    const mism = Object.keys(sheetRenewal).filter(k => M.renewalDate(dep(k), '2026-09-29') !== sheetRenewal[k]);
    eq(mism, [], 'monthly Renewal Date matches the sheet for 18 of 20 rows');
    eq([M.renewalDate(dep(2), today), M.renewalDate(dep(9), today)], ['2026-10-10', '2026-10-15'], 'rows 2 and 9: next 10th; capped at the 15 Oct mature date');
    eq(M.renewalDate(dep(10), today), '2026-09-28', 'on 26 Sep the next 28th is 28 Sep');

    /* ---------- stats */
    const st = M.computeStats(data, today);
    eq([st.members, st.active, st.closed], [20, 18, 2], 'stats counts');
    eq(st.principal, 1505000, 'principal of the 18 open deposits');
    eq(st.maturingSoon.map(d => d.id), ['7', '9', '19'], 'maturing soon list');
    eq(st.byType.map(b => b.type + ':' + b.count), ['Simple:12', 'Cumulative:6'], 'by interest type');
    eq(st.upcoming30, { count: 3, amount: 22125 }, 'interest due in the next 30 days (12, 15 and 25 Oct)');

    /* ---------- reminders: maturity and interest on the same day are told together */
    const rem = M.buildReminders(data, M.DEFAULT_PREFS, today, 60);
    const r7 = rem.filter(r => r.depositId === '7').map(r => r.type + '/' + r.daysBefore + '/' + r.notifyOn);
    eq(r7, ['Maturity/7/2026-10-05', 'Interest/3/2026-10-09', 'Maturity/1/2026-10-11', 'Maturity/0/2026-10-12'], 'deposit 7 reminders');
    ok(rem.find(r => r.depositId === '7' && r.daysBefore === 0).message.includes('₹1,50,000 + ₹10,650 interest'), 'maturity message includes the interest');
    ok(rem.every(r => !/SBI001245|IB004521/.test(r.message)), 'reminders never contain full deposit numbers');
    ok(!rem.some(r => r.type === 'Renewal'), 'monthly renewal reminders off by default');
    const withRenew = M.buildReminders(data, { notify: Object.assign({}, M.DEFAULT_PREFS.notify, { renewalDays: [0] }) }, today, 30);
    ok(withRenew.some(r => r.type === 'Renewal' && r.depositId === '1' && r.notifyOn === '2026-10-15'), 'monthly renewal reminder when switched on');

    /* ---------- add a deposit, mark received, renew */
    const f = { memberId: d1.memberId, bank: 'Canara Bank', accountNumber: 'CB999001', interestType: 'Simple', interestRate: '7.5',
      depositAmount: '100000', startDate: '2026-09-26', days: '180', maturityDate: '', incomeDate: '', interestAmount: '', notes: '' };
    eq(M.validateDeposit(f), {}, 'valid new deposit');
    const r1 = M.saveDeposit(data, f, { today });
    eq([r1.deposit.id, r1.deposit.maturityDate, r1.deposit.incomeDate, r1.deposit.interestAmount], ['21', '2027-03-25', '2027-03-25', 3750], 'new deposit gets S.No 21, mature date and interest');
    ok(Object.keys(M.validateDeposit(Object.assign({}, f, { days: '', maturityDate: '' }))).includes('days'), 'needs days or mature date');

    const p7 = M.paymentsOf(data, '7')[0];
    M.markReceived(data, p7.id, { amount: 10650, date: '2026-10-12' }, today);
    eq(M.payment(data, p7.id).status, 'Received', 'interest marked received');
    const draft = M.renewalDraft(dep(7));
    eq([draft.depositAmount, draft.startDate, draft.days, draft.notes], [160650, '2026-10-12', 365, 'Renewal of S.No 7'], 'cumulative renewal adds the interest');
    const rn = M.renewDeposit(data, '7', draft, { today: '2026-10-13' });
    eq([rn.deposit.id, rn.deposit.maturityDate, dep(7).status, dep(7).closedDate, dep(7).notes],
      ['22', '2027-10-12', 'Closed', '2026-10-12', 'Renewal required · Renewed as S.No 22'], 'renew closes the old deposit and links them');

    /* ---------- search */
    eq(M.searchDeposits(data, { q: '1245' }, today).map(d => d.id), ['1'], 'search by last digits of Deposit No');
    eq(M.searchDeposits(data, { status: 'Maturing Soon' }, today).map(d => d.id).sort(), ['19', '9'], 'filter by position');
    eq(M.searchDeposits(data, { interestType: 'Cumulative', status: 'Open' }, today).length, 6, 'filter by interest type');

    /* ---------- Excel round trip in the 16-column layout */
    const sheets = M.workbookSheets(data, M.DEFAULT_PREFS, today);
    eq(sheets.map(s => s.name), ['Deposits', 'FamilyMembers', 'Payments', 'Notifications'], 'sheet order');
    eq(sheets[0].columns.map(c => c.header), ['S.No', 'Bank Name', 'Deposit No', 'Depositer Name', 'Interest type', 'percentage', 'Deposit Value',
      'Deposit Date', 'No of Days', 'Mature Date', 'Deposit position', 'monthly Renewal Date', 'Income Date', 'Amount of Intersest', 'Deposited Village', 'Remarks'],
      'exact 16 headings of the family sheet');
    const bytes = await DM.xlsx.write(sheets);
    const back = M.prepareImport(await DM.xlsx.read(bytes), today);
    eq(back.errors.concat(back.warnings), [], 'own export imports cleanly');
    const fin2 = M.finalizeImport(back, 'received', today);
    const strip = d => JSON.stringify({ m: d.members, d: d.deposits.slice().sort((a, b) => M.idNum(a.id) - M.idNum(b.id)), p: d.payments.slice().sort((a, b) => a.id < b.id ? -1 : 1) });
    const A = JSON.parse(strip(fin2.data)), B = JSON.parse(strip(M.normalizeData(JSON.parse(JSON.stringify(data)))));
    ['m', 'd', 'p'].forEach(k => {
      if (A[k].length !== B[k].length) fails.push('round trip ' + k + ' count ' + A[k].length + ' vs ' + B[k].length);
      A[k].forEach((row, i) => { const a = JSON.stringify(row), b = JSON.stringify(B[k][i]); if (a !== b) fails.push('round trip ' + k + '[' + i + ']\n   got ' + a + '\n   exp ' + b); });
    });

    /* ---------- closing early keeps its date through Excel */
    M.closeDeposit(data, '15', '2026-11-01', today);
    eq(dep(15).notes, 'Long term deposit · Closed early on 01-11-2026', 'early closure noted in Remarks');
    const again = M.finalizeImport(M.prepareImport(await DM.xlsx.read(await DM.xlsx.write(M.workbookSheets(data, M.DEFAULT_PREFS, today))), today), 'received', today);
    eq(again.data.deposits.find(d => d.id === '15').closedDate, '2026-11-01', 'closing date read back from Remarks');
    M.reopenDeposit(data, '15', today);
    eq(dep(15).notes, 'Long term deposit', 'reopening removes the note');

    /* ---------- data saved by version 1 upgrades cleanly */
    const v1 = { version: 1, members: [{ id: 'M001', name: 'Lakshmi', village: 'Tambaram', phone: '' }],
      deposits: [{ id: 'D001', memberId: 'M001', village: 'Tambaram', bank: 'SBI', accountNumber: '30012344582', depositAmount: 100000, interestRate: 7.25,
        paymentAmount: 1812.5, frequency: 'Quarterly', startDate: '2026-03-20', firstPaymentDate: '2026-06-20', maturityDate: '2028-03-20', status: 'Active', closedDate: '', notes: '' }],
      payments: [{ id: 'P00001', depositId: 'D001', dueDate: '2026-06-20', expectedAmount: 1812.5, receivedAmount: 1812.5, receivedDate: '2026-06-20', status: 'Received', notes: '' }] };
    const up = M.normalizeData(v1);
    M.rollForward(up, today);
    const u = up.deposits[0];
    eq([u.interestType, u.days, u.incomeDate, u.interestAmount], ['Simple', 731, '2028-03-20', 14500], 'v1 deposit upgraded');
    eq(up.payments.map(p => p.dueDate + ':' + p.status), ['2026-06-20:Received', '2028-03-20:Pending'], 'v1 history kept, income row added');
    const nu = M.saveDeposit(up, { memberId: 'M001', bank: 'X', interestType: 'Simple', depositAmount: 1000, startDate: today, days: 365 }, { today });
    eq(nu.deposit.id, '2', 'next S.No after a v1 id');

    const tpl = await DM.xlsx.write(M.workbookSheets(M.emptyData(), M.DEFAULT_PREFS, today, { template: true }));
    return { fails, xlsx: U.bytesToBase64(bytes), tpl: U.bytesToBase64(tpl) };
  }, FIXTURE);

  fs.writeFileSync(path.join(OUT, 'roundtrip.xlsx'), Buffer.from(result.xlsx, 'base64'));
  fs.writeFileSync(path.join(OUT, 'template.xlsx'), Buffer.from(result.tpl, 'base64'));
  await browser.close();
  if (result.fails.length) {
    console.log('FAILED ' + result.fails.length + ':\n - ' + result.fails.join('\n - '));
    process.exit(1);
  }
  console.log('engine tests: all passed');
})();
