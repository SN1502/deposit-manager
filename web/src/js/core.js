/* Deposit Manager — core utilities: dates, numbers, formatting, DOM helpers. */
(function (DM) {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december'];

  /* ------------------------------------------------------------------ dates
   * Dates are stored everywhere as plain 'YYYY-MM-DD' strings. No time zones,
   * no Date objects in the data — that keeps due dates stable on every phone. */

  function pad(n, w) {
    var s = String(n);
    while (s.length < (w || 2)) s = '0' + s;
    return s;
  }

  function iso(y, m, d) {
    return pad(y, 4) + '-' + pad(m) + '-' + pad(d);
  }

  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  function parseISO(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return { y: y, m: mo, d: d };
  }

  function isValidISO(s) {
    return parseISO(s) !== null;
  }

  function todayISO() {
    var n = new Date();
    return iso(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }

  function toUTC(s) {
    var p = parseISO(s);
    return p ? Date.UTC(p.y, p.m - 1, p.d) : NaN;
  }

  function fromUTC(ms) {
    var d = new Date(ms);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  function addDays(s, n) {
    return fromUTC(toUTC(s) + n * 86400000);
  }

  /** Whole days from a to b (b - a). */
  function diffDays(a, b) {
    return Math.round((toUTC(b) - toUTC(a)) / 86400000);
  }

  /**
   * Add months keeping the day-of-month anchored. 31 Jan + 1 month = 28/29 Feb,
   * and + 2 months = 31 Mar again (never drifts), because each date is computed
   * from the original anchor date rather than from the previous result.
   */
  function addMonths(s, n, anchorDay) {
    var p = parseISO(s);
    if (!p) return '';
    var total = (p.y * 12 + (p.m - 1)) + n;
    var y = Math.floor(total / 12), m = total - y * 12 + 1;
    var day = Math.min(anchorDay || p.d, daysInMonth(y, m));
    return iso(y, m, day);
  }

  function fmtDate(s) {
    var p = parseISO(s);
    if (!p) return '—';
    return p.d + ' ' + MONTHS[p.m - 1] + ' ' + p.y;
  }

  function fmtDateShort(s) {
    var p = parseISO(s);
    if (!p) return '—';
    return p.d + ' ' + MONTHS[p.m - 1];
  }

  function fmtMonthYear(s) {
    var p = parseISO(s);
    if (!p) return '—';
    return MONTHS_LONG[p.m - 1].charAt(0).toUpperCase() + MONTHS_LONG[p.m - 1].slice(1) + ' ' + p.y;
  }

  function weekday(s) {
    var t = toUTC(s);
    if (isNaN(t)) return '';
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(t).getUTCDay()];
  }

  /** "in 3 days", "today", "2 days ago" relative to `today`. */
  function relDays(s, today) {
    var n = diffDays(today || todayISO(), s);
    if (isNaN(n)) return '';
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    if (n > 0) return 'in ' + n + ' days';
    return (-n) + ' days ago';
  }

  /** Friendly distance for far dates: "in 5 months", "in 4 years 3 months", "2 years ago". */
  function relLong(s, today) {
    today = today || todayISO();
    var n = diffDays(today, s);
    if (isNaN(n)) return '';
    if (Math.abs(n) <= 60) return relDays(s, today);
    var a = parseISO(n > 0 ? today : s), b = parseISO(n > 0 ? s : today);
    var months = (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
    var y = Math.floor(months / 12), m = months % 12, parts = [];
    if (y) parts.push(y + (y === 1 ? ' year' : ' years'));
    if (m) parts.push(m + (m === 1 ? ' month' : ' months'));
    var txt = parts.join(' ') || 'less than a month';
    return n > 0 ? 'in ' + txt : txt + ' ago';
  }

  function twoDigitYear(y) {
    if (y >= 100) return y;
    return y < 70 ? 2000 + y : 1900 + y;
  }

  function monthFromName(name) {
    var k = String(name).toLowerCase().replace(/\.$/, '');
    for (var i = 0; i < 12; i++) {
      if (MONTHS_LONG[i] === k || MONTHS_LONG[i].slice(0, 3) === k || (k === 'sept' && i === 8)) return i + 1;
    }
    return 0;
  }

  function checked(y, m, d) {
    if (!(y >= 1900 && y <= 2200) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= daysInMonth(y, m))) return null;
    return iso(y, m, d);
  }

  /**
   * Parse the date formats people actually type into Excel in India.
   * Numeric day/month order is assumed to be DD/MM/YYYY (Indian convention);
   * YYYY-MM-DD is always year-first. Returns 'YYYY-MM-DD' or null.
   */
  function parseFlexibleDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
    var s = String(v).trim().replace(/\s+/g, ' ');
    if (!s) return null;
    var m;
    // 2026-09-20 or 2026/09/20 (optionally followed by a time)
    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s))) return checked(+m[1], +m[2], +m[3]);
    // 20-09-2026, 20/09/26, 20.09.2026
    if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?: .*)?$/.exec(s))) {
      var a = +m[1], b = +m[2], y = twoDigitYear(+m[3]);
      if (b > 12 && a <= 12) return checked(y, a, b); // clearly MM/DD
      return checked(y, b, a);
    }
    // 20-Sep-2026, 20 Sep 2026, 20 September, 2026
    if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[-/ .,]*([A-Za-z]{3,9})\.?[-/ .,]*(\d{2}|\d{4})$/.exec(s))) {
      var mo = monthFromName(m[2]);
      return mo ? checked(twoDigitYear(+m[3]), mo, +m[1]) : null;
    }
    // Sep 20, 2026
    if ((m = /^([A-Za-z]{3,9})\.?[ -](\d{1,2})(?:st|nd|rd|th)?,?[ -](\d{2}|\d{4})$/.exec(s))) {
      var mo2 = monthFromName(m[1]);
      return mo2 ? checked(twoDigitYear(+m[3]), mo2, +m[2]) : null;
    }
    return null;
  }

  /* ---------------------------------------------------------------- numbers */

  function round2(n) {
    return Math.round((+n + Number.EPSILON) * 100) / 100;
  }

  /** Parse "1,00,000", "₹ 5,250.50", "7.5%", "Rs. 500". Returns NaN when not a number. */
  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v === null || v === undefined) return NaN;
    var s = String(v).trim();
    if (!s) return NaN;
    s = s.replace(/₹|rs\.?|inr|%|,|\s/gi, '');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    return parseFloat(s);
  }

  var inrWhole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  var inrFrac = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function fmtMoney(n) {
    n = +n;
    if (!isFinite(n)) return '—';
    var neg = n < 0;
    n = Math.abs(round2(n));
    var s = (n % 1 === 0) ? inrWhole.format(n) : inrFrac.format(n);
    return (neg ? '−₹' : '₹') + s;
  }

  /** Compact Indian units for small stat tiles: ₹12.5 L, ₹1.2 Cr. */
  function fmtMoneyShort(n) {
    n = +n || 0;
    var a = Math.abs(n);
    if (a >= 1e7) return '₹' + trimZero((n / 1e7).toFixed(2)) + ' Cr';
    if (a >= 1e5) return '₹' + trimZero((n / 1e5).toFixed(2)) + ' L';
    return fmtMoney(n);
  }

  function trimZero(s) {
    return s.replace(/\.?0+$/, '');
  }

  function fmtRate(r) {
    r = +r;
    if (!isFinite(r) || r === 0) return '—';
    return trimZero(round2(r).toFixed(2)) + '%';
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  /* ---------------------------------------------------------------- privacy */

  function maskAccount(acc) {
    var s = String(acc || '').replace(/\s+/g, '');
    if (!s) return '—';
    var last = s.slice(-4);
    return 'XXXX' + (s.length > 4 ? last : '');
  }

  /* ------------------------------------------------------------------ misc */

  function normKey(s) {
    return String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /** Next human-readable ID: nextId('D', ['D001','D007']) -> 'D008'. */
  function nextId(prefix, ids, width) {
    var max = 0, re = new RegExp('^' + prefix + '(\\d+)$', 'i');
    for (var i = 0; i < ids.length; i++) {
      var m = re.exec(String(ids[i] || '').trim());
      if (m && +m[1] > max) max = +m[1];
    }
    return prefix + pad(max + 1, width || 3);
  }

  function debounce(fn, ms) {
    var t = null;
    function wrapped() {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, ms);
    }
    wrapped.flush = function () {
      if (t) { clearTimeout(t); t = null; fn(); }
    };
    wrapped.pending = function () { return t !== null; };
    return wrapped;
  }

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function str(v) {
    return v === null || v === undefined ? '' : String(v).trim();
  }

  /** Small, fast content fingerprint (FNV-1a) for detecting outside edits to the Excel file. */
  function fingerprint(bytes) {
    var h = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return bytes.length + ':' + h.toString(16);
  }

  function bytesToBase64(bytes) {
    var chunk = 0x8000, parts = [];
    for (var i = 0; i < bytes.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
    }
    return btoa(parts.join(''));
  }

  function base64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ------------------------------------------------------------------- DOM */

  /**
   * h('div', {class: 'x', onclick: fn}, 'text', child, [more])
   * Attributes: class, style (string|object), on<event>, dataset, html, value, checked,
   * disabled, and any other attribute. null/false/undefined children are skipped.
   */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') {
          for (var sk in v) el.style[sk] = v[sk];
        } else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          el.addEventListener(k.slice(2), v);
        } else if (k === 'dataset') {
          for (var dk in v) el.dataset[dk] = v[dk];
        } else if (k === 'html') el.innerHTML = v;
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'required' || k === 'multiple') {
          el[k] = !!v;
          if (v) el.setAttribute(k, '');
        } else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(el, c) {
    if (c === null || c === undefined || c === false || c === true) return;
    if (Array.isArray(c)) { for (var i = 0; i < c.length; i++) append(el, c[i]); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  DM.util = {
    MONTHS: MONTHS,
    pad: pad, iso: iso, parseISO: parseISO, isValidISO: isValidISO, todayISO: todayISO,
    addDays: addDays, addMonths: addMonths, diffDays: diffDays, daysInMonth: daysInMonth,
    fmtDate: fmtDate, fmtDateShort: fmtDateShort, fmtMonthYear: fmtMonthYear, weekday: weekday,
    relDays: relDays, relLong: relLong, parseFlexibleDate: parseFlexibleDate,
    round2: round2, toNumber: toNumber, fmtMoney: fmtMoney, fmtMoneyShort: fmtMoneyShort,
    fmtRate: fmtRate, plural: plural, maskAccount: maskAccount, normKey: normKey, nextId: nextId,
    debounce: debounce, clone: clone, str: str, fingerprint: fingerprint,
    bytesToBase64: bytesToBase64, base64ToBytes: base64ToBytes,
    h: h, append: append, clear: clear
  };
})(window.DM = window.DM || {});
