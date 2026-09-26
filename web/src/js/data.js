/* Deposit Manager — data model: members, deposits, interest income, reminders, statistics,
 * and mapping to/from the Excel workbook. Pure logic, no DOM.
 *
 * A deposit follows the family's 16-column sheet:
 *   S.No | Bank Name | Deposit No | Depositer Name | Interest type | percentage | Deposit Value |
 *   Deposit Date | No of Days | Mature Date | Deposit position | monthly Renewal Date | Income Date |
 *   Amount of Intersest | Deposited Village | Remarks
 * The interest ("Amount of Intersest") is received once, on the Income Date; that receipt is
 * tracked as a payment (Pending / Received / Overdue). "Deposit position" and "monthly Renewal
 * Date" are worked out from the dates, so they are always current. */
(function (DM) {
  'use strict';
  var U = DM.util;

  var INTEREST_TYPES = ['Simple', 'Cumulative'];
  var POSITIONS = ['Active', 'Maturing Soon', 'Matured', 'Closed'];
  var MATURING_SOON_DAYS = 30;
  var TERMS = [180, 270, 365, 730, 1095, 1825];   // quick choices for "No of Days"
  var PAST_NOTE = 'Marked received automatically (date was before the deposit was added)';

  var DEFAULT_PREFS = {
    notify: { enabled: true, time: '09:00', paymentDays: [7, 3, 1, 0], maturityDays: [30, 7, 1, 0], renewalDays: [] }
  };

  /* ------------------------------------------------------------ basics */

  function emptyData() {
    return { version: 2, members: [], deposits: [], payments: [] };
  }

  function parseInterestType(v) {
    var k = U.normKey(v);
    if (!k) return '';
    if (/^(simple|si|s|simpleinterest|noncumulative|noncum|payout|periodic|regular)$/.test(k)) return 'Simple';
    if (/^(cumulative|cum|c|ci|compound|compounding|compoundinterest|reinvest|reinvestment)$/.test(k)) return 'Cumulative';
    return '';
  }

  /** "Deposit position" / status text -> stored status. Maturing Soon and Matured are still open deposits. */
  function parseDepositStatus(v) {
    var k = U.normKey(v);
    if (!k) return '';
    if (/^(active|open|running|live|ongoing|maturingsoon|maturing|dueformaturity|matured|renewalpending|renewalrequired)$/.test(k)) return 'Active';
    if (/^(closed|close|inactive|withdrawn|ended|done|renewed|settled|redeemed|paid)$/.test(k)) return 'Closed';
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

  function intNum(v) {
    var n = U.toNumber(v);
    return isFinite(n) && n > 0 ? Math.round(n) : '';
  }

  /** Tenure in whole months, as the family's sheet counts it: 180 days = 6, 270 = 9, 365 = 12, 730 = 24. */
  function tenureMonths(days) {
    return Math.round(+days * 12 / 365);
  }

  /**
   * Interest for the whole term, the way the family's sheet calculates it:
   * Deposit Value × percentage × months ÷ 12 (the same for Simple and Cumulative).
   */
  function suggestInterest(amount, rate, days) {
    var a = +amount, r = +rate, d = +days;
    if (!(a > 0) || !(r > 0) || !(d > 0)) return '';
    var months = tenureMonths(d);
    var years = months >= 1 ? months / 12 : d / 365;
    return U.round2(a * r / 100 * years);
  }

  function describeTerm(days) {
    var d = +days;
    if (!(d > 0)) return '';
    var m = tenureMonths(d);
    if (m >= 12 && m % 12 === 0) return (m / 12) + (m === 12 ? ' year' : ' years');
    if (m >= 1) return m + (m === 1 ? ' month' : ' months');
    return d + ' days';
  }

  /** Numeric part of an S.No / ID ("7" -> 7, "D007" -> 7). */
  function idNum(id) {
    var m = /(\d+)\s*$/.exec(String(id || ''));
    return m ? +m[1] : 0;
  }

  function nextSno(ids) {
    var max = 0;
    ids.forEach(function (id) { var n = idNum(id); if (n > max) max = n; });
    return String(max + 1);
  }

  /** Fill in whichever of start / days / maturity is missing from the other two. */
  function resolveTerm(start, days, maturity) {
    var s = U.isValidISO(start) ? start : '', m = U.isValidISO(maturity) ? maturity : '', d = intNum(days);
    if (s && d && !m) m = U.addDays(s, d);
    else if (s && m && !d) { var diff = U.diffDays(s, m); d = diff > 0 ? diff : ''; }
    else if (!s && m && d) s = U.addDays(m, -d);
    return { start: s, days: d, maturity: m };
  }

  /** Make any loaded object into a clean data set (also upgrades data saved by version 1). */
  function normalizeData(raw) {
    var d = emptyData();
    if (!raw || typeof raw !== 'object') return d;
    (raw.members || []).forEach(function (m) {
      if (!m || !m.id) return;
      d.members.push({ id: U.str(m.id), name: U.str(m.name), village: U.str(m.village), phone: U.str(m.phone) });
    });
    (raw.deposits || []).forEach(function (x) {
      if (!x || !x.id) return;
      var t = resolveTerm(x.startDate, x.days, x.maturityDate);
      var amount = num(x.depositAmount), rate = rateNum(x.interestRate);
      var interest = num(x.interestAmount);
      if (interest === '') interest = suggestInterest(amount, rate, t.days);
      d.deposits.push({
        id: U.str(x.id), memberId: U.str(x.memberId), village: U.str(x.village), bank: U.str(x.bank),
        accountNumber: U.str(x.accountNumber),
        interestType: INTEREST_TYPES.indexOf(x.interestType) >= 0 ? x.interestType : (parseInterestType(x.interestType) || 'Simple'),
        interestRate: rate, depositAmount: amount, startDate: t.start, days: t.days, maturityDate: t.maturity,
        incomeDate: U.isValidISO(x.incomeDate) ? x.incomeDate : t.maturity,
        interestAmount: interest === '' ? 0 : interest,
        status: x.status === 'Closed' ? 'Closed' : 'Active',
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

  /* ------------------------------------------------------------ derived columns */

  /** "Deposit position": Active, Maturing Soon (within 30 days), Matured (date passed, still open) or Closed. */
  function position(dep, today) {
    if (dep.status === 'Closed') return 'Closed';
    if (!U.isValidISO(dep.maturityDate)) return 'Active';
    if (dep.maturityDate < today) return 'Matured';
    if (dep.maturityDate <= U.addDays(today, MATURING_SOON_DAYS)) return 'Maturing Soon';
    return 'Active';
  }

  /**
   * "monthly Renewal Date": the next date on the deposit's day of the month (from the Deposit Date),
   * never later than the Mature Date. Closed and matured deposits show their Mature Date.
   */
  function renewalDate(dep, today) {
    var mat = U.isValidISO(dep.maturityDate) ? dep.maturityDate : '';
    if (dep.status === 'Closed') return mat || (U.isValidISO(dep.closedDate) ? dep.closedDate : '');
    if (!U.isValidISO(dep.startDate)) return mat;
    if (mat && mat < today) return mat;
    var from = today > dep.startDate ? today : U.addDays(dep.startDate, 1);
    var s = U.parseISO(dep.startDate), f = U.parseISO(from);
    var k = (f.y - s.y) * 12 + (f.m - s.m), c = U.addMonths(dep.startDate, k, s.d);
    if (c < from) c = U.addMonths(dep.startDate, k + 1, s.d);
    if (mat && c > mat) c = mat;
    return c;
  }

  /** The monthly renewal dates of a deposit between two dates (for reminders and the Payments screen). */
  function renewalDatesBetween(dep, from, to) {
    if (dep.status === 'Closed' || !U.isValidISO(dep.startDate)) return [];
    var mat = U.isValidISO(dep.maturityDate) ? dep.maturityDate : '9999-12-31';
    var out = [], s = U.parseISO(dep.startDate), f = U.parseISO(from);
    var k = Math.max(1, (f.y - s.y) * 12 + (f.m - s.m) - 1);
    for (var i = 0; i < 40; i++, k++) {
      var c = U.addMonths(dep.startDate, k, s.d);
      if (c > to || c > mat) break;
      if (c >= from) out.push(c);
    }
    return out;
  }

  /* ------------------------------------------------------------ income schedule */

  function hasSchedule(dep) {
    return U.isValidISO(dep.incomeDate);
  }

  /** The interest is received once, on the Income Date (not after a deposit was closed early). */
  function dueDates(dep) {
    if (!hasSchedule(dep)) return [];
    if (dep.status === 'Closed' && U.isValidISO(dep.closedDate) && dep.incomeDate > dep.closedDate) return [];
    return [dep.incomeDate];
  }

  function refreshStatuses(data, today) {
    data.payments.forEach(function (p) {
      if (p.status === 'Received') return;
      p.status = p.dueDate < today ? 'Overdue' : 'Pending';
    });
  }

  /**
   * Make stored income rows match each deposit:
   *  - adds the row for the Income Date when it is missing
   *  - removes not-yet-received rows whose date no longer applies (unless keepOffSchedule)
   *  - never touches received rows (history is permanent)
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
      var dates = dueDates(dep), want = new Set(dates);
      var mine = grouped[dep.id] || [], have = {};
      mine.forEach(function (p) {
        var onSchedule = want.has(p.dueDate);
        if (p.status !== 'Received' && !onSchedule && !opts.keepOffSchedule) { removedIds.add(p.id); return; }
        if (have[p.dueDate] && p.status !== 'Received' && !opts.keepOffSchedule) { removedIds.add(p.id); return; }
        if (!have[p.dueDate] || p.status === 'Received') have[p.dueDate] = p;
        if (opts.updateAmounts && p.status !== 'Received' && dep.interestAmount !== '') p.expectedAmount = dep.interestAmount;
      });
      dates.forEach(function (d) {
        if (have[d]) return;
        counter++;
        var p = {
          id: 'P' + U.pad(counter, 5), depositId: dep.id, dueDate: d, expectedAmount: dep.interestAmount,
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

  /** Rows already due — or belonging to a closed deposit — are "earlier" payments the user is asked about. */
  function isEarlier(data, p, today) {
    if (p.dueDate < today) return true;
    var d = deposit(data, p.depositId);
    return !!(d && d.status === 'Closed');
  }

  function applyPastChoice(rows, pastAs, today, data) {
    var n = 0;
    if (pastAs !== 'received') return 0;
    rows.forEach(function (p) {
      if (p.status !== 'Received' && (data ? isEarlier(data, p, today) : p.dueDate < today)) {
        p.status = 'Received';
        p.receivedAmount = p.expectedAmount;
        p.receivedDate = p.dueDate;
        p.notes = PAST_NOTE;
        n++;
      }
    });
    return n;
  }

  /** How many income dates before today a deposit (new or edited) would add. */
  function countPastDue(data, dep, today) {
    var existing = new Set((dep.id ? paymentsOf(data, dep.id) : []).map(function (p) { return p.dueDate; }));
    return dueDates(dep).filter(function (d) { return d < today && !existing.has(d); }).length;
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
      payments: list, receivedCount: 0, receivedTotal: 0, overdue: [], overdueTotal: 0, next: null, lastReceived: null
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

  /* ------------------------------------------------------------ members */

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

  /* ------------------------------------------------------------ deposits */

  // The sheet has no "Closed On" column. A deposit closed before its Mature Date gets a remark,
  // so the date survives a trip through Excel; otherwise it is taken as closed on the Mature Date.
  var CLOSED_EARLY_RE = /\s*(?:·\s*)?Closed early on (\d{2})-(\d{2})-(\d{4})/i;

  function closedEarlyFrom(notes) {
    var m = CLOSED_EARLY_RE.exec(notes || '');
    return m ? U.parseFlexibleDate(m[1] + '-' + m[2] + '-' + m[3]) : '';
  }

  function withoutClosedEarly(notes) {
    return String(notes || '').replace(CLOSED_EARLY_RE, '').replace(/^\s*·\s*/, '').trim();
  }

  function ddmmyyyy(iso) {
    return iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4);
  }

  function validateDeposit(f) {
    var e = {};
    if (!f.memberId) e.memberId = 'Choose the depositer';
    if (!U.str(f.bank)) e.bank = 'Enter the bank name';
    if (!(+f.depositAmount > 0)) e.depositAmount = 'Enter the deposit value';
    if (INTEREST_TYPES.indexOf(f.interestType) < 0) e.interestType = 'Choose Simple or Cumulative';
    if (f.interestRate !== '' && f.interestRate !== undefined && !(+f.interestRate >= 0 && +f.interestRate <= 100)) e.interestRate = 'Percentage should be between 0 and 100';
    if (!U.isValidISO(f.startDate)) e.startDate = 'Enter the deposit date';
    var hasDays = +f.days > 0, hasMat = U.isValidISO(f.maturityDate);
    if (!hasDays && !hasMat) e.days = 'Enter the number of days or the mature date';
    if (f.days !== '' && f.days !== undefined && !(+f.days > 0 && +f.days <= 36500 && Math.round(+f.days) === +f.days)) e.days = 'Enter whole days, e.g. 365';
    if (hasMat && U.isValidISO(f.startDate) && f.maturityDate <= f.startDate) e.maturityDate = 'Mature date must be after the deposit date';
    if (U.isValidISO(f.incomeDate) && U.isValidISO(f.startDate) && f.incomeDate < f.startDate) e.incomeDate = 'Income date cannot be before the deposit date';
    if (f.interestAmount !== '' && f.interestAmount !== undefined && !(+f.interestAmount >= 0)) e.interestAmount = 'Enter a valid amount';
    var acc = U.str(f.accountNumber);
    if (acc && !/^[A-Za-z0-9 /-]{3,34}$/.test(acc)) e.accountNumber = 'Use letters and digits only';
    return e;
  }

  var SCHEDULE_FIELDS = ['incomeDate', 'status', 'closedDate'];

  /** Create or update a deposit and bring its income row up to date. */
  function saveDeposit(data, f, opts) {
    opts = opts || {};
    var today = opts.today || U.todayISO(), dep, isNew = !f.id;
    if (isNew) {
      dep = { id: nextSno(data.deposits.map(function (x) { return x.id; })), status: 'Active', closedDate: '' };
      data.deposits.push(dep);
    } else {
      dep = deposit(data, f.id);
      if (!dep) throw new Error('Deposit not found');
    }
    var before = U.clone(dep);
    var m = member(data, f.memberId);
    // Mature Date wins when both are given; otherwise it is Deposit Date + No of Days.
    var t = resolveTerm(f.startDate, U.isValidISO(f.maturityDate) ? '' : f.days, f.maturityDate);
    dep.memberId = f.memberId;
    dep.village = U.str(f.village) || (m ? m.village : '');
    dep.bank = U.str(f.bank);
    dep.accountNumber = U.str(f.accountNumber).replace(/\s+/g, '');
    dep.interestType = INTEREST_TYPES.indexOf(f.interestType) >= 0 ? f.interestType : 'Simple';
    dep.interestRate = rateNum(f.interestRate);
    dep.depositAmount = num(f.depositAmount);
    dep.startDate = t.start;
    dep.days = t.days;
    dep.maturityDate = t.maturity;
    dep.incomeDate = U.isValidISO(f.incomeDate) ? f.incomeDate : t.maturity;
    dep.interestAmount = num(f.interestAmount);
    if (dep.interestAmount === '') dep.interestAmount = suggestInterest(dep.depositAmount, dep.interestRate, dep.days) || 0;
    dep.notes = U.str(f.notes);
    invalidate(data);
    var changed = isNew || SCHEDULE_FIELDS.some(function (k) { return before[k] !== dep[k]; });
    var amountChanged = isNew || before.interestAmount !== dep.interestAmount;
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
    dep.notes = withoutClosedEarly(dep.notes);
    if (U.isValidISO(dep.maturityDate) && dep.closedDate < dep.maturityDate) {
      var mark = 'Closed early on ' + ddmmyyyy(dep.closedDate);
      dep.notes = dep.notes ? dep.notes + ' · ' + mark : mark;
    }
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
    dep.notes = withoutClosedEarly(dep.notes);
    invalidate(data);
    return syncSchedule(data, { ids: [id], today: today });
  }

  /** Starting values for renewing a deposit at maturity (cumulative deposits roll the interest in). */
  function renewalDraft(dep) {
    var value = +dep.depositAmount || 0;
    if (dep.interestType === 'Cumulative') value = U.round2(value + (+dep.interestAmount || 0));
    return {
      id: '', memberId: dep.memberId, village: dep.village, bank: dep.bank, accountNumber: dep.accountNumber,
      interestType: dep.interestType, interestRate: dep.interestRate, depositAmount: value,
      startDate: dep.maturityDate || '', days: dep.days || '', maturityDate: '', incomeDate: '', interestAmount: '',
      notes: 'Renewal of S.No ' + dep.id
    };
  }

  /** Save the renewed deposit and close the old one on its mature date. */
  function renewDeposit(data, oldId, f, opts) {
    opts = opts || {};
    var today = opts.today || U.todayISO(), old = deposit(data, oldId);
    if (!old) throw new Error('Deposit not found');
    var res = saveDeposit(data, f, opts);
    var closeOn = U.isValidISO(old.maturityDate) && old.maturityDate <= today ? old.maturityDate : today;
    closeDeposit(data, oldId, closeOn, today);
    var mark = 'Renewed as S.No ' + res.deposit.id;
    if (old.notes.indexOf(mark) < 0) old.notes = old.notes ? old.notes + ' · ' + mark : mark;
    invalidate(data);
    return res;
  }

  function canDeleteDeposit(data, id) {
    return !paymentsOf(data, id).some(function (p) { return p.status === 'Received'; });
  }

  function deleteDeposit(data, id) {
    if (!canDeleteDeposit(data, id)) throw new Error('This deposit already has received interest, so it is kept for your records. Close it instead.');
    data.deposits = data.deposits.filter(function (d) { return d.id !== id; });
    data.payments = data.payments.filter(function (p) { return p.depositId !== id; });
    invalidate(data);
  }

  /* ------------------------------------------------------------ payments */

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

  function openIncomeOn(data, dep, date) {
    return paymentsOf(data, dep.id).filter(function (p) { return p.status !== 'Received' && p.dueDate === date; })[0] || null;
  }

  /**
   * Reminder list (the Notifications sheet, and what the phone schedules), from today through
   * `horizonDays`: interest income 7/3/1/0 days before the Income Date, maturity 30/7/1/0 days
   * before the Mature Date (combined with the interest when both fall on the same day), and —
   * when switched on — the monthly renewal dates.
   */
  function buildReminders(data, prefs, today, horizonDays) {
    var n = (prefs && prefs.notify) || DEFAULT_PREFS.notify;
    horizonDays = horizonDays || 60;
    var until = U.addDays(today, horizonDays), out = [];
    var desc = function (a, b) { return b - a; };
    var pDays = (n.paymentDays || []).slice().sort(desc);
    var mDays = (n.maturityDays || []).slice().sort(desc);
    var rDays = (n.renewalDays || []).slice().sort(desc);
    var lastDue = U.addDays(until, pDays.length ? pDays[0] : 0);

    function line(dep) {
      return memberName(data, dep.memberId) + ' · ' + dep.bank + ' ' + U.maskAccount(dep.accountNumber);
    }

    data.payments.forEach(function (p) {
      if (p.status === 'Received' || p.dueDate < today || p.dueDate > lastDue) return;
      var dep = deposit(data, p.depositId);
      if (!dep || dep.status !== 'Active') return;
      var sameAsMaturity = p.dueDate === dep.maturityDate;
      pDays.forEach(function (d) {
        if (sameAsMaturity && mDays.indexOf(d) >= 0) return; // told together with the maturity reminder
        var on = U.addDays(p.dueDate, -d);
        if (on < today || on > until) return;
        out.push({
          type: 'Interest', notifyOn: on, daysBefore: d, eventDate: p.dueDate, depositId: dep.id, paymentId: p.id,
          memberName: memberName(data, dep.memberId),
          title: daysLabel(d, 'Interest due'),
          message: line(dep) + ' · ' + U.fmtMoney(p.expectedAmount) + ' interest on ' + U.fmtDate(p.dueDate)
        });
      });
    });

    data.deposits.forEach(function (dep) {
      if (dep.status !== 'Active') return;
      if (U.isValidISO(dep.maturityDate) && dep.maturityDate >= today) {
        var income = openIncomeOn(data, dep, dep.maturityDate);
        mDays.forEach(function (d) {
          var on = U.addDays(dep.maturityDate, -d);
          if (on < today || on > until) return;
          out.push({
            type: 'Maturity', notifyOn: on, daysBefore: d, eventDate: dep.maturityDate, depositId: dep.id, paymentId: income ? income.id : '',
            memberName: memberName(data, dep.memberId),
            title: daysLabel(d, 'Deposit matures'),
            message: line(dep) + ' · ' + U.fmtMoney(dep.depositAmount) +
              (income ? ' + ' + U.fmtMoney(income.expectedAmount) + ' interest' : '') + ' on ' + U.fmtDate(dep.maturityDate)
          });
        });
      }
      if (rDays.length) {
        renewalDatesBetween(dep, today, U.addDays(until, rDays[0])).forEach(function (rd) {
          if (rd === dep.maturityDate) return; // the maturity reminder covers it
          rDays.forEach(function (d) {
            var on = U.addDays(rd, -d);
            if (on < today || on > until) return;
            out.push({
              type: 'Renewal', notifyOn: on, daysBefore: d, eventDate: rd, depositId: dep.id, paymentId: '',
              memberName: memberName(data, dep.memberId),
              title: daysLabel(d, 'Monthly renewal date'),
              message: line(dep) + ' · ' + U.fmtMoney(dep.depositAmount) + ' · ' + U.fmtDate(rd)
            });
          });
        });
      }
    });

    out.sort(function (a, b) {
      return a.notifyOn < b.notifyOn ? -1 : a.notifyOn > b.notifyOn ? 1 :
        a.eventDate < b.eventDate ? -1 : a.eventDate > b.eventDate ? 1 : (idNum(a.depositId) - idNum(b.depositId)) || (a.type < b.type ? -1 : 1);
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
      byType: INTEREST_TYPES.map(function (t) { return { type: t, count: 0, principal: 0, interest: 0 }; }),
      interestExpected: 0, interest12: 0, thisMonth: { expected: 0, received: 0 },
      maturingSoon: [], matured: [], maturing: [], incomplete: []
    };
    var in30 = U.addDays(today, 30), in60 = U.addDays(today, 60), in365 = U.addDays(today, 365), monthKey = today.slice(0, 7);
    var active = {};
    data.deposits.forEach(function (d) {
      if (d.status === 'Closed') { st.closed++; return; }
      st.active++;
      active[d.id] = d;
      st.principal += +d.depositAmount || 0;
      var ti = INTEREST_TYPES.indexOf(d.interestType), b = st.byType[ti >= 0 ? ti : 0];
      b.count++;
      b.principal += +d.depositAmount || 0;
      b.interest += +d.interestAmount || 0;
      if (!U.isValidISO(d.maturityDate) || !hasSchedule(d)) st.incomplete.push(d);
      var pos = position(d, today);
      if (pos === 'Matured') st.matured.push(d);
      else if (pos === 'Maturing Soon') st.maturingSoon.push(d);
      if (U.isValidISO(d.maturityDate) && d.maturityDate >= today && d.maturityDate <= in60) st.maturing.push(d);
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
        st.interestExpected += +p.expectedAmount || 0;
        if (p.dueDate <= in365) st.interest12 += +p.expectedAmount || 0;
        if (p.dueDate <= in30) { st.upcoming30.count++; st.upcoming30.amount += +p.expectedAmount || 0; }
      }
    });
    st.byType.forEach(function (b) { b.principal = U.round2(b.principal); b.interest = U.round2(b.interest); });
    ['principal', 'interestExpected', 'interest12'].forEach(function (k) { st[k] = U.round2(st[k]); });
    st.overdue.amount = U.round2(st.overdue.amount);
    st.upcoming30.amount = U.round2(st.upcoming30.amount);
    st.thisMonth.expected = U.round2(st.thisMonth.expected);
    st.thisMonth.received = U.round2(st.thisMonth.received);
    var byMat = function (a, b) { return a.maturityDate < b.maturityDate ? -1 : 1; };
    st.maturingSoon.sort(byMat);
    st.matured.sort(byMat);
    st.maturing.sort(byMat);
    return st;
  }

  /** Unreceived income rows (optionally only for active deposits) sorted by date. */
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

  /** Monthly renewal dates of open deposits in a date range, sorted. */
  function renewalsBetween(data, from, to) {
    var out = [];
    data.deposits.forEach(function (d) {
      renewalDatesBetween(d, from, to).forEach(function (rd) { out.push({ date: rd, deposit: d }); });
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : idNum(a.deposit.id) - idNum(b.deposit.id); });
  }

  /* ------------------------------------------------------------ search */

  function searchDeposits(data, f, today) {
    f = f || {};
    today = today || U.todayISO();
    var q = U.str(f.q).toLowerCase(), qDigits = q.replace(/\D/g, ''), qCompact = q.replace(/\s/g, '');
    var list = data.deposits.filter(function (d) {
      if (f.status && f.status !== 'All') {
        if (f.status === 'Open') { if (d.status === 'Closed') return false; }
        else if (position(d, today) !== f.status) return false;
      }
      if (f.interestType && d.interestType !== f.interestType) return false;
      if (f.memberId && d.memberId !== f.memberId) return false;
      if (f.village && U.normKey(d.village) !== U.normKey(f.village)) return false;
      if (f.bank && U.normKey(d.bank) !== U.normKey(f.bank)) return false;
      if (!q) return true;
      var m = member(data, d.memberId);
      var hay = ['s.no ' + d.id, d.bank, d.village, d.notes, m ? m.name : '', m ? m.village : '', d.interestType].join(' ').toLowerCase();
      if (hay.indexOf(q) >= 0) return true;
      if (qCompact.length >= 3 && String(d.accountNumber).toLowerCase().indexOf(qCompact) >= 0) return true;
      if (qDigits.length >= 3 && qDigits === qCompact && String(d.accountNumber).indexOf(qDigits) >= 0) return true;
      return false;
    });
    var sort = f.sort || 'member';
    list.sort(function (a, b) {
      var r = 0;
      if (sort === 'amount') r = (+b.depositAmount || 0) - (+a.depositAmount || 0);
      else if (sort === 'maturity') r = (a.maturityDate || '9999') < (b.maturityDate || '9999') ? -1 : (a.maturityDate || '9999') > (b.maturityDate || '9999') ? 1 : 0;
      else if (sort === 'bank') r = a.bank.localeCompare(b.bank);
      else if (sort === 'newest') r = (b.startDate || '') < (a.startDate || '') ? -1 : (b.startDate || '') > (a.startDate || '') ? 1 : 0;
      else if (sort === 'sno') r = idNum(a.id) - idNum(b.id);
      else r = memberName(data, a.memberId).localeCompare(memberName(data, b.memberId));
      return r || (idNum(a.id) - idNum(b.id));
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

  // The Deposits sheet keeps the family's own 16 column headings, in their order and spelling.
  var COL = {
    deposits: [
      { header: 'S.No', key: 'sno', type: 'int', width: 8 },
      { header: 'Bank Name', key: 'bank', type: 'text', width: 16 },
      { header: 'Deposit No', key: 'accountNumber', type: 'text', width: 16 },
      { header: 'Depositer Name', key: 'memberName', type: 'text', width: 22 },
      { header: 'Interest type', key: 'interestType', type: 'text', width: 16 },
      { header: 'percentage', key: 'interestRate', type: 'rate', width: 12 },
      { header: 'Deposit Value', key: 'depositAmount', type: 'money', width: 16 },
      { header: 'Deposit Date', key: 'startDate', type: 'date', width: 16 },
      { header: 'No of Days', key: 'days', type: 'int', width: 14 },
      { header: 'Mature Date', key: 'maturityDate', type: 'date', width: 16 },
      { header: 'Deposit position', key: 'position', type: 'text', width: 18 },
      { header: 'monthly Renewal Date', key: 'renewalDate', type: 'date', width: 22 },
      { header: 'Income Date', key: 'incomeDate', type: 'date', width: 16 },
      { header: 'Amount of Intersest', key: 'interestAmount', type: 'money', width: 20 },
      { header: 'Deposited Village', key: 'village', type: 'text', width: 20 },
      { header: 'Remarks', key: 'notes', type: 'text', width: 28 }
    ],
    members: [
      { header: 'Member ID', key: 'id', type: 'text', width: 12 },
      { header: 'Name', key: 'name', type: 'text', width: 24 },
      { header: 'Village', key: 'village', type: 'text', width: 18 },
      { header: 'Phone Number', key: 'phone', type: 'text', width: 16 }
    ],
    payments: [
      { header: 'Payment ID', key: 'id', type: 'text', width: 12 },
      { header: 'S.No', key: 'sno', type: 'int', width: 8 },
      { header: 'Depositer Name', key: 'memberName', type: 'text', width: 22 },
      { header: 'Bank Name', key: 'bank', type: 'text', width: 16 },
      { header: 'Income Date', key: 'dueDate', type: 'date', width: 16 },
      { header: 'Expected Amount', key: 'expectedAmount', type: 'money', width: 16 },
      { header: 'Received Amount', key: 'receivedAmount', type: 'money', width: 16 },
      { header: 'Received Date', key: 'receivedDate', type: 'date', width: 16 },
      { header: 'Status', key: 'status', type: 'text', width: 11 },
      { header: 'Notes', key: 'notes', type: 'text', width: 32 }
    ],
    notifications: [
      { header: 'Notification ID', key: 'id', type: 'text', width: 14 },
      { header: 'Notify On', key: 'notifyOn', type: 'date', width: 14 },
      { header: 'Type', key: 'type', type: 'text', width: 11 },
      { header: 'Days Before', key: 'daysBefore', type: 'int', width: 11 },
      { header: 'Event Date', key: 'eventDate', type: 'date', width: 14 },
      { header: 'S.No', key: 'sno', type: 'int', width: 8 },
      { header: 'Payment ID', key: 'paymentId', type: 'text', width: 12 },
      { header: 'Depositer Name', key: 'memberName', type: 'text', width: 22 },
      { header: 'Message', key: 'message', type: 'text', width: 64 },
      { header: 'Status', key: 'status', type: 'text', width: 10 }
    ]
  };

  function idSort(a, b) {
    return idNum(a.id) - idNum(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  /** S.No as a number when it is one, so Excel sorts it properly. */
  function snoValue(id) {
    return /^\d+$/.test(String(id)) ? +id : id;
  }

  var INSTRUCTIONS = [
    'Deposit Manager — how to fill this workbook',
    '',
    'Fill in the Deposits sheet (one row per deposit) and open the file in the app with "Open my Excel file". The app fills in the other sheets itself.',
    '',
    'Deposits sheet — the 16 columns:',
    '• S.No — serial number of the deposit (1, 2, 3 …). Leave blank and the app numbers it.',
    '• Bank Name — e.g. SBI, Indian Bank, Post Office.',
    '• Deposit No — the deposit / receipt number, e.g. SBI001245. Kept as text; the app only ever shows the last 4 characters.',
    '• Depositer Name — whose deposit it is. The app adds each name to Family members.',
    '• Interest type — Simple or Cumulative (pick from the dropdown).',
    '• percentage — interest rate, e.g. 7.1',
    '• Deposit Value — the amount deposited.',
    '• Deposit Date — the day the deposit was made. Type like 15-01-2026 (day first) or pick a date.',
    '• No of Days — the term, e.g. 180, 270, 365 or 730. You can give either No of Days or Mature Date; the app works out the other.',
    '• Mature Date — the day the deposit matures (Deposit Date + No of Days).',
    '• Deposit position — Active, Maturing Soon, Matured or Closed. Only "Closed" needs to be typed; the app keeps the others up to date (Maturing Soon = matures within 30 days).',
    '• monthly Renewal Date — the next monthly date on the deposit\'s day (e.g. every 15th), never after the Mature Date. The app keeps it up to date.',
    '• Income Date — when the interest is received. Leave blank and the app uses the Mature Date.',
    '• Amount of Intersest — the interest for the whole term. Leave blank and the app calculates Deposit Value × percentage × months ÷ 12 (180 days = 6 months).',
    '• Deposited Village — where the deposit was made.',
    '• Remarks — anything else.',
    'Example:  1 | SBI | SBI001245 | Arun Kumar | Simple | 7.1 | 50000 | 15-01-2026 | 365 | 15-01-2027 | Active | 15-10-2026 | 15-01-2027 | 3550 | Mudichur | Regular deposit',
    '',
    'FamilyMembers sheet (optional): add phone numbers for depositers. Name must match the Depositer Name.',
    'Payments sheet: filled by the app — one row per interest income, with its status (Pending / Received / Overdue).',
    'Notifications sheet: the reminders the app has scheduled (interest 7, 3 and 1 day before and on the Income Date; maturity 30, 7 and 1 day before and on the Mature Date).',
    '',
    'Keep this file private — it contains full deposit numbers.'
  ];

  /** Sheets for the workbook. `template` gives the empty template with an Instructions sheet. */
  function workbookSheets(data, prefs, today, opts) {
    opts = opts || {};
    var depValidations = [{ key: 'interestType', list: INTEREST_TYPES }, { key: 'position', list: POSITIONS }];
    var payStatus = { key: 'status', list: ['Pending', 'Received', 'Overdue'] };
    if (opts.template) {
      return [
        { name: 'Instructions', plain: true, columns: [{ header: '', key: 'x', type: 'wrap', width: 120 }], rows: INSTRUCTIONS },
        { name: 'Deposits', columns: COL.deposits, rows: [], validations: depValidations },
        { name: 'FamilyMembers', columns: COL.members, rows: [] },
        { name: 'Payments', columns: COL.payments, rows: [], validations: [payStatus] },
        { name: 'Notifications', columns: COL.notifications, rows: [] }
      ];
    }
    var deposits = data.deposits.slice().sort(idSort).map(function (d) {
      var r = U.clone(d);
      r.sno = snoValue(d.id);
      r.memberName = memberName(data, d.memberId);
      r.position = position(d, today);
      r.renewalDate = renewalDate(d, today);
      return r;
    });
    var payments = data.payments.slice().sort(function (a, b) {
      return idNum(a.depositId) - idNum(b.depositId) || byDue(a, b);
    }).map(function (p) {
      var d = deposit(data, p.depositId), r = U.clone(p);
      r.sno = snoValue(p.depositId);
      r.memberName = d ? memberName(data, d.memberId) : '';
      r.bank = d ? d.bank : '';
      return r;
    });
    var reminders = buildReminders(data, prefs, today).map(function (r) { r.sno = snoValue(r.depositId); return r; });
    return [
      { name: 'Deposits', columns: COL.deposits, rows: deposits, validations: depValidations },
      { name: 'FamilyMembers', columns: COL.members, rows: data.members.slice().sort(idSort) },
      { name: 'Payments', columns: COL.payments, rows: payments, validations: [payStatus] },
      { name: 'Notifications', columns: COL.notifications, rows: reminders }
    ];
  }

  /* ------------------------------------------------------------ Excel import */

  var SHEETS = {
    members: ['familymembers', 'familymember', 'members', 'member', 'family', 'depositers', 'depositors'],
    deposits: ['deposits', 'deposit', 'fds', 'fd', 'fixeddeposits', 'fixeddeposit', 'deposittestdata', 'depositdata'],
    payments: ['payments', 'payment', 'payouts', 'interestpayments', 'income', 'interestincome'],
    other: ['notifications', 'instructions', 'reminders']
  };

  var FIELDS = {
    members: {
      id: ['memberid', 'memid', 'memberno'],
      name: ['name', 'membername', 'familymember', 'fullname', 'depositername', 'depositorname'],
      village: ['village', 'town', 'place', 'city', 'location', 'ooru', 'area'],
      phone: ['phonenumber', 'phone', 'mobile', 'mobileno', 'mobilenumber', 'contact', 'contactnumber', 'phoneno', 'cell']
    },
    deposits: {
      id: ['sno', 'slno', 'srno', 'serialno', 'serialnumber', 'sno1', 'depositid', 'fdid', 'id'],
      memberId: ['memberid', 'memid'],
      memberName: ['depositername', 'depositorname', 'depositer', 'depositor', 'familymember', 'membername', 'member', 'name', 'holder', 'accountholder', 'holdername'],
      bank: ['bankname', 'bank', 'bankinstitution', 'institution', 'bankorinstitution', 'bankbranch'],
      accountNumber: ['depositno', 'depositnumber', 'accountnumber', 'accountno', 'acno', 'accno', 'account', 'fdnumber', 'fdno', 'receiptno', 'receiptnumber'],
      interestType: ['interesttype', 'typeofinterest', 'interestmode', 'type', 'fdtype', 'deposittype'],
      interestRate: ['percentage', 'percent', 'interestrate', 'rate', 'roi', 'rateofinterest', 'interestpercentage', 'interestratepa'],
      depositAmount: ['depositvalue', 'depositamount', 'amount', 'principal', 'principalamount', 'value', 'fdamount'],
      startDate: ['depositdate', 'dateofdeposit', 'startdate', 'opendate', 'openingdate', 'date'],
      days: ['noofdays', 'numberofdays', 'days', 'tenuredays', 'tenure', 'period', 'periodindays', 'termdays', 'term'],
      maturityDate: ['maturedate', 'maturitydate', 'maturity', 'maturesondate', 'maturedon'],
      status: ['depositposition', 'position', 'status', 'depositstatus'],
      renewalDate: ['monthlyrenewaldate', 'renewaldate', 'monthlydate'],
      incomeDate: ['incomedate', 'interestdate', 'payoutdate', 'interestincomedate'],
      interestAmount: ['amountofintersest', 'amountofinterest', 'interestamount', 'interest', 'totalinterest', 'maturityinterest', 'interestincome'],
      village: ['depositedvillage', 'village', 'town', 'place', 'city', 'location'],
      closedDate: ['closedon', 'closeddate', 'closedate', 'dateclosed'],
      notes: ['remarks', 'remark', 'notes', 'note', 'comments', 'comment']
    },
    payments: {
      id: ['paymentid'],
      depositId: ['sno', 'slno', 'srno', 'serialno', 'depositid', 'fdid'],
      dueDate: ['incomedate', 'duedate', 'paymentdate', 'date', 'due'],
      expectedAmount: ['expectedamount', 'expected', 'dueamount', 'amount'],
      receivedAmount: ['receivedamount', 'received', 'amountreceived', 'paidamount'],
      receivedDate: ['receiveddate', 'datereceived', 'paiddate', 'paidon', 'receivedon'],
      status: ['status', 'paymentstatus'],
      notes: ['notes', 'note', 'remarks', 'remark', 'comments']
    }
  };

  function sheetKind(name) {
    var k = U.normKey(name);
    for (var kind in SHEETS) if (SHEETS[kind].indexOf(k) >= 0) return kind;
    return '';
  }

  function findSheet(book, kind) {
    for (var i = 0; i < book.sheets.length; i++) {
      if (sheetKind(book.sheets[i].name) === kind) return book.sheets[i];
    }
    return null;
  }

  /** The deposits sheet is found by its column headings, whatever the sheet is called. */
  function findDepositSheet(book) {
    var best = null;
    book.sheets.forEach(function (s) {
      var kind = sheetKind(s.name);
      if (kind && kind !== 'deposits') return;
      var hdr = mapHeader(s.rows, FIELDS.deposits);
      if (!hdr || hdr.hits < 4) return;
      var score = hdr.hits + (kind === 'deposits' ? 100 : 0);
      if (!best || score > best.score) best = { sheet: s, score: score };
    });
    return best ? best.sheet : null;
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

  function hasContent(sheet) {
    return sheet.rows.some(function (r) { return !isBlankRow(r); });
  }

  /**
   * Step 1 of an import: read the sheets into a fresh data set and collect warnings.
   * Nothing is changed in the app until finalizeImport is called.
   */
  function prepareImport(book, today) {
    var data = emptyData(), warnings = [], errors = [];
    var ds = findDepositSheet(book), ms = findSheet(book, 'members'), ps = findSheet(book, 'payments');
    var counts = { members: 0, membersAdded: 0, deposits: 0, payments: 0, skipped: 0 };
    var used = [];
    if (!ms && !ds) {
      errors.push('No deposits were found. The sheet needs column headings like S.No, Bank Name, Deposit No, Depositer Name, Deposit Value, Deposit Date, No of Days, Mature Date — download the blank template from Settings to see the layout.');
      return { data: data, warnings: warnings, errors: errors, counts: counts, pastCount: 0, usedSheets: used };
    }
    var memberIdMap = {};

    function get(row, hdr, f) { return hdr.map[f] === undefined ? null : row[hdr.map[f]]; }

    /* members (optional sheet with phone numbers) */
    if (ms) {
      used.push(ms.name);
      var mh = mapHeader(ms.rows, FIELDS.members);
      if (!mh || mh.map.name === undefined) {
        if (hasContent(ms)) warnings.push(ms.name + ' sheet: could not find a "Name" column, so the sheet was skipped.');
      } else {
        var usedM = {};
        for (var r = mh.row + 1; r < ms.rows.length; r++) {
          var row = ms.rows[r];
          if (isBlankRow(row)) continue;
          var name = cellText(get(row, mh, 'name'));
          if (!name) { warnings.push(ms.name + ' row ' + (r + 1) + ': no name, row skipped.'); counts.skipped++; continue; }
          var rawId = cellText(get(row, mh, 'id')).toUpperCase(), id = rawId;
          if (!id || usedM[id]) {
            if (id) warnings.push(ms.name + ' row ' + (r + 1) + ': Member ID ' + id + ' is used twice; a new ID was given.');
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
      used.push(ds.name);
      var dh = mapHeader(ds.rows, FIELDS.deposits);
      var sheetLabel = ds.name;
      var usedD = {}, pending = [];
      for (var dr = dh.row + 1; dr < ds.rows.length; dr++) {
        var drow = ds.rows[dr];
        if (isBlankRow(drow)) continue;
        var label = sheetLabel + ' row ' + (dr + 1);
        var mid = cellText(get(drow, dh, 'memberId')).toUpperCase(), mname = cellText(get(drow, dh, 'memberName'));
        var village = cellText(get(drow, dh, 'village'));
        var mem = null;
        if (mid && memberIdMap[mid]) mem = data.members.filter(function (x) { return x.id === memberIdMap[mid]; })[0] || null;
        if (!mem && mname) mem = findMemberByName(mname, village);
        if (!mem && mid && !mname) { warnings.push(label + ': Member ID ' + mid + ' is not in the FamilyMembers sheet, row skipped.'); counts.skipped++; continue; }
        if (!mem && !mname) { warnings.push(label + ': no Depositer Name, row skipped.'); counts.skipped++; continue; }
        if (!mem) {
          mem = { id: U.nextId('M', data.members.map(function (x) { return x.id; }), 3), name: mname, village: village, phone: '' };
          data.members.push(mem);
          counts.membersAdded++;
          if (ms) warnings.push('Added family member "' + mname + '" (in ' + label + ' but not in the ' + ms.name + ' sheet).');
        }

        var bank = cellText(get(drow, dh, 'bank'));
        var amount = cellNum(get(drow, dh, 'depositAmount'));
        if (amount > 0) amount = U.round2(amount);
        if (!bank && !(amount > 0)) { warnings.push(label + ': no Bank Name and no Deposit Value, row skipped.'); counts.skipped++; continue; }
        if (!bank) warnings.push(label + ': Bank Name is missing.');
        if (!(amount > 0)) { warnings.push(label + ': Deposit Value is missing or not a number.'); amount = ''; }

        var rateCell = get(drow, dh, 'interestRate'), rate = cellNum(rateCell);
        if (rate === '' || isNaN(rate)) { if (rateCell) warnings.push(label + ': percentage "' + cellText(rateCell) + '" is not a number.'); rate = ''; }
        else {
          if (rateCell && (rateCell.pct || (rate > 0 && rate < 1))) rate = rate * 100;
          rate = Math.round(rate * 1000) / 1000;
        }

        var typeCell = get(drow, dh, 'interestType'), itype = parseInterestType(cellText(typeCell));
        if (!itype) {
          if (typeCell) warnings.push(label + ': Interest type "' + cellText(typeCell) + '" not recognised — treated as Simple.');
          itype = 'Simple';
        }

        var dates = {};
        ['startDate', 'maturityDate', 'incomeDate', 'closedDate'].forEach(function (k) {
          var c = get(drow, dh, k), v = cellDate(c);
          if (v === null) {
            var names = { startDate: 'Deposit Date', maturityDate: 'Mature Date', incomeDate: 'Income Date', closedDate: 'Closed On' };
            warnings.push(label + ': "' + cellText(c) + '" is not a date I can read (' + names[k] + ').');
            v = '';
          }
          dates[k] = v || '';
        });
        var daysCell = get(drow, dh, 'days'), days = intNum(cellNum(daysCell));
        if (daysCell && days === '') warnings.push(label + ': No of Days "' + cellText(daysCell) + '" is not a number.');
        if (dates.startDate && dates.maturityDate && days) {
          var actual = U.diffDays(dates.startDate, dates.maturityDate);
          if (actual !== days) warnings.push(label + ': No of Days is ' + days + ' but Deposit Date → Mature Date is ' + actual + ' days. The Mature Date was kept.');
          days = actual > 0 ? actual : days;
        }
        var t = resolveTerm(dates.startDate, days, dates.maturityDate);
        if (!t.maturity) warnings.push(label + ': Mature Date (or Deposit Date + No of Days) is missing.');
        var income = dates.incomeDate || t.maturity;

        var intCell = get(drow, dh, 'interestAmount'), interest = cellNum(intCell);
        if (interest !== '' && !isNaN(interest)) interest = U.round2(interest);
        if (interest === '' || isNaN(interest)) {
          if (intCell) warnings.push(label + ': Amount of Intersest "' + cellText(intCell) + '" is not a number.');
          interest = suggestInterest(amount, rate, t.days);
          if (interest !== '') warnings.push(label + ': Amount of Intersest calculated as ' + U.fmtMoney(interest) + '.');
          else interest = 0;
        }

        var statusTxt = cellText(get(drow, dh, 'status')), status = parseDepositStatus(statusTxt);
        if (statusTxt && !status) warnings.push(label + ': Deposit position "' + statusTxt + '" not recognised — treated as Active.');
        status = status || (dates.closedDate ? 'Closed' : 'Active');
        var notes = cellText(get(drow, dh, 'notes')), closedDate = '';
        if (status === 'Closed') closedDate = dates.closedDate || closedEarlyFrom(notes) || t.maturity || today;

        var accCell = get(drow, dh, 'accountNumber'), acc = cellText(accCell).replace(/\s+/g, '');
        if (accCell && typeof accCell.v === 'number' && /e/i.test(String(accCell.text))) {
          warnings.push(label + ': Excel stored the Deposit No as a rounded number (' + accCell.text + '). Please check it in the app.');
        }

        var idCell = get(drow, dh, 'id'), rawId2 = cellText(idCell).toUpperCase(), did = rawId2;
        if (idCell && typeof idCell.v === 'number') did = String(Math.round(idCell.v));
        if (did && usedD[did]) { warnings.push(label + ': S.No ' + did + ' is used twice; a new number was given.'); did = ''; }
        var dep = {
          id: did, memberId: mem.id, village: village || mem.village, bank: bank, accountNumber: acc,
          interestType: itype, interestRate: rate, depositAmount: amount,
          startDate: t.start, days: t.days, maturityDate: t.maturity, incomeDate: income, interestAmount: interest,
          status: status, closedDate: closedDate, notes: notes
        };
        if (did) usedD[did] = 1;
        data.deposits.push(dep);
        pending.push({ dep: dep, raw: did || rawId2 });
        counts.deposits++;
      }
      pending.forEach(function (x) {
        if (!x.dep.id) { x.dep.id = nextSno(Object.keys(usedD)); usedD[x.dep.id] = 1; }
        if (x.raw && !depIdMap[x.raw]) depIdMap[x.raw] = x.dep.id;
        depIdMap[x.dep.id] = depIdMap[x.dep.id] || x.dep.id;
      });
      if (counts.membersAdded && !ms) {
        warnings.unshift(U.plural(counts.membersAdded, 'family member') + ' created from the Depositer Name column.');
      }
    }

    /* payments (interest income history) */
    if (ps) {
      used.push(ps.name);
      var ph = mapHeader(ps.rows, FIELDS.payments);
      if (ph && ph.map.depositId !== undefined && ph.map.dueDate !== undefined) {
        var usedP = {}, seen = {}, pList = [];
        for (var pr = ph.row + 1; pr < ps.rows.length; pr++) {
          var prow = ps.rows[pr];
          if (isBlankRow(prow)) continue;
          var plabel = ps.name + ' row ' + (pr + 1);
          var depCell = get(prow, ph, 'depositId');
          var rawDep = depCell && typeof depCell.v === 'number' ? String(Math.round(depCell.v)) : cellText(depCell).toUpperCase();
          var depId = depIdMap[rawDep];
          if (!depId) { warnings.push(plabel + ': S.No ' + (rawDep || '(blank)') + ' is not in the Deposits sheet, row skipped.'); counts.skipped++; continue; }
          var due = cellDate(get(prow, ph, 'dueDate'));
          if (!due) { warnings.push(plabel + ': Income Date missing or unreadable, row skipped.'); counts.skipped++; continue; }
          var rAmt = cellNum(get(prow, ph, 'receivedAmount')), rDate = cellDate(get(prow, ph, 'receivedDate'));
          if (rAmt > 0) rAmt = U.round2(rAmt);
          var pst = parsePaymentStatus(cellText(get(prow, ph, 'status')));
          if (!pst) pst = (rDate || rAmt > 0) ? 'Received' : 'Pending';
          var exp = cellNum(get(prow, ph, 'expectedAmount'));
          if (exp !== '' && !isNaN(exp)) exp = U.round2(exp);
          var depObj = data.deposits.filter(function (x) { return x.id === depId; })[0];
          if (exp === '' || isNaN(exp)) exp = depObj ? depObj.interestAmount : 0;
          var key = depId + '|' + due;
          if (seen[key]) { warnings.push(plabel + ': duplicate row for S.No ' + depId + ' on ' + U.fmtDate(due) + ', skipped.'); counts.skipped++; continue; }
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
      } else if (hasContent(ps)) {
        warnings.push(ps.name + ' sheet: could not find "S.No" and "Income Date" columns, so the interest history was not loaded.');
      }
    }

    book.sheets.forEach(function (s) { if (sheetKind(s.name) === 'other') used.push(s.name); });
    invalidate(data);
    var trial = normalizeData(U.clone(data));
    var sim = syncSchedule(trial, { today: today, keepOffSchedule: true });
    var past = sim.created.filter(function (p) { return isEarlier(trial, p, today); }).length;
    return { data: data, warnings: warnings, errors: errors, counts: counts, pastCount: past, usedSheets: used };
  }

  /** Step 2: build the final data set, adding income rows. pastAs: 'received' | 'pending'. */
  function finalizeImport(prep, pastAs, today) {
    var data = normalizeData(U.clone(prep.data));
    var s = syncSchedule(data, { today: today, keepOffSchedule: true });
    var auto = applyPastChoice(s.created, pastAs, today, data);
    refreshStatuses(data, today);
    invalidate(data);
    return { data: data, generated: s.created.length, autoReceived: auto };
  }

  /** Keep income rows and statuses current (called on every app start and each new day). */
  function rollForward(data, today) {
    return syncSchedule(data, { today: today, keepOffSchedule: true });
  }

  DM.model = {
    INTEREST_TYPES: INTEREST_TYPES, POSITIONS: POSITIONS, TERMS: TERMS, MATURING_SOON_DAYS: MATURING_SOON_DAYS,
    DEFAULT_PREFS: DEFAULT_PREFS, PAST_NOTE: PAST_NOTE,
    emptyData: emptyData, normalizeData: normalizeData, invalidate: invalidate,
    parseInterestType: parseInterestType, parseDepositStatus: parseDepositStatus, parsePaymentStatus: parsePaymentStatus,
    suggestInterest: suggestInterest, tenureMonths: tenureMonths, describeTerm: describeTerm, resolveTerm: resolveTerm, idNum: idNum,
    member: member, deposit: deposit, payment: payment, paymentsOf: paymentsOf, depositsOf: depositsOf, memberName: memberName,
    position: position, renewalDate: renewalDate, renewalDatesBetween: renewalDatesBetween, renewalsBetween: renewalsBetween,
    hasSchedule: hasSchedule, dueDates: dueDates, syncSchedule: syncSchedule,
    refreshStatuses: refreshStatuses, countPastDue: countPastDue, nextPayment: nextPayment, depositSummary: depositSummary,
    validateMember: validateMember, saveMember: saveMember, deleteMember: deleteMember,
    validateDeposit: validateDeposit, saveDeposit: saveDeposit, closeDeposit: closeDeposit, reopenDeposit: reopenDeposit,
    renewalDraft: renewalDraft, renewDeposit: renewDeposit, canDeleteDeposit: canDeleteDeposit, deleteDeposit: deleteDeposit,
    markReceived: markReceived, markNotReceived: markNotReceived, updatePayment: updatePayment,
    buildReminders: buildReminders, computeStats: computeStats, openPayments: openPayments,
    searchDeposits: searchDeposits, villages: villages, banks: banks,
    workbookSheets: workbookSheets, prepareImport: prepareImport, finalizeImport: finalizeImport, rollForward: rollForward
  };
})(window.DM = window.DM || {});
