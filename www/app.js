/* Particle Field — mobile UI. Measurement lives in core.js (runs in worker.js). */
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const VERSION = '1.1.1';              // keep in step with the cache name in sw.js
const MAXPIX = 16.0e6;               // iOS canvas limit is 16.7 MP; 48 MP photos are downscaled 2x (≈ their real resolution)
const OVC = { ok: '#35e0c2', fine: '#ffb020', coarse: '#be96ff', edge: '#80929a' };

/* ---------------- settings ---------------- */
const DEF = { pitch: 2.0, measure: 'ecd', min: 80, max: 0, thrMode: 'half', thr: 0.5, split: true, height: true, bins: '2', shape: 'sphere', stillW: 4032, standH: '21', customZ: 25, basis: 'number' };
let S = Object.assign({}, DEF);
try { Object.assign(S, JSON.parse(localStorage.getItem('pf.settings') || '{}')); } catch (e) {}
const saveS = () => { try { localStorage.setItem('pf.settings', JSON.stringify(S)); } catch (e) {} };
const Zmm = () => S.standH === 'custom' ? +S.customZ : +S.standH;
const analysisKey = () => JSON.stringify([S.pitch, S.thrMode, S.thr, S.split, S.height, Zmm()]);

/* ---------------- state ---------------- */
const IM = [];            // { id, name, file, thumb, state:'queued'|'busy'|'done'|'fail', why, cal, res, q, prev, key }
let uid = 0, geo = null;
const worker = new Worker('worker.js');
const pending = new Map();
worker.onmessage = e => { const cb = pending.get(e.data.id); if (cb) { pending.delete(e.data.id); cb(e.data); } };
const runWorker = (msg, transfer) => new Promise(res => { pending.set(msg.id, res); worker.postMessage(msg, transfer); });

/* ---------------- helpers ---------------- */
let toastT = 0;
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 4200); }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = v => !isFinite(v) ? '–' : v >= 1000 ? Math.round(v).toLocaleString() : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
const fpct = v => !isFinite(v) ? '–' : v >= 10 ? v.toFixed(1) : v >= 0.1 ? v.toFixed(2) : v > 0 ? v.toPrecision(2) : '0';

async function decode(file) {
  let src, w, h;
  try { src = await createImageBitmap(file); w = src.width; h = src.height; }
  catch (e) { src = await new Promise((res, rej) => { const u = URL.createObjectURL(file), im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decode')); im.src = u; }); w = src.naturalWidth; h = src.naturalHeight; }
  const s = Math.min(1, Math.sqrt(MAXPIX / (w * h))), W = Math.round(w * s), H = Math.round(h * s);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, W, H);
  if (src.close) src.close();
  return { canvas: c, w: W, h: H, scaled: s < 1 };
}
function thumbOf(canvas) { const t = document.createElement('canvas'), tw = 160; t.width = tw; t.height = Math.round(tw * canvas.height / canvas.width); t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height); return t.toDataURL('image/jpeg', 0.7); }
function previewOf(canvas, res) {
  const [x0, y0, cw, ch] = res.crop, pad = Math.round(0.08 * Math.max(cw, ch));
  const X0 = Math.max(0, x0 - pad), Y0 = Math.max(0, y0 - pad), X1 = Math.min(canvas.width, x0 + cw + pad), Y1 = Math.min(canvas.height, y0 + ch + pad);
  const s = Math.min(1, 2000 / Math.max(X1 - X0, Y1 - Y0)), p = document.createElement('canvas');
  p.width = Math.round((X1 - X0) * s); p.height = Math.round((Y1 - Y0) * s);
  p.getContext('2d').drawImage(canvas, X0, Y0, X1 - X0, Y1 - Y0, 0, 0, p.width, p.height);
  return { canvas: p, x0: X0, y0: Y0, s };
}

/* ---------------- processing queue ---------------- */
let busy = false;
async function pump() {
  if (busy) return; const r = IM.find(r => r.state === 'queued'); if (!r) { renderAll(); return; }
  busy = true; r.state = 'busy'; renderImages();
  try {
    const d = await decode(r.file);
    if (!r.thumb) r.thumb = thumbOf(d.canvas);
    const img = d.canvas.getContext('2d').getImageData(0, 0, d.w, d.h);
    const opts = { pitch: +S.pitch, thrMode: S.thrMode, thr: +S.thr, split: S.split, heightZmm: S.height ? Zmm() : 0, maxSizeUm: S.max > 0 ? Math.max(+S.max, 500) : 2500 };
    const key = analysisKey();
    const out = await runWorker({ id: ++uid, rgba: img.data.buffer, w: d.w, h: d.h, opts }, [img.data.buffer]);
    if (!IM.includes(r)) { busy = false; pump(); return; }
    if (out.ok) { Object.assign(r, { state: 'done', cal: out.cal, res: out.res, q: out.q, key, why: '' }); r.prev = previewOf(d.canvas, out.res); r.scaled = d.scaled; }
    else Object.assign(r, { state: 'fail', why: out.why, key });
  } catch (e) { Object.assign(r, { state: 'fail', why: 'Could not open this photo (' + (e.message || e) + '). Try JPEG.' }); }
  busy = false; renderAll(); pump();
}
function addFiles(files) {
  const list = [...files].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp|tiff?)$/i.test(f.name));
  if (!list.length) return;
  for (const f of list) IM.push({ id: ++uid, name: f.name || ('Photo ' + (IM.length + 1)), file: f, state: 'queued' });
  toast(`Analysing ${list.length} photo${list.length > 1 ? 's' : ''}…`);
  renderImages(); pump();
}
function reanalyse() { const k = analysisKey(); let n = 0; for (const r of IM) if (r.key !== k && r.state !== 'busy') { r.state = 'queued'; n++; } if (n) { toast(`Re-analysing ${n} photo${n > 1 ? 's' : ''}…`); pump(); } else renderAll(); }

