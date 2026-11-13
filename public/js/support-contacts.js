/* Support page contact buttons. Reads the admin switches from /api/public/site-links:
   WhatsApp off -> only Telegram shows (with the Telegram icon); Telegram off -> only WhatsApp shows. */
(function () {
  var box = document.getElementById('suppContactBody');
  if (!box) return;
  var sub = document.getElementById('suppContactSub');
  var WA = '<svg class="wa-icon"><use href="#wa-logo"/></svg>';
  var TG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21.9 4.1 2.8 11.5c-1.3.5-1.3 1.3-.2 1.6l4.9 1.5 1.9 5.8c.2.6.1.8.7.8.5 0 .7-.2 1-.5l2.4-2.3 4.9 3.6c.9.5 1.5.2 1.7-.8l3.2-15.1c.3-1.3-.5-1.9-1.4-1.5zM9 13.9l9.4-5.9c.4-.3.8-.1.5.2l-7.8 7-.3 3.2z"/></svg>';
  var st = document.createElement('style');
  st.textContent = '.supp-tg{border-color:#229ed9;color:#229ed9}.supp-tg:hover{background:rgba(34,158,217,.1)}.supp-hours{font-size:13px;color:var(--t2);margin-top:4px}';
  document.head.appendChild(st);
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function btn(cls, href, icon, label) {
    return '<a class="supp-btn ' + cls + '" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer"><span>' + icon + '</span> ' + esc(label) + '</a>';
  }
  function render(l) {
    var wa = l.whatsappEnabled !== false, tg = l.telegramEnabled !== false, h = '';
    var phone = String(l.adminPhone || l.whatsappNumber || '').replace(/\D/g, '');
    var waChat = l.whatsappChatLink || (phone ? 'https://wa.me/' + phone : '');
    var tgUser = String(l.telegramUsername || '').replace(/^@/, '');
    var tgChat = l.telegramLink || (tgUser ? 'https://t.me/' + tgUser : '');
    if (wa && waChat) h += btn('supp-wa', waChat, WA, 'Chat on WhatsApp');
    if (tg && tgChat) h += btn('supp-tg', tgChat, TG, 'Chat on Telegram');
    if (wa && l.whatsappChannelLink) h += btn('supp-ch', l.whatsappChannelLink, WA, 'Join WhatsApp Channel');
    if (wa && l.whatsappGroupLink) h += btn('supp-grp', l.whatsappGroupLink, WA, 'Join WhatsApp Community');
    if (tg && l.telegramChannelLink) h += btn('supp-tg', l.telegramChannelLink, TG, 'Join Telegram Channel');
    if (tg && l.telegramCommunityLink) h += btn('supp-tg', l.telegramCommunityLink, TG, 'Join Telegram Community');
    if (l.supportHours) h += '<div class="supp-hours">🕒 ' + esc(l.supportHours) + '</div>';
    if (!h) h = '<p style="color:var(--t2);font-size:14px">Use Live Support or submit a ticket and we will get back to you.</p>';
    box.innerHTML = h;
    if (sub) sub.textContent = wa && tg ? 'Reach us on WhatsApp or Telegram' : wa ? 'Fastest response via WhatsApp' : tg ? 'Reach us on Telegram' : 'Contact options';
  }
  function load() {
    fetch('/api/public/site-links?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (l) { if (l) render(l); })
      .catch(function () {});
  }
  load();
  window.addEventListener('focus', load);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
})();
