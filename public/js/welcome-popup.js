/* Welcome pop-up — its own feature, set from Admin > Site Links > "Welcome pop-up".
   Frequency (chosen in admin):
     session     = once each visit, when they enter the site
     everyPage   = every time they open / switch to a page
     afterSignup = only right after a new account is created
   The button opens the WhatsApp channel link set in the admin panel. */
(function () {
  var path = location.pathname.toLowerCase();
  if (/^\/(admin|login|register|signup|forgot|reset)/.test(path)) return;
  var cfg = null, open = false;
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) {} return null; }
  var WA = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.2h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.79 14.09c-.24.68-1.4 1.3-1.93 1.35-.5.06-1.13.08-1.83-.11-.42-.12-.96-.3-1.66-.6-2.92-1.26-4.82-4.2-4.97-4.4-.15-.19-1.19-1.58-1.19-3.01 0-1.44.75-2.14 1.02-2.44.27-.29.58-.36.78-.36.19 0 .39 0 .56.01.18.01.42-.07.65.5.24.58.82 2.01.9 2.15.07.15.12.32.02.51-.09.19-.14.31-.28.48-.14.16-.29.36-.42.49-.14.14-.28.29-.12.57.16.27.71 1.17 1.52 1.9 1.05.94 1.93 1.23 2.21 1.37.28.14.44.12.6-.07.16-.19.68-.79.87-1.06.18-.27.37-.22.62-.13.25.09 1.6.75 1.87.89.27.13.45.2.51.31.06.11.06.66-.18 1.34z"/></svg>';

  function show() {
    if (open || !cfg) return;
    open = true;
    if (!document.getElementById('mswpStyle')) {
      var st = document.createElement('style'); st.id = 'mswpStyle';
      st.textContent =
        '.mswp-ov{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;padding:18px;animation:mswpIn .2s ease}' +
        '@keyframes mswpIn{from{opacity:0}to{opacity:1}}' +
        '.mswp-card{position:relative;width:100%;max-width:360px;background:#141421;color:#eeeef5;border:1px solid #2e2e42;border-radius:20px;padding:28px 20px 20px;box-shadow:0 20px 60px rgba(0,0,0,.55);text-align:center;font-family:inherit}' +
        '.mswp-x{position:absolute;top:10px;right:12px;width:32px;height:32px;border-radius:50%;border:none;background:rgba(255,255,255,.08);color:#eeeef5;font-size:20px;line-height:1;cursor:pointer}' +
        '.mswp-h{font-size:20px;font-weight:800;margin-bottom:8px}' +
        '.mswp-t{font-size:14.5px;line-height:1.5;color:#b9b9cc;margin-bottom:18px;white-space:pre-line}' +
        '.mswp-b{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:13px 14px;border-radius:14px;font-weight:700;font-size:15px;text-decoration:none;background:#25D366;color:#0a0a14}';
      document.head.appendChild(st);
    }
    var ov = document.createElement('div'); ov.className = 'mswp-ov'; ov.id = 'msWelcomePopup';
    ov.innerHTML = '<div class="mswp-card" role="dialog" aria-modal="true"><button type="button" class="mswp-x" aria-label="Close">&times;</button><div class="mswp-h"></div><div class="mswp-t"></div><a class="mswp-b" target="_blank" rel="noopener noreferrer">' + WA + '<span></span></a></div>';
    document.body.appendChild(ov);
    ov.querySelector('.mswp-h').textContent = cfg.title || '';
    ov.querySelector('.mswp-t').textContent = cfg.message || '';
    var a = ov.querySelector('.mswp-b'); a.href = cfg.link; a.querySelector('span').textContent = cfg.buttonText || 'Join now';
    function close() { ov.remove(); open = false; }
    ov.querySelector('.mswp-x').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    a.addEventListener('click', function () { setTimeout(close, 150); });
  }

  function check(isNav) {
    if (!cfg || open) return;
    if (cfg.frequency === 'afterSignup') {
      if (!ls('ms_wp_signup')) return;
      ls('ms_wp_signup', null); setTimeout(show, 700);
    } else if (cfg.frequency === 'everyPage') {
      setTimeout(show, isNav ? 300 : 700);
    } else {
      var k = 'ms_wp_seen_' + cfg.version;
      if (ss(k)) return; ss(k, '1'); setTimeout(show, 700);
    }
  }

  function hookSpa() {
    if (typeof window.showPage !== 'function' || window.showPage.__mswp) return;
    var orig = window.showPage;
    var w = function () { var r = orig.apply(this, arguments); var p = String(arguments[0] || ''); if (cfg && cfg.frequency === 'everyPage' && !/^(login|register|forgot|reset)/.test(p)) check(true); return r; };
    w.__mswp = true; window.showPage = w;
  }

  fetch('/api/public/welcome-popup', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
    if (!c || !c.enabled || !c.link) return;
    cfg = c; check(false); hookSpa();
  }).catch(function () {});
})();
