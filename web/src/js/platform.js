/* Deposit Manager — platform layer.
 *   android : running inside the Android app (window.AndroidBridge). Real file linking via the
 *             system file picker, autosave straight into the chosen .xlsx, phone notifications,
 *             fingerprint unlock, sharing.
 *   fs      : desktop Chrome/Edge — File System Access API gives the same "linked Excel file" autosave.
 *   basic   : any other browser — data is kept in the browser; Excel is imported/exported by hand. */
(function (DM) {
  'use strict';
  var U = DM.util;
  var A = window.AndroidBridge || null;
  var kind = A ? 'android' : ((window.showOpenFilePicker && window.isSecureContext) ? 'fs' : 'basic');
  var XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  /* ------------------------------------------------------------ native plumbing */

  var callbacks = {}, seq = 0;
  window.DMNativeCallback = function (id, json) {
    var cb = callbacks[id];
    delete callbacks[id];
    if (!cb) return;
    var v;
    try { v = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { v = { ok: false, error: String(e) }; }
    cb(v || { ok: false });
  };

  function nativeAsync(method, args) {
    return new Promise(function (resolve) {
      var id = 'cb' + (++seq) + '_' + Date.now();
      callbacks[id] = resolve;
      try { A[method].apply(A, [id].concat(args || [])); } catch (e) { delete callbacks[id]; resolve({ ok: false, error: String(e) }); }
    });
  }

  function nativeJson(method, args) {
    try {
      var r = A[method].apply(A, args || []);
      return r ? JSON.parse(r) : null;
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  var listeners = { resume: [], pause: [], back: [], open: [] };
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, payload) {
    var handled = false;
    (listeners[evt] || []).forEach(function (fn) { if (fn(payload)) handled = true; });
    return handled;
  }
  /** Called by the Android activity. For 'back' the return value tells Android whether we handled it. */
  window.DMNativeEvent = function (name, payload) {
    var p = payload;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { /* plain string */ } }
    return emit(name, p);
  };

  if (kind !== 'android') {
    document.addEventListener('visibilitychange', function () {
      emit(document.visibilityState === 'visible' ? 'resume' : 'pause');
    });
  }

  /* ------------------------------------------------------------ key/value storage */

  var LS = { data: 'dm.data.v1', prefs: 'dm.prefs.v1', backup: 'dm.backup.v1', meta: 'dm.meta.v1' };

  function load(key) {
    if (A) {
      var s = '';
      try { s = A.loadFile(key); } catch (e) { s = ''; }
      return s ? safeParse(s) : null;
    }
    try { return safeParse(localStorage.getItem(LS[key])); } catch (e) { return null; }
  }

  function save(key, obj) {
    var s = JSON.stringify(obj);
    if (A) {
      var r = A.saveFile(key, s);
      if (r !== 'ok') throw new Error('Could not save on the phone: ' + r);
      return;
    }
    try {
      localStorage.setItem(LS[key], s);
    } catch (e) {
      throw new Error('The browser refused to store the data (storage full or private mode).');
    }
  }

  function remove(key) {
    if (A) { try { A.deleteFile(key); } catch (e) { /* ignore */ } return; }
    try { localStorage.removeItem(LS[key]); } catch (e) { /* ignore */ }
  }

  function safeParse(s) {
    if (!s) return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  /* ------------------------------------------------------------ IndexedDB (file handle, fs mode) */

  function idb(mode, fn) {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('deposit-manager', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () {
        var db = req.result, tx = db.transaction('kv', mode), st = tx.objectStore('kv'), out;
        var r = fn(st);
        if (r) r.onsuccess = function () { out = r.result; };
        tx.oncomplete = function () { db.close(); resolve(out); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      };
    });
  }
  function idbGet(k) { return idb('readonly', function (s) { return s.get(k); }); }
  function idbSet(k, v) { return idb('readwrite', function (s) { return s.put(v, k); }); }
  function idbDel(k) { return idb('readwrite', function (s) { return s.delete(k); }); }

  var fsHandle = null;

  /* ------------------------------------------------------------ Excel file */

  var excel = {
    /** Can this platform keep writing every change into one chosen file? */
    canLink: kind === 'android' || kind === 'fs',

    init: function () {
      if (kind !== 'fs') return Promise.resolve();
      return idbGet('excel').then(function (h) { fsHandle = h || null; }).catch(function () { fsHandle = null; });
    },

    /** {name, needsPermission} or null */
    info: function () {
      if (kind === 'android') {
        var i = nativeJson('getLinkedFile');
        return i && i.uri ? { name: i.name || 'Excel file' } : null;
      }
      if (kind === 'fs' && fsHandle) return { name: fsHandle.name };
      return null;
    },

    /** Pick an .xlsx to read. When the platform can, it also becomes the linked file. */
    open: function () {
      if (kind === 'android') {
        return nativeAsync('openExcel').then(function (r) {
          if (!r || !r.ok) return r && r.cancelled ? null : Promise.reject(new Error((r && r.error) || 'Could not open the file'));
          return { name: r.name, bytes: U.base64ToBytes(r.base64), uri: r.uri };
        });
      }
      if (kind === 'fs') {
        return window.showOpenFilePicker({
          multiple: false,
          types: [{ description: 'Excel workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }]
        }).then(function (hs) {
          var h = hs[0];
          return h.getFile().then(function (f) { return f.arrayBuffer(); }).then(function (buf) {
            return { name: h.name, bytes: new Uint8Array(buf), handle: h, linked: false };
          });
        }, function (e) { if (e && e.name === 'AbortError') return null; throw e; });
      }
      return pickFileBasic();
    },

    /** After a confirmed import from open(): make that same file the one every change is saved into.
     *  Resolves true when the file can be written to. */
    adopt: function (opened) {
      if (kind === 'android' && opened && opened.uri) {
        var r = nativeJson('linkFile', [opened.uri, opened.name || '']);
        return Promise.resolve(!!(r && r.ok));
      }
      if (kind !== 'fs' || !opened || !opened.handle) return Promise.resolve(false);
      var h = opened.handle;
      return h.requestPermission({ mode: 'readwrite' }).then(function (p) {
        if (p !== 'granted') return false;
        fsHandle = h;
        return idbSet('excel', h).then(function () { return true; });
      }).catch(function () { return false; });
    },

    /** Choose where to create a new workbook, write it, and link it. */
    create: function (name, bytes) {
      if (kind === 'android') {
        return nativeAsync('createExcel', [name, U.bytesToBase64(bytes)]).then(function (r) {
          if (!r || !r.ok) return r && r.cancelled ? null : Promise.reject(new Error((r && r.error) || 'Could not create the file'));
          return { name: r.name };
        });
      }
      if (kind === 'fs') {
        return window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'Excel workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }]
        }).then(function (h) {
          return writeHandle(h, bytes).then(function () {
            fsHandle = h;
            return idbSet('excel', h).then(function () { return { name: h.name }; });
          });
        }, function (e) { if (e && e.name === 'AbortError') return null; throw e; });
      }
      return Promise.reject(new Error('Not supported here'));
    },

    /** Write the workbook into the linked file. Resolves {ok, needsPermission?, error?}. */
    write: function (bytes) {
      if (kind === 'android') {
        var r = nativeJson('writeLinked', [U.bytesToBase64(bytes)]);
        return Promise.resolve(r || { ok: false, error: 'No response' });
      }
      if (kind === 'fs' && fsHandle) {
        return fsHandle.queryPermission({ mode: 'readwrite' }).then(function (p) {
          if (p !== 'granted') return { ok: false, needsPermission: true };
          return writeHandle(fsHandle, bytes).then(function () { return { ok: true }; });
        }).catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
      }
      return Promise.resolve({ ok: false, error: 'No linked file' });
    },

    /** Current bytes of the linked file (to notice edits made outside the app). */
    read: function () {
      if (kind === 'android') {
        var r = nativeJson('readLinked');
        if (!r || !r.ok) return Promise.resolve(null);
        return Promise.resolve(U.base64ToBytes(r.base64));
      }
      if (kind === 'fs' && fsHandle) {
        return fsHandle.queryPermission({ mode: 'read' }).then(function (p) {
          if (p !== 'granted') return null;
          return fsHandle.getFile().then(function (f) { return f.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); });
        }).catch(function () { return null; });
      }
      return Promise.resolve(null);
    },

    /** fs mode: permission lapses between browser sessions; ask again (needs a tap). */
    reconnect: function () {
      if (kind !== 'fs' || !fsHandle) return Promise.resolve(false);
      return fsHandle.requestPermission({ mode: 'readwrite' }).then(function (p) { return p === 'granted'; }).catch(function () { return false; });
    },

    needsPermission: function () {
      if (kind !== 'fs' || !fsHandle) return Promise.resolve(false);
      return fsHandle.queryPermission({ mode: 'readwrite' }).then(function (p) { return p !== 'granted'; }).catch(function () { return true; });
    },

    unlink: function () {
      if (kind === 'android') { try { A.unlinkFile(); } catch (e) { /* ignore */ } return Promise.resolve(); }
      if (kind === 'fs') { fsHandle = null; return idbDel('excel').catch(function () {}); }
      return Promise.resolve();
    }
  };

  function writeHandle(h, bytes) {
    return h.createWritable().then(function (w) {
      return w.write(bytes).then(function () { return w.close(); });
    });
  }

  function pickFileBasic() {
    return new Promise(function (resolve, reject) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      input.style.display = 'none';
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        input.remove();
        if (!f) return resolve(null);
        f.arrayBuffer().then(function (b) { resolve({ name: f.name, bytes: new Uint8Array(b), linked: false }); }, reject);
      });
      input.addEventListener('cancel', function () { input.remove(); resolve(null); });
      document.body.appendChild(input);
      input.click();
    });
  }

  /* ------------------------------------------------------------ saving copies & sharing */

  function download(bytes, name, mime) {
    var blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }

  /** Save a separate copy (not linked). Resolves {name} or null when cancelled. */
  function saveCopy(bytes, name, mime) {
    mime = mime || XLSX_MIME;
    if (kind === 'android') {
      return nativeAsync('saveCopy', [name, mime, U.bytesToBase64(bytes)]).then(function (r) {
        if (!r || !r.ok) return r && r.cancelled ? null : Promise.reject(new Error((r && r.error) || 'Could not save the file'));
        return { name: r.name };
      });
    }
    if (kind === 'fs' && window.showSaveFilePicker) {
      return window.showSaveFilePicker({ suggestedName: name }).then(function (h) {
        return writeHandle(h, bytes).then(function () { return { name: h.name }; });
      }, function (e) { if (e && e.name === 'AbortError') return null; throw e; });
    }
    download(bytes, name, mime);
    return Promise.resolve({ name: name, downloaded: true });
  }

  function canShare() {
    if (kind === 'android') return true;
    try {
      return !!(navigator.canShare && navigator.canShare({ files: [new File([new Uint8Array(1)], 'x.xlsx', { type: XLSX_MIME })] }));
    } catch (e) { return false; }
  }

  function share(bytes, name, mime) {
    mime = mime || XLSX_MIME;
    if (kind === 'android') {
      var r = nativeJson('shareFile', [name, mime, U.bytesToBase64(bytes)]);
      return r && r.ok ? Promise.resolve(true) : Promise.reject(new Error((r && r.error) || 'Could not share'));
    }
    var file = new File([bytes], name, { type: mime });
    return navigator.share({ files: [file], title: name }).then(function () { return true; }, function (e) {
      if (e && e.name === 'AbortError') return false;
      throw e;
    });
  }

  /* ------------------------------------------------------------ notifications */

  var notify = {
    /** 'phone' (real scheduled notifications), 'browser' (only while open), or 'none' */
    mode: kind === 'android' ? 'phone' : (('Notification' in window) ? 'browser' : 'none'),

    status: function () {
      if (kind === 'android') {
        var s = nativeJson('notificationStatus');
        return s && s.granted ? 'granted' : 'default';
      }
      if (!('Notification' in window)) return 'unsupported';
      return Notification.permission; // 'granted' | 'denied' | 'default'
    },

    request: function () {
      if (kind === 'android') return nativeAsync('requestNotificationPermission').then(function (r) { return r && r.granted ? 'granted' : 'denied'; });
      if (!('Notification' in window)) return Promise.resolve('unsupported');
      return Promise.resolve(Notification.requestPermission()).then(function (p) { return p; });
    },

    /** Hand the reminder list to the phone so it can notify even when the app is closed. */
    schedule: function (items, settings) {
      if (kind !== 'android') return;
      var payload = {
        enabled: !!settings.enabled, time: settings.time || '09:00',
        items: items.map(function (r) {
          return {
            key: r.type + ':' + (r.paymentId || r.depositId) + ':' + r.eventDate + ':' + r.daysBefore,
            on: r.notifyOn, title: r.title, text: r.message, depositId: r.depositId, type: r.type
          };
        })
      };
      try { A.setReminders(JSON.stringify(payload)); } catch (e) { /* ignore */ }
    },

    show: function (title, body, tag) {
      if (kind === 'android') { try { A.showNotification(title, body, tag || ''); } catch (e) { /* ignore */ } return; }
      if (notify.status() !== 'granted') return;
      try { new Notification(title, { body: body, tag: tag || undefined }); } catch (e) { /* some browsers need a service worker */ }
    }
  };

  /* ------------------------------------------------------------ device features */

  var info = (kind === 'android' && nativeJson('getInfo')) || {};

  var device = {
    biometricAvailable: function () {
      if (kind !== 'android') return false;
      var i = nativeJson('getInfo') || {};
      return !!i.biometric;
    },
    authenticate: function (title) {
      if (kind !== 'android') return Promise.resolve(false);
      return nativeAsync('authenticate', [title || 'Unlock Deposit Manager']).then(function (r) { return !!(r && r.ok); });
    },
    setSecure: function (on) { if (kind === 'android') { try { A.setSecureScreen(!!on); } catch (e) { /* ignore */ } } },
    exit: function () { if (kind === 'android') { try { A.exitApp(); } catch (e) { /* ignore */ } } },
    launchTarget: function () {
      if (kind !== 'android') return '';
      try { return A.consumeLaunchTarget() || ''; } catch (e) { return ''; }
    },
    setThemeColors: function (bar, nav, darkIcons) {
      if (kind !== 'android') return;
      try { A.setSystemBars(bar, nav, !!darkIcons); } catch (e) { /* ignore */ }
    }
  };

  DM.platform = {
    kind: kind, info: info, on: on, emit: emit,
    load: load, save: save, remove: remove,
    excel: excel, saveCopy: saveCopy, download: download, canShare: canShare, share: share,
    notify: notify, device: device, XLSX_MIME: XLSX_MIME
  };
})(window.DM = window.DM || {});
