// Boosting 1 — NovaSolution SMM provider. Credentials stay server-side (NOVA_API_KEY, or the
// NovaSolution key saved in Admin → Logs 4). Routes: /api/boost1/*  and  /api/admin/boost1/*
// (Boosting 2 = Really Simple Social lives in lib/boost.js under /api/boost).
const axios = require('axios');
const crypto = require('crypto');
const { sealRef, openRef } = require('./opaque-ref');
// Optional price-adjust hook: when the project has no lib/price-adjust.js, prices pass through unchanged.
let PA; try { PA = require('./price-adjust'); } catch { PA = { apply: (_k, v) => v }; }
module.exports = function registerNovaBoost1({ app, mongoose, User, Transaction, auth, anyAdminAuth, novaGate: injectedGate }) {
  // Polite spacing between provider calls (~1.2s) when the host app doesn't supply its own gate.
  let _gateNext = 0;
  const novaGate = typeof injectedGate === 'function' ? injectedGate : async () => {
    const now = Date.now(), at = Math.max(now, _gateNext); _gateNext = at + 1200;
    if (at > now) await new Promise(r => setTimeout(r, at - now));
  };
  // Service references are sealed with a key derived from JWT_SECRET (must be 32+ chars).
  const refSecret = () => { const j = String(process.env.JWT_SECRET || ''); return j.length >= 32 ? j : require('crypto').createHash('sha256').update('boost1:' + j + ':' + (process.env.ADMIN_PASSCODE || '')).digest('hex'); };
  const base = () => String(process.env.NOVA_BASE_URL || 'https://www.novasolution.ng/api/v1').replace(/\/+$/, '');
  const cleanKey = v => String(v || '').replace(/[\r\n\t]/g, '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/^bearer\s+/i, '').trim();
  // Render's NOVA_API_KEY wins; otherwise reuse the NovaSolution key saved in Admin → Marketplace 4.
  const key = () => cleanKey(process.env.NOVA_API_KEY) || cleanKey(app.locals && typeof app.locals.market4NovaKey === 'function' ? app.locals.market4NovaKey() : '');
  const serviceRef = itemId => sealRef('boost1-service', { itemId }, refSecret());
  function serviceIdFromRef(token) {
    const value = openRef('boost1-service', token, refSecret());
    const id = Number(value.itemId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid service reference.');
    return id;
  }
  const schema = new mongoose.Schema({ itemId: {type:Number,unique:true,index:true}, sellPrice:{type:Number,default:0}, markup:{type:Number,default:0}, mode:{type:String,enum:['specific','markup'],default:'markup'}, enabled:{type:Boolean,default:true}, visible:{type:Boolean,default:true}, updatedAt:{type:Date,default:Date.now} });
  const Price = mongoose.models.NovaBoost1Price || mongoose.model('NovaBoost1Price', schema);
  // ONE markup (₦ per rate unit, normally per 1,000) added to every service that has no markup / specific price of its own.
  const settingsSchema = new mongoose.Schema({ key:{type:String,unique:true}, globalMarkup:{type:Number,default:300}, enabled:{type:Boolean,default:true}, updatedAt:{type:Date,default:Date.now} });
  const Settings = mongoose.models.NovaBoost1Settings || mongoose.model('NovaBoost1Settings', settingsSchema);
  async function globalMarkup() { try { const d = await Settings.findOne({ key: 'main' }).lean(); return d ? Math.max(0, Number(d.globalMarkup) || 0) : 300; } catch { return 300; } }
  // Master ON/OFF switch for Boosting 1 (set in Admin > Boosting 1). When OFF, customers do not see
  // Boosting 1 and cannot place orders; their old order history stays viewable. Defaults to ON.
  let _onCache = null; const ON_MS = 10 * 1000;
  async function boostOn() {
    if (_onCache && Date.now() - _onCache.at < ON_MS) return _onCache.val;
    let val = true;
    try { const d = await Settings.findOne({ key: 'main' }).lean(); val = !(d && d.enabled === false); } catch { val = _onCache ? _onCache.val : true; }
    _onCache = { at: Date.now(), val };
    return val;
  }
  const OFF_MSG = 'Boosting 1 is temporarily unavailable. Please use Boosting 2 instead.';
  app.get('/api/boost1/status', async (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ enabled: await boostOn() }); });
  const ordersSchema = new mongoose.Schema({ userId:mongoose.Schema.Types.ObjectId, itemId:Number, itemName:String, quantity:Number, rateUnit:Number, link:String, clientRef:{type:String,unique:true,sparse:true}, providerOrder:String, idempotencyKey:{type:String,index:true}, status:String, reviewNote:String, txRecorded:{type:Boolean,default:false}, cost:Number, sellTotal:Number, createdAt:{type:Date,default:Date.now} });
  const Order = mongoose.models.NovaBoost1Order || mongoose.model('NovaBoost1Order', ordersSchema);
  async function api(method,path,data,params,extraHeaders={}) {
    if (!key()) { const e=new Error('Boosting 1 is not set up yet. Please contact the administrator.'); e.status=503; throw e; }
    if (typeof novaGate === 'function') await novaGate();
    const r=await axios({method,url:base()+path,data,params,timeout:30000,headers:{Authorization:`Bearer ${key()}`,Accept:'application/json','Content-Type':'application/json',...(method==='post'?{'Idempotency-Key':crypto.randomUUID()}:{}),...(extraHeaders||{})}});
    return r.data;
  }
  const unwrap = d => (d && d.data && typeof d.data === 'object' && !Array.isArray(d.data)) ? d.data : (d || {});
  const rowsOf = d => { const u = unwrap(d); for (const k of ['services','items','products','results']) if (Array.isArray(u[k])) return u[k]; if (Array.isArray(d?.data)) return d.data; if (Array.isArray(d)) return d; return []; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Retries politely when the provider answers "too many requests".
  async function apiRetry(...args) {
    for (let attempt = 0; ; attempt++) {
      try { return await api(...args); }
      catch (e) { if (e.response && e.response.status === 429 && attempt < 3) { await sleep(Math.min(65, Number(e.response.headers?.['retry-after']) || 20) * 1000); continue; } throw e; }
    }
  }
  async function fetchPage(page, withPerPage) {
    return apiRetry('get','/catalog/smm',null, withPerPage ? {page,per_page:80} : {page});
  }
  async function fetchAllProducts() {
    const products=[]; const seenIds=new Set(); let page=1, more=true, withPerPage=true;
    while(more && page<=100) {
      let d;
      try { d = await fetchPage(page, withPerPage); }
      catch(e) {
        if (withPerPage && page===1 && e.response && e.response.status>=400 && e.response.status<500 && ![401,403,429].includes(e.response.status)) { withPerPage=false; d = await fetchPage(page,false); }
        else throw e;
      }
      const u = unwrap(d);
      if (!Array.isArray(d) && !Array.isArray(d?.data) && !['services','items','products','results'].some(k => Array.isArray(u[k]))) {
        throw new Error('The provider returned an invalid Boosting 1 catalogue.');
      }
      const batch = rowsOf(d);
      // Stop as soon as a page brings nothing new (provider ignoring ?page= and repeating the same rows, or an empty page).
      const fresh = batch.filter(x => { const id = Number(x && x.id); if (!Number.isInteger(id) || id <= 0 || seenIds.has(id)) return false; seenIds.add(id); return true; });
      products.push(...batch);
      if (!fresh.length) break;
      const meta = u.pagination || d?.pagination || u.meta || d?.meta || {};
      const current = Number(meta.current_page ?? meta.page);
      const last = Number(meta.last_page ?? meta.total_pages ?? meta.pages);
      more = !!(u.has_more || d?.has_more || u.next_page || d?.next_page || d?.meta?.has_more ||
        (Number.isFinite(current) && Number.isFinite(last) && current < last) || batch.length >= 80);
      if (more && page === 100) { console.error('[boost1] catalogue hit the 100-page limit; using what was loaded'); break; }
      page++;
    }
    const unique = new Map();
    for (const product of products) {
      const id = Number(product?.id);
      if (Number.isInteger(id) && id > 0 && !unique.has(id)) unique.set(id, product);
    }
    return [...unique.values()];
  }
  // The provider list is stored in our database. Customers never trigger a provider call just by
  // opening the page; it is re-pulled on admin sync, on a customer Refresh (30s cooldown), or when
  // nothing is stored yet. If a re-pull fails, the previously stored list stays available.
  const cacheSchema = new mongoose.Schema({ key:{type:String,unique:true}, products:{type:mongoose.Schema.Types.Mixed,default:[]}, syncedAt:Date, error:{type:String,default:''} },{minimize:false});
  const Cache = mongoose.models.NovaBoost1Cache || mongoose.model('NovaBoost1Cache', cacheSchema);
  let inflight = null;
  // In-memory copy so a customer request never waits on the database or the provider.
  let mem = null; const MEM_MS = 5 * 60 * 1000;
  async function loadProducts(refresh=false, force=false) {
    if (!refresh && mem && Date.now() - mem.at < MEM_MS) return mem.val;
    const val = await loadProductsDb(refresh, force);
    if (val && Array.isArray(val.products) && val.products.length) mem = { at: Date.now(), val };
    return val;
  }
  async function loadProductsDb(refresh=false, force=false) {
    const doc = await Cache.findOne({key:'smm'}).lean();
    const age = doc?.syncedAt ? Date.now()-new Date(doc.syncedAt).getTime() : Infinity;
    if (doc && Array.isArray(doc.products) && doc.products.length && !(refresh && (force || age>30000))) return {products:doc.products, syncedAt:doc.syncedAt, stale:false};
    if (!inflight) inflight = fetchAllProducts().then(async products=>{
      if (!products.length && Array.isArray(doc?.products) && doc.products.length) return {products:doc.products,syncedAt:doc.syncedAt,stale:true};
      const syncedAt=new Date(); await Cache.updateOne({key:'smm'},{$set:{products,syncedAt,error:''}},{upsert:true}); return {products,syncedAt,stale:false};
    }).finally(()=>{inflight=null;});
    try { return await inflight; }
    catch(e) {
      const st=e.response?.status, pm=e.response?.data?.message||e.response?.data?.error||e.message;
      console.error('[boost1] catalogue pull failed:',st || 'no response');
      if (doc && Array.isArray(doc.products) && doc.products.length) { Cache.updateOne({key:'smm'},{$set:{error:String(pm||'').slice(0,300)}}).catch(()=>{}); return {products:doc.products, syncedAt:doc.syncedAt, stale:true, error:pm}; }
      throw e;
    }
  }
  // Warm the list shortly after the server starts and keep it fresh in the background,
  // so the first customer to open Boosting 1 sees services immediately.
  setTimeout(() => { loadProducts(false).catch(() => {}); }, 4000);
  setInterval(() => { loadProducts(true).catch(() => {}); }, 30 * 60 * 1000);
  // Admin-only wording (used by the admin sync/list routes): says WHY the provider call failed instead of a generic "unavailable".
  const friendly = e => {
    const st = e && e.response && e.response.status;
    const k = key();
    const hint = k ? ` (key ends …${k.slice(-4)}, sent to ${base()})` : '';
    if (st === 429) return 'The provider is limiting requests right now. Please wait a minute and try again.';
    if (st === 401 || st === 403) return `NovaSolution rejected the API key${hint}. Set a valid NOVA_API_KEY in Render → Environment (it wins over the Logs 4 key) and make sure the key is allowed to use the SMM catalogue.`;
    if (st === 404) return `NovaSolution did not find /catalog/smm${hint}. Check NOVA_BASE_URL (should be https://www.novasolution.ng/api/v1 or unset).`;
    if (st) return `NovaSolution answered HTTP ${st}${hint}: ${String((e.response.data && (e.response.data.message || e.response.data.error)) || 'no details').slice(0, 160)}`;
    if (e && e.code) return `Could not reach NovaSolution (${e.code}). The server may be blocked from the provider or timed out.`;
    return `The provider service is temporarily unavailable (${String((e && e.message) || 'unknown error').slice(0, 160)}).`;
  };
  async function catalogue(refresh=false, force=false) {
    const {products, syncedAt, stale} = await loadProducts(refresh, force);
    const prices=await Price.find({}).lean(); const pm=new Map(prices.map(p=>[Number(p.itemId),p])); const gMarkup=await globalMarkup();
    const costOf = p => { const m=p.price_minor == null ? NaN : Number(p.price_minor); if (Number.isFinite(m) && m >= 0) return m/100; const x=Number(p.price ?? p.rate ?? p.cost); return Number.isFinite(x)&&x>=0?x:0; };
    const rateUnitOf = p => { const n=Number(p.rate_unit ?? p.rateUnit); return Number.isSafeInteger(n) && n>0 ? n : 1000; };
    const list = products.map(p=>{const cfg=pm.get(Number(p.id))||{};const cost=costOf(p);const sell0=cfg.mode==='specific'?Number(cfg.sellPrice)||0:cost+((Number(cfg.markup)||0)>0?Number(cfg.markup):gMarkup);const sell=sell0>0?PA.apply('boost1',sell0,{perUnits:rateUnitOf(p)/1000,decimals:true,floor:cost}):sell0;return {id:Number(p.id),name:p.name||`Service ${p.id}`,category:p.category||'Social boosting',description:String(p.description||p.service_description||p.desc||''),min:Number(p.min_qty ?? p.min)||1,max:Number(p.max_qty ?? p.max)||100000,rateUnit:rateUnitOf(p),cost,price:sell,mode:cfg.mode||'markup',sellPrice:Number(cfg.sellPrice)||0,markup:Number(cfg.markup)||0,enabled:cfg.enabled!==false,visible:cfg.visible!==false,priced:sell>0};});
    list.syncedAt = syncedAt; list.stale = stale;
    return list;
  }
  function safeOrderStatus(value) {
    const status=String(value||'').trim().toLowerCase();
    if(['success','complete','completed','delivered'].includes(status)) return 'completed';
    if(['failed','error','rejected','cancelled','canceled'].includes(status)) return 'failed';
    if(['pending','processing','in progress','in_progress','partial','queued','review','refunding','refunded'].includes(status)) return status.replace('in progress','processing').replace('in_progress','processing');
    return 'processing';
  }
  function statusBucket(value) {
    const status=String(value||'').toLowerCase();
    if(['success','complete','completed','delivered'].includes(status)) return 'delivered';
    if(['failed','error','rejected','cancelled','canceled','refunded'].includes(status)) return 'failed';
    return 'pending';
  }
  app.get('/api/boost1/services',auth,async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!(await boostOn())) return res.json({enabled:false,services:[],message:OFF_MSG});
    if(!key()) return res.json({enabled:false,services:[],message:'Boosting 1 is not available yet. Please contact the administrator.'});
    try {
      const list=await catalogue(String(req.query.refresh||'')==='1');
      const services=list.filter(x=>x.enabled&&x.visible&&x.priced)
        .map(({id,name,category,description,min,max,rateUnit,price})=>({serviceKey:serviceRef(id),name,category,description,min,max,rateUnit,price}));
      res.json({enabled:true,syncedAt:list.syncedAt,stale:!!list.stale,services});
    } catch(e) {
      console.error('[boost1] catalogue request failed:',e.response?.status||'no response');
      res.status(502).json({error:'Could not load Boosting 1 services right now. Please try again shortly.'});
    }
  });
  function customerOrder(order) {
    return {orderId:String(order._id),status:safeOrderStatus(order.status),itemName:order.itemName,quantity:order.quantity,rateUnit:order.rateUnit,link:order.link,amountPaid:order.sellTotal,createdAt:order.createdAt};
  }
  function respondExistingOrder(res, order) {
    if(['pending','review','refunding'].includes(String(order.status).toLowerCase())) {
      return res.status(202).json({ok:true,pending:true,orderId:String(order._id),message:'This order is still being checked. Please do not submit it again.'});
    }
    if(['failed','refunded'].includes(String(order.status).toLowerCase())) {
      return res.status(409).json({error:'This order attempt has already finished. Review your order history before placing another order.'});
    }
    return res.json({...customerOrder(order),ok:true,repeated:true});
  }
  // ── Live status from NovaSolution (GET /orders/{number}) ──
  // Runs when a customer opens an order or the order list. It NEVER refunds here: a provider "failed"
  // answer can be a network error after the order actually started, so the order moves to admin review
  // and the balance stays on hold until an admin verifies it on the provider dashboard.
  const LIVE_FINAL=['completed','failed','review','refunding','refunded'];
  async function refreshLive(order) {
    const stored=String(order.status||'').toLowerCase();
    if(!order.providerOrder||LIVE_FINAL.includes(stored)) return order;
    let remote;
    try {
      const d=await apiRetry('get','/orders/'+encodeURIComponent(order.providerOrder));
      remote=(d&&d.order&&typeof d.order==='object')?d.order:(d||{});
    } catch(e) {
      console.error('[boost1] live status check failed:',e.response?.status||e.code||e.name);
      return order;
    }
    const raw=String(remote.status||'').trim().toLowerCase();
    let next=null, note=null;
    if(['success','complete','completed','delivered'].includes(raw)) next='completed';
    else if(['pending','queued'].includes(raw)) next='pending';
    else if(['processing','in progress','in_progress','partial'].includes(raw)) next='processing';
    else if(['failed','error','rejected','cancelled','canceled'].includes(raw)) {
      next='review';
      note=`Provider reports "${raw}". Not refunded automatically: verify the order on NovaSolution, then confirm or refund it in the admin panel.`;
    }
    if(!next) return order;
    const set={status:next};
    if(note) set.reviewNote=note;
    // Compare-and-set on the previous status so a concurrent admin action is never overwritten.
    const result=await Order.updateOne({_id:order._id,status:order.status},{$set:set}).catch(()=>null);
    if(result&&result.matchedCount) { order.status=next; if(note) order.reviewNote=note; }
    return order;
  }
  app.get('/api/boost1/orders',auth,async(req,res)=>{
    try {
      const rows=await Order.find({userId:req.user._id}).sort({createdAt:-1}).limit(50).lean();
      // Refresh this page's open orders from the provider, one at a time (the provider gate spaces calls),
      // capped at 10 per load to stay within the provider's per-minute limit. Others keep their saved status.
      const open=rows.filter(r=>r.providerOrder&&!LIVE_FINAL.includes(String(r.status||'').toLowerCase())).slice(0,10);
      for(const row of open) await refreshLive(row);
      const statuses=await Order.find({userId:req.user._id}).select('status').lean();
      const counts={all:statuses.length,pending:0,delivered:0,failed:0};
      for(const row of statuses) counts[statusBucket(row.status)]++;
      res.set('Cache-Control','no-store');
      res.json({orders:rows.map(customerOrder),counts});
    } catch(e) {
      console.error('[boost1] customer history query failed:',e.name);
      res.status(500).json({error:'Could not load your Boosting 1 order history.'});
    }
  });
  app.get('/api/boost1/orders/:id',auth,async(req,res)=>{
    if(!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({error:'Order not found.'});
    try {
      const order=await Order.findOne({_id:req.params.id,userId:req.user._id}).lean();
      if(!order) return res.status(404).json({error:'Order not found.'});
      const fresh=await refreshLive(order);
      res.set('Cache-Control','no-store');
      res.json(customerOrder(fresh));
    } catch(e) {
      console.error('[boost1] customer order detail query failed:',e.name);
      res.status(500).json({error:'Could not load this Boosting 1 order.'});
    }
  });
  app.post('/api/boost1/orders',auth,async(req,res)=>{
    if(!(await boostOn())) return res.status(503).json({error:OFF_MSG+' Nothing was charged.'});
    let order=null, user=null, charged=0, providerCallStarted=false, clientRef='', purchaseTxRef='', refundTxRef='';
    try {
      let id;
      try { id=req.body?.serviceKey ? serviceIdFromRef(String(req.body.serviceKey)) : Number(req.body?.serviceId); }
      catch { return res.status(400).json({error:'Refresh the service list and choose a service again.'}); }
      const qty=Number(req.body?.quantity),link=String(req.body?.link||'').trim();
      clientRef=String(req.body?.clientRef||'').trim();
      if(clientRef&&!/^[A-Za-z0-9_-]{16,80}$/.test(clientRef)) return res.status(400).json({error:'Invalid order reference. Please review the order and try again.'});
      if(!clientRef) clientRef=crypto.randomUUID();
      if(!Number.isInteger(id)||id<=0||!Number.isInteger(qty)||qty<1||link.length>2048) return res.status(400).json({error:'Choose a service, valid quantity, and public http(s) link.'});
      let target;
      try { target=new URL(link); } catch { return res.status(400).json({error:'Enter a valid public http(s) link.'}); }
      if(!['http:','https:'].includes(target.protocol)||!target.hostname||target.username||target.password) return res.status(400).json({error:'Enter a valid public http(s) link.'});
      if(!key()) return res.status(503).json({error:'Boosting 1 is not available right now. Nothing was charged.'});
      const previous=await Order.findOne({clientRef}).lean();
      if(previous) {
        if(String(previous.userId)!==String(req.user._id)) return res.status(409).json({error:'Invalid order reference.'});
        return respondExistingOrder(res,previous);
      }
      const s=(await catalogue(false)).find(x=>x.id===id&&x.enabled&&x.visible&&x.priced);
      if(!s) return res.status(404).json({error:'Service unavailable.'});
      if(qty<s.min||qty>s.max) return res.status(400).json({error:`Quantity must be between ${s.min} and ${s.max}.`});
      const rateUnit=Number.isSafeInteger(s.rateUnit)&&s.rateUnit>0?s.rateUnit:1000;
      const total=Math.round((s.price*qty/rateUnit)*100)/100;
      if(!Number.isFinite(total)||total<=0||!Number.isFinite(s.cost)||s.cost<0) return res.status(400).json({error:'Invalid service price. No charge was made.'});
      const recent=await Order.findOne({
        userId:req.user._id,itemId:id,quantity:qty,link,
        status:{$in:['pending','review','refunding','processing']},
        createdAt:{$gte:new Date(Date.now()-10*60*1000)}
      }).sort({createdAt:-1}).lean();
      if(recent) return res.status(202).json({ok:true,pending:true,orderId:String(recent._id),message:'A matching Boosting 1 order is still being checked. Please review your order history before trying again.'});
      const idempotencyKey=clientRef;
      order=await Order.create({userId:req.user._id,itemId:id,itemName:s.name,quantity:qty,rateUnit,link,clientRef,providerOrder:'',idempotencyKey,status:'pending',cost:Math.round((s.cost*qty/rateUnit)*100)/100,sellTotal:total});
      purchaseTxRef=`boost1:${order._id}:purchase`;
      refundTxRef=`boost1:${order._id}:refund`;
      user=await User.findOneAndUpdate({_id:req.user._id,balance:{$gte:total}},{$inc:{balance:-total}},{new:true});
      if(!user){await Order.updateOne({_id:order._id},{$set:{status:'failed',reviewNote:'Insufficient balance; provider was not called.'}});return res.status(400).json({error:'Insufficient wallet balance.'});}
      charged=total;
      await Transaction.create({userId:user._id,type:'purchase',amount:total,description:`Boosting 1 — ${s.name}`,status:'pending',txRef:purchaseTxRef});
      let d;
      providerCallStarted=true;
      try {
        d=await api('post','/orders',{type:'smm',item_id:id,quantity:qty,payload:{link}},undefined,{'Idempotency-Key':idempotencyKey});
      } catch(e) {
        const status=Number(e.response?.status||e.status||0);
        // A timeout/network drop/5xx means Nova may already have created and charged the order.
        // Never refund automatically in this case; hold the debit and flag it for reconciliation.
        const ambiguous=!e.response || status===408 || status>=500;
        if(ambiguous){
          const note=`Provider outcome unclear (HTTP ${status||'no response'}). Reconcile using the saved request key before refunding.`;
          await Order.updateOne({_id:order._id},{$set:{status:'review',reviewNote:note}}).catch(()=>{});
          console.error('[BOOST1-REVIEW] provider result is ambiguous; manual reconciliation is required.');
          return res.status(202).json({ok:true,pending:true,orderId:String(order._id),message:'Your order is being verified because the provider did not confirm the result. Your balance is on hold; please do not order again yet.'});
        }
        // Definite provider rejection: refund exactly once using an atomic order-state claim.
        const claim=await Order.findOneAndUpdate({_id:order._id,status:'pending'},{$set:{status:'refunding',reviewNote:`Provider rejected order (HTTP ${status}).` }},{new:true});
        if(claim){
          try {
            await User.updateOne({_id:user._id},{$inc:{balance:total}});
            await Transaction.updateOne({txRef:purchaseTxRef},{$set:{status:'failed'}});
            await Transaction.create({userId:user._id,type:'refund',amount:total,description:`Boosting 1 refund — ${s.name}`,status:'success',txRef:refundTxRef});
          } catch(refundErr) {
            // Keep the refund claim in place: the wallet update may have succeeded before a
            // later ledger write failed, so reopening this order could credit it twice.
            await Order.updateOne({_id:order._id,status:'refunding'},{$set:{reviewNote:'Provider rejection was verified, but wallet/ledger refund requires manual reconciliation.'}}).catch(()=>{});
            console.error('[BOOST1-REFUND-REVIEW] wallet/ledger refund needs reconciliation:',refundErr.name);
            return res.status(202).json({ok:true,pending:true,orderId:String(order._id),message:'The provider rejected the order. Your refund is being processed; contact support if your balance is not restored shortly.'});
          }
          await Order.updateOne({_id:order._id,status:'refunding'},{$set:{status:'refunded',reviewNote:'Provider rejection confirmed; wallet refunded.'}});
          charged=0;
        }
        return res.status(400).json({error:'The provider rejected this order. Your wallet was refunded.'});
      }
      const root=unwrap(d); const ord=root.order||d.order||root;
      const providerOrder=String(ord.number||ord.order_number||ord.order_id||ord.orderId||ord.id||'');
      const reportedStatus=ord.status||root.status;
      if(!d||typeof d!=='object'||Array.isArray(d)||root.success===false||root.error||!providerOrder||safeOrderStatus(reportedStatus)==='failed'){
        await Order.updateOne({_id:order._id},{$set:{status:'review',reviewNote:'Provider response did not confirm a usable order reference and status.'}}).catch(()=>{});
        console.error('[BOOST1-REVIEW] provider response requires manual reconciliation.');
        return res.status(202).json({ok:true,pending:true,orderId:String(order._id),message:'The provider has not confirmed the order details yet. Your balance is on hold; please do not submit it again.'});
      }
      const status=safeOrderStatus(reportedStatus);
      await Order.updateOne({_id:order._id},{$set:{providerOrder,status,reviewNote:''}});
      try {
        const txResult=await Transaction.updateOne({txRef:purchaseTxRef},{$set:{status:'success'}});
        if(!txResult.matchedCount) throw new Error('Pending Boosting 1 ledger transaction was not found.');
        await Order.updateOne({_id:order._id},{$set:{txRecorded:true}});
      } catch(logErr){ console.error('[BOOST1-LEDGER-REVIEW] confirmed order transaction record needs reconciliation.'); }
      res.json({ok:true,orderId:String(order._id),status,amountPaid:total,balance:user.balance});
    } catch(e) {
      if(e.code===11000&&clientRef) {
        const existing=await Order.findOne({clientRef}).lean().catch(()=>null);
        if(existing&&String(existing.userId)===String(req.user._id)) return respondExistingOrder(res,existing);
      }
      if(charged && user?._id && !providerCallStarted){
        const claim=await Order.findOneAndUpdate({_id:order._id,status:'pending'},{$set:{status:'refunding',reviewNote:'Local failure before provider submission; refund claimed.'}},{new:true}).catch(()=>null);
        if(claim) {
          try {
            await User.updateOne({_id:user._id},{$inc:{balance:charged}});
            if(purchaseTxRef) await Transaction.updateOne({txRef:purchaseTxRef},{$set:{status:'failed'}});
            if(refundTxRef) await Transaction.create({userId:user._id,type:'refund',amount:charged,description:`Boosting 1 refund — ${order.itemName}`,status:'success',txRef:refundTxRef});
            await Order.updateOne({_id:order._id,status:'refunding'},{$set:{status:'refunded',reviewNote:'Local failure before provider submission; wallet refunded.'}});
            charged=0;
          } catch(refundErr) {
            // Never move an uncertain refund back to a retryable state after a wallet
            // increment may have happened. The admin handler intentionally won't credit a
            // refunding order a second time.
            await Order.updateOne({_id:order._id,status:'refunding'},{$set:{reviewNote:'Pre-provider refund needs reconciliation.'}}).catch(()=>{});
            console.error('[BOOST1-REFUND-REVIEW] pre-provider refund requires reconciliation:',refundErr.name);
          }
        }
      } else if(charged && order?._id && providerCallStarted) {
        await Order.updateOne({_id:order._id,status:'pending'},{$set:{status:'review',reviewNote:'Provider may have accepted the order; do not refund until reconciled.'}}).catch(()=>{});
      } else if(order?._id&&!charged&&!providerCallStarted) {
        await Order.updateOne({_id:order._id,status:'pending'},{$set:{status:'failed',reviewNote:'Local failure before wallet debit and provider submission.'}}).catch(()=>{});
      }
      console.error('[boost1] order handler failed:',e.name,e.response?.status||e.status||'');
      if(!res.headersSent) {
        if(providerCallStarted) return res.status(202).json({ok:true,pending:true,orderId:order?._id?String(order._id):undefined,message:'Your order result is still being checked. Please do not submit it again yet.'});
        const status=Number(e.status);
        res.status(status>=400&&status<500?status:502).json({error:providerCallStarted?'Order status is being checked. Please do not retry yet.':'The Boosting 1 order could not be placed. Please try again.'});
      }
    }
  });
  app.get('/api/admin/boost1/services',anyAdminAuth,async(req,res)=>{try{res.json(await catalogue(String(req.query.refresh||'')==='1'));}catch(e){res.status(502).json({error:'Could not load the service list: '+friendly(e)});}});
  app.post('/api/admin/boost1/sync',anyAdminAuth,async(req,res)=>{try{const list=await catalogue(true,true);res.json({ok:true,count:list.length,stale:!!list.stale,syncedAt:list.syncedAt,message:list.stale?'Provider could not be reached; the previously stored list was kept.':`Synced ${list.length} services.`});}catch(e){res.status(502).json({error:'Sync failed: '+friendly(e)});}});
  app.put('/api/admin/boost1/services/:id',anyAdminAuth,async(req,res)=>{const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:'Invalid service ID'});const b=req.body||{},set={updatedAt:new Date()};if(b.mode!==undefined){if(!['specific','markup'].includes(b.mode))return res.status(400).json({error:'Mode must be specific or markup'});set.mode=b.mode;}for(const k of ['sellPrice','markup'])if(b[k]!==undefined){const n=Number(b[k]);if(!Number.isFinite(n)||n<0)return res.status(400).json({error:`${k} must be zero or greater`});set[k]=n;}if(typeof b.enabled==='boolean')set.enabled=b.enabled;if(typeof b.visible==='boolean')set.visible=b.visible;await Price.updateOne({itemId:id},{$set:{itemId:id,...set}},{upsert:true});res.json({ok:true});});
  app.get('/api/admin/boost1/orders',anyAdminAuth,async(req,res)=>{
    try {
      const rows=await Order.find({status:{$in:['pending','review','refunding']}})
        .sort({createdAt:-1}).limit(100).populate('userId','name email').lean();
      res.set('Cache-Control','no-store');
      res.json(rows.map(order=>({
        id:String(order._id),userName:order.userId?.name||'',userEmail:order.userId?.email||'',
        itemId:order.itemId,itemName:order.itemName,quantity:order.quantity,rateUnit:order.rateUnit,
        link:order.link,amount:order.sellTotal,status:order.status,reviewNote:order.reviewNote||'',
        providerOrder:order.providerOrder||'',clientRef:order.clientRef,createdAt:order.createdAt,
        txRecorded:!!order.txRecorded
      })));
    } catch(e) {
      console.error('[boost1] admin order review list failed:',e.name);
      res.status(500).json({error:'Could not load Boosting 1 orders requiring review.'});
    }
  });
  app.post('/api/admin/boost1/orders/:id/resolve',anyAdminAuth,async(req,res)=>{
    if(!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({error:'Order not found.'});
    const action=String(req.body?.action||'');
    try {
      let order=await Order.findById(req.params.id);
      if(!order) return res.status(404).json({error:'Order not found.'});
      const purchaseTxRef=`boost1:${order._id}:purchase`, refundTxRef=`boost1:${order._id}:refund`;
      if(action==='review') {
        const result=await Order.updateOne({_id:order._id,status:'pending'},{$set:{status:'review',reviewNote:'Admin flagged this order for provider reconciliation; do not refund until checked.'}});
        if(!result.matchedCount) return res.status(409).json({error:'Only a pending order can be flagged for review.'});
        return res.json({ok:true,status:'review'});
      }
      if(action==='confirm') {
        const providerOrder=String(req.body?.providerOrder||'').trim().slice(0,128);
        const status=String(req.body?.status||'processing');
        if(!providerOrder||!['processing','completed'].includes(status)) return res.status(400).json({error:'Enter the confirmed provider order reference and a processing or completed status.'});
        if(order.status!=='review') return res.status(409).json({error:'Only an order awaiting review can be confirmed.'});
        const tx=await Transaction.findOne({txRef:purchaseTxRef}).lean();
        if(tx) await Transaction.updateOne({txRef:purchaseTxRef},{$set:{status:'success'}});
        const result=await Order.updateOne({_id:order._id,status:'review'},{$set:{providerOrder,status,reviewNote:'',txRecorded:!!tx}});
        if(!result.matchedCount) return res.status(409).json({error:'The order changed while it was being resolved. Refresh and try again.'});
        return res.json({ok:true,status,ledgerRecorded:!!tx});
      }
      if(action==='refund') {
        if(order.status==='refunded') return res.json({ok:true,status:'refunded',repeated:true});
        if(order.status==='refunding') {
          const priorRefund=await Transaction.findOne({txRef:refundTxRef,status:'success'}).lean();
          if(priorRefund) {
            await Transaction.updateOne({txRef:purchaseTxRef},{$set:{status:'failed'}});
            await Order.updateOne({_id:order._id,status:'refunding'},{$set:{status:'refunded',reviewNote:'Manual provider check confirmed no order; wallet refund reconciled.'}});
            return res.json({ok:true,status:'refunded',repeated:true});
          }
          return res.status(409).json({error:'This refund is already in progress and needs manual balance reconciliation; it will not be credited again automatically.'});
        }
        const claim=await Order.findOneAndUpdate({_id:order._id,status:'review'},{$set:{status:'refunding',reviewNote:'Admin confirmed the provider did not create this order; refund in progress.'}},{new:true});
        if(!claim) return res.status(409).json({error:'Only an order awaiting review can be refunded.'});
        try {
          const wallet=await User.updateOne({_id:claim.userId},{$inc:{balance:claim.sellTotal}});
          if(!wallet.matchedCount) throw new Error('The customer wallet was not found.');
          await Transaction.create({userId:claim.userId,type:'refund',amount:claim.sellTotal,description:`Boosting 1 refund — ${claim.itemName}`,status:'success',txRef:refundTxRef});
          await Transaction.updateOne({txRef:purchaseTxRef},{$set:{status:'failed'}});
          await Order.updateOne({_id:claim._id,status:'refunding'},{$set:{status:'refunded',reviewNote:'Manual provider check confirmed no order; wallet refunded.'}});
          return res.json({ok:true,status:'refunded',refunded:claim.sellTotal});
        } catch(refundError) {
          console.error('[BOOST1-ADMIN-REFUND] reconciliation required:',refundError.name);
          return res.status(202).json({ok:true,pending:true,status:'refunding',message:'Refund processing requires balance reconciliation. Do not retry the credit.'});
        }
      }
      return res.status(400).json({error:'Action must be confirm or refund.'});
    } catch(e) {
      console.error('[boost1] admin order resolution failed:',e.name);
      res.status(500).json({error:'Could not resolve this Boosting 1 order.'});
    }
  });
  app.get('/api/admin/boost1/settings',anyAdminAuth,async(req,res)=>{try{res.json({globalMarkup:await globalMarkup(),hasKey:!!key(),enabled:await boostOn()});}catch(e){res.status(500).json({error:'Could not load settings.'});}});
  app.put('/api/admin/boost1/switch',anyAdminAuth,async(req,res)=>{try{if(typeof req.body?.enabled!=='boolean')return res.status(400).json({error:'enabled must be true or false.'});const on=req.body.enabled;await Settings.updateOne({key:'main'},{$set:{key:'main',enabled:on,updatedAt:new Date()}},{upsert:true});_onCache={at:Date.now(),val:on};res.json({ok:true,enabled:on});}catch(e){res.status(500).json({error:'Could not save the switch.'});}});
  app.put('/api/admin/boost1/settings',anyAdminAuth,async(req,res)=>{try{const n=Number(req.body?.globalMarkup);if(!Number.isFinite(n)||n<0)return res.status(400).json({error:'Markup must be zero or greater.'});await Settings.updateOne({key:'main'},{$set:{key:'main',globalMarkup:n,updatedAt:new Date()}},{upsert:true});res.json({ok:true,globalMarkup:n});}catch(e){res.status(500).json({error:'Could not save settings.'});}});
};
            
