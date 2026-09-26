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

  function depositItem(dep, opts) {
    opts = opts || {};
    var today = T(), m = M.member(D(), dep.memberId), sub;
    if (dep.status === 'Closed') sub = 'Closed' + (dep.closedDate ? ' on ' + U.fmtDate(dep.closedDate) : '');
    else if (!M.hasSchedule(dep)) sub = h('span', { style: 'color:var(--warn);font-weight:600' }, 'Payment dates not set — tap to fix');
    else {
      var sum = M.depositSummary(D(), dep, today);
      if (sum.overdue.length) sub = h('span', { style: 'color:var(--danger);font-weight:600' }, U.plural(sum.overdue.length, 'payment') + ' overdue');
      else if (sum.next) sub = 'Next ' + U.fmtDate(sum.next.dueDate) + ' · ' + money(sum.next.expectedAmount);
      else if (dep.maturityDate && dep.maturityDate < today) sub = h('span', { style: 'color:var(--warn);font-weight:600' }, 'Matured on ' + U.fmtDate(dep.maturityDate) + ' — close it?');
      else sub = dep.maturityDate ? 'Matures ' + U.fmtDate(dep.maturityDate) : '';
    }
    return h('button', { class: 'item', onclick: function () { A().nav.go('deposit/' + dep.id); } },
      h('div', { class: 'avatar' }, UI.initials(m ? m.name : '?')),
      h('div', { class: 'grow' },
        h('div', { class: 't1 ellipsis' }, opts.hideMember ? dep.bank : (m ? m.name : '(Unknown member)')),
        h('div', { class: 't2 ellipsis' }, opts.hideMember ? U.maskAccount(dep.accountNumber) + (dep.village ? ' · ' + dep.village : '') : depositLine(dep)),
        sub ? h('div', { class: 't3 ellipsis' }, sub) : null),
      h('div', { class: 'right' },
        h('div', { class: 'amt' }, money(dep.depositAmount)),
        h('div', { class: 't3' }, dep.status === 'Closed' ? UI.statusChip('Closed') : (dep.frequency || '—'))));
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
      h('div', { class: 't2 ellipsis' }, opts.hideMember ? U.maskAccount(dep.accountNumber) + ' · ' + dep.frequency : depositLine(dep)),
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
        UI.field('Expected amount for this payment', expWrap.input, { wrap: expWrap.wrap, hint: 'Only this one payment changes. To change all future payments, edit the deposit.' }),
        h('button', { class: 'btn outline block', onclick: function () {
          var v = U.toNumber(expWrap.input.value);
          if (!(v >= 0)) { UI.toast('Enter a valid amount'); return; }
          M.updatePayment(D(), p.id, { expectedAmount: v });
          A().commit();
          close();
          UI.toast('Expected amount updated');
        } }, 'Save expected amount'));
      return [
        h('h3', null, 'Mark as received'),
        h('div', { class: 'sub' }, (m ? m.name : '') + ' · ' + depositLine(dep)),
        h('div', { class: 'card', style: 'background:var(--surface-2);box-shadow:none' },
          h('div', { class: 'row' },
            h('div', { class: 'grow' }, h('div', { class: 'muted small' }, 'Due date'), h('div', { class: 'strong' }, U.fmtDate(p.dueDate))),
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
            UI.toast(nxt ? 'Received ✓  Next payment: ' + U.fmtDate(nxt.dueDate) + ' · ' + money(nxt.expectedAmount)
              : 'Received ✓  No more payments scheduled for this deposit', {
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
        h('div', { class: 'k' }, 'Due date'), h('div', { class: 'v' }, U.fmtDate(p.dueDate)),
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
          UI.confirm('Mark as not received?', 'Use this if it was marked by mistake. The payment goes back to ' +
            (p.dueDate < T() ? 'overdue.' : 'pending.'), 'Mark not received').then(function (ok) {
            if (!ok) return;
            M.markNotReceived(D(), p.id, T());
            A().commit();
            close();
            UI.toast('Marked as not received');
          });
        } }, 'Not received'));
      return [
        h('h3', null, 'Payment received'),
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
          h('div', { class: 'cd' }, 'Load all family members and deposits at once from one .xlsx workbook.'))),
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
          h('li', null, 'All data lives in one Excel workbook with four sheets: FamilyMembers, Deposits, Payments and Notifications.'),
          h('li', null, 'Enter each deposit once. The app works out every payment date from the first payment date and how often it pays.'),
          h('li', null, 'You get reminders 7, 3 and 1 day before each payment, on the day, and before a deposit matures.'),
          h('li', null, 'Nothing is uploaded anywhere. Account numbers are shown only as XXXX1234.'))));
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
        h('div', null, h('b', null, String(c.payments)), h('span', null, 'payment rows'))));
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
            h('div', { class: 'rd' }, 'Mark them as received on their due dates. Choose this if the family has been getting these payments.')));
        r2 = h('button', { class: 'radio-card', onclick: function () { pick('pending'); } }, h('span', { class: 'dot' }),
          h('div', null, h('div', { class: 'rt' }, 'Not received yet'),
            h('div', { class: 'rd' }, 'Show them as overdue so you can tick each one off.')));
        nodes.push(h('div', { class: 'strong mt-16' }, U.plural(prep.pastCount, 'payment date') + ' are before today and not in the Payments sheet'));
        nodes.push(h('div', { class: 'muted small', style: 'margin:2px 0 10px' }, 'How should the app treat them?'));
        nodes.push(r1, r2);
      }
      if (P.excel.canLink && o.source === 'open') {
        var other = prep.otherSheets || [];
        nodes.push(h('div', { class: 'card mt-16', style: 'background:var(--surface-2);box-shadow:none;margin-bottom:10px' },
          UI.switchRow('Keep saving changes into this file',
            other.length ? 'This file also has other sheets (' + other.join(', ') + '). They would be removed when the app saves, so this is off. You can create a new file afterwards.'
              : 'The app rewrites this file in its own layout and fills in the Payments and Notifications sheets.',
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
      body.push(UI.banner('info', 'bell', 'Reminders are switched off on this phone', 'Allow notifications so you are reminded before each payment.',
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
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, U.plural(st.overdue.count, 'payment') + ' overdue'), h('div', { class: 'small muted' }, money(st.overdue.amount) + ' not yet received')),
        linkBtn('View', function () { app.nav.tab('payments'); })));
    }
    if (st.matured.length) {
      att.push(h('div', { class: 'att-line' }, h('span', { class: 'att-icon amber' }, UI.icon('clock', 'sm')),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, U.plural(st.matured.length, 'deposit') + ' matured'), h('div', { class: 'small muted' }, 'Renewed or withdrawn? Close them to keep things tidy.')),
        linkBtn('View', function () { app.nav.go(st.matured.length === 1 ? 'deposit/' + st.matured[0].id : 'search?maturedOnly=1'); })));
    }
    if (st.incomplete.length) {
      att.push(h('div', { class: 'att-line' }, h('span', { class: 'att-icon amber' }, UI.icon('calendar', 'sm')),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, U.plural(st.incomplete.length, 'deposit') + ' without payment dates'), h('div', { class: 'small muted' }, 'Add the first payment date and frequency.')),
        linkBtn('Fix', function () { app.nav.go('deposit-edit/' + st.incomplete[0].id); })));
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
      stat('Upcoming (30 days)', String(st.upcoming30.count), money(st.upcoming30.amount), function () { app.nav.tab('payments'); }, '', 'calendar'),
      stat('Pending payments', String(st.pending), 'scheduled, not yet due', function () { app.nav.tab('payments?range=all'); }, '', 'clock'),
      stat('Overdue', String(st.overdue.count), st.overdue.count ? money(st.overdue.amount) : 'nothing overdue', function () { app.nav.tab('payments'); }, st.overdue.count ? 'alert' : '', 'alert')));

    // coming up
    var soon = M.openPayments(data, { activeOnly: false, to: U.addDays(today, 30) }).slice(0, 6);
    body.push(sectionTitle('Coming up', linkBtn('See all', function () { app.nav.tab('payments'); })));
    if (soon.length) {
      var l = h('div', { class: 'list' });
      soon.forEach(function (p) { var n = paymentItem(p); if (n) l.appendChild(n); });
      body.push(l);
    } else {
      body.push(h('div', { class: 'card muted' }, 'No payments due in the next 30 days.'));
    }

    // this month
    body.push(h('div', { class: 'card' }, h('h2', null, 'This month — ' + U.fmtMonthYear(today)),
      h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('div', { class: 'muted small' }, 'Received'), h('div', { class: 'strong num', style: 'font-size:20px;color:var(--ok)' }, money(st.thisMonth.received))),
        h('div', { class: 'grow right' }, h('div', { class: 'muted small' }, 'Still to receive'), h('div', { class: 'strong num', style: 'font-size:20px' }, money(st.thisMonth.expected))))));

    // expected income by frequency
    var rows = st.byFrequency.filter(function (b) { return b.count; }).map(function (b) {
      var per = { 'Monthly': 'each month', 'Quarterly': 'each quarter', 'Half-Yearly': 'every 6 months', 'Annually': 'each year' }[b.frequency];
      return h('tr', null,
        h('td', null, h('div', { class: 'strong' }, b.frequency), h('div', { class: 'small muted' }, U.plural(b.count, 'deposit') + ' · ' + money(b.perPayout) + ' ' + per)),
        h('td', { class: 'r' }, money(b.yearly), h('div', { class: 'small muted', style: 'font-weight:500' }, 'a year')));
    });
    if (rows.length) {
      rows.push(h('tr', { class: 'total' }, h('td', null, 'Expected income a year'), h('td', { class: 'r' }, money(st.yearlyIncome))));
      body.push(h('div', { class: 'card' }, h('h2', null, 'Expected income by frequency'), h('table', { class: 'freq-table' }, h('tbody', null, rows))));
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
      body.push(h('div', { class: 'card' }, UI.empty('bank', depState.member ? 'No active deposits for this member' : 'No active deposits yet', 'Add a deposit and the app will work out every payment date.',
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
    var m = M.member(data, dep.memberId), sum = M.depositSummary(data, dep, today), body = [];

    // hero
    var acctText = h('span', null, U.maskAccount(dep.accountNumber)), shown = false, hideTimer = null;
    var eyeBtn = h('button', { 'aria-label': 'Show account number' }, UI.icon('eye', 'sm'), 'Show');
    eyeBtn.addEventListener('click', function () {
      if (shown) { hide(); return; }
      if (!dep.accountNumber) return;
      app.verifyUser('Show the full account number').then(function (ok) {
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
      h('div', { class: 'acct' }, 'A/c ', acctText, dep.accountNumber ? eyeBtn : null),
      h('div', { class: 'meta' },
        h('button', { class: 'who', onclick: function () { if (m) app.nav.go('member/' + m.id); } }, UI.icon('users', 'sm'), m ? m.name : 'Unknown'),
        UI.statusChip(dep.status))));

    if (!M.hasSchedule(dep)) {
      body.push(UI.banner('', 'calendar', 'Payment dates are not set', 'Add the first payment date and payment frequency, and the app will create the schedule.',
        h('button', { class: 'btn small primary', onclick: function () { app.nav.go('deposit-edit/' + dep.id); } }, 'Edit deposit')));
    }
    if (dep.status === 'Active' && dep.maturityDate && dep.maturityDate < today) {
      body.push(UI.banner('', 'clock', 'This deposit matured on ' + U.fmtDate(dep.maturityDate), 'If it was renewed or withdrawn, close it. Its history is kept.',
        h('button', { class: 'btn small primary', onclick: function () { closeSheet(dep); } }, 'Close deposit')));
    }

    // overdue
    if (sum.overdue.length) {
      var ol = h('div', { class: 'list', style: 'border:1.5px solid var(--danger-soft)' },
        h('div', { class: 'list-head', style: 'background:var(--danger-soft);color:var(--danger)' }, h('span', null, U.plural(sum.overdue.length, 'payment') + ' overdue'), h('span', null, money(sum.overdueTotal))));
      sum.overdue.forEach(function (p) { ol.appendChild(scheduleItem(p)); });
      body.push(ol);
    }

    // next payment
    if (sum.next) {
      body.push(h('div', { class: 'card' }, h('h2', null, 'Next payment'),
        h('div', { class: 'next-card' }, UI.dateBox(sum.next.dueDate, sum.next.dueDate === today ? 'today' : ''),
          h('div', { class: 'grow' }, h('div', { class: 'when num' }, money(sum.next.expectedAmount)), h('div', { class: 'muted' }, U.fmtDate(sum.next.dueDate) + ' · ' + U.relLong(sum.next.dueDate, today))),
          h('button', { class: 'recv-btn', onclick: function () { receiveSheet(sum.next.id); } }, UI.icon('check', 'sm'), 'Received'))));
    }

    // progress
    if (M.hasSchedule(dep)) {
      var prog = h('div', { class: 'card' }, h('h2', null, 'Payments received'),
        h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:8px' },
          h('div', { class: 'strong' }, sum.total ? sum.receivedCount + ' of ' + sum.total : String(sum.receivedCount)),
          h('div', { class: 'strong num', style: 'color:var(--ok)' }, money(sum.receivedTotal) + ' so far')));
      if (sum.total) prog.appendChild(h('div', { class: 'progress' }, h('span', { style: 'width:' + Math.min(100, Math.round(sum.receivedCount / sum.total * 100)) + '%' })));
      body.push(prog);
    }

    // details
    var rows = [
      ['Family member', m ? m.name : '—'],
      ['Village', dep.village || '—'],
      ['Bank / institution', dep.bank || '—'],
      ['Account number', U.maskAccount(dep.accountNumber)],
      ['Deposit amount', money(dep.depositAmount)],
      ['Interest rate', U.fmtRate(dep.interestRate)],
      ['Payment amount', money(dep.paymentAmount) + (dep.frequency ? ' ' + dep.frequency.toLowerCase() : '')],
      ['Start date', U.fmtDate(dep.startDate)],
      ['First payment', U.fmtDate(dep.firstPaymentDate)],
      ['Maturity date', dep.maturityDate ? U.fmtDate(dep.maturityDate) + (dep.status === 'Active' && dep.maturityDate >= today ? ' (' + U.relLong(dep.maturityDate, today) + ')' : '') : '—'],
      dep.status === 'Closed' ? ['Closed on', U.fmtDate(dep.closedDate)] : null,
      ['Deposit ID', dep.id],
      dep.notes ? ['Notes', dep.notes] : null
    ].filter(Boolean);
    var kv = h('div', { class: 'kv' });
    rows.forEach(function (r) { kv.appendChild(h('div', { class: 'k' }, r[0])); kv.appendChild(h('div', { class: 'v' }, r[1])); });
    body.push(h('div', { class: 'card' }, h('h2', null, 'Details'), kv));

    // schedule
    if (sum.payments.length) {
      body.push(sectionTitle('Payment schedule', h('span', { class: 'small muted', style: 'text-transform:none;letter-spacing:0' }, U.plural(sum.payments.length, 'row'))));
      var sched = sum.payments.slice().sort(function (a, b) { return a.dueDate < b.dueDate ? 1 : -1; });
      var upcomingFirst = sched.filter(function (p) { return p.dueDate >= today && p.status !== 'Received'; }).reverse()
        .concat(sched.filter(function (p) { return !(p.dueDate >= today && p.status !== 'Received'); }));
      body.push(chunkedList(upcomingFirst, scheduleItem, 24));
      if (dep.status === 'Active' && !dep.maturityDate) body.push(h('div', { class: 'muted small', style: 'margin:-6px 4px 14px' }, 'No maturity date, so payment dates are kept 12 months ahead and added automatically.'));
    }

    // actions
    var acts = h('div', { class: 'btn-row mt-16' },
      h('button', { class: 'btn outline', onclick: function () { app.nav.go('deposit-edit/' + dep.id); } }, UI.icon('edit', 'sm'), 'Edit'),
      dep.status === 'Active'
        ? h('button', { class: 'btn outline', onclick: function () { closeSheet(dep); } }, UI.icon('close', 'sm'), 'Close deposit')
        : h('button', { class: 'btn outline', onclick: function () { reopen(dep); } }, UI.icon('reopen', 'sm'), 'Reopen'));
    body.push(acts);
    if (M.canDeleteDeposit(data, dep.id)) {
      body.push(h('button', { class: 'btn danger block mt-12', onclick: function () {
        UI.confirm('Delete this deposit?', 'Use this only for a deposit added by mistake. It has no received payments, so nothing from the history is lost.', 'Delete', true).then(function (ok) {
          if (!ok) return;
          M.deleteDeposit(data, dep.id);
          app.commit({ render: false });
          if (!app.nav.back()) app.nav.tab('deposits');
          UI.toast('Deposit deleted');
        });
      } }, UI.icon('trash', 'sm'), 'Delete deposit'));
    }
    return { title: m ? m.name + ' · ' + (dep.bank || 'Deposit') : 'Deposit', body: body };
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
        info.textContent = 'All received payments are kept. ' + (f ? U.plural(f, 'scheduled payment') + ' after this date will be removed. ' : '') +
          (keep ? U.plural(keep, 'unpaid payment') + ' due on or before this date will stay so you can still mark them received.' : '');
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
            UI.toast('Deposit closed' + (r.unpaidKept ? ' · ' + U.plural(r.unpaidKept, 'unpaid payment') + ' kept' : ''));
          } }, 'Close deposit'))
      ];
    });
  }

  function reopen(dep) {
    UI.confirm('Reopen this deposit?', 'It becomes active again and upcoming payment dates are added back.', 'Reopen').then(function (ok) {
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
    if (!isNew && !dep) return { title: 'Edit deposit', body: UI.empty('bank', 'Deposit not found') };
    if (!data.members.length) {
      return {
        title: 'Add deposit', tabs: false,
        body: h('div', { class: 'card' }, UI.empty('users', 'Add a family member first', 'Every deposit belongs to a family member.',
          h('button', { class: 'btn primary', onclick: function () { memberSheet(null, function () { app.render(); }); } }, UI.icon('plus'), 'Add family member')))
      };
    }
    var f = dep ? U.clone(dep) : {
      id: '', memberId: route.query.member || (data.members.length === 1 ? data.members[0].id : ''), village: '', bank: '', accountNumber: '',
      depositAmount: '', interestRate: '', paymentAmount: '', frequency: '', startDate: '', firstPaymentDate: '', maturityDate: '', notes: ''
    };
    if (isNew && f.memberId) { var mm = M.member(data, f.memberId); f.village = mm ? mm.village : ''; }
    var pastAs = 'received';
    var root = h('div');

    // member
    function memberOptions() {
      return [{ value: '', label: 'Choose family member…' }].concat(data.members.slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
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
    var village = UI.input({ type: 'text', value: f.village || '', list: 'dl-v2', autocapitalize: 'words' });
    var bank = UI.input({ type: 'text', value: f.bank || '', list: 'dl-banks', autocapitalize: 'words', placeholder: 'e.g. SBI Tambaram, Post Office' });
    var acct = UI.input({ type: 'text', value: f.accountNumber || '', inputmode: 'text', autocapitalize: 'characters', placeholder: 'As in the passbook / receipt', spellcheck: 'false' });
    function acctHint() {
      var v = acct.value.replace(/\s+/g, '');
      return v.length > 4 ? 'The app shows it as ' + U.maskAccount(v) + ' everywhere.' : 'The app only ever shows the last 4 digits, like XXXX4582.';
    }
    acct.addEventListener('input', function () { var hn = acct.parentNode && acct.parentNode.querySelector('.hint'); if (hn) hn.textContent = acctHint(); });
    var amount = UI.moneyInput({ value: f.depositAmount === '' ? '' : String(f.depositAmount), placeholder: '0' });
    var rateI = UI.input({ type: 'text', inputmode: 'decimal', value: f.interestRate === '' ? '' : String(f.interestRate), placeholder: 'e.g. 7.25' });
    var rateWrap = h('div', { class: 'input-wrap has-suffix' }, rateI, h('span', { class: 'suffix' }, '%'));
    var pay = UI.moneyInput({ value: f.paymentAmount === '' ? '' : String(f.paymentAmount), placeholder: 'Interest received each time' });
    var suggest = h('div', { class: 'quick' });
    var start = UI.input({ type: 'date', value: f.startDate || '' });
    var first = UI.input({ type: 'date', value: f.firstPaymentDate || '' });
    var firstQuick = h('div', { class: 'quick' });
    var maturity = UI.input({ type: 'date', value: f.maturityDate || '' });
    var matQuick = h('div', { class: 'quick' });
    var notes = h('textarea', { class: 'input', rows: '2', placeholder: 'Anything useful — nominee, renewal plan…' });
    notes.value = f.notes || '';
    var preview = h('div', { class: 'preview-dates', style: 'display:none' });
    var pastBox = h('div');

    var freqBtns = {};
    var freqPick = h('div', { class: 'freq-pick', role: 'radiogroup' });
    M.FREQS.forEach(function (fr) {
      var b = h('button', { type: 'button', class: f.frequency === fr ? 'on' : '', role: 'radio', 'aria-checked': f.frequency === fr ? 'true' : 'false',
        onclick: function () { f.frequency = fr; Object.keys(freqBtns).forEach(function (k) { freqBtns[k].classList.toggle('on', k === fr); freqBtns[k].setAttribute('aria-checked', k === fr ? 'true' : 'false'); }); UI.setFieldError(root, 'frequency', ''); refresh(); } }, fr);
      freqBtns[fr] = b;
      freqPick.appendChild(b);
    });

    function readForm() {
      return {
        id: f.id, memberId: memberSel.value === '__new' ? '' : memberSel.value, village: village.value, bank: bank.value, accountNumber: acct.value,
        depositAmount: U.toNumber(amount.input.value), interestRate: rateI.value.trim() === '' ? '' : U.toNumber(rateI.value),
        paymentAmount: pay.input.value.trim() === '' ? '' : U.toNumber(pay.input.value), frequency: f.frequency,
        startDate: start.value, firstPaymentDate: first.value, maturityDate: maturity.value, notes: notes.value,
        status: dep ? dep.status : 'Active', closedDate: dep ? dep.closedDate : ''
      };
    }

    function refresh() {
      var cur = readForm();
      // suggested payment
      U.clear(suggest);
      var sg = M.suggestPayment(cur.depositAmount, cur.interestRate, cur.frequency);
      if (sg !== '' && +sg !== +cur.paymentAmount) {
        suggest.appendChild(h('button', { type: 'button', onclick: function () { pay.input.value = String(sg); refresh(); } }, 'Use ' + money(sg) + ' (amount × rate)'));
      }
      // first payment helpers
      U.clear(firstQuick);
      if (U.isValidISO(cur.startDate) && M.FREQ_MONTHS[cur.frequency]) {
        var guess = U.addMonths(cur.startDate, M.FREQ_MONTHS[cur.frequency]);
        if (guess !== cur.firstPaymentDate) firstQuick.appendChild(h('button', { type: 'button', onclick: function () { first.value = guess; refresh(); } }, U.fmtDate(guess) + ' (one period after start)'));
      }
      // maturity helpers
      U.clear(matQuick);
      var base = U.isValidISO(cur.startDate) ? cur.startDate : (U.isValidISO(cur.firstPaymentDate) ? cur.firstPaymentDate : '');
      if (base) [1, 2, 3, 5].forEach(function (y) {
        var d = U.addMonths(base, 12 * y);
        matQuick.appendChild(h('button', { type: 'button', onclick: function () { maturity.value = d; refresh(); } }, y + (y === 1 ? ' year' : ' years')));
      });
      // preview of dates
      var tmp = { frequency: cur.frequency, firstPaymentDate: cur.firstPaymentDate, maturityDate: cur.maturityDate, status: 'Active' };
      if (M.hasSchedule(tmp)) {
        var ds = M.dueDates(tmp, today, cur.maturityDate ? Infinity : 24).filter(function (d) { return d >= today; }).slice(0, 4);
        var total = M.totalPayments(tmp);
        preview.style.display = '';
        preview.textContent = (ds.length ? 'Next payment dates: ' + ds.map(U.fmtDateShort).join(', ') + (ds.length === 4 ? '…' : '') : 'All payment dates are in the past.') +
          (total ? ' · ' + total + ' payments in total until maturity.' : '');
      } else preview.style.display = 'none';
      // past dates question
      U.clear(pastBox);
      var probe = { id: f.id, frequency: cur.frequency, firstPaymentDate: cur.firstPaymentDate, maturityDate: cur.maturityDate, status: cur.status, closedDate: cur.closedDate };
      var past = M.hasSchedule(probe) ? M.countPastDue(data, probe, today) : 0;
      if (past > 0) {
        var r1, r2;
        var pick = function (v) { pastAs = v; r1.classList.toggle('on', v === 'received'); r2.classList.toggle('on', v === 'pending'); };
        r1 = h('button', { type: 'button', class: 'radio-card' + (pastAs === 'received' ? ' on' : ''), onclick: function () { pick('received'); } }, h('span', { class: 'dot' }),
          h('div', null, h('div', { class: 'rt' }, 'Already received'), h('div', { class: 'rd' }, 'Mark them received on their due dates.')));
        r2 = h('button', { type: 'button', class: 'radio-card' + (pastAs === 'pending' ? ' on' : ''), onclick: function () { pick('pending'); } }, h('span', { class: 'dot' }),
          h('div', null, h('div', { class: 'rt' }, 'Not received yet'), h('div', { class: 'rd' }, 'Show them as overdue.')));
        pastBox.appendChild(h('div', { class: 'card', style: 'background:var(--warn-soft);box-shadow:none' },
          h('div', { class: 'strong' }, U.plural(past, 'payment date') + ' before today'),
          h('div', { class: 'small muted', style: 'margin:2px 0 10px' }, 'How should these be recorded?'), r1, r2));
      }
    }

    [amount.input, rateI, pay.input].forEach(function (el) { el.addEventListener('input', refresh); });
    [start, first, maturity].forEach(function (el) { el.addEventListener('change', refresh); el.addEventListener('input', refresh); });

    U.append(root, [
      h('datalist', { id: 'dl-banks' }, M.banks(data).map(function (v) { return h('option', { value: v }); })),
      h('datalist', { id: 'dl-v2' }, M.villages(data).map(function (v) { return h('option', { value: v }); })),
      h('div', { class: 'card' },
        UI.field('Family member', memberSel, { name: 'memberId' }),
        UI.field('Village', village, { name: 'village', optional: true, hint: 'Filled in from the member; change it if this deposit is elsewhere.' }),
        UI.field('Bank / institution', bank, { name: 'bank' }),
        UI.field('Account number', acct, { name: 'accountNumber', optional: true, hint: acctHint() })),
      h('div', { class: 'card' },
        UI.field('Deposit amount', amount.input, { name: 'depositAmount', wrap: amount.wrap }),
        UI.field('Interest rate', rateI, { name: 'interestRate', wrap: rateWrap, optional: true }),
        h('div', { class: 'field', dataset: { name: 'frequency' } }, h('div', { class: 'lbl' }, 'How often is interest paid?'), freqPick,
          h('div', { class: 'error', style: 'display:none' })),
        UI.field('Payment amount', pay.input, { name: 'paymentAmount', wrap: pay.wrap, extra: suggest, hint: 'The interest received each time. Leave empty to calculate it from amount × rate.' })),
      h('div', { class: 'card' },
        UI.field('Start date', start, { name: 'startDate', optional: true }),
        UI.field('First payment date', first, { name: 'firstPaymentDate', extra: firstQuick, hint: 'Every later payment date is worked out from this.' }),
        preview,
        h('div', { class: 'mt-16' }, UI.field('Maturity date', maturity, { name: 'maturityDate', optional: true, extra: matQuick }))),
      pastBox,
      h('div', { class: 'card' }, UI.field('Notes', notes, { name: 'notes', optional: true }))
    ]);
    refresh();

    function save() {
      var cur = readForm();
      if (cur.depositAmount !== '' && isNaN(cur.depositAmount)) cur.depositAmount = '';
      var err = M.validateDeposit(cur);
      if (cur.interestRate !== '' && isNaN(cur.interestRate)) err.interestRate = 'Enter a number, e.g. 7.25';
      if (cur.paymentAmount !== '' && isNaN(cur.paymentAmount)) err.paymentAmount = 'Enter a valid amount';
      ['memberId', 'bank', 'accountNumber', 'depositAmount', 'interestRate', 'paymentAmount', 'frequency', 'firstPaymentDate', 'maturityDate'].forEach(function (k) {
        UI.setFieldError(root, k, err[k]);
      });
      var keys = Object.keys(err);
      if (keys.length) {
        var el = root.querySelector('.field.err');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        UI.toast('Please check the highlighted fields');
        return;
      }
      if (cur.paymentAmount === '' && M.suggestPayment(cur.depositAmount, cur.interestRate, cur.frequency) === '') cur.paymentAmount = 0;
      var res = M.saveDeposit(data, cur, { today: today, pastAs: pastAs });
      app.commit({ render: false });
      if (isNew) app.nav.replace('deposit/' + res.deposit.id); else app.nav.back();
      var msg = isNew ? 'Deposit added' : 'Deposit saved';
      if (res.created.length) msg += ' · ' + U.plural(res.created.length, 'payment date') + ' created';
      UI.toast(msg);
      if (isNew) app.maybeAskNotifications();
    }

    return {
      title: isNew ? 'Add deposit' : 'Edit deposit', body: root, tabs: false,
      sticky: h('div', { class: 'sticky-actions' }, h('div', null,
        h('button', { class: 'btn outline', onclick: function () { if (!app.nav.back()) app.nav.tab('deposits'); } }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: save }, isNew ? 'Add deposit' : 'Save')))
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
        body.push(h('div', { class: 'card' }, UI.empty('check', 'Nothing due', data.deposits.length ? 'No payments due in this period.' : 'Add deposits to see their payment dates here.')));
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
        body.push(h('div', { class: 'card' }, UI.empty('history', 'No received payments', 'Payments you mark as received appear here.')));
      } else {
        var total = rec.reduce(function (s, p) { return s + (+p.receivedAmount || 0); }, 0);
        body.push(h('div', { class: 'summary-line' }, h('span', null, U.plural(rec.length, 'payment') + ' received'), h('b', { class: 'num' }, money(total))));
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
    var yearly = act.reduce(function (s, d) { var k = M.FREQ_MONTHS[d.frequency]; return s + (k ? (+d.paymentAmount || 0) * 12 / k : 0); }, 0);
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
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Expected a year'), h('div', { class: 'v' }, U.fmtMoneyShort(yearly)), h('div', { class: 's' }, 'interest')),
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

  var searchState = { q: '', status: 'All', frequency: '', memberId: '', village: '', bank: '', sort: 'member' };

  S.search = function (route) {
    var app = A(), data = D(), today = T();
    var maturedOnly = route.query.maturedOnly === '1';
    var results = h('div');
    var q = UI.input({ type: 'search', value: searchState.q, placeholder: 'Name, village, bank, last digits of account…', 'aria-label': 'Search', enterkeyhint: 'search' });
    var clearBtn = h('button', { class: 'icon-btn clear', 'aria-label': 'Clear', onclick: function () { q.value = ''; searchState.q = ''; draw(); q.focus(); } }, UI.icon('x', 'sm'));
    q.addEventListener('input', U.debounce(function () { searchState.q = q.value; draw(); }, 150));

    function sel(key, options, label) {
      var s = UI.select(options, searchState[key], { 'aria-label': label });
      s.addEventListener('change', function () { searchState[key] = s.value; draw(); });
      return s;
    }
    var filters = h('div', { class: 'filters' },
      sel('status', [{ value: 'All', label: 'Active & closed' }, { value: 'Active', label: 'Active only' }, { value: 'Closed', label: 'Closed only' }], 'Status'),
      sel('frequency', [{ value: '', label: 'Any frequency' }].concat(M.FREQS), 'Frequency'),
      sel('memberId', [{ value: '', label: 'All members' }].concat(data.members.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (m) { return { value: m.id, label: m.name }; })), 'Member'),
      sel('village', [{ value: '', label: 'All villages' }].concat(M.villages(data)), 'Village'),
      sel('bank', [{ value: '', label: 'All banks' }].concat(M.banks(data)), 'Bank'),
      sel('sort', [{ value: 'member', label: 'Sort: member' }, { value: 'amount', label: 'Sort: amount' }, { value: 'maturity', label: 'Sort: maturity' }, { value: 'bank', label: 'Sort: bank' }, { value: 'newest', label: 'Sort: newest' }], 'Sort'));

    function draw() {
      U.clear(results);
      var list = M.searchDeposits(data, searchState);
      if (maturedOnly) list = list.filter(function (d) { return d.status === 'Active' && d.maturityDate && d.maturityDate < today; });
      var qq = U.str(searchState.q).toLowerCase();
      if (qq && !maturedOnly) {
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
      var total = list.reduce(function (s, d) { return s + (+d.depositAmount || 0); }, 0);
      results.appendChild(sectionTitle(maturedOnly ? 'Matured, still active' : 'Deposits', h('span', { style: 'text-transform:none;letter-spacing:0' }, list.length + ' · ' + money(total))));
      if (list.length) results.appendChild(chunkedList(list, function (d) { return depositItem(d); }, 60));
      else results.appendChild(h('div', { class: 'card muted' }, 'No deposits match.'));
    }
    draw();
    var body = [h('div', { class: 'search-box' }, UI.icon('search'), q, clearBtn), maturedOnly ? null : filters,
      maturedOnly ? null : h('div', { style: 'margin:-4px 0 6px;text-align:right' }, linkBtn('Reset filters', function () {
        searchState = { q: '', status: 'All', frequency: '', memberId: '', village: '', bank: '', sort: 'member' };
        app.render();
      })), results];
    return { title: maturedOnly ? 'Matured deposits' : 'Search & filters', body: body, after: function () { if (!searchState.q) q.focus(); } };
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
      P.notify.mode === 'phone' ? 'Phone notifications, even when the app is closed.' : 'Shown when the app is open in this browser. The Android app notifies even when closed.',
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
      rem.appendChild(h('div', { class: 'strong mt-12' }, 'Before each payment'));
      rem.appendChild(dayChips('paymentDays', [7, 3, 1, 0], lbl));
      rem.appendChild(h('div', { class: 'strong' }, 'Before a deposit matures'));
      rem.appendChild(dayChips('maturityDays', [30, 7, 1, 0], lbl));
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
    sec.appendChild(h('div', { class: 'small muted mt-12' }, 'Account numbers are always shown as XXXX1234. Tap Show on a deposit to see the full number' + (L.enabled ? ' (asks for your PIN).' : '.')));
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
        h('div', { class: 'k' }, 'Payment rows'), h('div', { class: 'v' }, String(data.payments.length))),
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
