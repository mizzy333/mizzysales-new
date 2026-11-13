// ══════════════════════ MARKETPLACE FOUR PAGE ══════════════════════
// Categories first; products load only after a category is opened (keeps phones fast).
// Loaded after script.js — reuses req(), esc(), P(), showToast(), skeletons().

let m4Items = [], m4Cats = [];
let m4Q = '', m4SortBy = 'default', m4Cat = '';

const M4_ICON = { 'Facebook': '📘', 'TikTok': '🎵', 'Instagram': '📸', 'VPN': '🔒', 'Snapchat': '👻', 'LinkedIn': '💼', 'Gmail': '✉️', 'Twitter': '🐦',
  'Pinterest': '📌', 'Texting Numbers': '📱', 'Telegram': '✈️', 'Discord': '🎮', 'Dating Apps': '💕', 'Gemini': '✨', 'Netflix': '🎬', 'Spotify': '🎧', 'TextNow': '💬', 'Text Plus': '➕', 'Mail': '📧', 'Google Voice': '📞', 'Proxy': '🌐' };

function m4Maintenance(msg) {
  ['m4Bar', 'm4Toolbar', 'mktResultCount'].forEach(id => document.getElementById(id)?.remove());
  const grid = document.getElementById('marketGrid');
  if (grid) grid.innerHTML = '<div class="no-items" style="grid-column:1/-1;padding:50px 20px"><div style="font-size:40px">🛠️</div>' +
    '<h3 style="margin:10px 0">Under maintenance</h3><p>' + esc(msg || 'Marketplace Four is under maintenance. Please check back shortly.') + '</p></div>';
}

async function initMarket4() {
  const grid = document.getElementById('marketGrid');
  if (!grid) return;
  m4Cat = '';
  document.getElementById('m4Bar').style.display = 'none';
  document.getElementById('m4Toolbar').style.display = 'none';
  document.getElementById('mktResultCount').textContent = '';
  grid.innerHTML = skeletons(6);
  try { m4Cats = await req('/api/market4/categories', 'GET', null, false); }
  catch (e) {
    if (e.maintenance) return m4Maintenance(e.message);
    grid.innerHTML = `<div class="no-items">${esc(e.message)}<br/><button class="btn-secondary" style="margin-top:10px" onclick="initMarket4()">Retry</button></div>`;
    return;
  }
  grid.innerHTML = m4Cats.map(c => {
    const ok = c.inStock > 0;
    return `<div class="prod-card-wrap"><div class="prod-card" style="${ok ? 'cursor:pointer' : 'opacity:.55;cursor:not-allowed'}" ${ok ? `onclick="m4OpenCat('${esc(c.name).replace(/'/g, "\\'")}')"` : ''}>
    <div class="prod-body" style="text-align:center;padding:22px 14px">
      <div style="font-size:42px;line-height:1">${M4_ICON[c.name] || '📦'}</div>
      <div class="prod-title" style="margin-top:10px">${esc(c.name)}</div>
      <div class="prod-desc">${ok ? c.inStock + ' product' + (c.inStock === 1 ? '' : 's') + ' in stock' : '<span style="color:var(--red)">Out of stock</span>'}</div>
      ${c.minPrice ? `<div class="prod-price" style="margin-top:6px">From ${P(c.minPrice)}</div>` : ''}
    </div></div></div>`;
  }).join('');
}

async function m4OpenCat(cat) {
  m4Cat = cat; m4Q = ''; m4SortBy = 'default';
  document.getElementById('mktSearchInput').value = '';
  document.getElementById('mktSortSelect').value = 'default';
  document.getElementById('m4Title').textContent = cat;
  document.getElementById('m4Bar').style.display = 'flex';
  document.getElementById('m4Toolbar').style.display = '';
  const grid = document.getElementById('marketGrid');
  grid.innerHTML = skeletons(6);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  try { m4Items = await req('/api/market4/products?category=' + encodeURIComponent(cat), 'GET', null, false); }
  catch (e) {
    if (e.maintenance) return m4Maintenance(e.message);
    grid.innerHTML = `<div class="no-items">${esc(e.message)}<br/><button class="btn-secondary" style="margin-top:10px" onclick="m4OpenCat('${esc(cat).replace(/'/g, "\\'")}')">Retry</button></div>`;
    return;
  }
  m4Apply();
}
function m4Back() { m4Items = []; initMarket4(); }

function onMktSearchInput() { m4Q = document.getElementById('mktSearchInput').value.trim().toLowerCase(); m4Apply(); }
function onMktSortChange() { m4SortBy = document.getElementById('mktSortSelect').value; m4Apply(); }

