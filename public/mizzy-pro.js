/* Mizzy Sales — small UX helpers for the redesigned sign-in / sign-up pages.
   Adds a show/hide button to password fields and a live strength meter. */
(function () {
  var EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0112 6c6 0 10 6 10 6a17 17 0 01-3.2 3.7M6.5 6.6A17 17 0 002 12s4 7 10 7a9.6 9.6 0 004-.9"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/></svg>';

  function addToggle(input) {
    if (!input || input.dataset.msEye) return;
    input.dataset.msEye = '1';
    var wrap = document.createElement('div');
    wrap.className = 'ms-pw';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ms-eye';
    btn.setAttribute('aria-label', 'Show password');
    btn.innerHTML = EYE;
    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
    wrap.appendChild(btn);
  }

  function strength(v) {
    var n = 0;
    if (v.length >= 6) n++;
    if (v.length >= 10) n++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) n++;
    if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) n++;
    return v ? Math.max(1, n) : 0;
  }

  function wireMeter() {
    var inp = document.getElementById('regPass');
    var bar = document.getElementById('regMeter');
    var txt = document.getElementById('regMeterT');
    if (!inp || !bar || !txt || inp.dataset.msMeter) return;
    inp.dataset.msMeter = '1';
    var labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    var colors = ['transparent', '#ff4757', '#f5a623', '#00b4f8', '#18d27a'];
    inp.addEventListener('input', function () {
      var n = strength(inp.value);
      bar.style.width = (n * 25) + '%';
      bar.style.background = colors[n];
      txt.textContent = n ? labels[n] : '';
      txt.style.color = colors[n] === 'transparent' ? '' : colors[n];
    });
  }

  function init() {
    ['loginPass', 'regPass', 'regConfirm', 'resetPass', 'resetPass2'].forEach(function (id) {
      addToggle(document.getElementById(id));
    });
    wireMeter();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
