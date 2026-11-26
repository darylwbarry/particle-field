// Synthetic accuracy test: render a phone-like photo of the tray with known circular particles,
// then run calibration + measurement and compare.  node synth.js [umPerPx] [blurSigmaPx] [seed] [window]
const PF = require('../www/core.js');
const fs = require('fs');
const UM = +(process.argv[2] || 8), SIG = +(process.argv[3] || 1.3), SEED = +(process.argv[4] || 1), WIN = process.argv[5] || 'L';
let s = SEED * 9973 + 7; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const W = 4032, H = 3024, L = PF.LAYOUT, P = L.pitch_mm, R = L.dot_d_mm / 2;
const c0 = [(L.ni - 1) / 2, (L.nj - 1) / 2];
const win = L.windows.find(w => w.name === WIN);
const inWin = (i, j) => L.windows.some(w => i >= w.i0 && i <= w.i1 && j >= w.j0 && j <= w.j1);
// ROI in lattice-centred mm
const roi = [(win.i0 - 1 - c0[0]) * P + R + L.roi_margin_mm, (win.i1 + 1 - c0[0]) * P - R - L.roi_margin_mm, (win.j0 - 1 - c0[1]) * P + R + L.roi_margin_mm, (win.j1 + 1 - c0[1]) * P - R - L.roi_margin_mm];
const rc = [(roi[0] + roi[1]) / 2, (roi[2] + roi[3]) / 2];
// camera: plane mm -> image px (undistorted), centred on ROI, rotated, slightly tilted
const th = 0.12, sc = 1000 / UM, cth = Math.cos(th), sth = Math.sin(th), px = 0.004, py = -0.003;
const Hm = [sc * cth, -sc * sth, 0, sc * sth, sc * cth, 0, px, py, 1];
// translate so ROI centre lands at image centre
let q = PF.apply(Hm, rc[0], rc[1]); Hm[2] = 0; Hm[5] = 0;
q = PF.apply(Hm, rc[0], rc[1]); // need full solve; do it by adjusting with affine correction
const T = [1, 0, W / 2 - q[0], 0, 1, H / 2 - q[1], 0, 0, 1];
const mul = (A, B) => { const C = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C.push(A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]); return C; };
const Hfull = mul(T, Hm), Hinv = PF.inv3(Hfull);
const D = PF.mkDist(W, H, 0.03);
// particles
const sizes = [2000, 1000, 1000, 500, 500, 500, 300, 300, 300, 300, ...Array(24).fill(200), ...Array(10).fill(150), ...Array(10).fill(100)];
const parts = [];
for (const d of sizes) { for (let a = 0; a < 2000; a++) { const r = d / 2000, x = roi[0] + r + 0.15 + rnd() * (roi[1] - roi[0] - 2 * r - 0.3), y = roi[2] + r + 0.15 + rnd() * (roi[3] - roi[2] - 2 * r - 0.3);
  if (parts.every(p => Math.hypot(p.x - x, p.y - y) > p.r + r + 0.08)) { parts.push({ x, y, r, d }); break; } } }
// render transmission with 4x4 supersampling
const img = new Float32Array(W * H), SS = 4;
const opaqueAt = (X, Y) => {
  const fi = X / P + c0[0], fj = Y / P + c0[1], i = Math.round(fi), j = Math.round(fj);
  if (i >= 0 && i < L.ni && j >= 0 && j < L.nj && !inWin(i, j) && Math.hypot((fi - i) * P, (fj - j) * P) <= R) return true;
  for (const p of parts) if ((X - p.x) ** 2 + (Y - p.y) ** 2 <= p.r * p.r) return true;
  return false;
};
const t0 = Date.now();
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  // fast path: test pixel centre neighbourhood coarsely
  let cov = 0;
  const u = D.und(x, y), pc = PF.apply(Hinv, u[0], u[1]);
  const fi = pc[0] / P + c0[0], fj = pc[1] / P + c0[1], i = Math.round(fi), j = Math.round(fj);
  const dd = Math.hypot((fi - i) * P, (fj - j) * P), pix = UM / 1000 * 1.5;
  let near = Math.abs(dd - R) < pix && i >= 0 && i < L.ni && j >= 0 && j < L.nj && !inWin(i, j);
  let inside = dd <= R && i >= 0 && i < L.ni && j >= 0 && j < L.nj && !inWin(i, j);
  for (const p of parts) { const e = Math.hypot(pc[0] - p.x, pc[1] - p.y) - p.r; if (Math.abs(e) < pix) near = true; else if (e < 0) inside = true; }
  if (near) { for (let a = 0; a < SS; a++) for (let b = 0; b < SS; b++) { const uu = D.und(x - 0.5 + (a + 0.5) / SS, y - 0.5 + (b + 0.5) / SS), P2 = PF.apply(Hinv, uu[0], uu[1]); if (opaqueAt(P2[0], P2[1])) cov++; } cov /= SS * SS; }
  else cov = inside ? 1 : 0;
  const rr = ((x - W / 2) ** 2 + (y - H / 2) ** 2) / (W * W / 4 + H * H / 4);
  const illum = 0.75 * (1 - 0.35 * rr) * (1 + 0.04 * Math.sin(x / 300) * Math.cos(y / 250));
  img[y * W + x] = illum * (1 - cov) + 0.01 * illum * cov;
}
// optics blur, phone sharpening, noise
const gblur = (src, sigma) => { const r = Math.ceil(3 * sigma), k = []; let ks = 0; for (let i = -r; i <= r; i++) { const v = Math.exp(-i * i / (2 * sigma * sigma)); k.push(v); ks += v; }
  const t = new Float32Array(W * H), o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s2 = 0; for (let i = -r; i <= r; i++) { const xx = Math.min(W - 1, Math.max(0, x + i)); s2 += src[y * W + xx] * k[i + r]; } t[y * W + x] = s2 / ks; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s2 = 0; for (let i = -r; i <= r; i++) { const yy = Math.min(H - 1, Math.max(0, y + i)); s2 += t[yy * W + x] * k[i + r]; } o[y * W + x] = s2 / ks; }
  return o; };
