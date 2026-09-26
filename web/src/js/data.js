/* Deposit Manager — data model: members, deposits, payment schedules, reminders,
 * statistics, and mapping to/from the Excel workbook. Pure logic, no DOM. */
(function (DM) {
  'use strict';
  var U = DM.util;

  var FREQS = ['Monthly', 'Quarterly', 'Half-Yearly', 'Annually'];
  var FREQ_MONTHS = { 'Monthly': 1, 'Quarterly': 3, 'Half-Yearly': 6, 'Annually': 12 };
  var HORIZON_MONTHS = 12;          // payment rows are kept generated this far ahead
  var PAST_NOTE = 'Marked received automatically (date was before the deposit was added)';

  var DEFAULT_PREFS = {
    notify: { enabled: true, time: '09:00', paymentDays: [7, 3, 1, 0], maturityDays: [30, 7, 1, 0] }
  };

  /* ------------------------------------------------------------ basics */

  function emptyData() {
    return { version: 1, members: [], deposits: [], payments: [] };
  }

  function parseFrequency(v) {
    var k = U.normKey(v);
    if (!k) return '';
    if (/^(m|monthly|month|months|permonth|1month|everymonth|mon)$/.test(k)) return 'Monthly';
    if (/^(q|qtr|qtrly|quarterly|quarter|quaterly|quartely|3months|3month|everyquarter|every3months)$/.test(k)) return 'Quarterly';
    if (/^(h|hy|halfyearly|halfyear|halfyrly|semiannual|semiannually|semiyearly|6months|6month|biannual|biannually|every6months|sixmonthly)$/.test(k)) return 'Half-Yearly';
    if (/^(a|y|yearly|annual|annually|year|peryear|12months|12month|pa|every12months|onceayear)$/.test(k)) return 'Annually';
    return '';
  }

  function parseDepositStatus(v) {
    var k = U.normKey(v);
    if (!k) return '';
    if (/^(active|open|running|live|ongoing)$/.test(k)) return 'Active';
    if (/^(closed|close|matured|inactive|withdrawn|ended|done|renewed)$/.test(k)) return 'Closed';
    return '';
  }

  function parsePaymentStatus(v) {
    var k = U.normKey(v);
    if (!k) return '';
    if (/^(received|paid|yes|done|credited|recd|rcvd|collected)$/.test(k)) return 'Received';
    if (/^(overdue|late|due|missed)$/.test(k)) return 'Overdue';
    if (/^(pending|no|notreceived|upcoming|scheduled)$/.test(k)) return 'Pending';
    return '';
  }

  function num(v) {
    var n = U.toNumber(v);
    return isFinite(n) ? U.round2(n) : '';
  }

  /** Interest rates keep up to 3 decimals (e.g. 7.125%). */
  function rateNum(v) {
    var n = U.toNumber(v);
    return isFinite(n) ? Math.round(n * 1000) / 1000 : '';
  }

  /** Interest per payout for simple-interest payout deposits. */
  function suggestPayment(amount, rate, frequency) {
    var a = +amount, r = +rate, m = FREQ_MONTHS[frequency];
    if (!(a > 0) || !(r > 0) || !m) return '';
    return U.round2(a * r / 100 * m / 12);
  }

  /** Make any loaded object into a clean data set (defensive against old/hand-edited data). */
  function normalizeData(raw) {
    var d = emptyData();
    if (!raw || typeof raw !== 'object') return d;
    (raw.members || []).forEach(function (m) {
      if (!m || !m.id) return;
      d.members.push({ id: U.str(m.id), name: U.str(m.name), village: U.str(m.village), phone: U.str(m.phone) });
    });
    (raw.deposits || []).forEach(function (x) {
      if (!x || !x.id) return;
      d.deposits.push({
        id: U.str(x.id), memberId: U.str(x.memberId), village: U.str(x.village), bank: U.str(x.bank),
        accountNumber: U.str(x.accountNumber), depositAmount: num(x.depositAmount), interestRate: rateNum(x.interestRate),
        paymentAmount: num(x.paymentAmount), frequency: FREQ_MONTHS[x.frequency] ? x.frequency : parseFrequency(x.frequency),
        startDate: U.isValidISO(x.startDate) ? x.startDate : '', firstPaymentDate: U.isValidISO(x.firstPaymentDate) ? x.firstPaymentDate : '',
        maturityDate: U.isValidISO(x.maturityDate) ? x.maturityDate : '', status: x.status === 'Closed' ? 'Closed' : 'Active',
        closedDate: U.isValidISO(x.closedDate) ? x.closedDate : '', notes: U.str(x.notes)
      });
    });
    (raw.payments || []).forEach(function (p) {
      if (!p || !p.id || !p.depositId || !U.isValidISO(p.dueDate)) return;
      d.payments.push({
        id: U.str(p.id), depositId: U.str(p.depositId), dueDate: p.dueDate, expectedAmount: num(p.expectedAmount),
        receivedAmount: num(p.receivedAmount), receivedDate: U.isValidISO(p.receivedDate) ? p.receivedDate : '',
        status: p.status === 'Received' ? 'Received' : (p.status === 'Overdue' ? 'Overdue' : 'Pending'), notes: U.str(p.notes)
      });
    });
    return d;
  }

  /* ------------------------------------------------------------ lookups */

  var cache = new WeakMap();

  function invalidate(data) { cache.delete(data); }

  function index(data) {
    var c = cache.get(data);
    if (c) return c;
    c = { member: {}, deposit: {}, payment: {}, byDeposit: {}, depositsByMember: {} };
    data.members.forEach(function (m) { c.member[m.id] = m; c.depositsByMember[m.id] = []; });
    data.deposits.forEach(function (d) {
      c.deposit[d.id] = d;
      c.byDeposit[d.id] = [];
      (c.depositsByMember[d.memberId] = c.depositsByMember[d.memberId] || []).push(d);
    });
    data.payments.forEach(function (p) {
      c.payment[p.id] = p;
      (c.byDeposit[p.depositId] = c.byDeposit[p.depositId] || []).push(p);
    });
    for (var k in c.byDeposit) c.byDeposit[k].sort(byDue);
    cache.set(data, c);
    return c;
  }

  function byDue(a, b) {
    return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : (a.id < b.id ? -1 : 1);
  }

  function member(data, id) { return index(data).member[id] || null; }
  function deposit(data, id) { return index(data).deposit[id] || null; }
  function payment(data, id) { return index(data).payment[id] || null; }
  function paymentsOf(data, depositId) { return index(data).byDeposit[depositId] || []; }
  function depositsOf(data, memberId) { return index(data).depositsByMember[memberId] || []; }

  function memberName(data, id) {
    var m = member(data, id);
    return m ? m.name : '(Unknown member)';
  }

  /* ------------------------------------------------------------ schedule */

  function hasSchedule(dep) {
    return !!(FREQ_MONTHS[dep.frequency] && U.isValidISO(dep.firstPaymentDate));
  }

  /** The last date a deposit can have a payment on. */
  function scheduleLimit(dep, today, horizon) {
    var limit = horizon === Infinity ? '9999-12-31' : U.addMonths(today, horizon === undefined ? HORIZON_MONTHS : horizon);
    if (U.isValidISO(dep.maturityDate) && dep.maturityDate < limit) limit = dep.maturityDate;
    if (dep.status === 'Closed') {
      var c = U.isValidISO(dep.closedDate) ? dep.closedDate
        : (U.isValidISO(dep.maturityDate) && dep.maturityDate < today ? dep.maturityDate : today);
      if (c < limit) limit = c;
    }
    return limit;
  }

  /** Due dates from the first payment date, stepping by the frequency, up to the limit. */
  function dueDates(dep, today, horizon) {
    if (!hasSchedule(dep)) return [];
    var step = FREQ_MONTHS[dep.frequency], first = dep.firstPaymentDate;
    var anchor = U.parseISO(first).d, limit = scheduleLimit(dep, today, horizon), out = [];
    for (var k = 0; k < 3000; k++) {
      var d = U.addMonths(first, k * step, anchor);
      if (d > limit) break;
      out.push(d);
    }
    return out;
  }

  /** Total number of payments until maturity (null when there is no maturity date). */
  function totalPayments(dep) {
    if (!hasSchedule(dep) || !U.isValidISO(dep.maturityDate)) return null;
    return dueDates(dep, '0000-01-01', Infinity).length;
  }

  function refreshStatuses(data, today) {
    data.payments.forEach(function (p) {
      if (p.status === 'Received') return;
      p.status = p.dueDate < today ? 'Overdue' : 'Pending';
    });
  }

  /**
   * Make stored payment rows match each deposit's schedule:
   *  - adds rows for every due date that has none (through the horizon / maturity / closing date)
   *  - removes not-yet-received rows that are no longer on the schedule (unless keepOffSchedule)
   *  - never touches received rows (payment history is permanent)
   * Returns the rows it created.
   */
  function syncSchedule(data, opts) {
    opts = opts || {};
    var today = opts.today || U.todayISO();
    var only = opts.ids ? new Set(opts.ids) : null;
    var counter = maxNum('P', data.payments.map(function (p) { return p.id; }));
    var created = [], removedIds = new Set();
    var grouped = {};
    data.payments.forEach(function (p) { (grouped[p.depositId] = grouped[p.depositId] || []).push(p); });

    data.deposits.forEach(function (dep) {
      if (only && !only.has(dep.id)) return;
      var dates = dueDates(dep, today), want = new Set(dates);
      var mine = grouped[dep.id] || [], have = {};
      mine.forEach(function (p) {
        var onSchedule = want.has(p.dueDate);
        if (p.status !== 'Received' && !onSchedule && !opts.keepOffSchedule) { removedIds.add(p.id); return; }
        if (have[p.dueDate] && p.status !== 'Received' && !opts.keepOffSchedule) { removedIds.add(p.id); return; }
        if (!have[p.dueDate] || p.status === 'Received') have[p.dueDate] = p;
        if (opts.updateAmounts && p.status !== 'Received' && dep.paymentAmount !== '') p.expectedAmount = dep.paymentAmount;
      });
      dates.forEach(function (d) {
        if (have[d]) return;
        counter++;
        var p = {
          id: 'P' + U.pad(counter, 5), depositId: dep.id, dueDate: d, expectedAmount: dep.paymentAmount,
          receivedAmount: '', receivedDate: '', status: 'Pending', notes: ''
        };
        data.payments.push(p);
        created.push(p);
      });
    });
    if (removedIds.size) data.payments = data.payments.filter(function (p) { return !removedIds.has(p.id); });
    refreshStatuses(data, today);
    invalidate(data);
    return { created: created, removed: removedIds.size };
  }

  function maxNum(prefix, ids) {
    var max = 0, re = new RegExp('^' + prefix + '(\\d+)$', 'i');
    ids.forEach(function (id) { var m = re.exec(String(id)); if (m && +m[1] > max) max = +m[1]; });
    return max;
  }

  function applyPastChoice(rows, pastAs, today) {
    var n = 0;
    if (pastAs !== 'received') return 0;
    rows.forEach(function (p) {
      if (p.dueDate < today && p.status !== 'Received') {
        p.status = 'Received';
        p.receivedAmount = p.expectedAmount;
        p.receivedDate = p.dueDate;
        p.notes = PAST_NOTE;
        n++;
      }
    });
    return n;
  }

  /** How many due dates before today a deposit (new or edited) would add. */
  function countPastDue(data, dep, today) {
    var existing = new Set((dep.id ? paymentsOf(data, dep.id) : []).map(function (p) { return p.dueDate; }));
    return dueDates(dep, today).filter(function (d) { return d < today && !existing.has(d); }).length;
  }

  function nextPayment(data, depositId, today) {
    var list = paymentsOf(data, depositId);
    for (var i = 0; i < list.length; i++) {
      if (list[i].status !== 'Received' && list[i].dueDate >= today) return list[i];
    }
    return null;
  }

  function depositSummary(data, dep, today) {
    var list = paymentsOf(data, dep.id), s = {
      payments: list, receivedCount: 0, receivedTotal: 0, overdue: [], overdueTotal: 0,
      next: null, lastReceived: null, total: totalPayments(dep)
    };
    list.forEach(function (p) {
      if (p.status === 'Received') {
        s.receivedCount++;
        s.receivedTotal += +p.receivedAmount || 0;
        if (!s.lastReceived || p.dueDate > s.lastReceived.dueDate) s.lastReceived = p;
      } else if (p.dueDate < today) {
        s.overdue.push(p);
        s.overdueTotal += +p.expectedAmount || 0;
      } else if (!s.next) s.next = p;
    });
    s.receivedTotal = U.round2(s.receivedTotal);
    s.overdueTotal = U.round2(s.overdueTotal);
    return s;
  }

  /* ------------------------------------------------------------ mutations */

  function validateMember(data, f) {
    var e = {};
    if (!U.str(f.name)) e.name = 'Please enter a name';
    var phone = U.str(f.phone).replace(/[\s-]/g, '');
    if (phone && !/^\+?\d{6,15}$/.test(phone)) e.phone = 'Phone number should be 6 to 15 digits';
    var dupe = data.members.filter(function (m) {
      return m.id !== f.id && U.normKey(m.name) === U.normKey(f.name) && U.normKey(m.village) === U.normKey(f.village);
    });
    if (!e.name && dupe.length) e.name = 'A member with this name and village already exists';
    return e;
  }

  function saveMember(data, f) {
    var m;
    if (f.id) {
      m = member(data, f.id);
      if (!m) throw new Error('Member not found');
    } else {
      m = { id: U.nextId('M', data.members.map(function (x) { return x.id; }), 3) };
      data.members.push(m);
    }
    var oldVillage = m.village;
    m.name = U.str(f.name);
    m.village = U.str(f.village);
    m.phone = U.str(f.phone);
    // keep deposits that used the member's old village in step with the new one
    if (f.id && oldVillage !== m.village) {
      data.deposits.forEach(function (d) {
        if (d.memberId === m.id && (d.village === oldVillage || !d.village)) d.village = m.village;
      });
    }
    invalidate(data);
    return m;
  }

  function deleteMember(data, id) {
    if (depositsOf(data, id).length) throw new Error('This member still has deposits. Deposits keep their history, so the member cannot be removed.');
    data.members = data.members.filter(function (m) { return m.id !== id; });
    invalidate(data);
  }

  function validateDeposit(f) {
    var e = {};
    if (!f.memberId) e.memberId = 'Choose the family member';
    if (!U.str(f.bank)) e.bank = 'Enter the bank or institution';
    if (!(+f.depositAmount > 0)) e.depositAmount = 'Enter the deposit amount';
    if (f.interestRate !== '' && f.interestRate !== undefined && !(+f.interestRate >= 0 && +f.interestRate <= 100)) e.interestRate = 'Rate should be between 0 and 100';
    if (f.paymentAmount !== '' && f.paymentAmount !== undefined && !(+f.paymentAmount >= 0)) e.paymentAmount = 'Enter a valid amount';
    if (!FREQ_MONTHS[f.frequency]) e.frequency = 'Choose how often payments come';
    if (!U.isValidISO(f.firstPaymentDate)) e.firstPaymentDate = 'Enter the first payment date';
    if (U.isValidISO(f.startDate) && U.isValidISO(f.firstPaymentDate) && f.firstPaymentDate < f.startDate) e.firstPaymentDate = 'First payment cannot be before the start date';
    if (U.isValidISO(f.maturityDate)) {
      if (U.isValidISO(f.firstPaymentDate) && f.maturityDate < f.firstPaymentDate) e.maturityDate = 'Maturity date cannot be before the first payment';
      else if (U.isValidISO(f.startDate) && f.maturityDate < f.startDate) e.maturityDate = 'Maturity date cannot be before the start date';
    }
    var acc = U.str(f.accountNumber);
    if (acc && !/^[A-Za-z0-9 /-]{3,34}$/.test(acc)) e.accountNumber = 'Use letters and digits only';
    return e;
  }

  var SCHEDULE_FIELDS = ['frequency', 'firstPaymentDate', 'maturityDate', 'status', 'closedDate'];

  /** Create or update a deposit and bring its payment schedule up to date. */
  function saveDeposit(data, f, opts) {
    opts = opts || {};
    var today = opts.today || U.todayISO(), dep, isNew = !f.id;
    if (isNew) {
      dep = { id: U.nextId('D', data.deposits.map(function (x) { return x.id; }), 3), status: 'Active', closedDate: '' };
      data.deposits.push(dep);
    } else {
      dep = deposit(data, f.id);
      if (!dep) throw new Error('Deposit not found');
    }
    var before = U.clone(dep);
    var m = member(data, f.memberId);
    dep.memberId = f.memberId;
    dep.village = U.str(f.village) || (m ? m.village : '');
    dep.bank = U.str(f.bank);
    dep.accountNumber = U.str(f.accountNumber).replace(/\s+/g, '');
    dep.depositAmount = num(f.depositAmount);
    dep.interestRate = rateNum(f.interestRate);
    dep.paymentAmount = num(f.paymentAmount);
    if (dep.paymentAmount === '') dep.paymentAmount = suggestPayment(dep.depositAmount, dep.interestRate, f.frequency) || 0;
    dep.frequency = f.frequency;
    dep.startDate = U.isValidISO(f.startDate) ? f.startDate : '';
    dep.firstPaymentDate = f.firstPaymentDate;
    dep.maturityDate = U.isValidISO(f.maturityDate) ? f.maturityDate : '';
    dep.notes = U.str(f.notes);
    invalidate(data);
    var changed = isNew || SCHEDULE_FIELDS.some(function (k) { return before[k] !== dep[k]; });
    var amountChanged = isNew || before.paymentAmount !== dep.paymentAmount;
    var res = { deposit: dep, created: [], autoReceived: 0 };
    if (changed || amountChanged) {
      var s = syncSchedule(data, { ids: [dep.id], today: today, updateAmounts: amountChanged });
      res.created = s.created;
      res.autoReceived = applyPastChoice(s.created, opts.pastAs, today);
      if (res.autoReceived) refreshStatuses(data, today);
    }
    invalidate(data);
    return res;
  }

  function closeDeposit(data, id, closedDate, today) {
    var dep = deposit(data, id);
    if (!dep) throw new Error('Deposit not found');
    dep.status = 'Closed';
    dep.closedDate = U.isValidISO(closedDate) ? closedDate : (today || U.todayISO());
    invalidate(data);
    var s = syncSchedule(data, { ids: [id], today: today });
    var unpaid = paymentsOf(data, id).filter(function (p) { return p.status !== 'Received'; }).length;
    return { removedFuture: s.removed, unpaidKept: unpaid };
  }

  function reopenDeposit(data, id, today) {
    var dep = deposit(data, id);
    if (!dep) throw new Error('Deposit not found');
    dep.status = 'Active';
    dep.closedDate = '';
    invalidate(data);
    return syncSchedule(data, { ids: [id], today: today });
  }

  function canDeleteDeposit(data, id) {
    return !paymentsOf(data, id).some(function (p) { return p.status === 'Received'; });
  }

  function deleteDeposit(data, id) {
    if (!canDeleteDeposit(data, id)) throw new Error('This deposit already has received payments, so it is kept for your records. Close it instead.');
    data.deposits = data.deposits.filter(function (d) { return d.id !== id; });
    data.payments = data.payments.filter(function (p) { return p.depositId !== id; });
    invalidate(data);
  }

  function markReceived(data, pid, f, today) {
    var p = payment(data, pid);
    if (!p) throw new Error('Payment not found');
    var amt = num(f.amount);
    p.status = 'Received';
    p.receivedAmount = amt === '' ? p.expectedAmount : amt;
    p.receivedDate = U.isValidISO(f.date) ? f.date : (today || U.todayISO());
    if (f.notes !== undefined) p.notes = U.str(f.notes);
    invalidate(data);
    syncSchedule(data, { ids: [p.depositId], today: today });
    return nextPayment(data, p.depositId, today || U.todayISO());
  }

  function markNotReceived(data, pid, today) {
    var p = payment(data, pid);
    if (!p) throw new Error('Payment not found');
    p.status = 'Pending';
    p.receivedAmount = '';
    p.receivedDate = '';
    if (p.notes === PAST_NOTE) p.notes = '';
    invalidate(data);
    syncSchedule(data, { ids: [p.depositId], today: today });
  }

  function updatePayment(data, pid, f) {
    var p = payment(data, pid);
    if (!p) throw new Error('Payment not found');
    if (f.expectedAmount !== undefined) { var e = num(f.expectedAmount); if (e !== '') p.expectedAmount = e; }
    if (f.notes !== undefined) p.notes = U.str(f.notes);
    if (p.status === 'Received') {
      if (f.receivedAmount !== undefined) { var r = num(f.receivedAmount); if (r !== '') p.receivedAmount = r; }
      if (f.receivedDate !== undefined && U.isValidISO(f.receivedDate)) p.receivedDate = f.receivedDate;
    }
    invalidate(data);
  }

  /* ------------------------------------------------------------ reminders */

  function daysLabel(d, what) {
    if (d === 0) return what + ' today';
    if (d === 1) return what + ' tomorrow';
    return what + ' in ' + d + ' days';
  }

  /**
   * Reminder list (the Notifications sheet, and what the phone schedules):
   * payments 7/3/1/0 days before and maturity 30/7/1/0 days before, from today through `horizonDays`.
   */
  function buildReminders(data, prefs, today, horizonDays) {
    var n = (prefs && prefs.notify) || DEFAULT_PREFS.notify;
    horizonDays = horizonDays || 60;
    var until = U.addDays(today, horizonDays), out = [];
    var pDays = (n.paymentDays || []).slice().sort(function (a, b) { return b - a; });
    var mDays = (n.maturityDays || []).slice().sort(function (a, b) { return b - a; });
    var maxP = pDays.length ? pDays[0] : 0, lastDue = U.addDays(until, maxP);
    data.payments.forEach(function (p) {
      if (p.status === 'Received' || p.dueDate < today || p.dueDate > lastDue) return;
      var dep = deposit(data, p.depositId);
      if (!dep || dep.status !== 'Active') return;
      pDays.forEach(function (d) {
        var on = U.addDays(p.dueDate, -d);
        if (on < today || on > until) return;
        out.push({
          type: 'Payment', notifyOn: on, daysBefore: d, eventDate: p.dueDate, depositId: dep.id, paymentId: p.id,
          memberName: memberName(data, dep.memberId),
          title: daysLabel(d, 'Payment due'),
          message: memberName(data, dep.memberId) + ' · ' + dep.bank + ' ' + U.maskAccount(dep.accountNumber) +
            ' · ' + U.fmtMoney(p.expectedAmount) + ' on ' + U.fmtDate(p.dueDate)
        });
      });
    });
    data.deposits.forEach(function (dep) {
      if (dep.status !== 'Active' || !U.isValidISO(dep.maturityDate) || dep.maturityDate < today) return;
      mDays.forEach(function (d) {
        var on = U.addDays(dep.maturityDate, -d);
        if (on < today || on > until) return;
        out.push({
          type: 'Maturity', notifyOn: on, daysBefore: d, eventDate: dep.maturityDate, depositId: dep.id, paymentId: '',
          memberName: memberName(data, dep.memberId),
          title: daysLabel(d, 'Deposit matures'),
          message: memberName(data, dep.memberId) + ' · ' + dep.bank + ' ' + U.maskAccount(dep.accountNumber) +
            ' · ' + U.fmtMoney(dep.depositAmount) + ' on ' + U.fmtDate(dep.maturityDate)
        });
      });
    });
    out.sort(function (a, b) {
      return a.notifyOn < b.notifyOn ? -1 : a.notifyOn > b.notifyOn ? 1 :
        a.eventDate < b.eventDate ? -1 : a.eventDate > b.eventDate ? 1 : (a.depositId < b.depositId ? -1 : 1);
    });
    out.forEach(function (r, i) {
      r.id = 'N' + U.pad(i + 1, 4);
      r.status = r.notifyOn === today ? 'Today' : 'Scheduled';
    });
    return out;
  }

  /* ------------------------------------------------------------ statistics */

  function computeStats(data, today) {
    var st = {
      members: data.members.length, active: 0, closed: 0, principal: 0,
      upcoming30: { count: 0, amount: 0 }, pending: 0, overdue: { count: 0, amount: 0 },
      byFrequency: FREQS.map(function (f) { return { frequency: f, count: 0, perPayout: 0, yearly: 0 }; }),
      yearlyIncome: 0, thisMonth: { expected: 0, received: 0 }, maturing: [], matured: [], incomplete: []
    };
    var in30 = U.addDays(today, 30), monthKey = today.slice(0, 7), in60 = U.addDays(today, 60);
    var active = {};
    data.deposits.forEach(function (d) {
      if (d.status === 'Closed') { st.closed++; return; }
      st.active++;
      active[d.id] = d;
      st.principal += +d.depositAmount || 0;
      var fi = FREQS.indexOf(d.frequency);
      if (fi >= 0) {
        var b = st.byFrequency[fi], amt = +d.paymentAmount || 0;
        b.count++;
        b.perPayout += amt;
        b.yearly += amt * 12 / FREQ_MONTHS[d.frequency];
      }
      if (!hasSchedule(d)) st.incomplete.push(d);
      if (U.isValidISO(d.maturityDate)) {
        if (d.maturityDate < today) st.matured.push(d);
        else if (d.maturityDate <= in60) st.maturing.push(d);
      }
    });
    data.payments.forEach(function (p) {
      if (p.status === 'Received') {
        if ((p.receivedDate || '').slice(0, 7) === monthKey) st.thisMonth.received += +p.receivedAmount || 0;
        return;
      }
      if (p.dueDate.slice(0, 7) === monthKey && active[p.depositId]) st.thisMonth.expected += +p.expectedAmount || 0;
      if (p.dueDate < today) {
        st.overdue.count++;
        st.overdue.amount += +p.expectedAmount || 0;
      } else if (active[p.depositId]) {
        st.pending++;
        if (p.dueDate <= in30) { st.upcoming30.count++; st.upcoming30.amount += +p.expectedAmount || 0; }
      }
    });
    st.byFrequency.forEach(function (b) {
      b.perPayout = U.round2(b.perPayout);
      b.yearly = U.round2(b.yearly);
      st.yearlyIncome += b.yearly;
    });
    st.yearlyIncome = U.round2(st.yearlyIncome);
    st.principal = U.round2(st.principal);
    st.overdue.amount = U.round2(st.overdue.amount);
    st.upcoming30.amount = U.round2(st.upcoming30.amount);
    st.thisMonth.expected = U.round2(st.thisMonth.expected);
    st.thisMonth.received = U.round2(st.thisMonth.received);
    st.maturing.sort(function (a, b) { return a.maturityDate < b.maturityDate ? -1 : 1; });
    st.matured.sort(function (a, b) { return a.maturityDate < b.maturityDate ? -1 : 1; });
    return st;
  }

  /** Unreceived payments (optionally only for active deposits) sorted by due date. */
  function openPayments(data, opts) {
    opts = opts || {};
    return data.payments.filter(function (p) {
      if (p.status === 'Received') return false;
      if (opts.from && p.dueDate < opts.from) return false;
      if (opts.to && p.dueDate > opts.to) return false;
      if (opts.before && p.dueDate >= opts.before) return false;
      var d = deposit(data, p.depositId);
      if (!d) return false;
      if (opts.activeOnly && d.status !== 'Active') return false;
      return true;
    }).sort(byDue);
  }

  /* ------------------------------------------------------------ search */

  function searchDeposits(data, f) {
    f = f || {};
    var q = U.str(f.q).toLowerCase(), qDigits = q.replace(/\D/g, '');
    var list = data.deposits.filter(function (d) {
      if (f.status && f.status !== 'All' && d.status !== f.status) return false;
      if (f.frequency && d.frequency !== f.frequency) return false;
      if (f.memberId && d.memberId !== f.memberId) return false;
      if (f.village && U.normKey(d.village) !== U.normKey(f.village)) return false;
      if (f.bank && U.normKey(d.bank) !== U.normKey(f.bank)) return false;
      if (!q) return true;
      var m = member(data, d.memberId);
      var hay = [d.id, d.bank, d.village, d.notes, m ? m.name : '', m ? m.village : '', d.frequency].join(' ').toLowerCase();
      if (hay.indexOf(q) >= 0) return true;
      if (qDigits.length >= 3 && qDigits === q.replace(/\s/g, '') && String(d.accountNumber).indexOf(qDigits) >= 0) return true;
      return false;
    });
    var sort = f.sort || 'member';
    list.sort(function (a, b) {
      var r = 0;
      if (sort === 'amount') r = (+b.depositAmount || 0) - (+a.depositAmount || 0);
      else if (sort === 'maturity') r = (a.maturityDate || '9999') < (b.maturityDate || '9999') ? -1 : (a.maturityDate || '9999') > (b.maturityDate || '9999') ? 1 : 0;
      else if (sort === 'bank') r = a.bank.localeCompare(b.bank);
      else if (sort === 'newest') r = (b.startDate || '') < (a.startDate || '') ? -1 : (b.startDate || '') > (a.startDate || '') ? 1 : 0;
      else r = memberName(data, a.memberId).localeCompare(memberName(data, b.memberId));
      return r || (a.id < b.id ? -1 : 1);
    });
    return list;
  }

  function distinct(values) {
    var seen = {}, out = [];
    values.forEach(function (v) {
      var k = U.normKey(v);
      if (k && !seen[k]) { seen[k] = 1; out.push(U.str(v)); }
    });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }

  function villages(data) {
    return distinct(data.members.map(function (m) { return m.village; }).concat(data.deposits.map(function (d) { return d.village; })));
  }

  function banks(data) {
    return distinct(data.deposits.map(function (d) { return d.bank; }));
  }

  /* ------------------------------------------------------------ Excel export */

  var COL = {
    members: [
      { header: 'Member ID', key: 'id', type: 'text', width: 12 },
      { header: 'Name', key: 'name', type: 'text', width: 26 },
      { header: 'Village', key: 'village', type: 'text', width: 18 },
      { header: 'Phone Number', key: 'phone', type: 'text', width: 16 }
    ],
    deposits: [
      { header: 'Deposit ID', key: 'id', type: 'text', width: 11 },
      { header: 'Member ID', key: 'memberId', type: 'text', width: 11 },
      { header: 'Family Member', key: 'memberName', type: 'text', width: 22 },
      { header: 'Village', key: 'village', type: 'text', width: 16 },
      { header: 'Bank/Institution', key: 'bank', type: 'text', width: 24 },
      { header: 'Account Number', key: 'accountNumber', type: 'text', width: 20 },
      { header: 'Deposit Amount', key: 'depositAmount', type: 'money', width: 15 },
      { header: 'Interest Rate (%)', key: 'interestRate', type: 'rate', width: 12 },
      { header: 'Payment Amount', key: 'paymentAmount', type: 'money', width: 15 },
      { header: 'Payment Frequency', key: 'frequency', type: 'text', width: 16 },
      { header: 'Start Date', key: 'startDate', type: 'date', width: 13 },
      { header: 'First Payment Date', key: 'firstPaymentDate', type: 'date', width: 15 },
      { header: 'Maturity Date', key: 'maturityDate', type: 'date', width: 13 },
      { header: 'Status', key: 'status', type: 'text', width: 10 },
      { header: 'Closed On', key: 'closedDate', type: 'date', width: 13 },
      { header: 'Notes', key: 'notes', type: 'text', width: 32 }
    ],
    payments: [
      { header: 'Payment ID', key: 'id', type: 'text', width: 11 },
      { header: 'Deposit ID', key: 'depositId', type: 'text', width: 11 },
      { header: 'Family Member', key: 'memberName', type: 'text', width: 22 },
      { header: 'Bank/Institution', key: 'bank', type: 'text', width: 22 },
      { header: 'Due Date', key: 'dueDate', type: 'date', width: 13 },
      { header: 'Expected Amount', key: 'expectedAmount', type: 'money', width: 15 },
      { header: 'Received Amount', key: 'receivedAmount', type: 'money', width: 15 },
      { header: 'Received Date', key: 'receivedDate', type: 'date', width: 14 },
      { header: 'Status', key: 'status', type: 'text', width: 11 },
      { header: 'Notes', key: 'notes', type: 'text', width: 32 }
    ],
    notifications: [
      { header: 'Notification ID', key: 'id', type: 'text', width: 13 },
      { header: 'Notify On', key: 'notifyOn', type: 'date', width: 13 },
      { header: 'Type', key: 'type', type: 'text', width: 10 },
      { header: 'Days Before', key: 'daysBefore', type: 'int', width: 10 },
      { header: 'Event Date', key: 'eventDate', type: 'date', width: 13 },
      { header: 'Deposit ID', key: 'depositId', type: 'text', width: 11 },
      { header: 'Payment ID', key: 'paymentId', type: 'text', width: 11 },
      { header: 'Family Member', key: 'memberName', type: 'text', width: 22 },
      { header: 'Message', key: 'message', type: 'text', width: 60 },
      { header: 'Status', key: 'status', type: 'text', width: 10 }
    ]
  };

  function idSort(a, b) {
    var na = +String(a.id).replace(/\D/g, ''), nb = +String(b.id).replace(/\D/g, '');
    return na - nb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  var INSTRUCTIONS = [
    'Deposit Manager — how to fill this workbook',
    '',
    'You can set up the whole family at once: fill in the FamilyMembers and Deposits sheets, then in the app choose "Open Excel file". Leave the Payments and Notifications sheets empty — the app fills them in.',
    '',
    'FamilyMembers sheet: one row per person. Name is required. Member ID is optional (the app gives one, like M001).',
    'Example:  M001 | Lakshmi | Tambaram | 9876543210',
    '',
    'Deposits sheet: one row per deposit.',
    '• Member ID or Family Member (name) — who the deposit belongs to. If the name is not in FamilyMembers, the app adds that person.',
    '• Bank/Institution and Deposit Amount — required.',
    '• Account Number — type it as it appears in the passbook/receipt. The column is text, so leading zeros are kept. The app only ever shows the last 4 digits.',
    '• Interest Rate (%) — e.g. 7.25',
    '• Payment Amount — the interest you receive each time. Leave blank and the app calculates it from amount × rate.',
    '• Payment Frequency — Monthly, Quarterly, Half-Yearly or Annually (pick from the dropdown).',
    '• Dates — Start Date, First Payment Date, Maturity Date. Type like 20-09-2026 (day first) or pick a date. The app works out every later payment date from the First Payment Date.',
    '• Status — Active or Closed (Active if left blank).',
    'Example:  D001 | M001 | Lakshmi | Tambaram | SBI Tambaram | 30012345678 | 100000 | 7.25 | 1812.50 | Quarterly | 20-06-2026 | 20-09-2026 | 20-06-2031 | Active',
    '',
    'Payments sheet: filled by the app. Every scheduled payment is one row. The Family Member and Bank columns are there for easy reading — the app uses Deposit ID.',
    'Notifications sheet: the upcoming reminders the app has scheduled (payments 7, 3 and 1 day before and on the day; maturity 30, 7 and 1 day before and on the day).',
    '',
    'Keep this file private — it contains full account numbers.'
  ];

  /**
   * Sheets for the workbook. `template` gives the empty template with an Instructions sheet.
   */
  function workbookSheets(data, prefs, today, opts) {
    opts = opts || {};
    var freqList = { key: 'frequency', list: FREQS };
    var depStatus = { key: 'status', list: ['Active', 'Closed'] };
    var payStatus = { key: 'status', list: ['Pending', 'Received', 'Overdue'] };
    if (opts.template) {
      return [
        { name: 'Instructions', plain: true, columns: [{ header: '', key: 'x', type: 'wrap', width: 120 }], rows: INSTRUCTIONS },
        { name: 'FamilyMembers', columns: COL.members, rows: [] },
        { name: 'Deposits', columns: COL.deposits, rows: [], validations: [freqList, depStatus] },
        { name: 'Payments', columns: COL.payments, rows: [], validations: [payStatus] },
        { name: 'Notifications', columns: COL.notifications, rows: [] }
      ];
    }
    var members = data.members.slice().sort(idSort);
    var deposits = data.deposits.slice().sort(idSort).map(function (d) {
      var r = U.clone(d);
      r.memberName = memberName(data, d.memberId);
      return r;
    });
    var payments = data.payments.slice().sort(function (a, b) {
      return idSort({ id: a.depositId }, { id: b.depositId }) || byDue(a, b);
    }).map(function (p) {
      var d = deposit(data, p.depositId), r = U.clone(p);
      r.memberName = d ? memberName(data, d.memberId) : '';
      r.bank = d ? d.bank : '';
      return r;
    });
    return [
      { name: 'FamilyMembers', columns: COL.members, rows: members },
      { name: 'Deposits', columns: COL.deposits, rows: deposits, validations: [freqList, depStatus] },
      { name: 'Payments', columns: COL.payments, rows: payments, validations: [payStatus] },
      { name: 'Notifications', columns: COL.notifications, rows: buildReminders(data, prefs, today) }
    ];
  }

  /* ------------------------------------------------------------ Excel import */

  var SHEETS = {
    members: ['familymembers', 'familymember', 'members', 'member', 'family'],
    deposits: ['deposits', 'deposit', 'fds', 'fd', 'fixeddeposits', 'fixeddeposit'],
    payments: ['payments', 'payment', 'payouts', 'interestpayments']
  };

  var FIELDS = {
    members: {
      id: ['memberid', 'memid', 'memberno', 'id'],
      name: ['name', 'membername', 'familymember', 'fullname', 'membersname'],
      village: ['village', 'town', 'place', 'city', 'location', 'ooru', 'area'],
      phone: ['phonenumber', 'phone', 'mobile', 'mobileno', 'mobilenumber', 'contact', 'contactnumber', 'phoneno', 'cell']
    },
    deposits: {
      id: ['depositid', 'fdid', 'depid', 'id'],
      memberId: ['memberid', 'memid'],
      memberName: ['familymember', 'membername', 'member', 'name', 'depositor', 'holder', 'accountholder', 'depositorname'],
      village: ['village', 'town', 'place', 'city', 'location'],
      bank: ['bankinstitution', 'bank', 'institution', 'bankname', 'bankorinstitution', 'bankbranch'],
      accountNumber: ['accountnumber', 'accountno', 'acno', 'accno', 'account', 'fdnumber', 'fdno', 'fdaccountnumber', 'depositnumber', 'receiptno', 'receiptnumber'],
      depositAmount: ['depositamount', 'amount', 'principal', 'principalamount', 'depositamt', 'fdamount'],
      interestRate: ['interestrate', 'rate', 'roi', 'rateofinterest', 'interestratepercent', 'interestratepa'],
      paymentAmount: ['paymentamount', 'interestamount', 'payout', 'payoutamount', 'interestpayout', 'interestperpayment', 'paymentamt'],
      frequency: ['paymentfrequency', 'frequency', 'payoutfrequency', 'interestfrequency', 'paymentfreq'],
      startDate: ['startdate', 'depositdate', 'opendate', 'openingdate', 'dateofdeposit', 'start'],
      firstPaymentDate: ['firstpaymentdate', 'firstpayment', 'firstpayoutdate', 'firstinterestdate', 'firstduedate', 'firstpaymentdue'],
      maturityDate: ['maturitydate', 'maturity', 'maturesondate', 'maturedate', 'enddate'],
      status: ['status', 'depositstatus'],
      closedDate: ['closedon', 'closeddate', 'closedate', 'dateclosed'],
      notes: ['notes', 'note', 'remarks', 'remark', 'comments', 'comment']
    },
    payments: {
      id: ['paymentid', 'id'],
      depositId: ['depositid', 'fdid'],
      dueDate: ['duedate', 'paymentdate', 'date', 'due'],
      expectedAmount: ['expectedamount', 'expected', 'dueamount', 'amount'],
      receivedAmount: ['receivedamount', 'received', 'amountreceived', 'paidamount'],
      receivedDate: ['receiveddate', 'datereceived', 'paiddate', 'paidon', 'receivedon'],
      status: ['status', 'paymentstatus'],
      notes: ['notes', 'note', 'remarks', 'remark', 'comments']
    }
  };

  function findSheet(book, kind) {
    for (var i = 0; i < book.sheets.length; i++) {
      if (SHEETS[kind].indexOf(U.normKey(book.sheets[i].name)) >= 0) return book.sheets[i];
    }
    return null;
  }

  /** Locate the header row (within the first 10 rows) and map fields to column indexes. */
  function mapHeader(rows, fields) {
    var best = null;
    for (var r = 0; r < Math.min(rows.length, 10); r++) {
      var row = rows[r] || [], map = {}, used = {}, hits = 0;
      for (var f in fields) {
        for (var c = 0; c < row.length; c++) {
          if (used[c] || !row[c]) continue;
          if (fields[f].indexOf(U.normKey(row[c].text !== undefined ? row[c].text : row[c].v)) >= 0) {
            map[f] = c; used[c] = 1; hits++; break;
          }
        }
      }
      if (hits >= 2 && (!best || hits > best.hits)) best = { row: r, map: map, hits: hits };
    }
    return best;
  }

  function cellText(cell) {
    if (!cell) return '';
    if (typeof cell.v === 'number') {
      if (cell.date) return cell.date;
      var t = String(cell.text || cell.v);
      if (/e/i.test(t)) return String(Math.round(cell.v)); // Excel scientific notation
      return t;
    }
    return String(cell.v).trim();
  }

  /** Raw number from a cell ('' when empty, NaN when not a number). Callers round. */
  function cellNum(cell) {
    if (!cell) return '';
    var n = typeof cell.v === 'number' ? cell.v : U.toNumber(cell.v);
    return isFinite(n) ? n : NaN;
  }

  function cellDate(cell) {
    if (!cell) return '';
    if (cell.date) return cell.date;
    if (typeof cell.v === 'number' && cell.v > 10000 && cell.v < 110000) return DM.xlsx.serialToDate(cell.v, false);
    return U.parseFlexibleDate(cell.v) || null;
  }

  function isBlankRow(row) {
    if (!row) return true;
    for (var i = 0; i < row.length; i++) if (row[i] && U.str(row[i].v) !== '') return false;
    return true;
  }

  /**
   * Step 1 of an import: read the sheets into a fresh data set and collect warnings.
   * Nothing is changed in the app until finalizeImport is called.
   */
  function prepareImport(book, today) {
    var data = emptyData(), warnings = [], errors = [];
    var ms = findSheet(book, 'members'), ds = findSheet(book, 'deposits'), ps = findSheet(book, 'payments');
    if (!ms && !ds) {
      errors.push('No "FamilyMembers" or "Deposits" sheet was found. Download the blank template from Settings to see the expected layout.');
      return { data: data, warnings: warnings, errors: errors, counts: {}, pastCount: 0 };
    }
    var counts = { members: 0, membersAdded: 0, deposits: 0, payments: 0, skipped: 0 };
    var memberIdMap = {}; // id as written in the sheet -> final id

    function get(row, hdr, f) { return hdr.map[f] === undefined ? null : row[hdr.map[f]]; }

    /* members */
    if (ms) {
      var mh = mapHeader(ms.rows, FIELDS.members);
      if (!mh || mh.map.name === undefined) {
        if (ms.rows.some(function (r) { return !isBlankRow(r); })) warnings.push('FamilyMembers sheet: could not find a "Name" column, so the sheet was skipped.');
      } else {
        var usedM = {};
        for (var r = mh.row + 1; r < ms.rows.length; r++) {
          var row = ms.rows[r];
          if (isBlankRow(row)) continue;
          var name = cellText(get(row, mh, 'name'));
          if (!name) { warnings.push('FamilyMembers row ' + (r + 1) + ': no name, row skipped.'); counts.skipped++; continue; }
          var rawId = cellText(get(row, mh, 'id')).toUpperCase(), id = rawId;
          if (!id || usedM[id]) {
            if (id) warnings.push('FamilyMembers row ' + (r + 1) + ': Member ID ' + id + ' is used twice; a new ID was given.');
            id = null;
          }
          var m = { id: id, name: name, village: cellText(get(row, mh, 'village')), phone: cellText(get(row, mh, 'phone')) };
          data.members.push(m);
          if (id) usedM[id] = 1;
          m._raw = rawId;
          counts.members++;
        }
        data.members.forEach(function (m) {
          if (!m.id) { m.id = U.nextId('M', Object.keys(usedM), 3); usedM[m.id] = 1; }
          if (m._raw && !memberIdMap[m._raw]) memberIdMap[m._raw] = m.id;
          delete m._raw;
        });
      }
    }

    function findMemberByName(name, village) {
      var k = U.normKey(name), v = U.normKey(village);
      var hits = data.members.filter(function (m) { return U.normKey(m.name) === k; });
      if (hits.length > 1 && v) {
        var narrowed = hits.filter(function (m) { return U.normKey(m.village) === v; });
        if (narrowed.length) hits = narrowed;
      }
      return hits[0] || null;
    }

    /* deposits */
    var depIdMap = {};
    if (ds) {
      var dh = mapHeader(ds.rows, FIELDS.deposits);
      if (!dh) {
        if (ds.rows.some(function (r) { return !isBlankRow(r); })) errors.push('Deposits sheet: could not recognise the column headings. Use the blank template layout.');
      } else {
        var usedD = {}, pendingIds = [];
        for (var dr = dh.row + 1; dr < ds.rows.length; dr++) {
          var drow = ds.rows[dr];
          if (isBlankRow(drow)) continue;
          var rowNo = dr + 1, label = 'Deposits row ' + rowNo;
          var mid = cellText(get(drow, dh, 'memberId')).toUpperCase(), mname = cellText(get(drow, dh, 'memberName'));
          var village = cellText(get(drow, dh, 'village'));
          var mem = null;
          if (mid && memberIdMap[mid]) mem = member(data, memberIdMap[mid]) || data.members.filter(function (x) { return x.id === memberIdMap[mid]; })[0];
          if (!mem && mname) mem = findMemberByName(mname, village);
          if (!mem && mid && !mname) {
            warnings.push(label + ': Member ID ' + mid + ' is not in the FamilyMembers sheet, row skipped.');
            counts.skipped++;
            continue;
          }
          if (!mem && !mname) { warnings.push(label + ': no family member given, row skipped.'); counts.skipped++; continue; }
          if (!mem) {
            mem = { id: U.nextId('M', data.members.map(function (x) { return x.id; }), 3), name: mname, village: village, phone: '' };
            data.members.push(mem);
            invalidate(data);
            counts.membersAdded++;
            warnings.push('Added family member "' + mname + '" (named in ' + label + ' but not in FamilyMembers).');
          }
          var bank = cellText(get(drow, dh, 'bank'));
          var amount = cellNum(get(drow, dh, 'depositAmount'));
          if (amount > 0) amount = U.round2(amount);
          if (!bank && !(amount > 0)) { warnings.push(label + ': no bank and no amount, row skipped.'); counts.skipped++; continue; }
          if (!bank) warnings.push(label + ': bank/institution is missing.');
          if (!(amount > 0)) { warnings.push(label + ': deposit amount is missing or not a number.'); amount = ''; }

          var rateCell = get(drow, dh, 'interestRate'), rate = cellNum(rateCell);
          if (rate === '' || isNaN(rate)) { if (rateCell) warnings.push(label + ': interest rate "' + cellText(rateCell) + '" is not a number.'); rate = ''; }
          else {
            if (rateCell && (rateCell.pct || (rate > 0 && rate < 1))) rate = rate * 100;
            rate = Math.round(rate * 1000) / 1000;
          }

          var freqCell = get(drow, dh, 'frequency'), freq = parseFrequency(cellText(freqCell));
          if (!freq) warnings.push(label + ': payment frequency ' + (freqCell ? '"' + cellText(freqCell) + '" not recognised' : 'missing') + ' — use Monthly, Quarterly, Half-Yearly or Annually. No payment dates were made for this deposit.');

          var dates = {};
          ['startDate', 'firstPaymentDate', 'maturityDate', 'closedDate'].forEach(function (k) {
            var c = get(drow, dh, k), v = cellDate(c);
            if (v === null) { warnings.push(label + ': "' + cellText(c) + '" is not a date I can read (' + k.replace(/([A-Z])/g, ' $1').toLowerCase() + ').'); v = ''; }
            dates[k] = v || '';
          });
          if (!dates.firstPaymentDate && freq && dates.startDate) {
            dates.firstPaymentDate = U.addMonths(dates.startDate, FREQ_MONTHS[freq]);
            warnings.push(label + ': first payment date missing — assumed ' + U.fmtDate(dates.firstPaymentDate) + ' (one ' + freq.toLowerCase() + ' period after the start date).');
          } else if (!dates.firstPaymentDate && freq) {
            warnings.push(label + ': first payment date missing. No payment dates were made for this deposit.');
          }

          var payCell = get(drow, dh, 'paymentAmount'), pay = cellNum(payCell);
          if (pay !== '' && !isNaN(pay)) pay = U.round2(pay);
          if (pay === '' || isNaN(pay)) {
            if (payCell) warnings.push(label + ': payment amount "' + cellText(payCell) + '" is not a number.');
            pay = suggestPayment(amount, rate, freq);
            if (pay !== '') warnings.push(label + ': payment amount calculated as ' + U.fmtMoney(pay) + ' from amount × rate.');
            else pay = 0;
          }

          var statusTxt = cellText(get(drow, dh, 'status')), status = parseDepositStatus(statusTxt);
          if (statusTxt && !status) warnings.push(label + ': status "' + statusTxt + '" not recognised, treated as Active.');
          status = status || (dates.closedDate ? 'Closed' : 'Active');

          var accCell = get(drow, dh, 'accountNumber'), acc = cellText(accCell).replace(/\s+/g, '');
          if (accCell && typeof accCell.v === 'number' && /e/i.test(String(accCell.text))) {
            warnings.push(label + ': the account number was stored by Excel as a rounded number (' + accCell.text + '). Please check it in the app.');
          }

          var rawDid = cellText(get(drow, dh, 'id')).toUpperCase(), did = rawDid;
          if (did && usedD[did]) { warnings.push(label + ': Deposit ID ' + did + ' is used twice; a new ID was given.'); did = ''; }
          var dep = {
            id: did, memberId: mem.id, village: village || mem.village, bank: bank, accountNumber: acc,
            depositAmount: amount, interestRate: rate, paymentAmount: pay, frequency: freq,
            startDate: dates.startDate, firstPaymentDate: dates.firstPaymentDate, maturityDate: dates.maturityDate,
            status: status, closedDate: status === 'Closed' ? dates.closedDate : '', notes: cellText(get(drow, dh, 'notes'))
          };
          if (dep.maturityDate && dep.firstPaymentDate && dep.maturityDate < dep.firstPaymentDate) {
            warnings.push(label + ': maturity date is before the first payment date — please check.');
          }
          if (did) usedD[did] = 1;
          data.deposits.push(dep);
          pendingIds.push({ dep: dep, raw: rawDid });
          counts.deposits++;
        }
        pendingIds.forEach(function (x) {
          if (!x.dep.id) { x.dep.id = U.nextId('D', Object.keys(usedD), 3); usedD[x.dep.id] = 1; }
          if (x.raw && !depIdMap[x.raw]) depIdMap[x.raw] = x.dep.id;
        });
      }
    }

    /* payments (history) */
    if (ps) {
      var ph = mapHeader(ps.rows, FIELDS.payments);
      if (ph && ph.map.depositId !== undefined && ph.map.dueDate !== undefined) {
        var usedP = {}, seen = {}, pList = [];
        for (var pr = ph.row + 1; pr < ps.rows.length; pr++) {
          var prow = ps.rows[pr];
          if (isBlankRow(prow)) continue;
          var plabel = 'Payments row ' + (pr + 1);
          var rawDep = cellText(get(prow, ph, 'depositId')).toUpperCase(), depId = depIdMap[rawDep];
          if (!depId) { warnings.push(plabel + ': Deposit ID ' + (rawDep || '(blank)') + ' is not in the Deposits sheet, row skipped.'); counts.skipped++; continue; }
          var due = cellDate(get(prow, ph, 'dueDate'));
          if (!due) { warnings.push(plabel + ': due date missing or unreadable, row skipped.'); counts.skipped++; continue; }
          var rAmt = cellNum(get(prow, ph, 'receivedAmount')), rDate = cellDate(get(prow, ph, 'receivedDate'));
          if (rAmt > 0) rAmt = U.round2(rAmt);
          var pst = parsePaymentStatus(cellText(get(prow, ph, 'status')));
          if (!pst) pst = (rDate || rAmt > 0) ? 'Received' : 'Pending';
          var exp = cellNum(get(prow, ph, 'expectedAmount'));
          if (exp !== '' && !isNaN(exp)) exp = U.round2(exp);
          var depObj = data.deposits.filter(function (x) { return x.id === depId; })[0];
          if (exp === '' || isNaN(exp)) exp = depObj ? depObj.paymentAmount : 0;
          var key = depId + '|' + due;
          if (seen[key]) { warnings.push(plabel + ': duplicate payment for ' + depId + ' on ' + U.fmtDate(due) + ', row skipped.'); counts.skipped++; continue; }
          seen[key] = 1;
          var pid = cellText(get(prow, ph, 'id')).toUpperCase();
          if (!/^P\d+$/.test(pid) || usedP[pid]) pid = '';
          var p = {
            id: pid, depositId: depId, dueDate: due, expectedAmount: exp,
            receivedAmount: pst === 'Received' ? (rAmt > 0 ? rAmt : exp) : '',
            receivedDate: pst === 'Received' ? (rDate || due) : '',
            status: pst === 'Received' ? 'Received' : 'Pending', notes: cellText(get(prow, ph, 'notes'))
          };
          if (pid) usedP[pid] = 1;
          pList.push(p);
          counts.payments++;
        }
        var ctr = maxNum('P', Object.keys(usedP));
        pList.forEach(function (p) { if (!p.id) { ctr++; p.id = 'P' + U.pad(ctr, 5); } });
        data.payments = pList;
      } else if (ps.rows.some(function (r) { return !isBlankRow(r); })) {
        warnings.push('Payments sheet: could not find "Deposit ID" and "Due Date" columns, so payment history was not loaded.');
      }
    }

    invalidate(data);
    // Preview how many past payment dates the schedule would add, so the user can say how to treat them.
    var trial = normalizeData(U.clone(data));
    var sim = syncSchedule(trial, { today: today, keepOffSchedule: true });
    var past = sim.created.filter(function (p) { return p.dueDate < today; }).length;
    return { data: data, warnings: warnings, errors: errors, counts: counts, pastCount: past };
  }

  /** Step 2: build the final data set, generating schedules. pastAs: 'received' | 'pending'. */
  function finalizeImport(prep, pastAs, today) {
    var data = normalizeData(U.clone(prep.data));
    var s = syncSchedule(data, { today: today, keepOffSchedule: true });
    var auto = applyPastChoice(s.created, pastAs, today);
    refreshStatuses(data, today);
    invalidate(data);
    return { data: data, generated: s.created.length, autoReceived: auto };
  }

  /** Keep schedules rolling forward (called on every app start). */
  function rollForward(data, today) {
    return syncSchedule(data, { today: today, keepOffSchedule: true });
  }

  DM.model = {
    FREQS: FREQS, FREQ_MONTHS: FREQ_MONTHS, DEFAULT_PREFS: DEFAULT_PREFS, HORIZON_MONTHS: HORIZON_MONTHS, PAST_NOTE: PAST_NOTE,
    emptyData: emptyData, normalizeData: normalizeData, invalidate: invalidate,
    parseFrequency: parseFrequency, parseDepositStatus: parseDepositStatus, parsePaymentStatus: parsePaymentStatus,
    suggestPayment: suggestPayment,
    member: member, deposit: deposit, payment: payment, paymentsOf: paymentsOf, depositsOf: depositsOf, memberName: memberName,
    hasSchedule: hasSchedule, dueDates: dueDates, totalPayments: totalPayments, syncSchedule: syncSchedule,
    refreshStatuses: refreshStatuses, countPastDue: countPastDue, nextPayment: nextPayment, depositSummary: depositSummary,
    validateMember: validateMember, saveMember: saveMember, deleteMember: deleteMember,
    validateDeposit: validateDeposit, saveDeposit: saveDeposit, closeDeposit: closeDeposit, reopenDeposit: reopenDeposit,
    canDeleteDeposit: canDeleteDeposit, deleteDeposit: deleteDeposit,
    markReceived: markReceived, markNotReceived: markNotReceived, updatePayment: updatePayment,
    buildReminders: buildReminders, computeStats: computeStats, openPayments: openPayments,
    searchDeposits: searchDeposits, villages: villages, banks: banks,
    workbookSheets: workbookSheets, prepareImport: prepareImport, finalizeImport: finalizeImport, rollForward: rollForward
  };
})(window.DM = window.DM || {});
