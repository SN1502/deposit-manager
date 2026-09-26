/* Deposit Manager — start-up. */
(function (DM) {
  'use strict';
  function fatal(msg) {
    var main = document.getElementById('main');
    if (!main) return;
    main.innerHTML = '';
    var box = document.createElement('div');
    box.style.cssText = 'padding:24px;margin:16px;border-radius:16px;background:#fce8e6;color:#5c1410;font-family:sans-serif';
    box.innerHTML = '<b>The app could not start.</b><br><br>';
    box.appendChild(document.createTextNode(String(msg)));
    main.appendChild(box);
  }
  window.addEventListener('error', function (e) {
    if (!DM.app || !document.getElementById('bar') || !document.getElementById('bar').firstChild) fatal(e.message || e);
  });
  function boot() {
    try {
      if (!window.JSZip) throw new Error('A required part (zip library) is missing from this file.');
      DM.app.start();
    } catch (e) {
      fatal(e && e.message || e);
      throw e;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.DM = window.DM || {});