/* ---------------- derived results ---------------- */
function derive() {
  const all = [];
  for (const r of IM) { if (r.state !== 'done') continue;
    for (const p of r.res.parts) {
      p.size = S.measure === 'ecd' ? p.ecd : S.measure === 'fmin' ? p.fmin : p.fmax;
      p.vol = S.shape === 'sphere' ? Math.PI / 6 * p.ecd ** 3 : Math.PI / 6 * p.fmax * p.fmin * p.fmin;
      p.status = p.edge ? 'edge' : p.size < S.min ? 'fine' : (S.max > 0 && p.size > S.max) ? 'coarse' : 'ok';
      p.img = r.name; if (p.status === 'ok') all.push(p); } }
  return all;
}

/* ---------------- rendering ---------------- */
function renderAll() { renderImages(); renderResults(); }
function renderImages() {
  derive();
  const ul = $('#imgList'); $('#imgEmpty').hidden = IM.length > 0;
  $('#navCount').textContent = IM.length ? `(${IM.length})` : '';
  const done = IM.filter(r => r.state === 'done');
  const nOk = done.reduce((a, r) => a + r.res.parts.filter(p => p.status === 'ok').length, 0);
  $('#imgSummary').textContent = IM.length ? `${done.length}/${IM.length} analysed · ${nOk.toLocaleString()} particles` : '';
  ul.innerHTML = IM.map((r, i) => {
    let badge = '', line = '';
    if (r.state === 'queued') { badge = '<span class="badge busy">Queued</span>'; }
    else if (r.state === 'busy') { badge = '<span class="badge busy">Analysing…</span>'; }
    else if (r.state === 'fail') { badge = '<span class="badge bad">No result</span>'; line = esc(r.why); }
    else { const q = r.q, lv = q.level, n = r.res.parts.filter(p => p.status === 'ok').length;
      badge = `<span class="badge ${lv}">${lv === 'good' ? 'Good' : lv === 'warn' ? 'Check' : 'Too coarse'}</span>`;
      line = `Window ${r.cal.window} · ${r.cal.umPerPx.toFixed(2)} µm/px · ${n} counted`; }
    return `<li data-i="${i}">${r.thumb ? `<img src="${r.thumb}" alt="">` : '<img alt="">'}<div class="meta"><b>${esc(r.name)}</b><span class="hint">${line}</span></div>${badge}<button class="btn sm" data-rm="${i}" type="button" aria-label="Remove">✕</button></li>`;
  }).join('');
}
function renderResults() {
  const all = derive(), mass = S.basis === 'mass';
  $('#resN').textContent = all.length ? `${all.length.toLocaleString()} particles · ${IM.filter(r => r.state === 'done').length} photos` : '';
  const ms = all.map(p => p.vol), st = core().stats(all.map(p => p.size), ms, S.bins);
  window._st = st;
  const tiles = $('#tiles');
  if (!st) { tiles.innerHTML = '<div class="empty" style="grid-column:1/-1">Results appear here once a photo is analysed.</div>'; $('#hist').innerHTML = $('#cum').innerHTML = ''; $('#classTable').innerHTML = ''; $('#accLine').textContent = ''; renderHistory(); return; }
  const b = mass ? st.mass : st.number;
  const T = (k, v, u = 'µm') => `<div class="tile"><div class="k">${k}</div><div class="v">${fmt(v)}</div><div class="u">${u}</div></div>`;
  tiles.innerHTML = T('D10', b.d10) + T('D50', b.d50) + T('D90', b.d90) + T('Span', b.span, '(D90−D10)/D50') + T(mass ? 'D[4,3]' : 'Mean', mass ? st.d43 : st.number.mean) + T('D[3,2]', st.d32);
  const done = IM.filter(r => r.state === 'done'), um = done.map(r => r.cal.umPerPx).sort((a, b) => a - b), est = done.map(r => r.q.est200pct).sort((a, b) => a - b);
  const worst = done.reduce((w, r) => r.q.level === 'bad' ? 'bad' : r.q.level === 'warn' && w !== 'bad' ? 'warn' : w, 'good');
  $('#accLine').innerHTML = `Scale ${um[0].toFixed(2)}–${um[um.length - 1].toFixed(2)} µm/px · expected single-particle error at 200 µm ≈ ±${est[est.length >> 1].toFixed(1)} %` + (worst !== 'good' ? ` · <b style="color:var(--${worst})">some photos need checking (Photos tab)</b>` : '');
  $('#histTitle').textContent = `Share of ${mass ? 'volume' : 'count'} per size class (${S.measure === 'ecd' ? 'ECD' : S.measure === 'fmin' ? 'Feret min' : 'Feret max'})`;
  renderHist(st, mass); renderCum(st); renderClassTable(st); renderHistory();
}
function core() { return window.PF; }
function xmap(st, x0, x1) { const lo = st.edges[0], hi = st.edges[st.edges.length - 1];
  return st.log ? v => x0 + (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) * (x1 - x0) : v => x0 + (v - lo) / (hi - lo) * (x1 - x0); }
