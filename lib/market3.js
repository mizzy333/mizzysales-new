// ── Marketplace 3 (Benotp Buy Accounts API) ─────────────────────────────────
// Resells account products from https://benotp.com/stubs/buy-accounts.php
//   GET  ?action=getProducts&api_key=KEY
//   POST action=buyProduct&api_key=KEY&id=PRODUCT_ID&amount=QTY   (form-encoded)
//
// Set in .env (or your host's environment variables, e.g. Render):
//   BENOTP_API_KEY=your_benotp_api_key
//   BENOTP_BASE_URL=https://benotp.com/stubs/buy-accounts.php   (optional, default)
//
// Customers pay YOUR price (set in Admin → Logs 3); the product cost comes from Benotp.
// The wallet is debited first, refunded automatically if Benotp fails the order.
const axios = require('axios');

function register(app, deps) {
  const { mongoose, User, Transaction, auth, anyAdminAuth, sendAdminEmail } = deps;
  const { resolveLogPicture } = require('./market2');

  const baseUrl = () => String(process.env.BENOTP_BASE_URL || 'https://benotp.com/stubs/buy-accounts.php').trim();
  const apiKey = () => String(process.env.BENOTP_API_KEY || '').trim();

  // ── Models ────────────────────────────────────────────────────────────────
  const cfgSchema = new mongoose.Schema({
    key: { type: String, default: 'main', unique: true },
    market3Enabled: { type: Boolean, default: true },
    maintenanceMessage: { type: String, default: 'Marketplace 3 is under maintenance. Please check back shortly.' },
    lowBalanceNgn: { type: Number, default: 5000 },
    defaultMarkupPercent: { type: Number, default: null },   // null = no default: unpriced products stay hidden
    alertEmail: { type: String, default: '' },
    lastBalance: { type: Number, default: 0 },
    lastBalanceAt: { type: Date, default: null },
    lastBalanceError: { type: String, default: '' },
    lastAlertAt: { type: Date, default: null },
    lastBuyError: { type: String, default: '' },
    lastBuyErrorAt: { type: Date, default: null }
  });
  const Market3Config = mongoose.models.Market3Config || mongoose.model('Market3Config', cfgSchema);

  const priceSchema = new mongoose.Schema({
    productId: { type: Number, unique: true, required: true },
    sellPrice: { type: Number, default: 0 },   // 0 = hidden from users
    enabled: { type: Boolean, default: true },
    customTitle: { type: String, default: '' },
    description: { type: String, default: '' },
    picture: { type: String, default: '' },
    updatedAt: { type: Date, default: Date.now }
  });
  // New collection for Benotp: old Sujan product ids must never be matched to Benotp products.
  const Market3Price = mongoose.models.Market3BenotpPrice || mongoose.model('Market3BenotpPrice', priceSchema, 'market3_benotp_prices');

  const orderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    userEmail: String,
    productId: Number,
    productName: String,
    quantity: Number,
    sellTotal: Number,
    costTotal: Number,
    profit: Number,
    supplierOrderId: String,
    keys: [String],
    createdAt: { type: Date, default: Date.now }
  });
  const Market3Order = mongoose.models.Market3Order || mongoose.model('Market3Order', orderSchema);

  async function getCfg() {
    let c = await Market3Config.findOne({ key: 'main' });
    if (!c) c = await Market3Config.create({ key: 'main' });
    return c;
  }

  // ── API client ────────────────────────────────────────────────────────────
  async function benotp(action, form) {
    if (!apiKey()) {
      const e = new Error('Marketplace 3 is not connected yet (BENOTP_API_KEY missing).');
      e.status = 503; throw e;
    }
    let body;
    try {
      const r = form
        ? await axios.post(baseUrl(), new URLSearchParams({ action, api_key: apiKey(), ...form }).toString(),
            { timeout: 30000, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } })
        : await axios.get(baseUrl(), { params: { action, api_key: apiKey() }, timeout: 30000, headers: { Accept: 'application/json' } });
      body = r.data;
    } catch (err) {
      const status = err.response?.status || 502;
      const b = err.response?.data || {};
      const e = new Error((typeof b === 'object' && (b.message || b.error)) || err.message || 'Supplier request failed');
      e.status = status; throw e;
    }
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    // Benotp answers { status: 'success' | 'error', message?, data?, order_id? }
    const st = String(body?.status ?? '').toLowerCase();
    if (st && !['success', 'ok', 'true', '1'].includes(st)) {
      const m = txt(body.message || body.error);
      // A bare code like "1" means nothing to a customer: show a clear sentence and keep the raw reply for the admin.
      const e = new Error(m.length >= 4 && !/^[\d\s.\-]+$/.test(m) ? m : 'The supplier could not complete this order right now (it may be out of stock). Please try again shortly or pick another product.');
      e.status = 400; e.raw = JSON.stringify(body).slice(0, 600); throw e;
    }
    return body;
  }

  const txt = v => (v == null ? '' : String(v)).trim();

  // Benotp's getProducts reply has NO stock field (only id, name, price, amount, min, max...).
  // "amount" is the pack size, not stock. So we only report a stock number when the supplier
  // really sends one; otherwise stock is null ("available, count not provided") and we never
  // show a made-up figure. Benotp rejects an order it cannot fill and the customer is refunded.
  function stockValue(v) {
    if (v == null || v === '' || typeof v === 'object') return null;
    if (typeof v === 'boolean') return v ? 'yes' : 0;
    const t = String(v).trim();
    if (/\d/.test(t)) { const n = Number(t.replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? Math.max(0, n) : null; }
    if (/^(out|sold|no|false|none|unavailable)/i.test(t)) return 0;
    if (/^(in ?stock|yes|true|available)/i.test(t)) return 'yes';
    return null;
  }
  function pickStock(p) {
    const pref = ['stock', 'available_stock', 'available', 'quantity', 'qty', 'in_stock', 'instock', 'stock_count', 'remaining', 'left', 'count', 'total_stock'];
    const keys = [...pref, ...Object.keys(p).filter(k => !pref.includes(k) && /stock|qty|quantit|avail|remain|left/i.test(k))];
    for (const k of keys) {
      const n = stockValue(p[k]);
      if (n === 'yes') return null;       // available, but no count given
      if (n !== null) return n;
    }
    return null;                           // supplier gives no stock info at all
  }

  // Supplier ids are usually numbers, but some rows use other id keys or text like "123".
  function pickId(p) {
    for (const k of ['id', 'product_id', 'productId', 'pid', 'item_id', 'service_id']) {
      if (p[k] == null || p[k] === '') continue;
      const n = Number(String(p[k]).replace(/[^0-9]/g, ''));
      if (Number.isFinite(n) && n > 0) return n;
    }
    return NaN;
  }
  function pickCost(p) {
    for (const k of ['price', 'cost', 'amount', 'rate', 'unit_price', 'price_per_unit', 'cost_price', 'sell_price']) {
      if (p[k] == null || p[k] === '') continue;
      const n = Number(String(p[k]).replace(/[^0-9.]/g, ''));
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  }
  function normaliseProduct(p) {
    const stock = pickStock(p);
    return {
      id: pickId(p),
      name: txt(p.name || p.title || p.product_name || p.product || p.service) || 'Account',
      category: txt(p.category_name || p.category?.name || p.category || p.platform) || 'Other',
      cost: pickCost(p),
      stock,   // number, or null when the supplier does not report stock
      minQty: Math.max(1, parseInt(p.min, 10) || 1),
      maxQty: Math.max(1, Math.min(100, parseInt(p.max, 10) || 100)),
      apiDesc: txt(p.description || p.details || p.notes),
      apiPic: txt(p.image || p.image_url || p.picture || p.icon || p.logo || p.thumbnail),
      active: p.is_active !== false && p.active !== false && p.status !== 'inactive',
      raw: p
    };
  }

  // Finds the product rows wherever Benotp puts them: a plain list, { data: [...] },
  // { products: [...] }, products grouped under categories, or an object keyed by product id.
  function extractRows(node, cat, out, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 6) return out;
    const looksLikeProduct = o => o && typeof o === 'object' && !Array.isArray(o) &&
      (o.name || o.title || o.product_name || o.product || o.service) &&
      (o.price != null || o.cost != null || o.amount != null || o.rate != null || o.unit_price != null || o.price_per_unit != null || o.cost_price != null || o.sell_price != null);
    if (Array.isArray(node)) {
      node.forEach(i => {
        if (looksLikeProduct(i)) out.push(cat && !i.category && !i.category_name ? { ...i, category: cat } : i);
        else extractRows(i, cat, out, depth + 1);
      });
      return out;
    }
    const here = txt(node.category_name || node.category || node.name || node.title);
    // A category object ({ id, name, products: [...] }) names the products inside it.
    const isCategoryObj = !!(node.category_name || (node.name && node.id != null));
    for (const [k, v] of Object.entries(node)) {
      if (!v || typeof v !== 'object') continue;
      if (looksLikeProduct(v)) out.push({ id: k, ...(cat ? { category: cat } : {}), ...v });
      else extractRows(v, here && (isCategoryObj || !['data', 'products', 'items', 'result'].includes(k)) ? here : cat, out, depth + 1);
    }
    return out;
  }

  // Product list cached 60s so the shop page is fast.
  let cache = { at: 0, products: [] };
  async function loadCatalogue(force) {
    if (!force && Date.now() - cache.at < 60 * 1000 && cache.products.length) return cache;
    const body = await benotp('getProducts');
    const rows = extractRows(body, '', []);
    if (!rows.length) {
      let snip = ''; try { snip = JSON.stringify(body); } catch {}
      const e = new Error('Benotp returned no products I could read. Their reply was: ' + snip.slice(0, 400));
      e.status = 502; throw e;
    }
    const all = rows.map(normaliseProduct);
    const dropped = all.filter(p => !p.id).map(p => ({ name: p.name, category: p.category, raw: p.raw }));
    cache = { at: Date.now(), products: all.filter(p => p.id), dropped, rowsRead: rows.length, body };
    return cache;
  }

  // Effective selling price:
  //   custom price (admin typed one)  → used, but never below the provider price
  //   else default markup % (if set)  → provider price + %
  //   else                            → 0 (hidden from customers)
  const floorOf = cost => Math.ceil(Number(cost) || 0);
  async function mergedProducts(force) {
    const { products } = await loadCatalogue(force);
    const prices = await Market3Price.find({}).lean();
    const cfg = await getCfg();
    const pct = cfg.defaultMarkupPercent;
    const hasDefault = pct !== null && pct !== undefined && Number.isFinite(Number(pct)) && Number(pct) >= 0;
    const byId = new Map(prices.map(p => [Number(p.productId), p]));
    return products.map(p => {
      const o = byId.get(p.id) || {};
      const floor = floorOf(p.cost);
      const custom = Number(o.sellPrice) || 0;
      let sell = 0, usingDefault = false;
      if (custom > 0) sell = Math.max(custom, floor);
      else if (hasDefault && p.cost > 0) { sell = Math.max(floor, Math.ceil(p.cost * (1 + Number(pct) / 100))); usingDefault = true; }
      const description = p.apiDesc || (o.description || '').trim();
      const picture = resolveLogPicture(p.category, p.name, p.apiPic, o.picture);
      return {
        id: p.id, name: p.name, customTitle: o.customTitle || '', description, picture, apiPicture: p.apiPic,
        category: p.category, cost: p.cost, floorPrice: floor, sellPrice: sell, customPrice: custom, usingDefault,
        profit: sell ? sell - p.cost : 0,
        stock: p.stock, minQty: p.minQty, maxQty: p.maxQty,
        inStock: p.active && (p.stock === null || p.stock > 0),
        enabled: o.enabled !== false, priced: sell > 0, raw: p.raw
      };
    });
  }

  // ── Balance ───────────────────────────────────────────────────────────────
  // Benotp's Buy Accounts API has no documented balance call, so there is no auto-monitor.
  // Check your Benotp balance on benotp.com. If Benotp can't fill an order, the customer is
  // refunded automatically (see /api/market3/buy).
  async function checkBalance() {
    const e = new Error('Benotp does not provide a balance check through the accounts API. Check your balance on benotp.com.');
    e.status = 501; throw e;
  }

  // ── Public ────────────────────────────────────────────────────────────────
  app.get('/api/market3/status', async (req, res) => {
    try { const c = await getCfg(); res.json({ market3Enabled: c.market3Enabled, maintenanceMessage: c.maintenanceMessage }); }
    catch (e) { res.json({ market3Enabled: true, maintenanceMessage: '' }); }
  });

  app.get('/api/market3/products', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const c = await getCfg();
      if (!c.market3Enabled) return res.status(503).json({ error: c.maintenanceMessage, maintenance: true });
      const list = (await mergedProducts(false))
        .filter(p => p.priced && p.enabled)
        .map(p => ({ id: p.id, title: p.customTitle || p.name, description: p.description, picture: p.picture,
          category: p.category, price: p.sellPrice, stock: p.stock, minQty: p.minQty, maxQty: p.maxQty, inStock: p.inStock }));
      res.json(app.locals.applyLogoRules ? await app.locals.applyLogoRules(list, 'title', 'm3') : list);
    } catch (e) { res.status(e.status === 503 ? 503 : 502).json({ error: 'Could not load Marketplace 3 right now. Please try again.' }); }
  });

  const toKeyText = (k) => {
    if (k == null) return '';
    if (typeof k === 'string') return k;
    if (typeof k !== 'object') return String(k);
    const v = k.credential ?? k.key ?? k.details ?? k.value ?? k.data;
    if (typeof v === 'string' && v.trim()) return v;
    try { return JSON.stringify(k); } catch { return ''; }
  };

  app.post('/api/market3/buy', auth, async (req, res) => {
    try {
      const c = await getCfg();
      if (!c.market3Enabled) return res.status(503).json({ error: c.maintenanceMessage, maintenance: true });
      const productId = parseInt(req.body?.productId, 10);
      let quantity = Math.max(1, Math.min(100, parseInt(req.body?.quantity, 10) || 1));
      if (!productId) return res.status(400).json({ error: 'Pick a product first.' });

      const product = (await mergedProducts(true)).find(p => p.id === productId);
      if (!product || !product.priced || !product.enabled) return res.status(404).json({ error: 'This product is not available.' });
      if (!product.inStock) return res.status(409).json({ error: 'This product is out of stock.' });
      if (product.stock !== null && product.stock < quantity) return res.status(409).json({ error: `Only ${product.stock} left in stock.` });
      if (quantity < product.minQty) return res.status(400).json({ error: `Minimum order for this product is ${product.minQty}.` });
      if (quantity > product.maxQty) return res.status(400).json({ error: `Maximum order for this product is ${product.maxQty}.` });
      if (product.sellPrice < product.cost) return res.status(400).json({ error: 'This product is temporarily unavailable.' });

      const total = product.sellPrice * quantity;
      // Atomic debit so two taps can never double-spend.
      const user = await User.findOneAndUpdate(
        { _id: req.user._id, balance: { $gte: total } },
        { $inc: { balance: -total } }, { new: true });
      if (!user) return res.status(400).json({ error: 'Insufficient balance. Please deposit funds.' });

      let order;
      try {
        order = await benotp('buyProduct', { id: String(productId), amount: String(quantity) });
      } catch (e) {
        await User.updateOne({ _id: user._id }, { $inc: { balance: total } }); // refund
        // Keep what the supplier really said so the admin can see why it failed (Render/server logs + config).
        console.error('[market3] Benotp buyProduct failed for product', productId, 'qty', quantity, '->', e.raw || e.message);
        try { await Market3Config.updateOne({ key: 'main' }, { $set: { lastBuyError: `#${productId} x${quantity}: ${e.raw || e.message}`.slice(0, 700), lastBuyErrorAt: new Date() } }); } catch (_) {}
        return res.status(400).json({ error: `${e.message} Nothing was charged.` });
      }

      // Benotp returns the account details in `data` (array, text or object).
      const d = order.data ?? order.accounts ?? order.items;
      const keys = (Array.isArray(d) ? d : (d == null || d === '' ? [] : [d]))
        .flatMap(i => typeof i === 'string' ? i.split(/\r?\n/) : [toKeyText(i)])
        .map(x => x.trim()).filter(Boolean);
      if (!keys.length) {
        await User.updateOne({ _id: user._id }, { $inc: { balance: total } });
        return res.status(400).json({ error: 'The supplier could not fulfil this order. Nothing was charged.' });
      }
      const cost = product.cost * quantity;
      const title = `${product.customTitle || product.name}${quantity > 1 ? ` ×${quantity}` : ''}`;

      await User.updateOne({ _id: user._id }, { $push: { purchaseDetails: {
        logTitle: `[Marketplace 3] ${title}`, logType: 'log', source: 'market3',
        logDetails: keys.join('\n') || 'Order placed — contact support if details do not arrive shortly.',
        providerOrderId: String(order.order_id || order.id || ''),
        pricePaid: total, purchasedAt: new Date()
      } } });
      await Transaction.create({ userId: user._id, type: 'purchase', amount: total, description: `Bought ${title} — Marketplace 3`, status: 'success' });
      await Market3Order.create({ userId: user._id, userEmail: user.email, productId, productName: product.name, quantity,
        sellTotal: total, costTotal: cost, profit: total - cost, supplierOrderId: String(order.order_id || order.id || ''), keys });
      cache.at = 0;
      res.json({ ok: true, title, quantity, amountPaid: total, keys, providerOrderId: String(order.order_id || order.id || ''), balance: user.balance });
    } catch (e) { res.status(500).json({ error: 'Purchase failed: ' + e.message }); }
  });

  // ── Admin ─────────────────────────────────────────────────────────────────
  app.get('/api/admin/market3/config', anyAdminAuth, async (req, res) => {
    const c = await getCfg();
    res.json({ ...c.toObject(), apiConnected: !!apiKey(), baseUrl: baseUrl() });
  });
  app.put('/api/admin/market3/config', anyAdminAuth, async (req, res) => {
    const c = await getCfg(); const b = req.body || {};
    if (typeof b.market3Enabled === 'boolean') c.market3Enabled = b.market3Enabled;
    if (typeof b.maintenanceMessage === 'string') c.maintenanceMessage = b.maintenanceMessage.slice(0, 300);
    if (b.lowBalanceNgn !== undefined && Number(b.lowBalanceNgn) >= 0) c.lowBalanceNgn = Number(b.lowBalanceNgn);
    if (typeof b.alertEmail === 'string') c.alertEmail = b.alertEmail.trim().slice(0, 200);
    if (b.defaultMarkupPercent !== undefined) {
      if (b.defaultMarkupPercent === null || b.defaultMarkupPercent === '') c.defaultMarkupPercent = null;
      else {
        const n = Number(b.defaultMarkupPercent);
        if (!Number.isFinite(n) || n < 0 || n > 10000) return res.status(400).json({ error: 'Default markup must be 0% or more.' });
        c.defaultMarkupPercent = n;
      }
    }
    await c.save();
    res.json({ ok: true });
  });
  app.get('/api/admin/market3/products', anyAdminAuth, async (req, res) => {
    try { res.json(await mergedProducts(req.query.refresh === '1')); }
    catch (e) { res.status(e.status || 502).json({ error: e.message }); }
  });
  // "Find missing product": shows what the supplier really sent for a word like "proxy" and why it is (not) on the shop.
  app.get('/api/admin/market3/diagnose', anyAdminAuth, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim().toLowerCase();
      if (!q) return res.status(400).json({ error: 'Type a word to look for, e.g. proxy.' });
      const merged = await mergedProducts(true);
      const c = cache;
      const hit = p => JSON.stringify(p.raw || p).toLowerCase().includes(q);
      const found = merged.filter(hit).map(p => ({
        id: p.id, name: p.name, category: p.category, supplierPrice: p.cost, yourPrice: p.sellPrice,
        priced: p.priced, shownToCustomers: p.priced && p.enabled, enabled: p.enabled, inStock: p.inStock,
        why: !p.priced ? (p.cost > 0 ? 'No price set by you yet (set a price or a default markup %).' : 'Supplier price is 0/unknown - set your own price.') : !p.enabled ? 'You switched it off (Show box).' : !p.inStock ? 'Marked out of stock by the supplier.' : 'Should be visible.'
      }));
      const droppedHit = (c.dropped || []).filter(d => JSON.stringify(d.raw).toLowerCase().includes(q)).map(d => ({ name: d.name, category: d.category, why: 'Skipped: no usable product id in the supplier row.', raw: d.raw }));
      let anywhere = 0; try { anywhere = (JSON.stringify(c.body || '').toLowerCase().split(q).length - 1); } catch (_) {}
      res.json({ query: q, supplierRowsRead: c.rowsRead || 0, productsKept: merged.length, mentionsInSupplierReply: anywhere, found, skippedRows: droppedHit });
    } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
  });
  app.put('/api/admin/market3/products/:id', anyAdminAuth, async (req, res) => {
    const productId = parseInt(req.params.id, 10);
    if (!productId) return res.status(400).json({ error: 'Bad product id' });
    const b = req.body || {}; const set = { updatedAt: new Date() };
    if (b.sellPrice !== undefined) {
      const n = Number(b.sellPrice);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'Price must be ₦0 or more (0 hides it).' });
      if (n > 0) {
        try {
          const cp = (await loadCatalogue(false)).products.find(x => x.id === productId);
          if (cp && n < floorOf(cp.cost)) return res.status(400).json({ error: `Price cannot be below the provider price (₦${floorOf(cp.cost).toLocaleString('en-NG')}).` });
        } catch (e) { /* provider unreachable: the live price is still clamped to the provider price */ }
      }
      set.sellPrice = n;
    }
    if (typeof b.enabled === 'boolean') set.enabled = b.enabled;
    if (typeof b.customTitle === 'string') set.customTitle = b.customTitle.slice(0, 150);
    if (typeof b.description === 'string') set.description = b.description.slice(0, 1000);
    if (typeof b.picture === 'string') set.picture = b.picture.trim().slice(0, 1000);
    await Market3Price.updateOne({ productId }, { $set: set }, { upsert: true });
    res.json({ ok: true });
  });
  // Bulk pricing: set | markup_percent | add | subtract | reset. Never goes below the provider price.
  app.post('/api/admin/market3/bulk-price', anyAdminAuth, async (req, res) => {
    try {
      const b = req.body || {}; const mode = String(b.mode || ''); const value = Number(b.value);
      if (!['set', 'markup_percent', 'add', 'subtract', 'reset'].includes(mode)) return res.status(400).json({ error: 'Unknown action.' });
      if (mode !== 'reset' && (b.value === '' || b.value == null || !Number.isFinite(value) || value < 0)) return res.status(400).json({ error: 'Enter a number of 0 or more.' });
      let list = await mergedProducts(true);
      if (b.category) list = list.filter(p => p.category === String(b.category));
      if (Array.isArray(b.ids) && b.ids.length) { const want = new Set(b.ids.map(Number)); list = list.filter(p => want.has(p.id)); }
      if (!list.length) return res.status(400).json({ error: 'No products to update.' });
      const ops = []; let clamped = 0;
      for (const p of list) {
        let price;
        if (mode === 'reset') price = 0;
        else {
          if (mode === 'set') price = value;
          else if (mode === 'markup_percent') price = p.cost * (1 + value / 100);
          else if (mode === 'add') price = (p.sellPrice || p.cost) + value;
          else price = (p.sellPrice || p.cost) - value;
          price = Math.ceil(price);
          if (price < p.floorPrice) { price = p.floorPrice; clamped++; }
        }
        ops.push({ updateOne: { filter: { productId: p.id }, update: { $set: { sellPrice: price, updatedAt: new Date() } }, upsert: true } });
      }
      await Market3Price.bulkWrite(ops);
      res.json({ ok: true, updated: ops.length, clamped });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.get('/api/admin/market3/balance', anyAdminAuth, async (req, res) => {
    try { res.json(await checkBalance()); } catch (e) { res.status(e.status === 501 ? 501 : 502).json({ error: e.message }); }
  });
  app.get('/api/admin/market3/orders', anyAdminAuth, async (req, res) => {
    const orders = await Market3Order.find({}).sort({ createdAt: -1 }).limit(200).select('-keys').lean();
    const agg = await Market3Order.aggregate([{ $group: { _id: null, sales: { $sum: '$sellTotal' }, cost: { $sum: '$costTotal' }, profit: { $sum: '$profit' }, count: { $sum: 1 } } }]);
    res.json({ orders, totals: agg[0] || { sales: 0, cost: 0, profit: 0, count: 0 } });
  });
}

module.exports = { register };