function m4Card(item) {
  const out = !item.inStock;
  const imgHtml = item.picture
    ? `<div class="prod-img"><img src="${esc(item.picture)}" alt="${esc(item.title)}" loading="lazy" onerror="this.parentElement.outerHTML='<div class=\\'prod-img-ph\\'><svg class=\\'icon i-package\\' aria-hidden=\\'true\\'><use href=\\'#i-package\\'/></svg></div>'"/></div>`
    : `<div class="prod-img-ph"><svg class="icon i-package" aria-hidden="true"><use href="#i-package"/></svg></div>`;

  return `<div class="prod-card-wrap"><div class="prod-card">
    <div class="prod-badge">${esc(item.category)}</div>
    ${imgHtml}
    <div class="prod-body">
      <div class="prod-cat">${esc(item.category)}</div>
      <div class="prod-title">${esc(item.title)}</div>
      <div class="prod-desc" style="white-space:pre-line;max-height:72px;overflow:hidden;text-overflow:ellipsis">${esc(item.description || 'Instant delivery after purchase.')}</div>
      <div class="prod-footer">
        <div class="prod-price">${out ? '<span style="color:var(--red)">Sold Out</span>' : P(item.price)}</div>
        <div class="prod-meta"><div class="prod-qty" style="color:${out ? 'var(--red)' : 'var(--green,#2ecc71)'}">${out ? 'Sold Out' : item.stock + ' available'}</div></div>
      </div>
      <button class="prod-select-btn" ${out ? 'disabled style="opacity:.5;cursor:not-allowed"' : ''} onclick="m4Open(${item.id})">${out ? 'Sold Out' : '<svg class="icon i-cart" aria-hidden="true"><use href="#i-cart"/></svg> Buy Now'}</button>
    </div></div></div>`;
}

const M4_PAGE = 24;
let m4Shown = M4_PAGE;
function m4Apply(reset) {
  if (reset !== false) m4Shown = M4_PAGE;
  let items = m4Items.slice();
  if (m4Q) items = items.filter(i => `${i.title} ${i.description}`.toLowerCase().includes(m4Q));
  if (m4SortBy === 'price-asc') items.sort((a, b) => a.price - b.price);
  else if (m4SortBy === 'price-desc') items.sort((a, b) => b.price - a.price);
  items.sort((a, b) => Number(b.inStock) - Number(a.inStock));
  const part = items.slice(0, m4Shown);
  const more = items.length > part.length
    ? `<div style="grid-column:1/-1;text-align:center"><button class="btn-secondary" onclick="m4Shown+=M4_PAGE;m4Apply(false)">Show more (${items.length - part.length} left)</button></div>` : '';
  document.getElementById('marketGrid').innerHTML = (part.length ? part.map(m4Card).join('') : '<div class="no-items">No listings match your search</div>') + more;
  const c = document.getElementById('mktResultCount');
  if (c) c.textContent = `${items.length} listing${items.length === 1 ? '' : 's'} available`;
}