let b = gblur(img, SIG); const bb = gblur(b, 2.0);
const rgba = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) { let v = b[i] + 0.5 * (b[i] - bb[i]) + 0.008 * gauss(); v = Math.max(0, v);
  const sv = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; const c = Math.round(Math.min(1, sv) * 255);
  rgba[i * 4] = c; rgba[i * 4 + 1] = c; rgba[i * 4 + 2] = c; rgba[i * 4 + 3] = 255; }
const tR = Date.now();
// pipeline
const g = PF.grayLinear(rgba, W, H);
const cal = PF.calibrate(g, W, H);
if (!cal.ok) { console.log('CAL FAIL', cal.why); process.exit(1); }
const res = PF.measureParticles(g, W, H, cal, { heightZmm: 0 });
const tP = Date.now();
const Q = PF.quality(cal);
// match measured particles to truth via plane coords. Measured plane coords are in the lattice frame up to a rigid motion,
// so match by image position instead (truth -> image).
const truthImg = parts.map(p => { const u = PF.apply(Hfull, p.x, p.y); return D.dist(u[0], u[1]); });
const rows = [];
for (let k = 0; k < parts.length; k++) { const t = truthImg[k]; let best = null, bd = Infinity; for (const m of res.parts) { const d = Math.hypot(m.cx - t[0], m.cy - t[1]); if (d < bd) { bd = d; best = m; } }
  if (best && bd < 5) rows.push({ d: parts[k].d, ecd: best.ecd, fmin: best.fmin, fmax: best.fmax, edge: best.edge }); }
const by = {}; for (const r of rows) (by[r.d] = by[r.d] || []).push((r.ecd / r.d - 1) * 100);
console.log(`um/px true ${UM}  measured ${cal.umPerPx.toFixed(3)}  window ${cal.window}  dots ${cal.nDots}  rms ${cal.rmsUm.toFixed(2)} um  k1 ${cal.k1.toFixed(4)}  edgeW ${cal.edgeWidthPx.toFixed(2)} px  blurSigma est ${Q.blurSigmaPx.toFixed(2)} (true ${Math.hypot(SIG, 0).toFixed(2)})`);
console.log(`matched ${rows.length}/${parts.length} (detected ${res.parts.length})  render ${(tR - t0) / 1000}s  pipeline ${(tP - tR) / 1000}s  thr ${res.thr.toFixed(3)} norm ${res.bgNorm.toFixed(3)}  quality ${Q.level}: ${Q.msg}  est200 ±${Q.est200pct.toFixed(2)}%`);
for (const d of Object.keys(by).map(Number).sort((a, b) => a - b)) { const e = by[d], mean = e.reduce((a, b) => a + b, 0) / e.length, sd = Math.sqrt(e.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, e.length - 1)), mx = Math.max(...e.map(Math.abs));
  console.log(`  D=${String(d).padStart(4)} um  n=${String(e.length).padStart(2)}  mean err ${mean.toFixed(2).padStart(6)}%  sd ${sd.toFixed(2)}%  max|err| ${mx.toFixed(2)}%`); }
if (process.env.SAVE) { const g8 = Buffer.alloc(W * H); for (let i = 0; i < W * H; i++) g8[i] = rgba[i * 4]; fs.writeFileSync(process.env.SAVE, g8); fs.writeFileSync(process.env.SAVE + '.truth.json', JSON.stringify(parts)); }
module.exports = { rgba, W, H };