function xticks(st) { const lo = st.edges[0], hi = st.edges[st.edges.length - 1], out = [];
  if (st.log) { for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const k of [1, 2, 5]) { const v = k * 10 ** e; if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); } }
  else { const step = (hi - lo) / 5; for (let v = lo; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(3)); }
  return out; }
function renderHist(st, mass) {
  const W = 600, H = 240, m = { l: 40, r: 10, t: 10, b: 34 }, X = xmap(st, m.l, W - m.r);
  const vals = st.bins.map(b => mass ? b.mp : b.np), ymax = Math.max(...vals) * 1.1 || 1, Y = v => H - m.b - v / ymax * (H - m.t - m.b);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) { const v = ymax * t; s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${m.l - 4}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(0)}%</text>`; }
  st.bins.forEach((b, i) => { const x0 = X(b.lo) + 1, x1 = X(b.hi) - 1; s += `<rect x="${x0}" y="${Y(vals[i])}" width="${Math.max(1, x1 - x0)}" height="${H - m.b - Y(vals[i])}" fill="var(--accent)" rx="2"/>`; });
  for (const t of xticks(st)) s += `<text x="${X(t)}" y="${H - m.b + 16}" text-anchor="middle">${fmt(t)}</text>`;
  s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 2}" text-anchor="middle">size (µm)</text></svg>`;
  $('#hist').innerHTML = s;
}
function renderCum(st) {
  const W = 600, H = 240, m = { l: 40, r: 10, t: 10, b: 34 }, X = xmap(st, m.l, W - m.r), Y = v => H - m.b - v / 100 * (H - m.t - m.b);
  const line = (key, col, dash) => { let d = `M${X(st.edges[0])},${Y(0)}`; for (const b of st.bins) d += `L${X(b.hi)},${Y(b[key])}`; return `<path d="${d}" fill="none" stroke="${col}" stroke-width="2.5" ${dash ? 'stroke-dasharray="6 4"' : ''}/>`; };
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  for (const v of [0, 10, 50, 90, 100]) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${m.l - 4}" y="${Y(v) + 4}" text-anchor="end">${v}%</text>`;
  s += line('cnp', 'var(--accent)') + line('cmp', '#d9822b', true);
  for (const t of xticks(st)) s += `<text x="${X(t)}" y="${H - m.b + 16}" text-anchor="middle">${fmt(t)}</text>`;
  s += `<text x="${m.l + 8}" y="${m.t + 12}" style="fill:var(--accent)">— count</text><text x="${m.l + 80}" y="${m.t + 12}" style="fill:#d9822b">-- volume</text>`;
  s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 2}" text-anchor="middle">size (µm)</text></svg>`;
  $('#cum').innerHTML = s;
}
function renderClassTable(st) {
  $('#classTable').innerHTML = `<tr><th>Class (µm)</th><th>Count</th><th>% count</th><th>% vol</th><th>Cum % vol</th></tr>` +
    st.bins.map(b => `<tr><td>${fmt(b.lo)}–${fmt(b.hi)}</td><td>${b.cnt}</td><td>${fpct(b.np)}</td><td>${fpct(b.mp)}</td><td>${fpct(b.cmp)}</td></tr>`).join('');
}

