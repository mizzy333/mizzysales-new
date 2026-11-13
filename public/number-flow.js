/* Mizzy Sales — buy-number flow polish
   1) Confirmation popup (service · country · pool · price) before any purchase
   2) Wait card + Active numbers rendered as clean "number cards" with a big code
   Wraps the existing buy/render functions, so the ordering logic itself is unchanged. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var COPY = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 012-2h9"/></svg>';

  function optText(id) {
    var el = $(id);
    if (!el || !el.value) return '';
    var o = el.options[el.selectedIndex];
    return o ? o.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  /* ---------- confirmation popup ---------- */
  function ask(d) {
    return new Promise(function (resolve) {
      var old = $('nfConfirm'); if (old) old.remove();
      var m = document.createElement('div');
      m.id = 'nfConfirm'; m.className = 'nf-modal';
      m.innerHTML = '<div class="nf-sheet" role="dialog" aria-modal="true" aria-labelledby="nfCT">' +
        '<h3 id="nfCT">Confirm your order</h3>' +
        '<div class="nf-sum">' +
        '<div><span>Service</span><b>' + esc(d.service) + '</b></div>' +
        '<div><span>Country</span><b>' + esc(d.country) + '</b></div>' +
        '<div><span>Pool</span><b>' + esc(d.pool) + '</b></div>' +
        '<div><span>Wallet balance</span><b>' + esc((($('numBalDisplay') || {}).textContent || '—')) + '</b></div>' +
        '<div class="nf-sum-total"><span>Price</span><b>' + esc(d.price) + '</b></div></div>' +
        '<p class="nf-msg">Charged from your wallet now. Auto-refund if no code arrives in time.</p>' +
        '<div class="nf-modal-actions"><button type="button" class="nf-btn nf-btn--ghost" id="nfNo">Cancel</button>' +
        '<button type="button" class="nf-btn nf-btn--solid" id="nfYes">Confirm &amp; buy</button></div></div>';
      document.body.appendChild(m);
      function done(v) { m.remove(); document.removeEventListener('keydown', onKey); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') done(false); }
      document.addEventListener('keydown', onKey);
      m.addEventListener('click', function (e) { if (e.target === m) done(false); });
      $('nfNo').onclick = function () { done(false); };
      $('nfYes').onclick = function () { done(true); };
      $('nfYes').focus();
    });
  }

  function wrapBuy(name, collect) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = async function () {
      var d = collect();
      if (!d) return orig.apply(this, arguments);       // let the original show its own "pick something" message
      var yes = await ask(d);
      if (!yes) return;
      var oc = window.confirm;
      window.confirm = function () { return true; };    // the popup above replaces the old browser confirm
      try { return await orig.apply(this, arguments); }
      finally { window.confirm = oc; }
    };
  }

  wrapBuy('buyNumber', function () {
    var service = optText('numProviderSelect'), country = optText('numCountrySelect');
    if (!service || !country) return null;
    return { service: service, country: country, pool: 'Server 1', price: ($('numPriceDisplay') || {}).textContent || '' };
  });
  wrapBuy('buyNumberServer2', function () {
    var service = optText('g2ServiceSelect'), country = optText('g2CountrySelect'), pool = optText('g2ProviderSelect');
    if (!service || !country || !pool) return null;
    try {   // clean names straight from the loaded data instead of the long dropdown text
      var s = g2Services.find(function (x) { return x.code === $('g2ServiceSelect').value; });
      var c = g2Countries.find(function (x) { return String(x.id) === String($('g2CountrySelect').value); });
      var p = g2Providers[Number($('g2ProviderSelect').value)];
      if (s) service = s.name;
      if (c) country = c.name;
      if (p) pool = (p.label || pool) + ' · ' + p.count + ' in stock';
    } catch (e) {}
    return { service: service, country: country, pool: pool, price: ($('g2PriceDisplay') || {}).textContent || '' };
  });

  /* ---------- wait card ---------- */
  function setStatus(label, kind) {
    var el = $('nwStatus'); if (!el) return;
    el.textContent = label; el.className = 'nf-status nf-status--' + kind;
  }
  function syncCard() {
    var note = $('numStatusNote'), box = $('numCodeBox'), txt = $('nwCodeText'), card = $('numWaitStep');
    if (!note || !box) return;
    var t = (note.textContent || '').toLowerCase();
    var hasCode = box.style.display !== 'none' && box.style.display !== '';
    if (hasCode || /code received/.test(t)) { setStatus('Completed', 'ok'); if (txt) txt.textContent = 'Verification code received'; if (card) card.classList.add('nf-done'); }
    else if (/refund|cancel|no code/.test(t)) { setStatus(/cancel/.test(t) ? 'Cancelled' : 'Refunded', 'warn'); if (txt) txt.textContent = 'No code — refunded to your wallet'; }
    else { setStatus('Waiting', 'wait'); if (txt) txt.textContent = 'Waiting for verification code…'; if (card) card.classList.remove('nf-done'); }
  }
  var origShow = window.showNumWaitStep;
  if (typeof origShow === 'function') {
    window.showNumWaitStep = function (order) {
      var r = origShow.apply(this, arguments);
      try {
        var name = (order && (order.provider || order.service)) || 'Service';
        $('nwSvcName').textContent = name;
        $('nwSvcLetter').textContent = String(name).trim().charAt(0).toUpperCase() || '#';
        $('nwCountry').textContent = (order && order.country) || '';
        $('numCopyBtn').textContent = 'Copy number';
        syncCard();
      } catch (e) {}
      return r;
    };
  }
  ['numStatusNote', 'numCodeBox'].forEach(function (id) {
    var el = $(id); if (!el) return;
    new MutationObserver(syncCard).observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
  });

  /* ---------- active numbers as cards ---------- */
  window.renderActiveNumbers = function (list) {
    var card = $('activeNumbersCard'), host = $('activeNumbersList'), chip = $('anCountChip');
    if (!card || !host) return;
    if (chip) chip.textContent = list.length;
    if (!list.length) { card.style.display = 'none'; host.innerHTML = ''; return; }
    card.style.display = 'block';
    host.innerHTML = list.map(function (o) {
      var left = o.expiresAt ? Math.max(0, Math.round((new Date(o.expiresAt) - Date.now()) / 1000)) : 0;
      var mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0');
      var done = !!o.code;
      return '<div class="nf-mini" data-href="/number-history?order=' + esc(o.id) + '">' +
        '<div class="nf-top"><span class="nf-svc"><i>' + esc(String(o.provider || '#').charAt(0).toUpperCase()) + '</i><b>' + esc(o.provider) + '</b></span>' +
        '<span class="nf-status nf-status--' + (done ? 'ok' : 'wait') + '">' + (done ? 'Completed' : 'Waiting') + '</span></div>' +
        (o.country ? '<div class="nf-country">' + esc(o.country) + '</div>' : '') +
        '<div class="nf-numrow"><div class="phone-num">' + esc(o.phoneNumber) + '</div>' +
        '<button type="button" class="nf-copy" data-copy="' + esc(o.phoneNumber) + '" aria-label="Copy number">' + COPY + '</button></div>' +
        '<div class="nf-minifoot">' + (done ? '<span class="nf-minicode">' + esc(o.code) + '</span>' : '<span class="an-waiting">Waiting for code…</span>') +
        '<span class="an-time">' + mm + ':' + ss + '</span></div></div>';
    }).join('');
  };
  document.addEventListener('click', function (e) {
    var cp = e.target.closest && e.target.closest('[data-copy]');
    if (cp) {
      e.stopPropagation();
      try { navigator.clipboard.writeText(cp.getAttribute('data-copy')); if (window.showToast) showToast('Number copied', 'ok'); } catch (x) {}
      return;
    }
    var mini = e.target.closest && e.target.closest('.nf-mini');
    if (mini) window.location.href = mini.getAttribute('data-href');
  });
})();