// ── Buy modal ──
function m4Open(id) {
  const item = m4Items.find(i => i.id === id);
  if (!item) return;
  const max = Math.min(item.stock, 100);
  document.getElementById('itemModal').classList.add('open');
  const imgHtml = item.picture ? `<img class="m-img" src="${esc(item.picture)}" alt="${esc(item.title)}" onerror="this.style.display='none'"/>` : '';
  document.getElementById('modalBody').innerHTML = `${imgHtml}<div style="padding:22px">
    <div class="prod-cat">${esc(item.category)}</div>
    <h2 style="margin:6px 0 8px">${esc(item.title)}</h2>
    <p style="color:var(--t2);margin:0 0 14px;white-space:pre-line">${esc(item.description || 'Instant delivery after purchase.')}</p>
    <p style="margin:0 0 6px"><b>${P(item.price)}</b> each · ${item.stock} available</p>
    <label style="display:block;font-size:13px;color:var(--t2);margin:12px 0 6px">Quantity</label>
    <input type="number" id="m4Qty" class="input-field" min="1" max="${max}" value="1" oninput="m4Total(${item.price})" style="width:100%"/>
    <p id="m4TotalTxt" style="margin:10px 0 14px">Total: <b>${P(item.price)}</b></p>
    <button class="prod-select-btn" id="m4BuyBtn" onclick="m4Buy(${item.id})"><svg class="icon i-cart" aria-hidden="true"><use href="#i-cart"/></svg> Buy Now</button>
    <div id="m4Result"></div>
  </div>`;
}
function m4Total(price) {
  const q = Math.max(1, parseInt(document.getElementById('m4Qty').value, 10) || 1);
  document.getElementById('m4TotalTxt').innerHTML = `Total: <b>${P(price * q)}</b>`;
}
let m4Ref = {};
async function m4Buy(id) {
  if (typeof token === 'undefined' || !token) { showToast('Please log in to buy', 'err'); setTimeout(() => { window.location.href = '/login'; }, 800); return; }
  const btn = document.getElementById('m4BuyBtn');
  const quantity = Math.max(1, parseInt(document.getElementById('m4Qty').value, 10) || 1);
  const key = id + ':' + quantity;
  // One reference per purchase attempt: a double-tap or retry can never charge twice.
  const ref = m4Ref[key] || (m4Ref[key] = 'm4' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  btn.disabled = true; btn.textContent = 'Processing…';
  const showKeys = (r) => {
    const keys = (r.keys || []).map(k => typeof k === 'string' ? k : JSON.stringify(k)).join('\n');
    const keysClean = window.msCredText ? window.msCredText(keys) : keys;
    document.getElementById('m4Result').innerHTML = `<div class="pc-details-wrap" style="margin-top:16px">
      <p style="color:var(--green,#2ecc71);font-weight:700;margin:0 0 8px">Purchase successful — ${P(r.amountPaid)}</p>
      ${r.partial ? '<p style="color:var(--red)">Only part of your order was available. The difference was refunded.</p>' : ''}
      ${r.providerOrderId ? `<div class="pc-oid"><span>Provider Order ID</span><code id="m4Oid">${esc(r.providerOrderId)}</code><button type="button" class="pc-oid-copy" onclick="navigator.clipboard.writeText(document.getElementById('m4Oid').textContent);showToast('Order ID copied','ok')">Copy</button></div>` : ''}
      ${(window.msCredHTML && window.msCredHTML(keysClean)) || ''}
      <pre id="m4Keys" class="pc-details"${(window.msCredHTML && window.msCredHTML(keysClean)) ? ' style="display:none"' : ''}>${esc(keysClean || 'Delivered')}</pre>
      <button class="copy-details-btn" onclick="navigator.clipboard.writeText(document.getElementById('m4Keys').textContent);showToast('Copied','ok')">Copy Details</button>
      <p style="font-size:12px;color:var(--t2);margin-top:8px">You can view this again anytime in <a href="/purchases">My Purchases</a>.</p></div>`;
    btn.style.display = 'none';
    showToast('Purchase successful', 'ok');
    if (typeof updateNav === 'function') try { updateNav(); } catch (e) {}
    const it = m4Items.find(i => i.id === id); if (it) { it.stock = Math.max(0, it.stock - quantity); it.inStock = it.stock > 0; m4Apply(false); }
    delete m4Ref[key];
  };
  try {
    const r = await req('/api/market4/buy', 'POST', { productId: id, quantity, clientRef: ref }, true);
    if (r && r.pending) {
      document.getElementById('m4Result').innerHTML = `<p style="margin-top:14px">${esc(r.message || 'Order received. Your credentials will appear in My Purchases shortly. Please do not buy again.')}</p>`;
      btn.style.display = 'none'; return;
    }
    showKeys(r);
  } catch (e) {
    if (e.maintenance) { document.getElementById('itemModal').classList.remove('open'); return m4Maintenance(e.message); }
    if (/network|failed to fetch|timeout|connection/i.test(e.message || '')) {
      // The request may have gone through — look the order up by its reference before telling the customer anything.
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const list = await req('/api/market4/orders?ref=' + encodeURIComponent(ref), 'GET', null, true), o = Array.isArray(list) ? list[0] : null;
          if (o && (o.status === 'delivered' || o.status === 'partial') && o.keys && o.keys.length) return showKeys({ keys: o.keys, amountPaid: o.amountPaid, partial: o.status === 'partial' });
          if (o && (o.status === 'failed' || o.status === 'refunded')) { delete m4Ref[key]; showToast('This order did not go through. Nothing was charged.', 'err'); btn.disabled = false; btn.textContent = 'Buy Now'; return; }
        } catch (e2) {}
      }
      document.getElementById('m4Result').innerHTML = '<p style="margin-top:14px">Connection problem. Check <a href="/purchases">My Purchases</a> before trying again — your order may have gone through.</p>';
      btn.style.display = 'none'; return;
    }
    delete m4Ref[key];
    showToast(e.message, 'err');
    btn.disabled = false; btn.innerHTML = '<svg class="icon i-cart" aria-hidden="true"><use href="#i-cart"/></svg> Buy Now';
  }
}