/* ---------------- viewer ---------------- */
const V = { r: null, s: 1, tx: 0, ty: 0, mode: 'outlines', ptrs: new Map(), last: null };
function openViewer(i) {
  const r = IM[i]; if (!r) return;
  if (r.state !== 'done') { if (r.state === 'fail') toast(r.why); return; }
  V.r = r; $('#viewer').hidden = false; $('#vTitle').textContent = r.name;
  const c = r.cal, q = r.q, n = r.res.parts.filter(p => p.status === 'ok').length, ne = r.res.parts.filter(p => p.status === 'edge').length;
  $('#vInfo').innerHTML = `<b style="color:${q.level === 'good' ? '#4fd1a5' : q.level === 'warn' ? '#ffc04d' : '#ff6b77'}">${esc(q.msg)}</b><br>
   Window ${c.window} · ${c.umPerPx.toFixed(3)} µm/px · ${c.nDots} dots · fit residual ${c.rmsUm.toFixed(1)} µm · edge blur ≈ ${isFinite(q.blurSigmaPx) ? q.blurSigmaPx.toFixed(1) : '–'} px · est. ±${q.est200pct.toFixed(1)} % at 200 µm<br>
   ${n} counted · ${ne} cut by the window edge${r.scaled ? ' · photo downscaled to 16 MP' : ''}
   <div class="legend"><span><i style="background:${OVC.ok}"></i>Counted</span><span><i style="background:${OVC.fine}"></i>Below min</span><span><i style="background:${OVC.coarse}"></i>Above max</span><span><i style="background:${OVC.edge}"></i>Cut by edge</span></div>`;
  requestAnimationFrame(() => { fitViewer(); drawViewer(); });
}
function fitViewer() { const st = $('#vStage'), p = V.r.prev; V.s = Math.min(st.clientWidth / p.canvas.width, st.clientHeight / p.canvas.height); V.tx = (st.clientWidth - p.canvas.width * V.s) / 2; V.ty = (st.clientHeight - p.canvas.height * V.s) / 2; }
function drawViewer() {
  const st = $('#vStage'), cv = $('#vCanvas'), dpr = devicePixelRatio || 1, r = V.r; if (!r) return;
  cv.width = st.clientWidth * dpr; cv.height = st.clientHeight * dpr; cv.style.width = st.clientWidth + 'px'; cv.style.height = st.clientHeight + 'px';
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.fillStyle = '#000'; x.fillRect(0, 0, cv.width, cv.height);
  x.translate(V.tx, V.ty); x.scale(V.s, V.s); x.imageSmoothingEnabled = V.s < 2;
  const p = r.prev; x.drawImage(p.canvas, 0, 0);
  const T = (X, Y) => [(X - p.x0) * p.s, (Y - p.y0) * p.s];
  x.lineWidth = 2 / V.s; x.strokeStyle = '#ffd400'; x.setLineDash([8 / V.s, 6 / V.s]); x.beginPath();
  r.res.roiPoly.forEach((q, k) => { const [a, b] = T(q[0], q[1]); k ? x.lineTo(a, b) : x.moveTo(a, b); }); x.closePath(); x.stroke(); x.setLineDash([]);
  if (V.mode === 'outlines') for (const pt of r.res.parts) { if (!pt.hull || pt.hull.length < 2) continue; x.strokeStyle = OVC[pt.status] || '#fff'; x.lineWidth = 1.6 / V.s; x.beginPath();
    pt.hull.forEach((q, k) => { const [a, b] = T(q[0], q[1]); k ? x.lineTo(a, b) : x.moveTo(a, b); }); x.closePath(); x.stroke();
    if (V.s * p.s > 0.6 && pt.status === 'ok') { const [a, b] = T(pt.cx, pt.cy); x.fillStyle = '#fff'; x.font = `${12 / V.s}px sans-serif`; x.textAlign = 'center'; x.fillText(fmt(pt.size), a, b + 4 / V.s); } }
}
function setupViewerGestures() {
  const st = $('#vStage');
  st.addEventListener('pointerdown', e => { st.setPointerCapture(e.pointerId); V.ptrs.set(e.pointerId, [e.clientX, e.clientY]); V.last = null;
    const now = Date.now(); if (V.ptrs.size === 1 && now - (V.tap || 0) < 300) { const b = st.getBoundingClientRect(); zoomAt(V.s > 1.5 * fitScale() ? fitScale() / V.s : 3, e.clientX - b.left, e.clientY - b.top); } V.tap = now; });
  st.addEventListener('pointermove', e => { if (!V.ptrs.has(e.pointerId)) return; const prev = V.ptrs.get(e.pointerId); V.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (V.ptrs.size === 1) { V.tx += e.clientX - prev[0]; V.ty += e.clientY - prev[1]; drawViewer(); }
    else if (V.ptrs.size === 2) { const [a, b] = [...V.ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), bb = st.getBoundingClientRect(), cx = (a[0] + b[0]) / 2 - bb.left, cy = (a[1] + b[1]) / 2 - bb.top;
      if (V.last) zoomAt(d / V.last, cx, cy); V.last = d; } });
  const up = e => { V.ptrs.delete(e.pointerId); V.last = null; };
  st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
  st.addEventListener('wheel', e => { e.preventDefault(); const b = st.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - b.left, e.clientY - b.top); }, { passive: false });
}
function fitScale() { const st = $('#vStage'), p = V.r.prev; return Math.min(st.clientWidth / p.canvas.width, st.clientHeight / p.canvas.height); }
function zoomAt(f, cx, cy) { const ns = Math.max(fitScale() * 0.5, Math.min(V.s * f, 12)); f = ns / V.s; V.tx = cx - (cx - V.tx) * f; V.ty = cy - (cy - V.ty) * f; V.s = ns; drawViewer(); }

