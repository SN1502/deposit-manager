/* Deposit Manager — UI toolkit: icons, dialogs, sheets, toasts, form fields, keypad. */
(function (DM) {
  'use strict';
  var U = DM.util, h = U.h;

  /* ------------------------------------------------------------ icons (24×24, stroked) */

  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
    bank: '<path d="M3 9.5 12 4l9 5.5"/><path d="M4 21h16"/><path d="M5 10v8M9.7 10v8M14.3 10v8M19 10v8"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><path d="M16 4.8a3.3 3.3 0 0 1 0 6.4M18.2 14.8c1.8.8 2.9 2.6 3.3 5.2"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    right: '<path d="m9 5 7 7-7 7"/>',
    back: '<path d="M19 12H5M11 5l-7 7 7 7"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.7 3.5M6.5 7.2C4 8.9 2.5 12 2.5 12S6 18.5 12 18.5c1.8 0 3.3-.5 4.6-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8.5 12.5l4 5M12.5 12.5l-4 5"/>',
    share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>',
    bell: '<path d="M6 9.5a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15.5 6 9.5"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    rupee: '<path d="M7 5h10M7 9.5h10M7 5h3.5a4.5 4.5 0 0 1 0 9H7l7.5 6"/>',
    phone: '<path d="M5 3.5h3.5l1.5 4-2 1.5a11 11 0 0 0 7 7l1.5-2 4 1.5V19a1.5 1.5 0 0 1-1.5 1.5A16.5 16.5 0 0 1 3.5 5 1.5 1.5 0 0 1 5 3.5z"/>',
    download: '<path d="M12 3.5v12M7 11l5 5 5-5M4.5 20.5h15"/>',
    upload: '<path d="M12 16.5v-12M7 9l5-5 5 5M4.5 20.5h15"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.3l1.7-1.8M20 20v-4.5h-4.5"/>',
    finger: '<path d="M7.5 5.3A8 8 0 0 1 20 12v1.5M4 12a8 8 0 0 1 1.6-4.8M12 8a4 4 0 0 1 4 4v2a10 10 0 0 1-1.2 4.8M8 12a4 4 0 0 1 .6-2.1M8 12v2a14 14 0 0 1-1.4 6M12 12v2.5a17 17 0 0 1-2.1 7M20 17a15 15 0 0 1-1.2 3.8M4 15.5V16"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.01"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5"/><path d="M3.5 4v4.5H8M12 7.5V12l3 2"/>',
    close: '<path d="M4 7h16M6 7v13h12V7M9 7V4h6v3M9.5 12h5"/>',
    reopen: '<path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.7"/><path d="M4 4v4.7h4.7"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5"/>',
    backspace: '<path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="m12 9 6 6M18 9l-6 6"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    wallet: '<path d="M4 7.5V18a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3M4 7.5A2 2 0 0 1 6 5.5h11v2"/><path d="M4 7.5h15a1 1 0 0 1 1 1V12"/><path d="M15.5 12H21v4h-5.5a2 2 0 0 1 0-4z"/>',
    trend: '<path d="M3.5 17 9 11.5l4 4 7.5-7.5"/><path d="M15 8h5.5v5.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'
  };

  function icon(name, cls) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name] || '';
    return s;
  }

  var LOGO_SVG = '<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<rect width="96" height="96" rx="24" fill="#0F5C5A"/>' +
    '<path d="M20 38 48 22l28 16" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M26 42v26M38 42v26M58 42v26M70 42v26" stroke="#fff" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M20 74h56" stroke="#fff" stroke-width="5" stroke-linecap="round"/>' +
    '<circle cx="48" cy="55" r="12" fill="#F2B84B"/>' +
    '<path d="M43 49.5h10M43 53h10M43 49.5h3a3.8 3.8 0 0 1 0 7.5h-3l6.5 5" fill="none" stroke="#0F5C5A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  function logo(cls) {
    var d = h('div', { class: cls || 'logo', html: LOGO_SVG });
    return d;
  }

  /* ------------------------------------------------------------ overlay stack */

  var stack = []; // {el, close}

  function pushOverlay(el, onClose) {
    var entry = { el: el };
    entry.close = function (v) {
      var i = stack.indexOf(entry);
      if (i < 0) return;
      stack.splice(i, 1);
      el.remove();
      if (onClose) onClose(v);
    };
    stack.push(entry);
    document.body.appendChild(el);
    return entry;
  }

  /** Close the top overlay (Android back button). Returns true if one was open. */
  function closeTop() {
    if (!stack.length) return false;
    var top = stack[stack.length - 1];
    if (top.el.dataset.modal === 'hard') return true;
    top.close(undefined);
    return true;
  }

  function closeAll() {
    while (stack.length) stack[stack.length - 1].close(undefined);
  }

  function hasOverlay() { return stack.length > 0; }

  /** Bottom sheet. build(close) returns the content. Resolves with the value passed to close(). */
  function sheet(build, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var body = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'grab' }));
      var ov = h('div', { class: 'overlay' }, body);
      var entry = pushOverlay(ov, resolve);
      ov.addEventListener('click', function (e) { if (e.target === ov && !opts.sticky) entry.close(undefined); });
      U.append(body, build(entry.close));
      var f = body.querySelector('[autofocus]');
      if (f) setTimeout(function () { f.focus(); }, 60);
    });
  }

  /** Centered dialog. buttons: [{text, value, kind}] */
  function dialog(o) {
    return new Promise(function (resolve) {
      var box = h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true' },
        o.title ? h('h3', null, o.title) : null,
        o.message ? (o.message.nodeType ? o.message : h('p', null, o.message)) : null);
      var ov = h('div', { class: 'overlay center' }, box);
      var entry = pushOverlay(ov, resolve);
      if (o.hard) ov.dataset.modal = 'hard';
      var row = h('div', { class: 'btn-row' });
      (o.buttons || [{ text: 'OK', value: true, kind: 'primary' }]).forEach(function (b) {
        row.appendChild(h('button', { class: 'btn ' + (b.kind || 'outline'), onclick: function () { entry.close(b.value); } }, b.text));
      });
      box.appendChild(row);
      ov.addEventListener('click', function (e) { if (e.target === ov && !o.hard) entry.close(undefined); });
    });
  }

  function confirm(title, message, okText, danger) {
    return dialog({
      title: title, message: message,
      buttons: [{ text: 'Cancel', value: false, kind: 'outline' }, { text: okText || 'OK', value: true, kind: danger ? 'danger-solid' : 'primary' }]
    }).then(function (v) { return v === true; });
  }

  function alertBox(title, message) {
    return dialog({ title: title, message: message, buttons: [{ text: 'OK', value: true, kind: 'primary' }] });
  }

  /* ------------------------------------------------------------ toast */

  var toastTimer = null;
  function toast(msg, opts) {
    opts = opts || {};
    var wrap = document.getElementById('toast');
    if (!wrap) return;
    U.clear(wrap);
    clearTimeout(toastTimer);
    var t = h('div', { class: 'toast', role: 'status' }, h('div', { class: 'grow' }, msg));
    if (opts.action) {
      t.appendChild(h('button', { onclick: function () { U.clear(wrap); opts.onAction(); } }, opts.action));
    }
    wrap.appendChild(t);
    toastTimer = setTimeout(function () { U.clear(wrap); }, opts.ms || (opts.action ? 6000 : 3200));
  }

  /* ------------------------------------------------------------ form pieces */

  function field(label, control, o) {
    o = o || {};
    var id = control.id || ('f' + Math.random().toString(36).slice(2, 8));
    control.id = id;
    var f = h('div', { class: 'field' + (o.error ? ' err' : ''), dataset: o.name ? { name: o.name } : undefined },
      h('label', { for: id }, label, o.optional ? h('span', { class: 'opt' }, ' (optional)') : null),
      o.wrap ? o.wrap : control,
      o.extra || null,
      o.hint ? h('div', { class: 'hint' }, o.hint) : null,
      h('div', { class: 'error', style: o.error ? null : 'display:none' }, o.error || ''));
    return f;
  }

  function setFieldError(root, name, msg) {
    var f = root.querySelector('.field[data-name="' + name + '"]');
    if (!f) return;
    var e = f.querySelector('.error');
    f.classList.toggle('err', !!msg);
    e.textContent = msg || '';
    e.style.display = msg ? '' : 'none';
  }

  function input(attrs) {
    return h('input', Object.assign({ class: 'input', autocomplete: 'off' }, attrs || {}));
  }

  function moneyInput(attrs) {
    var i = input(Object.assign({ inputmode: 'decimal', type: 'text' }, attrs));
    return { input: i, wrap: h('div', { class: 'input-wrap has-prefix' }, h('span', { class: 'prefix' }, '₹'), i) };
  }

  function select(options, value, attrs) {
    var s = h('select', Object.assign({ class: 'input' }, attrs || {}));
    options.forEach(function (o) {
      var opt = typeof o === 'string' ? { value: o, label: o } : o;
      s.appendChild(h('option', { value: opt.value, selected: String(opt.value) === String(value) }, opt.label));
    });
    return s;
  }

  function seg(options, value, onChange) {
    var el = h('div', { class: 'seg', role: 'tablist' });
    options.forEach(function (o) {
      el.appendChild(h('button', {
        class: o.value === value ? 'on' : '', role: 'tab', 'aria-selected': o.value === value ? 'true' : 'false',
        onclick: function () { if (o.value !== value) onChange(o.value); }
      }, o.label, o.count !== undefined ? h('span', { class: 'count' }, '(' + o.count + ')') : null));
    });
    return el;
  }

  function chipRow(options, value, onChange) {
    var el = h('div', { class: 'chips' });
    options.forEach(function (o) {
      el.appendChild(h('button', { class: 'fchip' + (o.value === value ? ' on' : ''), onclick: function () { onChange(o.value); } }, o.label));
    });
    return el;
  }

  function switchRow(label, desc, checked, onChange, disabled) {
    var cb = h('input', { type: 'checkbox', checked: checked, disabled: disabled, 'aria-label': label });
    cb.addEventListener('change', function () { onChange(cb.checked, cb); });
    return h('label', { class: 'switch-row' },
      h('div', { class: 'sl' }, h('div', { class: 'strong' }, label), desc ? h('div', { class: 'sd' }, desc) : null),
      h('span', { class: 'switch' }, cb, h('span', { class: 'track' })));
  }

  function statusChip(status) {
    var cls = { Pending: 'pending', Received: 'received', Overdue: 'overdue', Active: 'active', Closed: 'closed' }[status] || '';
    return h('span', { class: 'chip ' + cls }, status);
  }

  function dateBox(iso, cls) {
    var p = U.parseISO(iso);
    return h('div', { class: 'datebox' + (cls ? ' ' + cls : '') },
      h('span', { class: 'd' }, p ? p.d : '–'), h('span', { class: 'm' }, p ? U.MONTHS[p.m - 1] + ' ' + String(p.y).slice(2) : ''));
  }

  function empty(iconName, title, text, action) {
    return h('div', { class: 'empty' },
      h('div', { class: 'ei' }, icon(iconName, 'lg')),
      h('div', { class: 'et' }, title),
      text ? h('div', null, text) : null,
      action || null);
  }

  function banner(kind, iconName, title, text, action) {
    return h('div', { class: 'banner ' + (kind || '') },
      h('span', { class: 'bi' }, icon(iconName)),
      h('div', { class: 'grow' }, h('div', { class: 'bt' }, title), text ? h('div', { class: 'bd' }, text) : null, action || null));
  }

  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '?').charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
  }

  /* ------------------------------------------------------------ PIN keypad */

  /**
   * Renders dots + keypad. onDone(pin) fires when `length` digits are entered (or on OK when
   * length is null, for choosing a new 4–6 digit PIN). Returns {el, reset(msg), shake()}.
   */
  function pinPad(o) {
    var pin = '', max = o.length || 6;
    var dots = h('div', { class: 'dots', 'aria-live': 'polite' });
    var msg = h('div', { class: 'ls' }, o.message || '');
    function drawDots() {
      U.clear(dots);
      var n = o.length || Math.max(4, pin.length);
      for (var i = 0; i < n; i++) dots.appendChild(h('span', { class: i < pin.length ? 'on' : '' }));
    }
    function press(k) {
      if (o.isBlocked && o.isBlocked()) return;
      if (k === 'del') pin = pin.slice(0, -1);
      else if (k === 'ok') { if (pin.length >= 4) o.onDone(pin); return; }
      else if (pin.length < max) pin += k;
      drawDots();
      if (o.length && pin.length === o.length) setTimeout(function () { o.onDone(pin); }, 90);
    }
    var pad = h('div', { class: 'keypad' });
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'].forEach(function (k) {
      pad.appendChild(h('button', { onclick: function () { press(k); }, 'aria-label': k }, k));
    });
    if (o.extraKey) pad.appendChild(o.extraKey);
    else if (!o.length) pad.appendChild(h('button', { class: 'ghost', onclick: function () { press('ok'); }, 'aria-label': 'OK', style: 'font-size:18px;font-weight:700' }, 'OK'));
    else pad.appendChild(h('span'));
    pad.appendChild(h('button', { onclick: function () { press('0'); }, 'aria-label': '0' }, '0'));
    pad.appendChild(h('button', { class: 'ghost', onclick: function () { press('del'); }, 'aria-label': 'Delete' }, icon('backspace', 'lg')));
    drawDots();
    function onKey(e) {
      if (!document.body.contains(pad)) { document.removeEventListener('keydown', onKey); return; }
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter' && !o.length) press('ok');
    }
    document.addEventListener('keydown', onKey);
    return {
      el: h('div', { style: 'display:flex;flex-direction:column;align-items:center' }, msg, dots, pad),
      reset: function (m) { pin = ''; drawDots(); msg.textContent = m || ''; },
      shake: function () { dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); },
      setMessage: function (m) { msg.textContent = m; },
      destroy: function () { document.removeEventListener('keydown', onKey); }
    };
  }

  DM.ui = {
    icon: icon, logo: logo, LOGO_SVG: LOGO_SVG, sheet: sheet, dialog: dialog, confirm: confirm, alert: alertBox, toast: toast,
    closeTop: closeTop, closeAll: closeAll, hasOverlay: hasOverlay,
    field: field, setFieldError: setFieldError, input: input, moneyInput: moneyInput, select: select, seg: seg, chipRow: chipRow,
    switchRow: switchRow, statusChip: statusChip, dateBox: dateBox, empty: empty, banner: banner, initials: initials, pinPad: pinPad
  };
})(window.DM = window.DM || {});
