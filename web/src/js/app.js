/* Deposit Manager — app controller: state, persistence, Excel autosave, navigation, lock. */
(function (DM) {
  'use strict';
  var U = DM.util, M = DM.model, X = DM.xlsx, P = DM.platform, UI = DM.ui, h = U.h;

  var VERSION = '1.0.0';

  var DEFAULT_PREFS = {
    version: 1,
    onboarded: false,
    theme: 'system',
    lock: { enabled: false, algo: '', hash: '', salt: '', length: 4, biometric: false, after: 60, failures: 0, blockedUntil: 0 },
    secureScreen: false,
    notify: U.clone(M.DEFAULT_PREFS.notify),
    excel: { lastSavedAt: 0, lastHash: '', exportedRev: 0, lastImport: null },
    webNotified: '',
    notifyAsked: false
  };

  var App = {
    VERSION: VERSION,
    data: M.emptyData(),
    prefs: U.clone(DEFAULT_PREFS),
    today: U.todayISO(),
    rev: 0,
    save: { state: 'idle', error: '' }
  };

  /* ------------------------------------------------------------ persistence */

  function mergePrefs(p) {
    var out = U.clone(DEFAULT_PREFS);
    if (!p || typeof p !== 'object') return out;
    for (var k in p) {
      if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) && p[k] && typeof p[k] === 'object') {
        for (var j in p[k]) out[k][j] = p[k][j];
      } else if (k in out) out[k] = p[k];
    }
    return out;
  }

  function loadAll() {
    var stored = P.load('data');
    App.prefs = mergePrefs(P.load('prefs'));
    if (stored && stored.data) {
      App.data = M.normalizeData(stored.data);
      App.rev = +stored.rev || 0;
    } else {
      App.data = M.emptyData();
      App.rev = 0;
    }
  }

  function persistData() {
    try {
      P.save('data', { app: 'deposit-manager', rev: App.rev, savedAt: Date.now(), data: App.data });
    } catch (e) {
      UI.alert('Could not save', String(e.message || e));
    }
  }

  App.savePrefs = function () {
    try { P.save('prefs', App.prefs); } catch (e) { /* prefs are best effort */ }
  };

  /** Every data change goes through here. */
  App.commit = function (opts) {
    opts = opts || {};
    App.today = U.todayISO();
    M.refreshStatuses(App.data, App.today);
    M.invalidate(App.data);
    App.rev++;
    persistData();
    queueExcelWrite();
    queueReminders();
    if (opts.render !== false) App.render();
  };

  /* ------------------------------------------------------------ Excel autosave */

  function buildWorkbook() {
    return X.write(M.workbookSheets(App.data, App.prefs, App.today), { title: 'Deposit Manager' });
  }
  App.buildWorkbook = buildWorkbook;

  App.linkedFile = function () { return P.excel.canLink ? P.excel.info() : null; };

  var writing = false, writeAgain = false;
  var queueExcelWrite = U.debounce(function () { writeExcelNow(); }, 700);

  function writeExcelNow() {
    if (!App.linkedFile()) { App.renderStatus(); return Promise.resolve(false); }
    if (writing) { writeAgain = true; return Promise.resolve(false); }
    writing = true;
    setSave('saving');
    return buildWorkbook().then(function (bytes) {
      return P.excel.write(bytes).then(function (r) {
        if (r && r.ok) {
          App.prefs.excel.lastHash = U.fingerprint(bytes);
          App.prefs.excel.lastSavedAt = Date.now();
          App.savePrefs();
          setSave('saved');
          return true;
        }
        if (r && r.needsPermission) setSave('permission');
        else setSave('error', (r && r.error) || 'The file could not be written');
        return false;
      });
    }).catch(function (e) {
      setSave('error', String(e && e.message || e));
      return false;
    }).then(function (ok) {
      writing = false;
      if (writeAgain) { writeAgain = false; return writeExcelNow(); }
      return ok;
    });
  }
  App.writeExcelNow = writeExcelNow;

  function setSave(state, err) {
    App.save.state = state;
    App.save.error = err || '';
    App.renderStatus();
  }

  /** What the save indicator should say. kind: ok | warn | err | busy */
  App.saveStatus = function () {
    var f = App.linkedFile(), s = App.save.state;
    if (P.excel.canLink) {
      if (!f) return { kind: 'warn', label: 'Not saved to Excel', detail: 'Choose an Excel file so every change is saved into it.' };
      if (s === 'saving') return { kind: 'busy', label: 'Saving…', detail: 'Saving to ' + f.name };
      if (s === 'error') return { kind: 'err', label: 'Excel not saved', detail: App.save.error || 'Could not write ' + f.name };
      if (s === 'permission') return { kind: 'warn', label: 'Reconnect Excel', detail: 'The browser needs permission again to save into ' + f.name + '.' };
      var at = App.prefs.excel.lastSavedAt;
      return { kind: 'ok', label: 'Saved', detail: 'Saved to ' + f.name + (at ? ' at ' + timeText(at) : '') };
    }
    if (App.rev > (App.prefs.excel.exportedRev || 0) && (App.data.members.length || App.data.deposits.length)) {
      return { kind: 'warn', label: 'Not exported', detail: 'Changes are kept in this browser. Export to Excel to keep a file copy.' };
    }
    return { kind: 'ok', label: 'Up to date', detail: 'Everything is exported to Excel.' };
  };

  function timeText(ms) {
    var d = new Date(ms), now = new Date();
    var t = U.pad(d.getHours() % 12 || 12) + ':' + U.pad(d.getMinutes()) + (d.getHours() < 12 ? ' AM' : ' PM');
    if (d.toDateString() === now.toDateString()) return t.replace(/^0/, '');
    return U.fmtDate(U.iso(d.getFullYear(), d.getMonth() + 1, d.getDate())) + ', ' + t.replace(/^0/, '');
  }
  App.timeText = timeText;

  /** Detect edits made to the linked Excel file by another app (e.g. Excel/Sheets on the phone). */
  var checkingExternal = false;
  App.checkExternalChanges = function () {
    if (checkingExternal || !App.linkedFile() || UI.hasOverlay() || isLocked()) return Promise.resolve();
    // our own save is still on its way — comparing now would mistake it for an outside edit
    if (writing || queueExcelWrite.pending()) return Promise.resolve();
    checkingExternal = true;
    return P.excel.read().then(function (bytes) {
      if (!bytes) return;
      var fp = U.fingerprint(bytes);
      if (!App.prefs.excel.lastHash) { App.prefs.excel.lastHash = fp; App.savePrefs(); return; }
      if (fp === App.prefs.excel.lastHash) return;
      var name = (App.linkedFile() || {}).name || 'your Excel file';
      return UI.dialog({
        title: 'Excel file was changed',
        message: name + ' was edited outside the app. Do you want to load those changes into the app?',
        hard: true,
        buttons: [
          { text: 'Keep app data', value: 'keep', kind: 'outline' },
          { text: 'Load changes', value: 'load', kind: 'primary' }
        ]
      }).then(function (v) {
        if (v === 'load') return App.importOpened({ name: name, bytes: bytes }, { source: 'linked' });
        App.prefs.excel.lastHash = '';
        return writeExcelNow();
      });
    }).catch(function () { /* unreadable: status will show on next write */ }).then(function () { checkingExternal = false; });
  };

  /* ------------------------------------------------------------ import / export flows */

  function hasData() { return App.data.members.length > 0 || App.data.deposits.length > 0; }
  App.hasData = hasData;

  function backup(reason) {
    if (!hasData()) return;
    try { P.save('backup', { at: Date.now(), reason: reason, data: App.data }); } catch (e) { /* ignore */ }
  }

  App.backupInfo = function () {
    var b = P.load('backup');
    return b && b.data ? { at: b.at, reason: b.reason, members: (b.data.members || []).length, deposits: (b.data.deposits || []).length } : null;
  };

  App.restoreBackup = function () {
    var b = P.load('backup');
    if (!b || !b.data) return Promise.resolve(false);
    return UI.confirm('Restore previous data?',
      'This puts back the data saved ' + timeText(b.at) + ' (' + (b.reason || 'backup') + '). The current data is kept as the new backup, so you can switch back.',
      'Restore').then(function (ok) {
      if (!ok) return false;
      var current = App.data;
      App.data = M.normalizeData(b.data);
      try { P.save('backup', { at: Date.now(), reason: 'Before restoring', data: current }); } catch (e) { /* ignore */ }
      M.rollForward(App.data, App.today);
      App.commit();
      UI.toast('Previous data restored');
      return true;
    });
  };

  /** Ask for a file, then run the import preview. */
  App.importFromPicker = function () {
    return P.excel.open().then(function (opened) {
      if (!opened) return false;
      return App.importOpened(opened, { source: 'open' });
    }).catch(function (e) {
      UI.alert('Could not open the file', String(e && e.message || e));
      return false;
    });
  };

  /** opened = {name, bytes, uri?/handle?}; source: 'open' (user picked) | 'linked' (already linked file changed) */
  App.importOpened = function (opened, o) {
    o = o || {};
    return X.read(opened.bytes).then(function (book) {
      var prep = M.prepareImport(book, App.today);
      if (!prep.counts || (!prep.counts.members && !prep.counts.deposits)) {
        var msg = (prep.errors.length ? prep.errors.join(' ') : 'No family members or deposits were found in this file.') +
          (prep.warnings.length ? ' ' + prep.warnings.slice(0, 3).join(' ') : '');
        return UI.alert('Nothing to import', msg).then(function () { return false; });
      }
      // Sheets the app did not read would be lost when it saves into this file.
      prep.otherSheets = book.sheets.filter(function (s) {
        return (prep.usedSheets || []).indexOf(s.name) < 0 && s.rows.some(function (r) { return r && r.length; });
      }).map(function (s) { return s.name; });
      return DM.screens.importPreview(prep, opened, o).then(function (choice) {
        if (!choice) return false;
        backup('before importing ' + (opened.name || 'a file'));
        var fin = M.finalizeImport(prep, choice.pastAs, App.today);
        App.data = fin.data;
        App.prefs.onboarded = true;
        App.prefs.excel.lastImport = { name: opened.name || '', at: Date.now() };
        var linking = Promise.resolve(null);
        if (o.source === 'linked') linking = Promise.resolve(true);
        else if (P.excel.canLink && choice.link) linking = P.excel.adopt(opened);
        return linking.then(function (linked) {
          App.prefs.excel.lastHash = '';
          App.savePrefs();
          App.commit({ render: false });
          App.nav.tab('home');
          var summary = U.plural(App.data.members.length, 'family member') + ' and ' + U.plural(App.data.deposits.length, 'deposit') + ' loaded';
          if (linked === false && P.excel.canLink && choice.link) {
            UI.alert('Imported — but this file cannot be updated',
              summary + '. The app is not allowed to write into "' + opened.name + '" (it may be read-only, e.g. a WhatsApp attachment). ' +
              'Go to Settings › Excel file › Create Excel file to choose where to keep your data.');
          } else {
            UI.toast(summary + (linked ? ' · saving changes into ' + opened.name : ''));
          }
          if (linked) writeExcelNow();
          App.maybeAskNotifications();
          return true;
        });
      });
    }).catch(function (e) {
      UI.alert('Could not read the Excel file', String(e && e.message || e));
      return false;
    });
  };

  App.createLinkedFile = function () {
    return buildWorkbook().then(function (bytes) {
      return P.excel.create('DepositManager.xlsx', bytes).then(function (r) {
        if (!r) return false;
        App.prefs.excel.lastHash = U.fingerprint(bytes);
        App.prefs.excel.lastSavedAt = Date.now();
        App.prefs.onboarded = true;
        App.savePrefs();
        setSave('saved');
        UI.toast('Every change will now be saved into ' + r.name);
        App.render();
        return true;
      });
    }).catch(function (e) {
      UI.alert('Could not create the file', String(e && e.message || e));
      return false;
    });
  };

  App.unlinkFile = function () {
    var f = App.linkedFile();
    return UI.confirm('Stop saving to ' + (f ? f.name : 'the Excel file') + '?',
      'Your data stays in the app and the Excel file stays where it is. The app will no longer update the file.', 'Stop saving').then(function (ok) {
      if (!ok) return;
      return P.excel.unlink().then(function () {
        App.prefs.excel.lastHash = '';
        App.savePrefs();
        App.save.state = 'idle';
        App.render();
      });
    });
  };

  App.reconnect = function () {
    return P.excel.reconnect().then(function (ok) {
      if (ok) { UI.toast('Reconnected'); return writeExcelNow(); }
      UI.toast('Permission was not given');
    });
  };

  function stampName(base) {
    return base + '-' + App.today + '.xlsx';
  }

  App.saveCopy = function () {
    return buildWorkbook().then(function (bytes) {
      return P.saveCopy(bytes, stampName('DepositManager'), P.XLSX_MIME).then(function (r) {
        if (!r) return;
        App.prefs.excel.exportedRev = App.rev;
        App.savePrefs();
        App.renderStatus();
        UI.toast(r.downloaded ? 'Excel file downloaded: ' + r.name : 'Saved ' + r.name);
      });
    }).catch(function (e) { UI.alert('Could not save the copy', String(e && e.message || e)); });
  };

  App.shareCopy = function () {
    return buildWorkbook().then(function (bytes) {
      return P.share(bytes, stampName('DepositManager'), P.XLSX_MIME).then(function (shared) {
        if (shared && P.kind === 'basic') { App.prefs.excel.exportedRev = App.rev; App.savePrefs(); App.renderStatus(); }
      });
    }).catch(function (e) { UI.alert('Could not share', String(e && e.message || e)); });
  };

  App.downloadTemplate = function () {
    return X.write(M.workbookSheets(M.emptyData(), App.prefs, App.today, { template: true }), { title: 'Deposit Manager template' })
      .then(function (bytes) { return P.saveCopy(bytes, 'DepositManager-Template.xlsx', P.XLSX_MIME); })
      .then(function (r) { if (r) UI.toast(r.downloaded ? 'Template downloaded' : 'Template saved: ' + r.name); })
      .catch(function (e) { UI.alert('Could not save the template', String(e && e.message || e)); });
  };

  App.eraseAll = function () {
    return UI.confirm('Erase all data in the app?',
      'All family members, deposits and payments will be removed from the app. A backup is kept (Settings › Restore previous data). Your Excel file is not deleted, but it will be emptied if the app is saving into it.',
      'Erase everything', true).then(function (ok) {
      if (!ok) return;
      backup('before erasing all data');
      App.data = M.emptyData();
      App.commit();
      UI.toast('All data erased');
    });
  };

  /* ------------------------------------------------------------ reminders */

  /** Once there is something to remind about, ask (once) to allow notifications. */
  App.maybeAskNotifications = function () {
    if (!App.prefs.notify.enabled || P.notify.mode === 'none' || App.prefs.notifyAsked) return;
    var st = P.notify.status();
    if (st === 'granted' || st === 'denied' || st === 'unsupported') return;
    App.prefs.notifyAsked = true;
    App.savePrefs();
    setTimeout(function () {
      UI.dialog({
        title: 'Get payment reminders?',
        message: 'The app can remind you 7, 3 and 1 day before each payment, on the day, and before a deposit matures.',
        buttons: [{ text: 'Not now', value: false, kind: 'outline' }, { text: 'Allow reminders', value: true, kind: 'primary' }]
      }).then(function (yes) {
        if (!yes) return;
        P.notify.request().then(function () { queueReminders(); App.render(); });
      });
    }, 1200);
  };

  var queueReminders = U.debounce(function () {
    var items = M.buildReminders(App.data, App.prefs, App.today, 60);
    P.notify.schedule(items, App.prefs.notify);
    if (P.kind !== 'android' && App.prefs.notify.enabled && P.notify.status() === 'granted' && App.prefs.webNotified !== App.today) {
      var todays = items.filter(function (r) { return r.notifyOn === App.today; });
      if (todays.length) {
        App.prefs.webNotified = App.today;
        App.savePrefs();
        todays.slice(0, 5).forEach(function (r) { P.notify.show(r.title, r.message, r.id); });
      }
    }
  }, 400);
  App.syncReminders = function () { queueReminders(); };

  /* ------------------------------------------------------------ PIN & lock */

  // Compact SHA-256 (fallback when WebCrypto is unavailable).
  function sha256Hex(str) {
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
      0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
      0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70,
      0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var bytes = new TextEncoder().encode(str), l = bytes.length;
    var withPad = new Uint8Array(((l + 9 + 63) >> 6) << 6);
    withPad.set(bytes);
    withPad[l] = 0x80;
    var bits = l * 8, dv = new DataView(withPad.buffer);
    dv.setUint32(withPad.length - 4, bits >>> 0);
    dv.setUint32(withPad.length - 8, Math.floor(bits / 4294967296));
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], w = new Array(64);
    for (var o = 0; o < withPad.length; o += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (i = 16; i < 64; i++) {
        var s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], hh = H[7];
      for (i = 0; i < 64; i++) {
        var t1 = (hh + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        var t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + hh) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }
  function ror(x, n) { return (x >>> n) | (x << (32 - n)); }

  function hexOf(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function hashPin(pin, salt, algo) {
    if (algo === 'pbkdf2' && window.crypto && crypto.subtle) {
      var enc = new TextEncoder();
      return crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']).then(function (key) {
        return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 150000, hash: 'SHA-256' }, key, 256);
      }).then(hexOf);
    }
    var x = salt + ':' + pin;
    for (var i = 0; i < 3000; i++) x = sha256Hex(x + salt);
    return Promise.resolve(x);
  }

  function newSalt() {
    var a = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (var i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256);
    return hexOf(a.buffer);
  }

  App.setPin = function (pin) {
    var algo = (window.crypto && crypto.subtle) ? 'pbkdf2' : 'sha256x', salt = newSalt();
    return hashPin(pin, salt, algo).then(function (hash) {
      var L = App.prefs.lock;
      L.enabled = true; L.algo = algo; L.salt = salt; L.hash = hash; L.length = pin.length; L.failures = 0; L.blockedUntil = 0;
      App.savePrefs();
    });
  };

  App.removePin = function () {
    var L = App.prefs.lock;
    L.enabled = false; L.hash = ''; L.salt = ''; L.biometric = false; L.failures = 0; L.blockedUntil = 0;
    App.savePrefs();
  };

  App.checkPin = function (pin) {
    var L = App.prefs.lock;
    if (!L.enabled || !L.hash) return Promise.resolve(true);
    return hashPin(pin, L.salt, L.algo).then(function (hsh) { return hsh === L.hash; });
  };

  function blockedFor() {
    return Math.max(0, Math.ceil(((+App.prefs.lock.blockedUntil || 0) - Date.now()) / 1000));
  }

  function registerFailure() {
    var L = App.prefs.lock;
    L.failures = (+L.failures || 0) + 1;
    if (L.failures >= 5) L.blockedUntil = Date.now() + Math.min(300, 30 * (L.failures - 4)) * 1000;
    App.savePrefs();
  }

  function registerSuccess() {
    App.prefs.lock.failures = 0;
    App.prefs.lock.blockedUntil = 0;
    App.savePrefs();
  }

  var lockEl = null, hiddenAt = 0;

  function isLocked() { return !!lockEl; }
  App.isLocked = isLocked;

  function canUseBiometric() {
    return App.prefs.lock.enabled && App.prefs.lock.biometric && P.device.biometricAvailable();
  }

  App.lockNow = function () {
    if (!App.prefs.lock.enabled || lockEl) return;
    UI.closeAll();
    document.body.classList.add('locked');
    var pad;
    function tryBio() {
      P.device.authenticate('Unlock Deposit Manager').then(function (ok) { if (ok) unlock(); });
    }
    var bioKey = canUseBiometric() ? h('button', { class: 'ghost', onclick: tryBio, 'aria-label': 'Use fingerprint' }, UI.icon('finger', 'lg')) : null;
    pad = UI.pinPad({
      length: App.prefs.lock.length, message: '',
      extraKey: bioKey,
      isBlocked: function () {
        var s = blockedFor();
        if (s) pad.setMessage('Too many wrong tries. Wait ' + s + ' seconds.');
        return s > 0;
      },
      onDone: function (pin) {
        App.checkPin(pin).then(function (ok) {
          if (ok) { registerSuccess(); unlock(); return; }
          registerFailure();
          pad.shake();
          var s = blockedFor();
          pad.reset(s ? 'Too many wrong tries. Wait ' + s + ' seconds.' : 'Wrong PIN, try again');
        });
      }
    });
    lockEl = h('div', { class: 'lock', role: 'dialog', 'aria-label': 'App locked' },
      UI.logo('logo'), h('div', { class: 'lt' }, 'Deposit Manager'), h('div', { class: 'ls' }, 'Enter your PIN'), pad.el);
    lockEl._pad = pad;
    document.body.appendChild(lockEl);
    if (canUseBiometric()) setTimeout(tryBio, 350);
  };

  function unlock() {
    if (!lockEl) return;
    if (lockEl._pad) lockEl._pad.destroy();
    lockEl.remove();
    lockEl = null;
    document.body.classList.remove('locked');
    App.afterUnlock();
  }

  App.afterUnlock = function () {
    var target = P.device.launchTarget();
    if (target && M.deposit(App.data, target)) App.nav.go('deposit/' + target);
    App.checkExternalChanges();
  };

  /** Ask for PIN (or fingerprint) before showing something sensitive. Resolves true when allowed. */
  App.verifyUser = function (reason) {
    if (!App.prefs.lock.enabled) return Promise.resolve(true);
    var first = canUseBiometric() ? P.device.authenticate(reason || 'Confirm it is you') : Promise.resolve(false);
    return first.then(function (ok) {
      if (ok) return true;
      return UI.sheet(function (close) {
        var pad = UI.pinPad({
          length: App.prefs.lock.length, message: reason || 'Enter your PIN',
          isBlocked: function () { var s = blockedFor(); if (s) pad.setMessage('Too many wrong tries. Wait ' + s + ' seconds.'); return s > 0; },
          onDone: function (pin) {
            App.checkPin(pin).then(function (good) {
              if (good) { registerSuccess(); pad.destroy(); close(true); return; }
              registerFailure();
              pad.shake();
              pad.reset('Wrong PIN, try again');
            });
          }
        });
        return [h('h3', { style: 'text-align:center' }, 'Confirm it is you'), h('div', { class: 'mt-12' }, pad.el)];
      }).then(function (v) { return v === true; });
    });
  };

  /* ------------------------------------------------------------ theme */

  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  App.applyTheme = function () {
    var t = App.prefs.theme, dark = t === 'dark' || (t === 'system' && mq && mq.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    P.device.setThemeColors(dark ? '#0F4E4C' : '#0F5C5A', dark ? '#141E1D' : '#FFFFFF', !dark);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0F4E4C' : '#0F5C5A');
  };
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { App.applyTheme(); });

  /* ------------------------------------------------------------ navigation */

  var TABS = ['home', 'deposits', 'payments', 'members', 'settings'];

  function parse(path) {
    var q = {}, parts = String(path || 'home').split('?');
    if (parts[1]) parts[1].split('&').forEach(function (kv) {
      var p = kv.split('=');
      q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });
    var seg = parts[0].split('/');
    return { path: path, name: seg[0] || 'home', arg: seg[1] ? decodeURIComponent(seg[1]) : '', query: q };
  }

  var nav = {
    stack: [{ path: 'home', scroll: 0 }],
    current: function () { return parse(nav.stack[nav.stack.length - 1].path); },
    tabName: function () {
      var n = parse(nav.stack[0].path).name;
      return TABS.indexOf(n) >= 0 ? n : 'home';
    },
    go: function (path) {
      nav.stack[nav.stack.length - 1].scroll = window.scrollY;
      nav.stack.push({ path: path, scroll: 0 });
      App.render(0);
    },
    replace: function (path) {
      nav.stack[nav.stack.length - 1] = { path: path, scroll: window.scrollY };
      App.render(window.scrollY);
    },
    tab: function (path) {
      nav.stack = [{ path: path, scroll: 0 }];
      App.render(0);
    },
    back: function () {
      if (UI.closeTop()) return true;
      if (nav.stack.length > 1) {
        nav.stack.pop();
        App.render(nav.stack[nav.stack.length - 1].scroll || 0);
        return true;
      }
      if (nav.current().name !== 'home' && App.prefs.onboarded) { nav.tab('home'); return true; }
      return false;
    }
  };
  App.nav = nav;

  /* ------------------------------------------------------------ rendering */

  var els = {};

  App.render = function (scrollTo) {
    if (!els.main) return;
    var route = nav.current();
    if (!App.prefs.onboarded && !hasData() && route.name !== 'welcome') {
      nav.stack = [{ path: 'welcome', scroll: 0 }];
      route = nav.current();
    }
    var screen = DM.screens[route.name] || DM.screens.home;
    var view;
    try {
      view = screen(route);
    } catch (e) {
      console.error(e);
      view = { title: 'Something went wrong', body: UI.empty('alert', 'Something went wrong', String(e && e.message || e),
        h('button', { class: 'btn primary', onclick: function () { nav.tab('home'); } }, 'Go to Home')) };
    }
    var back = nav.stack.length > 1 || view.back;
    U.clear(els.bar);
    els.bar.className = 'appbar-row' + (back ? ' has-back' : '');
    if (back) els.bar.appendChild(h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: function () { if (!nav.back()) nav.tab('home'); } }, UI.icon('back')));
    els.bar.appendChild(h('h1', null, view.title || 'Deposit Manager'));
    U.append(els.bar, view.actions || null);
    if (view.showStatus !== false) {
      els.pill = h('button', { class: 'save-pill', onclick: function () { nav.tab('settings'); } });
      els.bar.appendChild(els.pill);
      App.renderStatus();
    } else els.pill = null;

    U.clear(els.main);
    U.append(els.main, view.body);
    U.clear(els.extra);
    U.append(els.extra, view.fab || null);
    U.append(els.extra, view.sticky || null);

    var tabs = view.tabs !== false && App.prefs.onboarded !== false;
    document.body.classList.toggle('no-tabs', !tabs);
    renderTabs();
    document.title = (view.title ? view.title + ' · ' : '') + 'Deposit Manager';
    try { history.replaceState(null, '', '#/' + nav.stack[nav.stack.length - 1].path); } catch (e) { /* file:// quirks */ }
    if (scrollTo !== undefined) window.scrollTo(0, scrollTo || 0);
    if (view.after) setTimeout(view.after, 0);
  };

  App.renderStatus = function () {
    if (!els.pill) return;
    var s = App.saveStatus();
    U.clear(els.pill);
    els.pill.className = 'save-pill ' + s.kind;
    els.pill.title = s.detail;
    els.pill.setAttribute('aria-label', s.detail);
    els.pill.appendChild(h('span', { class: 'dot' }));
    els.pill.appendChild(document.createTextNode(s.label));
  };

  function renderTabs() {
    var defs = [
      { name: 'home', label: 'Home', icon: 'home' },
      { name: 'deposits', label: 'Deposits', icon: 'bank' },
      { name: 'payments', label: 'Payments', icon: 'calendar' },
      { name: 'members', label: 'Family', icon: 'users' },
      { name: 'settings', label: 'Settings', icon: 'sliders' }
    ];
    var cur = nav.tabName(), overdue = 0;
    App.data.payments.forEach(function (p) { if (p.status === 'Overdue') overdue++; });
    U.clear(els.tabs);
    defs.forEach(function (d) {
      els.tabs.appendChild(h('button', {
        class: 'tab' + (d.name === cur ? ' on' : ''), 'aria-current': d.name === cur ? 'page' : null,
        onclick: function () { nav.tab(d.name); }
      }, h('span', { class: 'pill' }, UI.icon(d.icon)), d.label,
      d.name === 'payments' && overdue ? h('span', { class: 'badge' }, overdue > 99 ? '99+' : String(overdue)) : null));
    });
  }

  /* ------------------------------------------------------------ app lifecycle */

  function onResume() {
    var now = U.todayISO();
    if (now !== App.today) {
      App.today = now;
      M.rollForward(App.data, App.today);
      App.commit();
    }
    if (App.prefs.lock.enabled && hiddenAt && Date.now() - hiddenAt >= (App.prefs.lock.after || 0) * 1000) App.lockNow();
    hiddenAt = 0;
    if (!isLocked()) {
      var target = P.device.launchTarget();
      if (target && M.deposit(App.data, target)) App.nav.go('deposit/' + target);
      App.checkExternalChanges();
    }
  }

  function start() {
    els.bar = document.getElementById('bar');
    els.main = document.getElementById('main');
    els.tabs = document.getElementById('tabs');
    els.extra = document.getElementById('extra');

    loadAll();
    App.applyTheme();
    P.device.setSecure(App.prefs.secureScreen);
    // keep schedules rolling forward and statuses current for today's date
    M.rollForward(App.data, App.today);
    if (hasData()) persistData();

    var hash = (location.hash || '').replace(/^#\/?/, '');
    if (hash && App.prefs.onboarded) {
      var r = parse(hash);
      if (DM.screens[r.name] && r.name !== 'welcome') nav.stack = TABS.indexOf(r.name) >= 0 ? [{ path: hash }] : [{ path: 'home' }, { path: hash }];
    }

    P.on('back', function () {
      if (isLocked()) { P.device.exit(); return true; }
      return nav.back();
    });
    P.on('pause', function () { hiddenAt = Date.now(); if (queueExcelWrite.pending()) queueExcelWrite.flush(); });
    P.on('resume', onResume);
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') UI.closeTop();
    });
    setInterval(function () {
      if (U.todayISO() !== App.today && document.visibilityState === 'visible') onResume();
    }, 60000);

    P.excel.init().then(function () {
      App.render(0);
      queueReminders();
      if (App.prefs.lock.enabled) App.lockNow();
      else App.afterUnlock();
      if (P.kind === 'fs' && App.linkedFile()) {
        P.excel.needsPermission().then(function (need) { if (need) setSave('permission'); });
      }
    });
  }

  App.start = start;
  DM.app = App;
})(window.DM = window.DM || {});