/* ---------------- live alignment ---------------- */
const LV = { stream: null, timer: 0, busy: false };
async function openLive() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Live view needs camera access (https or the installed app).'); return; }
  $('#live').hidden = false; $('#lvHud').textContent = 'Starting camera…';
  try {
    LV.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
    const v = $('#lvVideo'); v.srcObject = LV.stream; await v.play();
    LV.timer = setInterval(liveTick, 600);
  } catch (e) { $('#lvHud').textContent = 'Camera unavailable: ' + (e.message || e); }
}
function closeLive() { clearInterval(LV.timer); if (LV.stream) LV.stream.getTracks().forEach(t => t.stop()); LV.stream = null; $('#live').hidden = true; }
async function liveTick() {
  if (LV.busy) return; const v = $('#lvVideo'); if (!v.videoWidth) return;
  LV.busy = true;
  const s = Math.min(1, 1100 / Math.max(v.videoWidth, v.videoHeight)), w = Math.round(v.videoWidth * s), h = Math.round(v.videoHeight * s);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(v, 0, 0, w, h);
  const img = x.getImageData(0, 0, w, h);
  const out = await runWorker({ id: ++uid, kind: 'live', rgba: img.data.buffer, w, h, opts: { pitch: +S.pitch } }, [img.data.buffer]);
  LV.busy = false; if ($('#live').hidden) return;
  const cv = $('#lvCanvas'), vw = cv.clientWidth, vh = cv.clientHeight, dpr = devicePixelRatio || 1; cv.width = vw * dpr; cv.height = vh * dpr;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, vw, vh);
  const k = Math.min(vw / w, vh / h), ox = (vw - w * k) / 2, oy = (vh - h * k) / 2;
  g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(vw / 2 - 20, vh / 2); g.lineTo(vw / 2 + 20, vh / 2); g.moveTo(vw / 2, vh / 2 - 20); g.lineTo(vw / 2, vh / 2 + 20); g.stroke();
  if (!out.ok) { $('#lvHud').innerHTML = `<b>Looking for the dot grid…</b><br>${esc(out.why || '')}`; return; }
  g.strokeStyle = '#ffd400'; g.lineWidth = 3; g.beginPath(); out.roiPoly.forEach((q, i) => { const X = ox + q[0] * k, Y = oy + q[1] * k; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.closePath(); g.stroke();
  const umStill = out.fovWmm * 1000 / (+S.stillW || 4032), px200 = 200 / umStill, sig = out.edgeWidthPx / 2.56;
  const verdict = px200 >= 20 ? '<b style="color:#4fd1a5">resolution OK</b>' : px200 >= 12 ? '<b style="color:#ffc04d">marginal – go closer / use window S + lens</b>' : '<b style="color:#ff6b77">too coarse – go closer or add a macro lens</b>';
  $('#lvHud').innerHTML = `Window <b>${out.window}</b> found · ${out.nDots} dots · field ≈ ${out.fovWmm.toFixed(1)} mm wide<br>
    Photo estimate ≈ ${umStill.toFixed(1)} µm/px → 200 µm ≈ ${px200.toFixed(0)} px · ${verdict}<br>
    Sharpness: ${sig < 1.6 ? 'sharp' : sig < 2.6 ? 'OK' : 'soft – tap to focus'} <span class="hint" style="color:#aaa">(preview is lower resolution than the photo)</span>`;
}

/* ---------------- export & history ---------------- */
function meta() { const d = new Date(); return { sample: $('#sampleName').value.trim() || 'Unnamed sample', date: d.toISOString(), geo }; }
async function deliver(name, text) {
  const blob = new Blob([text], { type: 'text/csv' });
  try { const f = new File([blob], name, { type: 'text/csv' }); if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const fileBase = () => (meta().sample.replace(/[^\w\-]+/g, '_') || 'sample') + '_' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
function header() { const m = meta(); return [`# Particle Field export`, `# sample,${csvq(m.sample)}`, `# date,${m.date}`, m.geo ? `# location,${m.geo.lat.toFixed(6)},${m.geo.lon.toFixed(6)},±${Math.round(m.geo.acc)} m` : '', `# tray pitch mm,${S.pitch}`, `# threshold,${S.thrMode}`, `# height correction mm,${S.height ? Zmm() : 'off'}`, `# size measure,${S.measure}`, `# min/max um,${S.min},${S.max || 'none'}`].filter(Boolean).join('\n'); }
const csvq = s => '"' + String(s).replace(/"/g, '""') + '"';
function expParts() {
  derive(); const rows = ['image,id,ecd_um,feret_min_um,feret_max_um,aspect,roundness,status,um_per_px,window,x_px,y_px'];
  for (const r of IM) if (r.state === 'done') for (const p of r.res.parts) rows.push([csvq(r.name), p.id, p.ecd.toFixed(2), p.fmin.toFixed(2), p.fmax.toFixed(2), p.aspect.toFixed(3), p.round.toFixed(3), p.status, r.cal.umPerPx.toFixed(4), r.cal.window, p.cx.toFixed(1), p.cy.toFixed(1)].join(','));
  if (rows.length < 2) { toast('Nothing to export yet.'); return; }
  deliver(fileBase() + '_particles.csv', header() + '\n' + rows.join('\n'));
}
function expClasses() {
  const st = window._st; if (!st) { toast('Nothing to export yet.'); return; }
  const rows = ['class_lo_um,class_hi_um,count,pct_count,pct_volume,cum_pct_count,cum_pct_volume', ...st.bins.map(b => [b.lo.toFixed(2), b.hi.toFixed(2), b.cnt, b.np.toFixed(3), b.mp.toFixed(3), b.cnp.toFixed(3), b.cmp.toFixed(3)].join(','))];
  const sum = ['', `# n,${st.n}`, `# count basis D10/D50/D90 um,${st.number.d10.toFixed(1)},${st.number.d50.toFixed(1)},${st.number.d90.toFixed(1)}`, `# volume basis D10/D50/D90 um,${st.mass.d10.toFixed(1)},${st.mass.d50.toFixed(1)},${st.mass.d90.toFixed(1)}`, `# D[3,2] um,${st.d32.toFixed(1)}`, `# D[4,3] um,${st.d43.toFixed(1)}`];
  deliver(fileBase() + '_classes.csv', header() + sum.join('\n') + '\n' + rows.join('\n'));
}
const H = { load() { try { return JSON.parse(localStorage.getItem('pf.history') || '[]'); } catch (e) { return []; } }, save(a) { try { localStorage.setItem('pf.history', JSON.stringify(a.slice(-200))); } catch (e) {} } };
function saveHistory() {
  const st = window._st; if (!st) { toast('Nothing to save yet.'); return; }
  const m = meta(), a = H.load();
  a.push({ sample: m.sample, date: m.date, lat: m.geo && m.geo.lat, lon: m.geo && m.geo.lon, n: st.n, photos: IM.filter(r => r.state === 'done').length, measure: S.measure,
    n10: st.number.d10, n50: st.number.d50, n90: st.number.d90, v10: st.mass.d10, v50: st.mass.d50, v90: st.mass.d90, d32: st.d32, d43: st.d43 });
  H.save(a); renderHistory(); toast('Saved to history on this device.');
}
function renderHistory() {
  const a = H.load().slice().reverse();
  $('#histTable').innerHTML = a.length ? `<tr><th>Sample</th><th>n</th><th>D10v</th><th>D50v</th><th>D90v</th></tr>` + a.map(h => `<tr><td>${esc(h.sample)}<br><span class="hint">${h.date.slice(0, 16).replace('T', ' ')}</span></td><td>${h.n}</td><td>${fmt(h.v10)}</td><td>${fmt(h.v50)}</td><td>${fmt(h.v90)}</td></tr>`).join('') : '<tr><td class="hint">Saved results appear here.</td></tr>';
}
function histCsv() { const a = H.load(); if (!a.length) { toast('History is empty.'); return; }
  const k = ['sample', 'date', 'lat', 'lon', 'n', 'photos', 'measure', 'n10', 'n50', 'n90', 'v10', 'v50', 'v90', 'd32', 'd43'];
  deliver('particle_field_history.csv', k.join(',') + '\n' + a.map(h => k.map(x => typeof h[x] === 'number' ? h[x].toFixed(x === 'lat' || x === 'lon' ? 6 : 2) : csvq(h[x] ?? '')).join(',')).join('\n')); }

/* ---------------- wiring ---------------- */
function bindSettings() {
  const map = [['#sPitch', 'pitch', true], ['#sMeasure', 'measure'], ['#sMin', 'min', true], ['#sMax', 'max', true], ['#sThr', 'thrMode'], ['#sThrV', 'thr', true], ['#sBins', 'bins'], ['#sShape', 'shape'], ['#sStillW', 'stillW', true], ['#standH', 'standH'], ['#customZ', 'customZ', true]];
  for (const [sel, k, num] of map) { const el = $(sel); el.value = S[k]; el.addEventListener('change', () => { S[k] = num ? +el.value : el.value; saveS(); sync(); reanalyse(); }); }
  for (const [sel, k] of [['#sSplit', 'split'], ['#sHeight', 'height']]) { const el = $(sel); el.checked = !!S[k]; el.addEventListener('change', () => { S[k] = el.checked; saveS(); reanalyse(); }); }
  const sync = () => { $('#sThrManualWrap').hidden = S.thrMode !== 'manual'; $('#customZwrap').hidden = S.standH !== 'custom'; };
  sync();
}
function init() {
  $$('nav button').forEach(b => b.addEventListener('click', () => { $$('nav button').forEach(x => x.setAttribute('aria-current', x === b ? 'true' : 'false')); for (const t of ['capture', 'images', 'results']) $('#tab-' + t).hidden = t !== b.dataset.tab; if (b.dataset.tab === 'results') renderResults(); window.scrollTo(0, 0); }));
  $('#btnShoot').onclick = () => $('#fileShoot').click(); $('#btnImport').onclick = () => $('#fileImport').click();
  $('#fileShoot').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  $('#fileImport').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  $('#imgList').addEventListener('click', e => { const rm = e.target.closest('[data-rm]'); if (rm) { IM.splice(+rm.dataset.rm, 1); renderAll(); return; } const li = e.target.closest('li'); if (li) openViewer(+li.dataset.i); });
  $('#vClose').onclick = () => { $('#viewer').hidden = true; V.r = null; };
  $('#vMode').onclick = () => { V.mode = V.mode === 'outlines' ? 'image' : 'outlines'; $('#vMode').textContent = V.mode === 'outlines' ? 'Outlines' : 'Photo only'; drawViewer(); };
  addEventListener('resize', () => { if (V.r) { fitViewer(); drawViewer(); } });
  setupViewerGestures();
  $('#btnLive').onclick = openLive; $('#lvClose').onclick = closeLive;
  $('#btnSettings').onclick = () => $('#settings').hidden = false; $('#setClose').onclick = () => { $('#settings').hidden = true; renderAll(); };
  $('#settings').addEventListener('click', e => { if (e.target.id === 'settings') { $('#settings').hidden = true; renderAll(); } });
  $$('#basisSeg button').forEach(b => { b.setAttribute('aria-pressed', b.dataset.b === S.basis ? 'true' : 'false'); b.onclick = () => { S.basis = b.dataset.b; saveS(); $$('#basisSeg button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); renderResults(); }; });
  $('#expParts').onclick = expParts; $('#expClasses').onclick = expClasses; $('#expSave').onclick = saveHistory; $('#histCsv').onclick = histCsv;
  $('#histClear').onclick = () => { if (confirm('Delete all saved history on this device?')) { H.save([]); renderHistory(); } };
  $('#btnGeo').onclick = () => { if (!navigator.geolocation) { toast('Location is not available.'); return; } $('#geoText').textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition(p => { geo = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; $('#geoText').textContent = `${geo.lat.toFixed(5)}, ${geo.lon.toFixed(5)} (±${Math.round(geo.acc)} m)`; },
      e => { $('#geoText').textContent = ''; toast('Location unavailable: ' + e.message); }, { enableHighAccuracy: true, timeout: 15000 }); };
  $('#verLine').textContent = 'Version ' + VERSION;
  $('#btnUpdate').onclick = async () => {
    toast('Checking for update…');
    try {
      if ('serviceWorker' in navigator) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); }
      if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); }
    } catch (e) {}
    location.reload();
  };
  bindSettings(); renderAll();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
