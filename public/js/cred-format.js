/* Turns raw supplier credentials (e.g. "user<TAB>password<TAB>2FA KEY") into a neat card
   with labelled fields and a Copy button on each. Falls back to the raw text if the format is not recognised.
   Usage: window.msCredHTML(text) -> html string ('' when it can't be formatted). */
(function () {
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function label(v, i) {
    var t = String(v).trim(), c = t.replace(/\s+/g, '');
    if (/^https?:\/\//i.test(t)) return ['Link', 'link'];
    if (i === 0) return [t.indexOf('@') > -1 && !/\s/.test(t) ? 'Email' : (/^\+?\d[\d\s-]{7,}$/.test(t) ? 'Phone' : 'Username'), 'text'];
    if (i === 1) return ['Password', 'text'];
    if (/^\S+@\S+\.\S+$/.test(t)) return ['Email', 'text'];
    if (/^\+?\d[\d\s-]{7,}$/.test(t)) return ['Phone', 'text'];
    if (t.length >= 80 || (/=/.test(t) && /;/.test(t))) return ['Cookie', 'text'];
    if (/^[A-Za-z0-9 ]+$/.test(t) && c.length >= 16 && c.length <= 64) return ['2FA key', '2fa'];
    return ['Extra info', 'text'];
  }
  // Try the common separators: tab, " | ", "|", " : ", ":" (email:pass), "----", " - "
  function split(line) {
    if (line.indexOf('\t') > -1) return line.split('\t');
    var q = split2(line); return q && !/\s/.test(q[0].trim()) ? q : null;
  }
  function split2(line) {
    if (line.indexOf('|') > -1) return line.split('|');
    if (line.indexOf('----') > -1) return line.split(/-{4,}/);
    if (/ : /.test(line)) return line.split(/ : /);
    if (!/https?:\/\//i.test(line) && line.indexOf(':') > 0) {
      var p = line.split(':');
      if (p.length <= 4) return p;
      return [p[0], p[1], p.slice(2).join(':')];
    }
    return null;
  }
  var KNOWN = /^(user ?name|user|login|email|e-?mail|mail|pass(word)?|pwd|2fa( key| code)?|secret|key|cookies?|phone|number|recovery( email)?|link|url|backup codes?)$/i;
  function labelled(lines) {
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^([A-Za-z0-9 _\/-]{2,24}?)\s*[:=]\s*(.+)$/);
      if (m && KNOWN.test(m[1].trim())) rows.push([m[1].trim().replace(/^./, function (c) { return c.toUpperCase(); }), m[2].trim(), /2fa|secret|key/i.test(m[1])]);
    }
    return rows.length >= 2 && rows.length >= lines.length - 1 ? rows : null;
  }
  function row(l, v, kind) {
    var copy = kind === '2fa' ? v.replace(/\s+/g, '') : v;
    return '<div class="mscred-row"><div class="mscred-l">' + esc(l) + '</div><div class="mscred-v">' +
      (kind === 'link' ? '<a href="' + esc(v) + '" target="_blank" rel="noopener noreferrer">' + esc(v) + '</a>' : '<code>' + esc(v) + '</code>') +
      '</div><button type="button" class="mscred-c" data-copy="' + esc(copy) + '">Copy</button></div>';
  }
  // Supplier sometimes hands back the whole order record as JSON. Pull out just the account lines.
  function pull(o, out) {
    if (o == null) return;
    if (typeof o === 'string') { out.push(o); return; }
    if (Array.isArray(o)) { o.forEach(function (x) { pull(x, out); }); return; }
    if (typeof o === 'object') {
      if (o.fulfillment_result) return pull(o.fulfillment_result, out);
      var ks = ['accounts', 'credentials', 'keys', 'logs', 'details', 'items', 'delivery', 'deliveries'];
      for (var i = 0; i < ks.length; i++) { if (Array.isArray(o[ks[i]]) && o[ks[i]].length) return pull(o[ks[i]], out); }
    }
  }
  window.msCredText = function (text) {
    var t = String(text == null ? '' : text).trim();
    if (t.charAt(0) === '{' || t.charAt(0) === '[') {
      try { var out = []; pull(JSON.parse(t), out); if (out.length) return out.join('\n'); } catch (e) {}
    }
    // old orders can hold several JSON objects, one per line
    if (t.indexOf('"fulfillment_result"') > -1 && t.indexOf('\n') > -1) {
      var all = [], ok = true;
      t.split(/\r?\n/).forEach(function (l) { l = l.trim(); if (!l) return; try { pull(JSON.parse(l), all); } catch (e) { ok = false; } });
      if (ok && all.length) return all.join('\n');
    }
    return String(text == null ? '' : text);
  };
  window.msCredHTML = function (text) {
    var lines = window.msCredText(text).split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length || lines.length > 25) return '';
    var lab = labelled(lines);
    if (lab) return '<div class="mscred"><div class="mscred-acc">' + lab.map(function (r) { return row(r[0], r[1], r[2] ? '2fa' : 'text'); }).join('') + '</div></div>';
    var recs = [], any = false;
    for (var n = 0; n < lines.length; n++) {
      if (lines[n].length > 3000) return '';
      var p = split(lines[n]);
      if (p) { p = p.map(function (x) { return x.trim(); }).filter(Boolean); }
      if (p && p.length >= 2) any = true; else p = [lines[n]];
      recs.push(p);
    }
    if (!any) return '';
    var html = '<div class="mscred">';
    recs.forEach(function (p, r) {
      html += '<div class="mscred-acc">' + (recs.length > 1 ? '<div class="mscred-h">Account ' + (r + 1) + '</div>' : '');
      p.forEach(function (v, i) {
        var l = p.length === 1 ? ['Details', 'text'] : label(v, i);
        html += row(l[0], v, l[1]);
      });
      html += '</div>';
    });
    return html + '</div>';
  };
  if (!document.getElementById('mscredStyle')) {
    var st = document.createElement('style'); st.id = 'mscredStyle';
    st.textContent =
      '.mscred{display:flex;flex-direction:column;gap:12px;margin-bottom:10px}' +
      '.mscred-acc{border:1px solid var(--border,#2e2e42);border-radius:12px;padding:6px 12px;background:rgba(127,127,127,.06)}' +
      '.mscred-h{font-weight:800;font-size:13px;padding:8px 0 4px;color:var(--accent,#c9a227)}' +
      '.mscred-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(127,127,127,.18)}' +
      '.mscred-row:last-child{border-bottom:none}' +
      '.mscred-l{flex:0 0 78px;font-size:12px;font-weight:700;opacity:.7}' +
      '.mscred-v{flex:1;min-width:0;word-break:break-all;font-size:14px}' +
      '.mscred-v code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13.5px;white-space:pre-wrap}' +
      '.mscred-c{flex:0 0 auto;border:1px solid var(--border,#2e2e42);background:transparent;color:inherit;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer}' +
      '.mscred-c.ok{background:#25D366;color:#0a0a14;border-color:#25D366}';
    document.head.appendChild(st);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.mscred-c'); if (!b) return;
    var v = b.getAttribute('data-copy') || '';
    function done() { var o = b.textContent; b.textContent = 'Copied'; b.classList.add('ok'); setTimeout(function () { b.textContent = 'Copy'; b.classList.remove('ok'); }, 1400); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, function () {});
    else { var t = document.createElement('textarea'); t.value = v; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (x) {} t.remove(); }
  });
})();
