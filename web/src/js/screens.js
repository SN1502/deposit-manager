/* Deposit Manager — screens and sheets. Each screen returns {title, body, actions?, fab?, sticky?, tabs?, after?}. */
(function (DM) {
  'use strict';
  var U = DM.util, M = DM.model, P = DM.platform, UI = DM.ui, h = U.h;
  var S = DM.screens = {};
  function A() { return DM.app; }
  function D() { return DM.app.data; }
  function T() { return DM.app.today; }

  /* ================================================================ shared pieces */

  function money(n) { return U.fmtMoney(n); }

  function depositLine(dep) {
    return dep.bank + ' · ' + U.maskAccount(dep.accountNumber);
  }

  function positionChip(pos) {
    return UI.statusChip(pos);
  }

  function depositItem(dep, opts) {
    opts = opts || {};
    var today = T(), m = M.member(D(), dep.memberId), pos = M.position(dep, today), sub;
    if (pos === 'Closed') sub = 'Closed' + (dep.closedDate ? ' on ' + U.fmtDate(dep.closedDate) : '');
    else if (!U.isValidISO(dep.maturityDate)) sub = h('span', { style: 'color:var(--warn);font-weight:600' }, 'Mature date not set — tap to fix');
    else {
      var sum = M.depositSummary(D(), dep, today);
      if (sum.overdue.length) sub = h('span', { style: 'color:var(--danger);font-weight:600' }, 'Interest ' + money(sum.overdueTotal) + ' overdue');
      else if (pos === 'Matured') sub = h('span', { style: 'color:var(--warn);font-weight:600' }, 'Matured ' + U.fmtDate(dep.maturityDate) + ' — renew or close?');
      else if (pos === 'Maturing Soon') sub = h('span', { style: 'color:var(--warn);font-weight:600' }, 'Matures ' + U.relDays(dep.maturityDate, today) + ' · ' + U.fmtDate(dep.maturityDate));
      else sub = 'Matures ' + U.fmtDate(dep.maturityDate) + ' · interest ' + money(dep.interestAmount);
    }
    return h('button', { class: 'item', onclick: function () { A().nav.go('deposit/' + dep.id); } },
      h('div', { class: 'avatar' }, UI.initials(m ? m.name : '?')),
      h('div', { class: 'grow' },
        h('div', { class: 't1 ellipsis' }, opts.hideMember ? dep.bank : (m ? m.name : '(Unknown member)')),
        h('div', { class: 't2 ellipsis' }, 'S.No ' + dep.id + ' · ' + (opts.hideMember ? U.maskAccount(dep.accountNumber) + (dep.village ? ' · ' + dep.village : '') : depositLine(dep))),
        sub ? h('div', { class: 't3 ellipsis' }, sub) : null),
      h('div', { class: 'right' },
        h('div', { class: 'amt' }, money(dep.depositAmount)),
        h('div', { class: 't3' }, pos === 'Active' ? dep.interestType : positionChip(pos))));
  }

  function dueText(p) {
    var today = T();
    if (p.status === 'Received') return 'Received ' + U.fmtDate(p.receivedDate);
    var n = U.diffDays(today, p.dueDate);
    if (n < 0) return h('span', { style: 'color:var(--danger);font-weight:650' }, 'Overdue by ' + U.plural(-n, 'day'));
    if (n === 0) return h('span', { style: 'color:var(--warn);font-weight:650' }, 'Due today');
    if (n === 1) return 'Due tomorrow';
    return 'Due in ' + n + ' days · ' + U.weekday(p.dueDate);
  }

  function paymentItem(p, opts) {
    opts = opts || {};
    var dep = M.deposit(D(), p.depositId), today = T();
    if (!dep) return null;
    var boxCls = p.status === 'Received' ? 'received' : (p.dueDate < today ? 'overdue' : (p.dueDate === today ? 'today' : ''));
    var right;
    if (p.status === 'Received') {
      right = h('div', { class: 'right' }, h('div', { class: 'amt' }, money(p.receivedAmount)), h('div', { class: 't3' }, UI.statusChip('Received')));
    } else {
      right = h('div', { class: 'right' }, h('div', { class: 'amt' }, money(p.expectedAmount)), h('div', { class: 'mt-8' }, quickReceive(p)));
    }
    var m = M.member(D(), dep.memberId);
    return h('button', {
      class: 'item', onclick: function () {
        if (p.status === 'Received') paymentSheet(p.id); else receiveSheet(p.id);
      }
    },
    UI.dateBox(p.status === 'Received' && opts.byReceived ? p.receivedDate : p.dueDate, boxCls),
    h('div', { class: 'grow' },
      h('div', { class: 't1 ellipsis' }, opts.hideMember ? dep.bank : (m ? m.name : '?')),
      h('div', { class: 't2 ellipsis' }, opts.hideMember ? U.maskAccount(dep.accountNumber) + ' · ' + dep.interestType : depositLine(dep)),
      h('div', { class: 't3 ellipsis' }, opts.history ? ('Due ' + U.fmtDate(p.dueDate) + (+p.receivedAmount !== +p.expectedAmount ? ' · expected ' + money(p.expectedAmount) : '')) : dueText(p))),
    right);
  }

  /** "Received" quick button for payments that are overdue or due within 30 days; a status chip otherwise. */
  function quickReceive(p) {
    if (p.dueDate > U.addDays(T(), 30)) return UI.statusChip(p.status);
    return h('span', {
      class: 'recv-btn', role: 'button', tabindex: '0', 'aria-label': 'Mark as received',
      onclick: function (e) { e.stopPropagation(); receiveSheet(p.id); }
    }, UI.icon('check', 'sm'), 'Received');
  }

  /** Compact row for a deposit's own payment schedule. */
  function scheduleItem(p) {
    var today = T(), rec = p.status === 'Received';
    var boxCls = rec ? 'received' : (p.dueDate < today ? 'overdue' : (p.dueDate === today ? 'today' : ''));
    var n = U.diffDays(today, p.dueDate);
    var t1 = rec ? 'Received ' + U.fmtDate(p.receivedDate)
      : n < 0 ? h('span', { style: 'color:var(--danger)' }, 'Overdue by ' + U.plural(-n, 'day'))
        : n === 0 ? h('span', { style: 'color:var(--warn)' }, 'Due today') : 'Due ' + U.relLong(p.dueDate, today);
    var t2 = rec ? (+p.receivedAmount !== +p.expectedAmount ? 'Expected ' + money(p.expectedAmount) : (p.notes && p.notes !== M.PAST_NOTE ? p.notes : 'Due ' + U.fmtDate(p.dueDate)))
      : U.weekday(p.dueDate) + ', ' + U.fmtDate(p.dueDate);
    return h('button', { class: 'item', onclick: function () { if (rec) paymentSheet(p.id); else receiveSheet(p.id); } },
      UI.dateBox(p.dueDate, boxCls),
      h('div', { class: 'grow' }, h('div', { class: 't1 ellipsis', style: 'font-size:15px' }, t1), h('div', { class: 't3 ellipsis' }, t2)),
      h('div', { class: 'right' }, h('div', { class: 'amt' }, money(rec ? p.receivedAmount : p.expectedAmount)),
        h('div', { class: 'mt-8' }, rec ? UI.statusChip('Received') : quickReceive(p))));
  }

  /** A monthly renewal date row. */
  function renewalItem(r) {
    var dep = r.deposit, m = M.member(D(), dep.memberId), today = T();
    return h('button', { class: 'item', onclick: function () { A().nav.go('deposit/' + dep.id); } },
      UI.dateBox(r.date, r.date === today ? 'today' : ''),
      h('div', { class: 'grow' },
        h('div', { class: 't1 ellipsis' }, m ? m.name : '?'),
        h('div', { class: 't2 ellipsis' }, 'S.No ' + dep.id + ' · ' + depositLine(dep)),
        h('div', { class: 't3 ellipsis' }, 'Monthly renewal · ' + U.relDays(r.date, today) + ' · matures ' + U.fmtDate(dep.maturityDate))),
      h('div', { class: 'right' }, h('div', { class: 'amt' }, money(dep.depositAmount))));
  }

  /** Render a long list in chunks so big histories stay fast. */
  function chunkedList(items, render, pageSize, headFn) {
    var list = h('div', { class: 'list' }), shown = 0;
    pageSize = pageSize || 60;
    function more() {
      var btn = list.querySelector('.more-btn');
      if (btn) btn.remove();
      var end = Math.min(items.length, shown + pageSize);
      for (var i = shown; i < end; i++) {
        if (headFn) { var hd = headFn(items[i], items[i - 1]); if (hd) list.appendChild(hd); }
        var n = render(items[i]);
        if (n) list.appendChild(n);
      }
      shown = end;
      if (shown < items.length) list.appendChild(h('button', { class: 'more-btn', onclick: more }, 'Show more (' + (items.length - shown) + ' left)'));
    }
    more();
    return list;
  }

  function sectionTitle(text, link) {
    return h('div', { class: 'section-title' }, h('span', null, text), link || null);
  }

  function linkBtn(text, fn) { return h('button', { class: 'link', onclick: fn }, text); }

  /* ================================================================ sheets: payments */

  function receiveSheet(pid) {
    var p = M.payment(D(), pid);
    if (!p) return;
    var dep = M.deposit(D(), p.depositId), m = M.member(D(), dep.memberId);
    UI.sheet(function (close) {
      var amt = UI.moneyInput({ value: String(p.expectedAmount), 'aria-label': 'Amount received' });
      var date = UI.input({ type: 'date', value: T() });
      var note = UI.input({ type: 'text', value: p.notes || '', placeholder: 'e.g. credited to savings account' });
      var expWrap = UI.moneyInput({ value: String(p.expectedAmount) });
      var editBox = h('div', { style: 'display:none' },
        UI.field('Expected interest', expWrap.input, { wrap: expWrap.wrap, hint: 'Only this record changes. To change the Amount of Interest itself, edit the deposit.' }),
        h('button', { class: 'btn outline block', onclick: function () {
          var v = U.toNumber(expWrap.input.value);
          if (!(v >= 0)) { UI.toast('Enter a valid amount'); return; }
          M.updatePayment(D(), p.id, { expectedAmount: v });
          A().commit();
          close();
          UI.toast('Expected amount updated');
        } }, 'Save expected amount'));
      return [
        h('h3', null, 'Mark interest as received'),
        h('div', { class: 'sub' }, (m ? m.name : '') + ' · S.No ' + dep.id + ' · ' + depositLine(dep)),
        h('div', { class: 'card', style: 'background:var(--surface-2);box-shadow:none' },
          h('div', { class: 'row' },
            h('div', { class: 'grow' }, h('div', { class: 'muted small' }, 'Income Date'), h('div', { class: 'strong' }, U.fmtDate(p.dueDate))),
            h('div', { class: 'right' }, h('div', { class: 'muted small' }, 'Expected'), h('div', { class: 'strong num' }, money(p.expectedAmount))))),
        UI.field('Amount received', amt.input, { wrap: amt.wrap }),
        UI.field('Date received', date),
        UI.field('Note', note, { optional: true }),
        h('button', {
          class: 'btn ok block', onclick: function () {
            var v = U.toNumber(amt.input.value);
            if (!(v >= 0)) { UI.toast('Enter the amount received'); amt.input.focus(); return; }
            if (!U.isValidISO(date.value)) { UI.toast('Choose the date received'); return; }
            var nxt = M.markReceived(D(), p.id, { amount: v, date: date.value, notes: note.value }, T());
            A().commit();
            close();
            UI.toast(nxt ? 'Received ✓  Next interest: ' + U.fmtDate(nxt.dueDate) + ' · ' + money(nxt.expectedAmount)
              : 'Interest received ✓', {
              action: 'Undo', onAction: function () { M.markNotReceived(D(), p.id, T()); A().commit(); UI.toast('Undone'); }
            });
          }
        }, UI.icon('check'), 'Mark as received'),
        h('button', { class: 'link mt-12', onclick: function (e) { editBox.style.display = ''; e.target.remove(); } }, 'Change the expected amount instead'),
        editBox
      ];
    });
  }

  function paymentSheet(pid) {
    var p = M.payment(D(), pid);
    if (!p) return;
    var dep = M.deposit(D(), p.depositId), m = M.member(D(), dep.memberId);
    UI.sheet(function (close) {
      var amt = UI.moneyInput({ value: String(p.receivedAmount) });
      var date = UI.input({ type: 'date', value: p.receivedDate });
      var note = UI.input({ type: 'text', value: p.notes || '' });
      var kv = h('div', { class: 'kv' },
        h('div', { class: 'k' }, 'Income Date'), h('div', { class: 'v' }, U.fmtDate(p.dueDate)),
        h('div', { class: 'k' }, 'Expected'), h('div', { class: 'v' }, money(p.expectedAmount)),
        h('div', { class: 'k' }, 'Received'), h('div', { class: 'v' }, money(p.receivedAmount)),
        h('div', { class: 'k' }, 'Received on'), h('div', { class: 'v' }, U.fmtDate(p.receivedDate)),
        h('div', { class: 'k' }, 'Payment ID'), h('div', { class: 'v' }, p.id),
        p.notes ? h('div', { class: 'k' }, 'Note') : null, p.notes ? h('div', { class: 'v' }, p.notes) : null);
      var edit = h('div', { style: 'display:none', class: 'mt-16' },
        UI.field('Amount received', amt.input, { wrap: amt.wrap }),
        UI.field('Date received', date),
        UI.field('Note', note, { optional: true }),
        h('button', { class: 'btn primary block', onclick: function () {
          var v = U.toNumber(amt.input.value);
          if (!(v >= 0) || !U.isValidISO(date.value)) { UI.toast('Check the amount and date'); return; }
          M.updatePayment(D(), p.id, { receivedAmount: v, receivedDate: date.value, notes: note.value });
          A().commit();
          close();
          UI.toast('Payment updated');
        } }, 'Save changes'));
      var actions = h('div', { class: 'btn-row mt-16' },
        h('button', { class: 'btn outline', onclick: function () { edit.style.display = ''; actions.style.display = 'none'; } }, UI.icon('edit', 'sm'), 'Edit'),
        h('button', { class: 'btn danger', onclick: function () {
          UI.confirm('Mark as not received?', 'Use this if it was marked by mistake. The interest goes back to ' +
            (p.dueDate < T() ? 'overdue.' : 'pending.'), 'Mark not received').then(function (ok) {
            if (!ok) return;
            M.markNotReceived(D(), p.id, T());
            A().commit();
            close();
            UI.toast('Marked as not received');
          });
        } }, 'Not received'));
      return [
        h('h3', null, 'Interest received'),
        h('div', { class: 'sub' }, (m ? m.name : '') + ' · ' + depositLine(dep)),
        kv, actions, edit,
        h('button', { class: 'link mt-12', onclick: function () { close(); A().nav.go('deposit/' + dep.id); } }, 'Open deposit')
      ];
    });
  }

  /* ================================================================ sheets: members */

  function memberSheet(id, onSaved) {
    var existing = id ? M.member(D(), id) : null;
    return UI.sheet(function (close) {
      var name = UI.input({ type: 'text', value: existing ? existing.name : '', autocapitalize: 'words', autofocus: true, placeholder: 'Full name' });
      var village = UI.input({ type: 'text', value: existing ? existing.village : '', autocapitalize: 'words', list: 'dl-villages', placeholder: 'Village or town' });
      var phone = UI.input({ type: 'tel', value: existing ? existing.phone : '', inputmode: 'tel', placeholder: 'Mobile number' });
      var dl = h('datalist', { id: 'dl-villages' }, M.villages(D()).map(function (v) { return h('option', { value: v }); }));
      var root = h('div', null,
        h('h3', null, existing ? 'Edit family member' : 'Add family member'),
        h('div', { class: 'sub' }, existing ? 'Member ID ' + existing.id : 'Add everyone who has deposits.'),
        UI.field('Name', name, { name: 'name' }),
        UI.field('Village', village, { name: 'village', optional: true }), dl,
        UI.field('Phone number', phone, { name: 'phone', optional: true }),
        h('button', { class: 'btn primary block', onclick: save }, existing ? 'Save changes' : 'Add member'));
      function save() {
        var f = { id: existing ? existing.id : '', name: name.value, village: village.value, phone: phone.value };
        var err = M.validateMember(D(), f);
        ['name', 'phone'].forEach(function (k) { UI.setFieldError(root, k, err[k]); });
        if (Object.keys(err).length) return;
        var m = M.saveMember(D(), f);
        A().prefs.onboarded = true;
        A().savePrefs();
        A().commit({ render: !onSaved });
        close(m);
        UI.toast(existing ? 'Saved' : m.name + ' added');
        if (onSaved) onSaved(m);
      }
      return root;
    });
  }

  /* ================================================================ welcome / onboarding */

  S.welcome = function () {
    var body = h('div', { class: 'welcome' },
      UI.logo('logo'),
      h('h2', null, 'Deposit Manager'),
      h('p', { class: 'lead' }, 'Keep every family deposit in one place, and never miss an interest payment.'),
      h('button', { class: 'choice primary', onclick: function () { A().importFromPicker(); } },
        h('div', { class: 'ci' }, UI.icon('file', 'lg')),
        h('div', { class: 'grow' }, h('div', { class: 'ct' }, 'Open my Excel file'),
          h('div', { class: 'cd' }, 'Load every deposit at once from your .xlsx sheet (S.No, Bank Name, Deposit No, Depositer Name …).'))),
      h('button', { class: 'choice', onclick: function () { A().downloadTemplate(); } },
        h('div', { class: 'ci' }, UI.icon('download', 'lg')),
        h('div', { class: 'grow' }, h('div', { class: 'ct' }, 'Get a blank Excel template'),
          h('div', { class: 'cd' }, 'Fill it in with Excel or Google Sheets, then come back and open it.'))),
      h('button', { class: 'choice', onclick: startEmpty },
        h('div', { class: 'ci' }, UI.icon('plus', 'lg')),
        h('div', { class: 'grow' }, h('div', { class: 'ct' }, 'Start with an empty book'),
          h('div', { class: 'cd' }, 'Add family members and deposits one by one.'))),
      h('div', { class: 'card mt-16' },
        h('h2', null, 'How it works'),
        h('ol', { class: 'steps' },
          h('li', null, 'Your deposits stay in your own Excel sheet with its 16 columns. The app adds Payments and Notifications sheets beside it.'),
          h('li', null, 'Enter each deposit once. The app works out the Mature Date, the interest, the monthly renewal date and whether it is maturing soon.'),
          h('li', null, 'You get reminders before each Income Date and Mature Date: 30, 7, 3 and 1 day before, and on the day.'),
          h('li', null, 'Nothing is uploaded anywhere. Deposit numbers are shown only as XXXX1234.'))));
    return { title: 'Welcome', body: body, tabs: false, showStatus: false };
  };

  function startEmpty() {
    var app = A();
    app.prefs.onboarded = true;
    app.savePrefs();
    function go() {
      app.nav.tab('members');
      setTimeout(function () { memberSheet(null); }, 150);
    }
    if (!P.excel.canLink) { go(); return; }
    UI.dialog({
      title: 'Where should your Excel file be kept?',
      message: 'Choose a place and name for your workbook (for example Downloads › DepositManager.xlsx). The app will save every change into it.',
      buttons: [{ text: 'Later', value: false, kind: 'outline' }, { text: 'Choose place', value: true, kind: 'primary' }]
    }).then(function (v) {
      if (v) app.createLinkedFile().then(go); else go();
    });
  }

  S.importPreview = function (prep, opened, o) {
    var app = A();
    var choice = { pastAs: 'received', link: P.excel.canLink && o.source === 'open' && !(prep.otherSheets || []).length };
    return UI.sheet(function (close) {
      var c = prep.counts, nodes = [];
      nodes.push(h('h3', null, o.source === 'linked' ? 'Load changes from Excel' : 'Import from Excel'));
      nodes.push(h('div', { class: 'sub' }, opened.name || 'Excel file'));
      nodes.push(h('div', { class: 'count-grid' },
        h('div', null, h('b', null, String(c.members + c.membersAdded)), h('span', null, 'family members')),
        h('div', null, h('b', null, String(c.deposits)), h('span', null, 'deposits')),
        h('div', null, h('b', null, String(c.payments)), h('span', null, 'interest rows'))));
      if (prep.errors.length) nodes.push(UI.banner('err', 'alert', 'Problems', prep.errors.join(' ')));
      if (prep.warnings.length) {
        nodes.push(h('div', { class: 'strong mt-8' }, U.plural(prep.warnings.length, 'thing') + ' to check'));
        nodes.push(h('div', { class: 'warn-list' }, prep.warnings.map(function (w) { return h('div', null, w); })));
      }
      if (prep.pastCount > 0) {
        var r1, r2;
        var pick = function (v) { choice.pastAs = v; r1.classList.toggle('on', v === 'received'); r2.classList.toggle('on', v === 'pending'); };
        r1 = h('button', { class: 'radio-card on', onclick: function () { pick('received'); } }, h('span', { class: 'dot' }),
          h('div', null, h('div', { class: 'rt' }, 'Already received'),
            h('div', { class: 'rd' }, 'Record the interest as received on its Income Date. Choose this if the family already has this money.')));
        r2 = h('button', { class: 'radio-card', onclick: function () { pick('pending'); } }, h('span', { class: 'dot' }),
          h('div', null, h('div', { class: 'rt' }, 'Not received yet'),
            h('div', { class: 'rd' }, 'Show them as overdue so you can tick each one off.')));
        nodes.push(h('div', { class: 'strong mt-16' }, U.plural(prep.pastCount, 'interest payment') + (prep.pastCount === 1 ? ' is' : ' are') + ' already due or on closed deposits'));
        nodes.push(h('div', { class: 'muted small', style: 'margin:2px 0 10px' }, 'How should the app treat them?'));
        nodes.push(r1, r2);
      }
      if (P.excel.canLink && o.source === 'open') {
        var other = prep.otherSheets || [];
        nodes.push(h('div', { class: 'card mt-16', style: 'background:var(--surface-2);box-shadow:none;margin-bottom:10px' },
          UI.switchRow('Keep saving changes into this file',
            other.length ? 'This file also has other sheets (' + other.join(', ') + '). They would be removed when the app saves, so this is off. You can create a new file afterwards.'
              : 'Your 16 columns stay as they are (the sheet is named Deposits). The app adds Payments, Notifications and FamilyMembers sheets.',
            choice.link, function (v) { choice.link = v; })));
      }
      if (app.hasData() && o.source !== 'linked') {
        nodes.push(UI.banner('', 'info', 'This replaces the data in the app',
          'Now: ' + U.plural(app.data.members.length, 'member') + ', ' + U.plural(app.data.deposits.length, 'deposit') + '. A backup is kept — Settings › Restore previous data.'));
      }
      nodes.push(h('div', { class: 'btn-row sheet-actions' },
        h('button', { class: 'btn outline', onclick: function () { close(); } }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: function () { close(choice); } }, o.source === 'linked' ? 'Load changes' : 'Import')));
      return nodes;
    }, { sticky: true });
  };

  /* ================================================================ dashboard */

  S.home = function () {
    var app = A(), data = D(), today = T();
    var st = M.computeStats(data, today), body = [];
    var hour = new Date().getHours();
    body.push(h('div', { class: 'hello' },
      h('div', { class: 'h' }, hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'),
      h('div', { class: 's' }, U.weekday(today) + ', ' + U.fmtDate(today))));

    if (!app.hasData()) {
      body.push(h('div', { class: 'card' }, UI.empty('users', 'Your book is empty', 'Add the family members first, then their deposits — or load everything from Excel.',
        h('div', { class: 'stack' },
          h('button', { class: 'btn primary block', onclick: function () { app.nav.tab('members'); setTimeout(function () { memberSheet(null); }, 120); } }, UI.icon('plus'), 'Add a family member'),
          h('button', { class: 'btn outline block', onclick: function () { app.importFromPicker(); } }, UI.icon('file'), 'Open Excel file')))));
      return { title: 'Deposit Manager', body: body };
    }

    // file status
    var ss = app.saveStatus();
    if (P.excel.canLink && !app.linkedFile()) {
      body.push(UI.banner('', 'file', 'Changes are not being saved to Excel', 'Choose an Excel file and every change will be saved into it.',
        h('button', { class: 'btn small primary', onclick: function () { app.createLinkedFile(); } }, 'Choose Excel file')));
    } else if (ss.kind === 'err' || (ss.kind === 'warn' && P.excel.canLink)) {
      body.push(UI.banner('err', 'alert', ss.label, ss.detail,
        h('button', { class: 'btn small primary', onclick: function () { app.nav.tab('settings'); } }, 'Fix')));
    }

    if (P.notify.mode === 'phone' && app.prefs.notify.enabled && P.notify.status() !== 'granted') {
      body.push(UI.banner('info', 'bell', 'Reminders are switched off on this phone', 'Allow notifications so you are reminded before each maturity and Income Date.',
        h('button', { class: 'btn small primary', onclick: function () {
          P.notify.request().then(function (st) {
            UI.toast(st === 'granted' ? 'Reminders are on' : 'Please allow notifications for Deposit Manager in the phone settings');
            app.syncReminders();
            app.render();
          });
        } }, 'Allow notifications')));
    }

    // needs attention
    var att = [];
    if (st.overdue.count) {
      att.push(h('div', { class: 'att-line' }, h('span', { class: 'att-icon red' }, UI.icon('alert', 'sm')),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, U.plural(st.overdue.count, 'interest payment') + ' overdue'), h('div', { class: 'small muted' }, money(st.overdue.amount) + ' not yet received')),
        linkBtn('View', function () { app.nav.tab('payments'); })));
    }
    if (st.matured.length) {
      att.push(h('div', { class: 'att-line' }, h('span', { class: 'att-icon amber' }, UI.icon('clock', 'sm')),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, U.plural(st.matured.length, 'deposit') + ' matured'), h('div', { class: 'small muted' }, 'Renew them, or close them if the money was withdrawn.')),
        linkBtn('View', function () { app.nav.go(st.matured.length === 1 ? 'deposit/' + st.matured[0].id : 'search?position=Matured'); })));
    }
    if (st.incomplete.length) {
      att.push(h('div', { class: 'att-line' }, h('span', { class: 'att-icon amber' }, UI.icon('calendar', 'sm')),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, U.plural(st.incomplete.length, 'deposit') + ' without a mature date'), h('div', { class: 'small muted' }, 'Add the Deposit Date and No of Days.')),
        linkBtn('Fix', function () { app.nav.go('deposit-edit/' + st.incomplete[0].id); })));
    }
    if (st.maturingSoon.length) {
      att.push(h('div', { class: 'att-line' }, h('span', { class: 'att-icon amber' }, UI.icon('calendar', 'sm')),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, U.plural(st.maturingSoon.length, 'deposit') + ' maturing soon'),
          h('div', { class: 'small muted' }, 'Within ' + M.MATURING_SOON_DAYS + ' days — first on ' + U.fmtDate(st.maturingSoon[0].maturityDate))),
        linkBtn('View', function () { app.nav.go('search?position=Maturing%20Soon'); })));
    }
    if (att.length) body.push(h('div', { class: 'card attention' + (st.overdue.count ? '' : ' soft') }, h('h2', null, 'Needs attention'), att));

    // stats grid
    function stat(k, v, s, onclick, cls, ic) {
      return h('button', { class: 'stat' + (cls ? ' ' + cls : ''), onclick: onclick },
        h('div', { class: 'k' }, ic ? UI.icon(ic) : null, k), h('div', { class: 'v' }, v), s ? h('div', { class: 's' }, s) : null);
    }
    body.push(h('div', { class: 'stats' },
      stat('Total principal (active)', U.fmtMoneyShort(st.principal), money(st.principal) + ' in ' + U.plural(st.active, 'deposit'),
        function () { app.nav.tab('deposits'); }, 'wide hero', 'wallet'),
      stat('Family members', String(st.members), null, function () { app.nav.tab('members'); }, '', 'users'),
      stat('Active deposits', String(st.active), null, function () { app.nav.tab('deposits'); }, '', 'bank'),
      stat('Closed deposits', String(st.closed), 'history kept', function () { app.nav.tab('deposits?tab=closed'); }, '', 'history'),
      stat('Maturing soon', String(st.maturingSoon.length), 'within ' + M.MATURING_SOON_DAYS + ' days', function () { app.nav.go('search?position=Maturing%20Soon'); }, '', 'clock'),
      stat('Interest due (30 days)', String(st.upcoming30.count), money(st.upcoming30.amount), function () { app.nav.tab('payments'); }, '', 'calendar'),
      stat('Interest pending', String(st.pending), money(st.interestExpected) + ' to come', function () { app.nav.tab('payments?range=all'); }, '', 'rupee'),
      stat('Overdue', String(st.overdue.count), st.overdue.count ? money(st.overdue.amount) : 'nothing overdue', function () { app.nav.tab('payments'); }, st.overdue.count ? 'alert' : '', 'alert')));

    // coming up
    var soon = M.openPayments(data, { activeOnly: false, to: U.addDays(today, 30) }).slice(0, 6);
    body.push(sectionTitle('Coming up', linkBtn('See all', function () { app.nav.tab('payments'); })));
    if (soon.length) {
      var l = h('div', { class: 'list' });
      soon.forEach(function (p) { var n = paymentItem(p); if (n) l.appendChild(n); });
      body.push(l);
    } else {
      body.push(h('div', { class: 'card muted' }, 'No interest due in the next 30 days.'));
    }

    // this month
    body.push(h('div', { class: 'card' }, h('h2', null, 'This month — ' + U.fmtMonthYear(today)),
      h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('div', { class: 'muted small' }, 'Received'), h('div', { class: 'strong num', style: 'font-size:20px;color:var(--ok)' }, money(st.thisMonth.received))),
        h('div', { class: 'grow right' }, h('div', { class: 'muted small' }, 'Still to receive'), h('div', { class: 'strong num', style: 'font-size:20px' }, money(st.thisMonth.expected))))));

    // expected interest income by interest type
    var rows = st.byType.filter(function (b) { return b.count; }).map(function (b) {
      return h('tr', null,
        h('td', null, h('div', { class: 'strong' }, b.type), h('div', { class: 'small muted' }, U.plural(b.count, 'deposit') + ' · ' + U.fmtMoneyShort(b.principal))),
        h('td', { class: 'r' }, money(b.interest), h('div', { class: 'small muted', style: 'font-weight:500' }, 'interest')));
    });
    if (rows.length) {
      rows.push(h('tr', { class: 'total' }, h('td', null, 'Interest still to come'), h('td', { class: 'r' }, money(st.interestExpected))));
      body.push(h('div', { class: 'card' }, h('h2', null, 'Expected interest income'), h('table', { class: 'freq-table' }, h('tbody', null, rows)),
        h('div', { class: 'small muted mt-8' }, money(st.interest12) + ' of it is due in the next 12 months.')));
    }

    // maturing soon
    if (st.maturing.length) {
      body.push(sectionTitle('Maturing in the next 60 days'));
      var ml = h('div', { class: 'list' });
      st.maturing.forEach(function (d) { ml.appendChild(depositItem(d)); });
      body.push(ml);
    }

    return {
      title: 'Deposit Manager', body: body,
      actions: h('button', { class: 'icon-btn', 'aria-label': 'Search', onclick: function () { app.nav.go('search'); } }, UI.icon('search')),
      fab: h('button', { class: 'fab', onclick: function () { app.nav.go('deposit-edit/new'); } }, UI.icon('plus'), 'Add deposit')
    };
  };

  /* ================================================================ deposits (active / closed) */

  var depState = { member: '' };

  S.deposits = function (route) {
    var app = A(), data = D(), tab = route.query.tab === 'closed' ? 'closed' : 'active';
    var all = data.deposits, act = all.filter(function (d) { return d.status === 'Active'; }), clo = all.filter(function (d) { return d.status === 'Closed'; });
    var list = (tab === 'active' ? act : clo).slice();
    if (depState.member && !M.member(data, depState.member)) depState.member = '';
    if (depState.member) list = list.filter(function (d) { return d.memberId === depState.member; });
    list.sort(function (a, b) {
      var r = M.memberName(data, a.memberId).localeCompare(M.memberName(data, b.memberId));
      if (r) return r;
      if (tab === 'closed') return (b.closedDate || '') < (a.closedDate || '') ? -1 : 1;
      return (a.maturityDate || '9999') < (b.maturityDate || '9999') ? -1 : 1;
    });
    var body = [UI.seg([
      { value: 'active', label: 'Active', count: act.length },
      { value: 'closed', label: 'Closed', count: clo.length }
    ], tab, function (v) { app.nav.replace('deposits?tab=' + v); })];

    if (data.members.length > 1) {
      var opts = [{ value: '', label: 'Everyone' }].concat(data.members.slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
        .map(function (m) { return { value: m.id, label: m.name }; }));
      body.push(UI.chipRow(opts, depState.member, function (v) { depState.member = v; app.render(); }));
    }
    if (list.length) {
      var total = list.reduce(function (s, d) { return s + (+d.depositAmount || 0); }, 0);
      body.push(h('div', { class: 'summary-line' }, h('span', null, U.plural(list.length, tab === 'active' ? 'active deposit' : 'closed deposit')), h('b', { class: 'num' }, money(total))));
      if (tab === 'closed') body.push(h('div', { class: 'muted small', style: 'margin:-4px 4px 10px' }, 'Closed deposits and all their payments are kept for your records.'));
      body.push(chunkedList(list, function (d) { return depositItem(d); }, 80));
    } else if (tab === 'active') {
      body.push(h('div', { class: 'card' }, UI.empty('bank', depState.member ? 'No active deposits for this member' : 'No active deposits yet', 'Add a deposit and the app works out its Mature Date, interest and reminders.',
        h('button', { class: 'btn primary', onclick: function () { app.nav.go('deposit-edit/new' + (depState.member ? '?member=' + depState.member : '')); } }, UI.icon('plus'), 'Add deposit'))));
    } else {
      body.push(h('div', { class: 'card' }, UI.empty('history', 'No closed deposits', 'When a deposit matures or is withdrawn, close it from its details page. Its history stays here.')));
    }
    return {
      title: 'Deposits', body: body,
      actions: h('button', { class: 'icon-btn', 'aria-label': 'Search', onclick: function () { app.nav.go('search'); } }, UI.icon('search')),
      fab: tab === 'active' ? h('button', { class: 'fab', onclick: function () { app.nav.go('deposit-edit/new' + (depState.member ? '?member=' + depState.member : '')); } }, UI.icon('plus'), 'Add deposit') : null
    };
  };

  /* ================================================================ deposit details */

  S.deposit = function (route) {
    var app = A(), data = D(), today = T(), dep = M.deposit(data, route.arg);
    if (!dep) return { title: 'Deposit', body: UI.empty('bank', 'Deposit not found', 'It may have been deleted.') };
    var m = M.member(data, dep.memberId), sum = M.depositSummary(data, dep, today), pos = M.position(dep, today), body = [];

    // hero
    var acctText = h('span', null, U.maskAccount(dep.accountNumber)), shown = false, hideTimer = null;
    var eyeBtn = h('button', { 'aria-label': 'Show account number' }, UI.icon('eye', 'sm'), 'Show');
    eyeBtn.addEventListener('click', function () {
      if (shown) { hide(); return; }
      if (!dep.accountNumber) return;
      app.verifyUser('Show the full deposit number').then(function (ok) {
        if (!ok) return;
        shown = true;
        acctText.textContent = dep.accountNumber;
        U.clear(eyeBtn);
        U.append(eyeBtn, [UI.icon('eyeoff', 'sm'), 'Hide']);
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 15000);
      });
    });
    function hide() {
      shown = false;
      acctText.textContent = U.maskAccount(dep.accountNumber);
      U.clear(eyeBtn);
      U.append(eyeBtn, [UI.icon('eye', 'sm'), 'Show']);
    }
    body.push(h('div', { class: 'hero-card' },
      h('div', { class: 'bank' }, dep.bank || 'Bank not set'),
      h('div', { class: 'big' }, money(dep.depositAmount)),
      h('div', { class: 'acct' }, 'Deposit No ', acctText, dep.accountNumber ? eyeBtn : null),
      h('div', { class: 'meta' },
        h('button', { class: 'who', onclick: function () { if (m) app.nav.go('member/' + m.id); } }, UI.icon('users', 'sm'), m ? m.name : 'Unknown'),
        h('span', { class: 'chip' }, 'S.No ' + dep.id + ' · ' + pos))));

    if (!U.isValidISO(dep.maturityDate)) {
      body.push(UI.banner('', 'calendar', 'Mature date is not set', 'Add the Deposit Date and No of Days (or the Mature Date).',
        h('button', { class: 'btn small primary', onclick: function () { app.nav.go('deposit-edit/' + dep.id); } }, 'Edit deposit')));
    }
    if (pos === 'Matured') {
      body.push(UI.banner('', 'clock', 'Matured on ' + U.fmtDate(dep.maturityDate), 'Renew it, or close it if the money was withdrawn. Its history is kept either way.',
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn small primary', onclick: function () { app.nav.go('deposit-edit/new?renew=' + dep.id); } }, 'Renew'),
          h('button', { class: 'btn small outline', onclick: function () { closeSheet(dep); } }, 'Close'))));
    }

    // interest overdue
    if (sum.overdue.length) {
      var ol = h('div', { class: 'list', style: 'border:1.5px solid var(--danger-soft)' },
        h('div', { class: 'list-head', style: 'background:var(--danger-soft);color:var(--danger)' }, h('span', null, 'Interest overdue'), h('span', null, money(sum.overdueTotal))));
      sum.overdue.forEach(function (p) { ol.appendChild(scheduleItem(p)); });
      body.push(ol);
    }

    // interest income
    var income = sum.payments.filter(function (p) { return p.dueDate === dep.incomeDate; })[0];
    if (income && income.status !== 'Overdue') {
      var rec = income.status === 'Received';
      body.push(h('div', { class: 'card' }, h('h2', null, 'Interest income'),
        h('div', { class: 'next-card' }, UI.dateBox(income.dueDate, rec ? 'received' : (income.dueDate === today ? 'today' : '')),
          h('div', { class: 'grow' },
            h('div', { class: 'when num' }, money(rec ? income.receivedAmount : income.expectedAmount)),
            h('div', { class: 'muted' }, rec ? 'Received ' + U.fmtDate(income.receivedDate) : 'Income Date ' + U.fmtDate(income.dueDate) + ' · ' + U.relLong(income.dueDate, today))),
          rec ? h('button', { class: 'chip received', style: 'border:0', onclick: function () { paymentSheet(income.id); } }, 'Received')
            : income.dueDate <= U.addDays(today, 30) ? h('button', { class: 'recv-btn', onclick: function () { receiveSheet(income.id); } }, UI.icon('check', 'sm'), 'Received')
              : h('button', { class: 'chip pending', style: 'border:0', onclick: function () { receiveSheet(income.id); } }, 'Pending'))));
    }

    // maturity
    if (U.isValidISO(dep.maturityDate)) {
      var atMaturity = (+dep.depositAmount || 0) + (dep.incomeDate === dep.maturityDate ? (+dep.interestAmount || 0) : 0);
      var renewal = M.renewalDate(dep, today);
      body.push(h('div', { class: 'card' }, h('h2', null, 'Maturity'),
        h('div', { class: 'row', style: 'justify-content:space-between;align-items:flex-end' },
          h('div', null, h('div', { class: 'strong', style: 'font-size:18px' }, U.fmtDate(dep.maturityDate)),
            h('div', { class: 'muted small' }, dep.status === 'Closed' ? 'Closed' + (dep.closedDate ? ' on ' + U.fmtDate(dep.closedDate) : '')
              : (dep.maturityDate >= today ? U.relLong(dep.maturityDate, today) : 'matured ' + U.relLong(dep.maturityDate, today)) + ' · ' + M.describeTerm(dep.days))),
          h('div', { class: 'right' }, h('div', { class: 'muted small' }, 'Amount at maturity'), h('div', { class: 'strong num', style: 'font-size:18px' }, money(atMaturity)))),
        dep.status === 'Active' && renewal ? h('div', { class: 'small muted mt-12' }, 'Next monthly renewal date: ', h('b', null, U.fmtDate(renewal))) : null,
        dep.status === 'Active' && pos === 'Maturing Soon' ? h('button', { class: 'btn outline block mt-12', onclick: function () { app.nav.go('deposit-edit/new?renew=' + dep.id); } }, UI.icon('reopen', 'sm'), 'Renew at maturity') : null));
    }

    // details — the 16 columns of the sheet
    var rows = [
      ['S.No', dep.id],
      ['Bank Name', dep.bank || '—'],
      ['Deposit No', U.maskAccount(dep.accountNumber)],
      ['Depositer Name', m ? m.name : '—'],
      ['Interest type', dep.interestType],
      ['Percentage', U.fmtRate(dep.interestRate)],
      ['Deposit Value', money(dep.depositAmount)],
      ['Deposit Date', U.fmtDate(dep.startDate)],
      ['No of Days', dep.days ? dep.days + ' (' + M.describeTerm(dep.days) + ')' : '—'],
      ['Mature Date', U.fmtDate(dep.maturityDate)],
      ['Deposit position', pos],
      ['Monthly Renewal Date', U.fmtDate(M.renewalDate(dep, today))],
      ['Income Date', U.fmtDate(dep.incomeDate)],
      ['Amount of Interest', money(dep.interestAmount)],
      ['Deposited Village', dep.village || '—'],
      dep.status === 'Closed' ? ['Closed on', U.fmtDate(dep.closedDate)] : null,
      ['Remarks', dep.notes || '—']
    ].filter(Boolean);
    var kv = h('div', { class: 'kv' });
    rows.forEach(function (r) { kv.appendChild(h('div', { class: 'k' }, r[0])); kv.appendChild(h('div', { class: 'v' }, r[1])); });
    body.push(h('div', { class: 'card' }, h('h2', null, 'Details'), kv));

    // earlier income rows (e.g. history kept from before a change of dates)
    var others = sum.payments.filter(function (p) { return p !== income && sum.overdue.indexOf(p) < 0; });
    if (others.length) {
      body.push(sectionTitle('Interest history'));
      body.push(chunkedList(others.slice().sort(function (a, b) { return a.dueDate < b.dueDate ? 1 : -1; }), scheduleItem, 24));
    }

    // actions
    var acts = h('div', { class: 'btn-row mt-16' },
      h('button', { class: 'btn outline', onclick: function () { app.nav.go('deposit-edit/' + dep.id); } }, UI.icon('edit', 'sm'), 'Edit'),
      dep.status === 'Active'
        ? h('button', { class: 'btn outline', onclick: function () { closeSheet(dep); } }, UI.icon('close', 'sm'), 'Close deposit')
        : h('button', { class: 'btn outline', onclick: function () { reopen(dep); } }, UI.icon('reopen', 'sm'), 'Reopen'));
    if (dep.status === 'Active' && pos === 'Active') {
      body.push(acts);
      acts = h('button', { class: 'link mt-12', onclick: function () { app.nav.go('deposit-edit/new?renew=' + dep.id); } }, 'Renew this deposit');
    }
    body.push(acts);
    if (M.canDeleteDeposit(data, dep.id)) {
      body.push(h('button', { class: 'btn danger block mt-12', onclick: function () {
        UI.confirm('Delete this deposit?', 'Use this only for a deposit added by mistake. It has no received interest, so nothing from the history is lost.', 'Delete', true).then(function (ok) {
          if (!ok) return;
          M.deleteDeposit(data, dep.id);
          app.commit({ render: false });
          if (!app.nav.back()) app.nav.tab('deposits');
          UI.toast('Deposit deleted');
        });
      } }, UI.icon('trash', 'sm'), 'Delete deposit'));
    }
    return { title: (m ? m.name : 'Deposit') + ' · S.No ' + dep.id, body: body };
  };

  function closeSheet(dep) {
    var app = A(), today = T();
    UI.sheet(function (close) {
      var def = dep.maturityDate && dep.maturityDate <= today ? dep.maturityDate : today;
      var date = UI.input({ type: 'date', value: def });
      var info = h('div', { class: 'muted small' });
      function upd() {
        var d = U.isValidISO(date.value) ? date.value : today;
        var f = M.paymentsOf(D(), dep.id).filter(function (p) { return p.status !== 'Received' && p.dueDate > d; }).length;
        var keep = M.paymentsOf(D(), dep.id).filter(function (p) { return p.status !== 'Received' && p.dueDate <= d; }).length;
        var early = U.isValidISO(dep.maturityDate) && d < dep.maturityDate;
        info.textContent = 'Received interest is kept. ' + (f ? 'The interest due on ' + U.fmtDate(dep.incomeDate) + ' will be removed because the deposit closes before it. ' : '') +
          (keep ? 'Unpaid interest due on or before this date stays, so you can still mark it received. ' : '') +
          (early ? '"Closed early on …" is added to the Remarks so the date is kept in Excel.' : '');
      }
      date.addEventListener('change', upd);
      upd();
      return [
        h('h3', null, 'Close deposit'),
        h('div', { class: 'sub' }, depositLine(dep) + ' · ' + money(dep.depositAmount)),
        UI.field('Closed on', date),
        info,
        h('div', { class: 'btn-row sheet-actions' },
          h('button', { class: 'btn outline', onclick: function () { close(); } }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: function () {
            var r = M.closeDeposit(D(), dep.id, date.value, today);
            app.commit();
            close();
            UI.toast('Deposit closed' + (r.unpaidKept ? ' · unpaid interest kept' : ''));
          } }, 'Close deposit'))
      ];
    });
  }

  function reopen(dep) {
    UI.confirm('Reopen this deposit?', 'It becomes active again and its interest income is tracked again.', 'Reopen').then(function (ok) {
      if (!ok) return;
      M.reopenDeposit(D(), dep.id, T());
      A().commit();
      UI.toast('Deposit reopened');
    });
  }

  /* ================================================================ add / edit deposit */

  S['deposit-edit'] = function (route) {
    var app = A(), data = D(), today = T(), isNew = route.arg === 'new' || !route.arg;
    var dep = isNew ? null : M.deposit(data, route.arg);
    var renewFrom = isNew && route.query.renew ? M.deposit(data, route.query.renew) : null;
    if (!isNew && !dep) return { title: 'Edit deposit', body: UI.empty('bank', 'Deposit not found') };
    if (!data.members.length) {
      return {
        title: 'Add deposit', tabs: false,
        body: h('div', { class: 'card' }, UI.empty('users', 'Add a family member first', 'Every deposit belongs to a depositer.',
          h('button', { class: 'btn primary', onclick: function () { memberSheet(null, function () { app.render(); }); } }, UI.icon('plus'), 'Add family member')))
      };
    }
    var f;
    if (dep) f = U.clone(dep);
    else if (renewFrom) f = M.renewalDraft(renewFrom);
    else {
      f = {
        id: '', memberId: route.query.member || (data.members.length === 1 ? data.members[0].id : ''), village: '', bank: '', accountNumber: '',
        interestType: 'Simple', interestRate: '', depositAmount: '', startDate: today, days: '', maturityDate: '', incomeDate: '', interestAmount: '', notes: ''
      };
      if (f.memberId) { var mm = M.member(data, f.memberId); f.village = mm ? mm.village : ''; }
    }
    var pastAs = 'received';
    var root = h('div');
    var val = function (v) { return v === '' || v === undefined || v === null ? '' : String(v); };

    /* --- depositer */
    function memberOptions() {
      return [{ value: '', label: 'Choose depositer…' }].concat(data.members.slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
        .map(function (m) { return { value: m.id, label: m.name + (m.village ? ' — ' + m.village : '') }; }))
        .concat([{ value: '__new', label: '+ Add a new family member…' }]);
    }
    var memberSel = UI.select(memberOptions(), f.memberId);
    memberSel.addEventListener('change', function () {
      if (memberSel.value === '__new') {
        memberSel.value = f.memberId;
        memberSheet(null, function (m) {
          var fresh = UI.select(memberOptions(), m.id);
          memberSel.innerHTML = fresh.innerHTML;
          memberSel.value = m.id;
          setMember(m.id);
        });
        return;
      }
      setMember(memberSel.value);
    });
    function setMember(id) {
      var prev = M.member(data, f.memberId), next = M.member(data, id);
      if (!village.value || (prev && village.value === prev.village)) village.value = next ? next.village : '';
      f.memberId = id;
      UI.setFieldError(root, 'memberId', '');
    }
    var village = UI.input({ type: 'text', value: f.village || '', list: 'dl-v2', autocapitalize: 'words', placeholder: 'e.g. Tambaram' });
    var bank = UI.input({ type: 'text', value: f.bank || '', list: 'dl-banks', autocapitalize: 'words', placeholder: 'e.g. SBI, Indian Bank, Post Office' });
    var acct = UI.input({ type: 'text', value: f.accountNumber || '', inputmode: 'text', autocapitalize: 'characters', placeholder: 'e.g. SBI001245', spellcheck: 'false' });
    function acctHint() {
      var v = acct.value.replace(/\s+/g, '');
      return v.length > 4 ? 'The app shows it as ' + U.maskAccount(v) + ' everywhere.' : 'The app only ever shows the last 4 characters, like XXXX1245.';
    }
    acct.addEventListener('input', function () { var hn = acct.parentNode && acct.parentNode.querySelector('.hint'); if (hn) hn.textContent = acctHint(); });

    /* --- money */
    var typeBtns = {};
    var typePick = h('div', { class: 'freq-pick', role: 'radiogroup' });
    M.INTEREST_TYPES.forEach(function (t) {
      var b = h('button', {
        type: 'button', class: f.interestType === t ? 'on' : '', role: 'radio', 'aria-checked': f.interestType === t ? 'true' : 'false',
        onclick: function () {
          f.interestType = t;
          Object.keys(typeBtns).forEach(function (k) { typeBtns[k].classList.toggle('on', k === t); typeBtns[k].setAttribute('aria-checked', k === t ? 'true' : 'false'); });
          UI.setFieldError(root, 'interestType', '');
          refresh();
        }
      }, t);
      typeBtns[t] = b;
      typePick.appendChild(b);
    });
    var amount = UI.moneyInput({ value: val(f.depositAmount), placeholder: '0' });
    var rateI = UI.input({ type: 'text', inputmode: 'decimal', value: val(f.interestRate), placeholder: 'e.g. 7.1' });
    var rateWrap = h('div', { class: 'input-wrap has-suffix' }, rateI, h('span', { class: 'suffix' }, '%'));

    /* --- dates */
    var start = UI.input({ type: 'date', value: f.startDate || '' });
    var daysI = UI.input({ type: 'text', inputmode: 'numeric', value: val(f.days), placeholder: 'e.g. 365' });
    var daysWrap = h('div', { class: 'input-wrap has-suffix' }, daysI, h('span', { class: 'suffix' }, 'days'));
    var termQuick = h('div', { class: 'quick' });
    M.TERMS.forEach(function (d) {
      termQuick.appendChild(h('button', { type: 'button', onclick: function () { daysI.value = String(d); onDays(); } }, d + ' · ' + M.describeTerm(d)));
    });
    var maturity = UI.input({ type: 'date', value: f.maturityDate || '' });
    var income = UI.input({ type: 'date', value: f.incomeDate || f.maturityDate || '' });
    var incomeSame = !f.incomeDate || f.incomeDate === f.maturityDate;
    var sameBox = h('input', { type: 'checkbox', checked: incomeSame, style: 'width:20px;height:20px;margin:0' });
    var sameRow = h('label', { class: 'check-row' }, sameBox, h('span', null, 'Same as the Mature Date'));
    income.disabled = incomeSame;
    sameBox.addEventListener('change', function () {
      incomeSame = sameBox.checked;
      income.disabled = incomeSame;
      if (incomeSame) income.value = maturity.value;
      refresh();
    });
    var preview = h('div', { class: 'preview-dates', style: 'display:none' });

    /* --- interest */
    var interest = UI.moneyInput({ value: val(f.interestAmount), placeholder: 'Leave empty to calculate' });
    var suggest = h('div', { class: 'quick' });
    var notes = h('textarea', { class: 'input', rows: '2', placeholder: 'e.g. Auto renewal, Senior deposit, nominee…' });
    notes.value = f.notes || '';
    var pastBox = h('div');

    function onStart() {
      var d = parseInt(daysI.value, 10);
      if (U.isValidISO(start.value) && d > 0) maturity.value = U.addDays(start.value, d);
      syncIncome();
      refresh();
    }
    function onDays() {
      var d = parseInt(daysI.value, 10);
      if (U.isValidISO(start.value) && d > 0) maturity.value = U.addDays(start.value, d);
      UI.setFieldError(root, 'days', '');
      syncIncome();
      refresh();
    }
    function onMaturity() {
      if (U.isValidISO(start.value) && U.isValidISO(maturity.value)) {
        var d = U.diffDays(start.value, maturity.value);
        if (d > 0) daysI.value = String(d);
      }
      syncIncome();
      refresh();
    }
    function syncIncome() { if (incomeSame) income.value = maturity.value; }

    function readForm() {
      return {
        id: f.id, memberId: memberSel.value === '__new' ? '' : memberSel.value, village: village.value, bank: bank.value, accountNumber: acct.value,
        interestType: f.interestType, interestRate: rateI.value.trim() === '' ? '' : U.toNumber(rateI.value),
        depositAmount: U.toNumber(amount.input.value), startDate: start.value,
        days: daysI.value.trim() === '' ? '' : U.toNumber(daysI.value), maturityDate: maturity.value,
        incomeDate: incomeSame ? maturity.value : income.value,
        interestAmount: interest.input.value.trim() === '' ? '' : U.toNumber(interest.input.value), notes: notes.value,
        status: dep ? dep.status : 'Active', closedDate: dep ? dep.closedDate : ''
      };
    }

    function refresh() {
      var cur = readForm();
      // suggested interest, calculated the way the family's sheet does
      U.clear(suggest);
      var sg = M.suggestInterest(cur.depositAmount, cur.interestRate, cur.days);
      if (sg !== '' && +sg !== +cur.interestAmount) {
        suggest.appendChild(h('button', { type: 'button', onclick: function () { interest.input.value = String(sg); refresh(); } },
          'Use ' + money(sg) + ' (value × ' + U.fmtRate(cur.interestRate) + ' × ' + M.tenureMonths(cur.days) + ' months ÷ 12)'));
      }
      // what the dates add up to
      if (U.isValidISO(cur.maturityDate) && U.isValidISO(cur.startDate)) {
        var probeDep = { status: 'Active', startDate: cur.startDate, maturityDate: cur.maturityDate };
        var ren = M.renewalDate(probeDep, today);
        preview.style.display = '';
        preview.textContent = 'Matures ' + U.fmtDate(cur.maturityDate) + ' (' + M.describeTerm(U.diffDays(cur.startDate, cur.maturityDate)) + ')' +
          ' · position: ' + M.position(probeDep, today) + (ren && cur.maturityDate >= today ? ' · next monthly renewal date ' + U.fmtDate(ren) : '');
      } else preview.style.display = 'none';
      // interest income that is already due
      U.clear(pastBox);
      var probe = { id: f.id, incomeDate: cur.incomeDate, status: cur.status, closedDate: cur.closedDate };
      var past = M.hasSchedule(probe) ? M.countPastDue(data, probe, today) : 0;
      if (past > 0) {
        var r1, r2;
        var pick = function (v) { pastAs = v; r1.classList.toggle('on', v === 'received'); r2.classList.toggle('on', v === 'pending'); };
        r1 = h('button', { type: 'button', class: 'radio-card' + (pastAs === 'received' ? ' on' : ''), onclick: function () { pick('received'); } }, h('span', { class: 'dot' }),
          h('div', null, h('div', { class: 'rt' }, 'Already received'), h('div', { class: 'rd' }, 'Record the interest as received on the Income Date.')));
        r2 = h('button', { type: 'button', class: 'radio-card' + (pastAs === 'pending' ? ' on' : ''), onclick: function () { pick('pending'); } }, h('span', { class: 'dot' }),
          h('div', null, h('div', { class: 'rt' }, 'Not received yet'), h('div', { class: 'rd' }, 'Show it as overdue.')));
        pastBox.appendChild(h('div', { class: 'card', style: 'background:var(--warn-soft);box-shadow:none' },
          h('div', { class: 'strong' }, 'The Income Date is before today'),
          h('div', { class: 'small muted', style: 'margin:2px 0 10px' }, 'Has this interest been received?'), r1, r2));
      }
    }

    [amount.input, rateI, interest.input].forEach(function (el) { el.addEventListener('input', refresh); });
    daysI.addEventListener('input', onDays);
    start.addEventListener('change', onStart); start.addEventListener('input', onStart);
    maturity.addEventListener('change', onMaturity); maturity.addEventListener('input', onMaturity);
    income.addEventListener('change', refresh); income.addEventListener('input', refresh);

    var renewNote = renewFrom ? UI.banner('info', 'reopen', 'Renewing S.No ' + renewFrom.id + ' (' + depositLine(renewFrom) + ')',
      'Saving adds this as a new deposit and closes S.No ' + renewFrom.id + ' on ' + U.fmtDate(renewFrom.maturityDate && renewFrom.maturityDate <= today ? renewFrom.maturityDate : today) +
      '.' + (renewFrom.interestType === 'Cumulative' ? ' The interest is added to the Deposit Value because it is cumulative.' : '')) : null;

    U.append(root, [
      renewNote,
      h('datalist', { id: 'dl-banks' }, M.banks(data).map(function (v) { return h('option', { value: v }); })),
      h('datalist', { id: 'dl-v2' }, M.villages(data).map(function (v) { return h('option', { value: v }); })),
      h('div', { class: 'card' },
        UI.field('Depositer Name', memberSel, { name: 'memberId' }),
        UI.field('Deposited Village', village, { name: 'village', optional: true, hint: 'Filled in from the member; change it if this deposit is elsewhere.' }),
        UI.field('Bank Name', bank, { name: 'bank' }),
        UI.field('Deposit No', acct, { name: 'accountNumber', optional: true, hint: acctHint() })),
      h('div', { class: 'card' },
        h('div', { class: 'field', dataset: { name: 'interestType' } }, h('div', { class: 'lbl' }, 'Interest type'), typePick, h('div', { class: 'error', style: 'display:none' })),
        UI.field('Deposit Value', amount.input, { name: 'depositAmount', wrap: amount.wrap }),
        UI.field('Percentage', rateI, { name: 'interestRate', wrap: rateWrap, optional: true })),
      h('div', { class: 'card' },
        UI.field('Deposit Date', start, { name: 'startDate' }),
        UI.field('No of Days', daysI, { name: 'days', wrap: daysWrap, extra: termQuick, hint: 'Type the days, or pick the Mature Date below — the other one is filled in.' }),
        UI.field('Mature Date', maturity, { name: 'maturityDate' }),
        preview,
        h('div', { class: 'mt-16' }, UI.field('Income Date', income, { name: 'incomeDate', extra: sameRow, hint: 'When the interest is received.' }))),
      h('div', { class: 'card' },
        UI.field('Amount of Interest', interest.input, { name: 'interestAmount', wrap: interest.wrap, extra: suggest, hint: 'Interest for the whole term. Leave empty and the app calculates it.' })),
      pastBox,
      h('div', { class: 'card' }, UI.field('Remarks', notes, { name: 'notes', optional: true }))
    ]);
    refresh();

    function save() {
      var cur = readForm();
      if (cur.depositAmount !== '' && isNaN(cur.depositAmount)) cur.depositAmount = '';
      var err = M.validateDeposit(cur);
      if (cur.interestRate !== '' && isNaN(cur.interestRate)) err.interestRate = 'Enter a number, e.g. 7.1';
      if (cur.interestAmount !== '' && isNaN(cur.interestAmount)) err.interestAmount = 'Enter a valid amount';
      if (!incomeSame && !U.isValidISO(cur.incomeDate)) err.incomeDate = 'Enter the Income Date, or tick "Same as the Mature Date"';
      ['memberId', 'bank', 'accountNumber', 'interestType', 'depositAmount', 'interestRate', 'startDate', 'days', 'maturityDate', 'incomeDate', 'interestAmount'].forEach(function (k) {
        UI.setFieldError(root, k, err[k]);
      });
      if (Object.keys(err).length) {
        var el = root.querySelector('.field.err');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        UI.toast('Please check the highlighted fields');
        return;
      }
      var res;
      if (renewFrom) res = M.renewDeposit(data, renewFrom.id, cur, { today: today, pastAs: pastAs });
      else res = M.saveDeposit(data, cur, { today: today, pastAs: pastAs });
      app.commit({ render: false });
      if (isNew) app.nav.replace('deposit/' + res.deposit.id); else app.nav.back();
      UI.toast(renewFrom ? 'Renewed as S.No ' + res.deposit.id + ' · S.No ' + renewFrom.id + ' closed'
        : (isNew ? 'Deposit added as S.No ' + res.deposit.id : 'Deposit saved') + ' · interest ' + money(res.deposit.interestAmount) + ' on ' + U.fmtDate(res.deposit.incomeDate));
      if (isNew) app.maybeAskNotifications();
    }

    return {
      title: renewFrom ? 'Renew deposit' : (isNew ? 'Add deposit' : 'Edit S.No ' + dep.id), body: root, tabs: false,
      sticky: h('div', { class: 'sticky-actions' }, h('div', null,
        h('button', { class: 'btn outline', onclick: function () { if (!app.nav.back()) app.nav.tab('deposits'); } }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: save }, renewFrom ? 'Renew' : (isNew ? 'Add deposit' : 'Save'))))
    };
  };

  /* ================================================================ payments (upcoming / history) */

  var payState = { range: '30', member: '', period: '3m' };

  S.payments = function (route) {
    var app = A(), data = D(), today = T(), tab = route.query.tab === 'history' ? 'history' : 'upcoming';
    if (route.query.range) { payState.range = route.query.range; }
    if (payState.member && !M.member(data, payState.member)) payState.member = '';
    var body = [UI.seg([{ value: 'upcoming', label: 'Upcoming' }, { value: 'history', label: 'History' }], tab, function (v) { app.nav.replace('payments?tab=' + v); })];
    var memOpts = [{ value: '', label: 'Everyone' }].concat(data.members.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (m) { return { value: m.id, label: m.name }; }));
    function byMember(p) {
      if (!payState.member) return true;
      var d = M.deposit(data, p.depositId);
      return d && d.memberId === payState.member;
    }
    if (tab === 'upcoming') {
      body.push(UI.chipRow([{ value: '7', label: 'Next 7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: 'all', label: 'All' }],
        payState.range, function (v) { payState.range = v; app.nav.replace('payments?tab=upcoming'); }));
      if (data.members.length > 1) body.push(UI.chipRow(memOpts, payState.member, function (v) { payState.member = v; app.render(); }));
      var to = payState.range === 'all' ? null : U.addDays(today, +payState.range);
      var overdue = M.openPayments(data, { before: today }).filter(byMember);
      var upcoming = M.openPayments(data, { from: today, to: to, activeOnly: true }).filter(byMember);
      if (!overdue.length && !upcoming.length) {
        body.push(h('div', { class: 'card' }, UI.empty('check', 'No interest due', data.deposits.length ? 'No interest is due in this period.' : 'Add deposits to see their Income Dates here.')));
      }
      if (overdue.length) {
        var ot = overdue.reduce(function (s, p) { return s + (+p.expectedAmount || 0); }, 0);
        body.push(sectionTitle('Overdue', h('span', { style: 'color:var(--danger);text-transform:none;letter-spacing:0' }, money(ot))));
        body.push(chunkedList(overdue, function (p) { return paymentItem(p); }, 50));
      }
      var groups = [
        { t: 'Today', f: function (p) { return p.dueDate === today; } },
        { t: 'Next 7 days', f: function (p) { return p.dueDate > today && p.dueDate <= U.addDays(today, 7); } },
        { t: 'Later', f: function (p) { return p.dueDate > U.addDays(today, 7); } }
      ];
      groups.forEach(function (g) {
        var items = upcoming.filter(g.f);
        if (!items.length) return;
        var tot = items.reduce(function (s, p) { return s + (+p.expectedAmount || 0); }, 0);
        body.push(sectionTitle(g.t, h('span', { style: 'text-transform:none;letter-spacing:0' }, money(tot))));
        body.push(chunkedList(items, function (p) { return paymentItem(p); }, 60));
      });
      // monthly renewal dates in the same period (the mature date itself is listed above with its interest)
      var rTo = to || U.addDays(today, 90);
      var renewals = M.renewalsBetween(data, today, rTo).filter(function (r) {
        return r.date !== r.deposit.maturityDate && (!payState.member || r.deposit.memberId === payState.member);
      });
      if (renewals.length) {
        body.push(sectionTitle('Monthly renewal dates', h('span', { style: 'text-transform:none;letter-spacing:0' }, U.plural(renewals.length, 'date'))));
        body.push(chunkedList(renewals, renewalItem, 5));
      }
    } else {
      var periods = [{ value: 'month', label: 'This month' }, { value: '3m', label: 'Last 3 months' }, { value: 'year', label: 'This year' }, { value: 'fy', label: 'This financial year' }, { value: 'all', label: 'All' }];
      body.push(UI.chipRow(periods, payState.period, function (v) { payState.period = v; app.render(); }));
      if (data.members.length > 1) body.push(UI.chipRow(memOpts, payState.member, function (v) { payState.member = v; app.render(); }));
      var from = '0000-01-01', y = +today.slice(0, 4), mo = +today.slice(5, 7);
      if (payState.period === 'month') from = today.slice(0, 8) + '01';
      else if (payState.period === '3m') from = U.addMonths(today.slice(0, 8) + '01', -2);
      else if (payState.period === 'year') from = y + '-01-01';
      else if (payState.period === 'fy') from = (mo >= 4 ? y : y - 1) + '-04-01';
      var rec = data.payments.filter(function (p) { return p.status === 'Received' && (p.receivedDate || p.dueDate) >= from && byMember(p); })
        .sort(function (a, b) { var x = a.receivedDate || a.dueDate, z = b.receivedDate || b.dueDate; return x < z ? 1 : x > z ? -1 : (a.id < b.id ? 1 : -1); });
      if (!rec.length) {
        body.push(h('div', { class: 'card' }, UI.empty('history', 'No interest received yet', 'Interest you mark as received appears here.')));
      } else {
        var total = rec.reduce(function (s, p) { return s + (+p.receivedAmount || 0); }, 0);
        body.push(h('div', { class: 'summary-line' }, h('span', null, U.plural(rec.length, 'interest payment') + ' received'), h('b', { class: 'num' }, money(total))));
        var monthTotals = {};
        rec.forEach(function (p) { var k = (p.receivedDate || p.dueDate).slice(0, 7); monthTotals[k] = (monthTotals[k] || 0) + (+p.receivedAmount || 0); });
        body.push(chunkedList(rec, function (p) { return paymentItem(p, { history: true, byReceived: true }); }, 60, function (cur, prev) {
          var k = (cur.receivedDate || cur.dueDate).slice(0, 7);
          if (prev && (prev.receivedDate || prev.dueDate).slice(0, 7) === k) return null;
          return h('div', { class: 'list-head' }, h('span', null, U.fmtMonthYear(k + '-01')), h('span', { class: 'num' }, money(monthTotals[k])));
        }));
      }
    }
    return { title: 'Payments', body: body, actions: h('button', { class: 'icon-btn', 'aria-label': 'Search', onclick: function () { app.nav.go('search'); } }, UI.icon('search')) };
  };

  /* ================================================================ family members */

  S.members = function () {
    var app = A(), data = D(), today = T(), body = [];
    var list = data.members.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (!list.length) {
      body.push(h('div', { class: 'card' }, UI.empty('users', 'No family members yet', 'Add each person who has deposits.',
        h('div', { class: 'stack' },
          h('button', { class: 'btn primary block', onclick: function () { memberSheet(null); } }, UI.icon('plus'), 'Add family member'),
          h('button', { class: 'btn outline block', onclick: function () { app.importFromPicker(); } }, UI.icon('file'), 'Load from Excel')))));
    } else {
      body.push(h('div', { class: 'summary-line' }, h('span', null, U.plural(list.length, 'family member')), h('span', null, U.plural(data.deposits.filter(function (d) { return d.status === 'Active'; }).length, 'active deposit'))));
      var l = h('div', { class: 'list' });
      list.forEach(function (m) {
        var deps = M.depositsOf(data, m.id), act = deps.filter(function (d) { return d.status === 'Active'; });
        var principal = act.reduce(function (s, d) { return s + (+d.depositAmount || 0); }, 0);
        var overdue = 0;
        deps.forEach(function (d) { M.paymentsOf(data, d.id).forEach(function (p) { if (p.status !== 'Received' && p.dueDate < today) overdue++; }); });
        l.appendChild(h('button', { class: 'item', onclick: function () { app.nav.go('member/' + m.id); } },
          h('div', { class: 'avatar' }, UI.initials(m.name)),
          h('div', { class: 'grow' },
            h('div', { class: 't1 ellipsis' }, m.name),
            h('div', { class: 't2 ellipsis' }, [m.village, m.phone].filter(Boolean).join(' · ') || m.id),
            h('div', { class: 't3' }, act.length ? U.plural(act.length, 'active deposit') : 'No active deposits',
              overdue ? h('span', { style: 'color:var(--danger);font-weight:650' }, ' · ' + overdue + ' overdue') : null)),
          h('div', { class: 'right' }, h('div', { class: 'amt' }, U.fmtMoneyShort(principal)))));
      });
      body.push(l);
    }
    return {
      title: 'Family members', body: body,
      fab: h('button', { class: 'fab', onclick: function () { memberSheet(null); } }, UI.icon('plus'), 'Add member')
    };
  };

  S.member = function (route) {
    var app = A(), data = D(), today = T(), m = M.member(data, route.arg);
    if (!m) return { title: 'Member', body: UI.empty('users', 'Member not found') };
    var deps = M.depositsOf(data, m.id).slice(), act = deps.filter(function (d) { return d.status === 'Active'; }), clo = deps.filter(function (d) { return d.status === 'Closed'; });
    var principal = act.reduce(function (s, d) { return s + (+d.depositAmount || 0); }, 0);
    var yearly = act.reduce(function (s, d) { return s + (+d.interestAmount || 0); }, 0);
    var received = 0;
    deps.forEach(function (d) { M.paymentsOf(data, d.id).forEach(function (p) { if (p.status === 'Received' && (p.receivedDate || '').slice(0, 4) === today.slice(0, 4)) received += +p.receivedAmount || 0; }); });
    var body = [
      h('div', { class: 'card' },
        h('div', { class: 'row' }, h('div', { class: 'avatar lg' }, UI.initials(m.name)),
          h('div', { class: 'grow' }, h('div', { class: 'strong', style: 'font-size:20px' }, m.name),
            h('div', { class: 'muted' }, [m.village, m.id].filter(Boolean).join(' · ')))),
        m.phone ? h('a', { class: 'btn outline block mt-16', href: 'tel:' + m.phone.replace(/[^\d+]/g, '') }, UI.icon('phone', 'sm'), 'Call ' + m.phone) : null),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Active principal'), h('div', { class: 'v' }, U.fmtMoneyShort(principal)), h('div', { class: 's' }, U.plural(act.length, 'deposit'))),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Interest (active)'), h('div', { class: 'v' }, U.fmtMoneyShort(yearly)), h('div', { class: 's' }, 'for the full terms')),
        h('div', { class: 'stat wide' }, h('div', { class: 'k' }, 'Received in ' + today.slice(0, 4)), h('div', { class: 'v', style: 'color:var(--ok)' }, money(received))))
    ];
    body.push(sectionTitle('Active deposits', linkBtn('+ Add', function () { app.nav.go('deposit-edit/new?member=' + m.id); })));
    if (act.length) { var al = h('div', { class: 'list' }); act.forEach(function (d) { al.appendChild(depositItem(d, { hideMember: true })); }); body.push(al); }
    else body.push(h('div', { class: 'card muted' }, 'No active deposits.'));
    if (clo.length) { body.push(sectionTitle('Closed deposits')); var cl = h('div', { class: 'list' }); clo.forEach(function (d) { cl.appendChild(depositItem(d, { hideMember: true })); }); body.push(cl); }
    body.push(h('div', { class: 'btn-row mt-16' },
      h('button', { class: 'btn outline', onclick: function () { memberSheet(m.id); } }, UI.icon('edit', 'sm'), 'Edit member'),
      h('button', { class: 'btn primary', onclick: function () { app.nav.go('deposit-edit/new?member=' + m.id); } }, UI.icon('plus', 'sm'), 'Add deposit')));
    if (!deps.length) {
      body.push(h('button', { class: 'btn danger block mt-12', onclick: function () {
        UI.confirm('Remove ' + m.name + '?', 'This member has no deposits, so nothing else is affected.', 'Remove', true).then(function (ok) {
          if (!ok) return;
          M.deleteMember(data, m.id);
          app.commit({ render: false });
          if (!app.nav.back()) app.nav.tab('members');
          UI.toast(m.name + ' removed');
        });
      } }, UI.icon('trash', 'sm'), 'Remove member'));
    }
    return { title: m.name, body: body };
  };

  /* ================================================================ search & filters */

  function freshSearch() { return { q: '', status: 'All', interestType: '', memberId: '', village: '', bank: '', sort: 'member' }; }
  var searchState = freshSearch();

  S.search = function (route) {
    var app = A(), data = D(), today = T();
    // links from the dashboard open the search with a position already chosen
    if (route.query.position && M.POSITIONS.indexOf(route.query.position) >= 0 && !route.query.seen) {
      searchState = freshSearch();
      searchState.status = route.query.position;
      searchState.sort = 'maturity';
      app.nav.stack[app.nav.stack.length - 1].path = route.path + '&seen=1';
    }
    var results = h('div');
    var q = UI.input({ type: 'search', value: searchState.q, placeholder: 'Name, village, bank, S.No, Deposit No…', 'aria-label': 'Search', enterkeyhint: 'search' });
    var clearBtn = h('button', { class: 'icon-btn clear', 'aria-label': 'Clear', onclick: function () { q.value = ''; searchState.q = ''; draw(); q.focus(); } }, UI.icon('x', 'sm'));
    q.addEventListener('input', U.debounce(function () { searchState.q = q.value; draw(); }, 150));

    function sel(key, options, label) {
      var el = UI.select(options, searchState[key], { 'aria-label': label });
      el.addEventListener('change', function () { searchState[key] = el.value; draw(); });
      return el;
    }
    var filters = h('div', { class: 'filters' },
      sel('status', [{ value: 'All', label: 'Any position' }, { value: 'Open', label: 'Open (not closed)' }]
        .concat(M.POSITIONS.map(function (p) { return { value: p, label: p }; })), 'Deposit position'),
      sel('interestType', [{ value: '', label: 'Any interest type' }].concat(M.INTEREST_TYPES), 'Interest type'),
      sel('memberId', [{ value: '', label: 'All depositers' }].concat(data.members.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (m) { return { value: m.id, label: m.name }; })), 'Depositer'),
      sel('village', [{ value: '', label: 'All villages' }].concat(M.villages(data)), 'Village'),
      sel('bank', [{ value: '', label: 'All banks' }].concat(M.banks(data)), 'Bank'),
      sel('sort', [{ value: 'member', label: 'Sort: depositer' }, { value: 'sno', label: 'Sort: S.No' }, { value: 'maturity', label: 'Sort: mature date' },
        { value: 'amount', label: 'Sort: deposit value' }, { value: 'bank', label: 'Sort: bank' }, { value: 'newest', label: 'Sort: newest' }], 'Sort'));

    function draw() {
      U.clear(results);
      var list = M.searchDeposits(data, searchState, today);
      var qq = U.str(searchState.q).toLowerCase();
      if (qq) {
        var mems = data.members.filter(function (m) { return (m.name + ' ' + m.village + ' ' + m.phone).toLowerCase().indexOf(qq) >= 0; });
        if (mems.length) {
          results.appendChild(sectionTitle('Family members'));
          var ml = h('div', { class: 'list' });
          mems.forEach(function (m) {
            ml.appendChild(h('button', { class: 'item', onclick: function () { app.nav.go('member/' + m.id); } },
              h('div', { class: 'avatar' }, UI.initials(m.name)), h('div', { class: 'grow' }, h('div', { class: 't1' }, m.name), h('div', { class: 't2' }, [m.village, m.phone].filter(Boolean).join(' · '))),
              UI.icon('right', 'sm')));
          });
          results.appendChild(ml);
        }
      }
      var total = list.reduce(function (sum, d) { return sum + (+d.depositAmount || 0); }, 0);
      results.appendChild(sectionTitle('Deposits', h('span', { style: 'text-transform:none;letter-spacing:0' }, list.length + ' · ' + money(total))));
      if (list.length) results.appendChild(chunkedList(list, function (d) { return depositItem(d); }, 60));
      else results.appendChild(h('div', { class: 'card muted' }, 'No deposits match.'));
    }
    draw();
    var body = [h('div', { class: 'search-box' }, UI.icon('search'), q, clearBtn), filters,
      h('div', { style: 'margin:-4px 0 6px;text-align:right' }, linkBtn('Reset filters', function () { searchState = freshSearch(); app.render(); })), results];
    return { title: searchState.status !== 'All' && searchState.status !== 'Open' ? searchState.status : 'Search & filters', body: body,
      after: function () { if (!searchState.q && searchState.status === 'All') q.focus(); } };
  };

  /* ================================================================ settings */

  function pinSetupSheet() {
    var app = A();
    return UI.sheet(function (close) {
      var first = '', title = h('h3', { style: 'text-align:center' }, 'Choose a PIN');
      var holder = h('div', { class: 'mt-12' });
      function stepOne() {
        var pad = UI.pinPad({ length: null, message: '4 to 6 digits, then tap OK', onDone: function (pin) {
          first = pin;
          pad.destroy();
          stepTwo();
        } });
        U.clear(holder).appendChild(pad.el);
      }
      function stepTwo() {
        title.textContent = 'Enter the PIN again';
        var pad2 = UI.pinPad({ length: first.length, message: '', onDone: function (pin) {
          if (pin !== first) { pad2.shake(); pad2.reset('The PINs did not match — try again'); return; }
          pad2.destroy();
          app.setPin(pin).then(function () {
            close(true);
            UI.toast('App lock is on');
            if (P.device.biometricAvailable()) {
              UI.confirm('Use fingerprint too?', 'Unlock with your fingerprint, with the PIN as a backup.', 'Use fingerprint').then(function (ok) {
                app.prefs.lock.biometric = !!ok;
                app.savePrefs();
                app.render();
              });
            } else app.render();
          });
        } });
        U.clear(holder).appendChild(pad2.el);
      }
      stepOne();
      return [title, holder];
    });
  }

  S.settings = function () {
    var app = A(), data = D(), prefs = app.prefs, body = [];
    var f = app.linkedFile(), ss = app.saveStatus();

    // Excel
    var ex = h('div', { class: 'card' }, h('h2', null, 'Excel file'));
    if (P.excel.canLink) {
      if (f) {
        ex.appendChild(h('div', { class: 'row', style: 'margin-bottom:12px' },
          h('div', { class: 'att-icon ' + (ss.kind === 'ok' ? 'teal' : ss.kind === 'busy' ? 'teal' : 'red') }, UI.icon(ss.kind === 'ok' || ss.kind === 'busy' ? 'check' : 'alert', 'sm')),
          h('div', { class: 'grow' }, h('div', { class: 'strong ellipsis' }, f.name), h('div', { class: 'small muted' }, ss.detail))));
        var exBtns = h('div', { class: 'stack' });
        if (ss.label === 'Reconnect Excel') exBtns.appendChild(h('button', { class: 'btn primary block', onclick: function () { app.reconnect(); } }, UI.icon('link'), 'Reconnect to the file'));
        else exBtns.appendChild(h('button', { class: 'btn primary block', onclick: function () { app.writeExcelNow().then(function (ok) { UI.toast(ok ? 'Saved to ' + f.name : 'Could not save — see the message above'); app.render(); }); } }, UI.icon('refresh'), 'Save now'));
        exBtns.appendChild(h('div', { class: 'btn-row' },
          h('button', { class: 'btn outline', onclick: function () { app.saveCopy(); } }, UI.icon('download', 'sm'), 'Save a copy'),
          P.canShare() ? h('button', { class: 'btn outline', onclick: function () { app.shareCopy(); } }, UI.icon('share', 'sm'), 'Share') : null));
        exBtns.appendChild(h('button', { class: 'btn outline block', onclick: function () { app.importFromPicker(); } }, UI.icon('file', 'sm'), 'Open a different Excel file'));
        exBtns.appendChild(h('button', { class: 'link', onclick: function () { app.unlinkFile(); } }, 'Stop saving to this file'));
        ex.appendChild(exBtns);
      } else {
        ex.appendChild(h('p', { class: 'muted', style: 'margin-top:0' }, 'Your data is safe in the app, but it is not being saved to an Excel file yet. Choose one and every change will be saved into it automatically.'));
        ex.appendChild(h('div', { class: 'stack' },
          h('button', { class: 'btn primary block', onclick: function () { app.createLinkedFile(); } }, UI.icon('plus'), 'Create Excel file'),
          h('button', { class: 'btn outline block', onclick: function () { app.importFromPicker(); } }, UI.icon('file'), 'Open existing Excel file'),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn outline', onclick: function () { app.saveCopy(); } }, UI.icon('download', 'sm'), 'Save a copy'),
            P.canShare() ? h('button', { class: 'btn outline', onclick: function () { app.shareCopy(); } }, UI.icon('share', 'sm'), 'Share') : null)));
      }
    } else {
      ex.appendChild(h('p', { class: 'muted', style: 'margin-top:0' }, 'In this browser your data is stored on this device. Export an Excel copy after making changes, or use the Android app to save every change into the file automatically.'));
      if (ss.kind === 'warn') ex.appendChild(UI.banner('', 'alert', 'Changes not exported yet', 'Export now to keep your Excel file up to date.'));
      ex.appendChild(h('div', { class: 'stack' },
        h('button', { class: 'btn primary block', onclick: function () { app.saveCopy(); } }, UI.icon('download'), 'Export Excel file'),
        P.canShare() ? h('button', { class: 'btn outline block', onclick: function () { app.shareCopy(); } }, UI.icon('share'), 'Share Excel file') : null,
        h('button', { class: 'btn outline block', onclick: function () { app.importFromPicker(); } }, UI.icon('upload'), 'Import Excel file')));
    }
    ex.appendChild(h('button', { class: 'btn outline block mt-12', onclick: function () { app.downloadTemplate(); } }, UI.icon('file', 'sm'), 'Download blank template'));
    if (prefs.excel.lastImport) ex.appendChild(h('div', { class: 'small muted mt-12' }, 'Last import: ' + (prefs.excel.lastImport.name || 'file') + ', ' + app.timeText(prefs.excel.lastImport.at)));
    body.push(ex);

    // Reminders
    var n = prefs.notify, rem = h('div', { class: 'card' }, h('h2', null, 'Reminders'));
    rem.appendChild(UI.switchRow('Payment & maturity reminders',
      P.notify.mode === 'phone' ? 'Phone notifications for maturity and interest, even when the app is closed.' : 'Shown when the app is open in this browser. The Android app notifies even when closed.',
      n.enabled, function (v) {
        n.enabled = v;
        app.savePrefs();
        app.syncReminders();
        if (v && P.notify.status() !== 'granted') askNotify();
        app.render();
      }));
    function askNotify() {
      P.notify.request().then(function (st) {
        UI.toast(st === 'granted' ? 'Notifications allowed' : 'Notifications are blocked — allow them in the phone settings');
        app.syncReminders();
        app.render();
      });
    }
    if (n.enabled) {
      var perm = P.notify.status();
      if (perm !== 'granted' && perm !== 'unsupported') {
        rem.appendChild(UI.banner('', 'bell', 'Notifications are not allowed yet', perm === 'denied' ? 'They are blocked. Allow them in the browser or phone settings.' : 'Allow them so reminders can appear.',
          perm === 'denied' ? null : h('button', { class: 'btn small primary', onclick: askNotify }, 'Allow notifications')));
      }
      var time = UI.input({ type: 'time', value: n.time || '09:00', style: 'max-width:160px' });
      time.addEventListener('change', function () { if (/^\d{2}:\d{2}$/.test(time.value)) { n.time = time.value; app.savePrefs(); app.syncReminders(); UI.toast('Reminders at ' + time.value); } });
      rem.appendChild(h('div', { class: 'switch-row' }, h('div', { class: 'sl' }, h('div', { class: 'strong' }, 'Reminder time'), h('div', { class: 'sd' }, 'When the day\'s reminders appear')), time));
      function dayChips(key, all, labelFn) {
        var row = h('div', { class: 'chips', style: 'flex-wrap:wrap' });
        all.forEach(function (d) {
          var on = n[key].indexOf(d) >= 0;
          row.appendChild(h('button', { class: 'fchip' + (on ? ' on' : ''), onclick: function () {
            var i = n[key].indexOf(d);
            if (i >= 0) n[key].splice(i, 1); else n[key].push(d);
            n[key].sort(function (a, b) { return b - a; });
            app.savePrefs(); app.syncReminders(); app.render();
          } }, on ? UI.icon('check', 'sm') : null, labelFn(d)));
        });
        return row;
      }
      var lbl = function (d) { return d === 0 ? 'On the day' : d === 1 ? '1 day before' : d + ' days before'; };
      if (!Array.isArray(n.renewalDays)) n.renewalDays = [];
      rem.appendChild(h('div', { class: 'strong mt-12' }, 'Before a deposit matures'));
      rem.appendChild(dayChips('maturityDays', [30, 7, 1, 0], lbl));
      rem.appendChild(h('div', { class: 'strong' }, 'Before an Income Date'));
      rem.appendChild(h('div', { class: 'small muted', style: 'margin:-2px 0 6px' }, 'When the interest comes on the Mature Date, one reminder covers both.'));
      rem.appendChild(dayChips('paymentDays', [7, 3, 1, 0], lbl));
      rem.appendChild(h('div', { class: 'strong' }, 'Monthly renewal dates'));
      rem.appendChild(h('div', { class: 'small muted', style: 'margin:-2px 0 6px' }, 'Off unless you pick one — one reminder per deposit every month.'));
      rem.appendChild(dayChips('renewalDays', [1, 0], lbl));
      if (P.notify.mode === 'phone') {
        rem.appendChild(h('button', { class: 'btn outline block', onclick: function () {
          P.notify.show('Deposit Manager', 'Reminders are working. You will be notified at ' + (n.time || '09:00') + ' on reminder days.', 'test');
          UI.toast('Test notification sent');
        } }, UI.icon('bell', 'sm'), 'Send a test notification'));
      }
      var upcoming = M.buildReminders(data, prefs, app.today, 60);
      rem.appendChild(h('div', { class: 'small muted mt-12' }, upcoming.length ? U.plural(upcoming.length, 'reminder') + ' scheduled in the next 60 days' + (upcoming[0] ? ' · next on ' + U.fmtDate(upcoming[0].notifyOn) : '') : 'No reminders in the next 60 days.'));
    }
    body.push(rem);

    // Security
    var L = prefs.lock, sec = h('div', { class: 'card' }, h('h2', null, 'Privacy & security'));
    sec.appendChild(UI.switchRow('App lock (PIN)', L.enabled ? 'A ' + L.length + '-digit PIN is needed to open the app.' : 'Ask for a PIN when the app opens.', L.enabled, function (v, cb) {
      if (v) { cb.checked = false; pinSetupSheet(); return; }
      cb.checked = true;
      app.verifyUser('Enter your PIN to turn off the lock').then(function (ok) {
        if (!ok) return;
        app.removePin();
        UI.toast('App lock is off');
        app.render();
      });
    }));
    if (L.enabled) {
      if (P.device.biometricAvailable()) {
        sec.appendChild(UI.switchRow('Unlock with fingerprint', 'The PIN still works as a backup.', !!L.biometric, function (v) { L.biometric = v; app.savePrefs(); }));
      }
      var after = UI.select([{ value: '0', label: 'Immediately' }, { value: '60', label: 'After 1 minute' }, { value: '300', label: 'After 5 minutes' }, { value: '900', label: 'After 15 minutes' }], String(L.after), { style: 'max-width:190px;min-height:44px;font-size:15px' });
      after.addEventListener('change', function () { L.after = +after.value; app.savePrefs(); });
      sec.appendChild(h('div', { class: 'switch-row' }, h('div', { class: 'sl' }, h('div', { class: 'strong' }, 'Lock again'), h('div', { class: 'sd' }, 'after leaving the app')), after));
      sec.appendChild(h('button', { class: 'btn outline block mt-8', onclick: function () {
        app.verifyUser('Enter your current PIN').then(function (ok) { if (ok) pinSetupSheet(); });
      } }, UI.icon('lock', 'sm'), 'Change PIN'));
    }
    if (P.kind === 'android') {
      sec.appendChild(UI.switchRow('Hide screen in recent apps', 'Also blocks screenshots of the app.', !!prefs.secureScreen, function (v) {
        prefs.secureScreen = v; app.savePrefs(); P.device.setSecure(v);
      }));
    }
    sec.appendChild(h('div', { class: 'small muted mt-12' }, 'Deposit numbers are always shown as XXXX1234. Tap Show on a deposit to see the full number' + (L.enabled ? ' (asks for your PIN).' : '.')));
    body.push(sec);

    // Appearance
    var th = UI.seg([{ value: 'system', label: 'Automatic' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], prefs.theme, function (v) {
      prefs.theme = v; app.savePrefs(); app.applyTheme(); app.render();
    });
    th.style.marginBottom = '0';
    body.push(h('div', { class: 'card' }, h('h2', null, 'Appearance'), th));

    // Data
    var bk = app.backupInfo();
    body.push(h('div', { class: 'card' }, h('h2', null, 'Data'),
      h('div', { class: 'kv' },
        h('div', { class: 'k' }, 'Family members'), h('div', { class: 'v' }, String(data.members.length)),
        h('div', { class: 'k' }, 'Deposits'), h('div', { class: 'v' }, data.deposits.length + ' (' + data.deposits.filter(function (d) { return d.status === 'Closed'; }).length + ' closed)'),
        h('div', { class: 'k' }, 'Interest rows'), h('div', { class: 'v' }, String(data.payments.length))),
      h('div', { class: 'stack mt-12' },
        h('button', { class: 'btn outline block', onclick: function () { app.nav.go('search'); } }, UI.icon('search', 'sm'), 'Search & filter deposits'),
        bk ? h('button', { class: 'btn outline block', onclick: function () { app.restoreBackup(); } }, UI.icon('history', 'sm'), 'Restore previous data') : null,
        bk ? h('div', { class: 'small muted' }, 'Backup from ' + app.timeText(bk.at) + ' (' + bk.reason + '): ' + U.plural(bk.members, 'member') + ', ' + U.plural(bk.deposits, 'deposit') + '.') : null,
        h('button', { class: 'btn danger block', onclick: function () { app.eraseAll(); } }, UI.icon('trash', 'sm'), 'Erase all data'))));

    body.push(h('div', { class: 'card' }, h('h2', null, 'About'),
      h('div', { class: 'row' }, UI.logo('avatar'),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, 'Deposit Manager ' + app.VERSION),
          h('div', { class: 'small muted' }, 'Works fully offline. Your data stays on this device and in your own Excel file — nothing is uploaded.')))));
    return { title: 'Settings', body: body };
  };

  DM.screens.receiveSheet = receiveSheet;
  DM.screens.memberSheet = memberSheet;
})(window.DM = window.DM || {});
