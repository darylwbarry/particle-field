/* Particle Field — measurement core.
 * Pure functions, no DOM. Runs in a Web Worker, on the main thread, or in Node (tests).
 *
 * Pipeline per photo
 *   1. sRGB -> linear luminance (edge physics only holds in linear light)
 *   2. find the black-dot lattice, index it, fit plane->image homography + radial distortion k1
 *   3. locate the dot-free window (L or S) from the occupancy pattern -> ROI in mm on the tray plane
 *   4. segment particles inside the ROI on a flat-fielded image (ratio to local background)
 *   5. sub-pixel area from grey-level coverage in an edge band (blur/sharpening invariant),
 *      convert to mm^2 with the local Jacobian, ferets in plane coordinates, optional height correction
 */
(function (root) {
'use strict';

const LAYOUT = {
  pitch_mm: 2.0, dot_d_mm: 1.0, ni: 33, nj: 22, roi_margin_mm: 0.5,
  windows: [ { name: 'L', i0: 6, i1: 14, j0: 8, j1: 13 }, { name: 'S', i0: 22, i1: 24, j0: 10, j1: 11 } ]
};

/* ---------------- basic image ops ---------------- */
let LIN = null;
function linLUT() {
  if (LIN) return LIN;
  LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  return LIN;
}
// RGBA bytes -> linear luminance 0..1
function grayLinear(rgba, w, h) {
  const L = linLUT(), n = w * h, g = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = 0.2126 * L[rgba[j]] + 0.7152 * L[rgba[j + 1]] + 0.0722 * L[rgba[j + 2]];
  return g;
}
function downsample(g, w, h, f) {
  if (f <= 1) return { g, w, h, f: 1 };
  const W = Math.floor(w / f), H = Math.floor(h / f), o = new Float32Array(W * H), k = 1 / (f * f);
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    let s = 0; for (let dy = 0; dy < f; dy++) { const r = (Y * f + dy) * w + X * f; for (let dx = 0; dx < f; dx++) s += g[r + dx]; }
    o[Y * W + X] = s * k;
  }
  return { g: o, w: W, h: H, f };
}
function boxBlur(src, w, h, r) {
  if (r <= 0) return Float32Array.from(src);
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), pre = new Float64Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) pre[x + 1] = pre[x] + src[o + x];
    for (let x = 0; x < w; x++) { const a = x > r ? x - r : 0, b = x + r < w ? x + r : w - 1; tmp[o + x] = (pre[b + 1] - pre[a]) / (b - a + 1); } }
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) pre[y + 1] = pre[y] + tmp[y * w + x];
    for (let y = 0; y < h; y++) { const a = y > r ? y - r : 0, b = y + r < h ? y + r : h - 1; out[y * w + x] = (pre[b + 1] - pre[a]) / (b - a + 1); } }
  return out;
}
// 1-D running max/min (monotonic deque), applied separably -> square window (2r+1)
function runExt(src, dst, n, stride, off, r, isMax, dq, buf) {
  for (let i = 0; i < n; i++) buf[i] = src[off + i * stride];
  let head = 0, tail = 0;
  for (let i = 0, j = 0; i < n; i++) {
    const lim = Math.min(n - 1, i + r);
    while (j <= lim) { const v = buf[j]; while (tail > head && (isMax ? buf[dq[tail - 1]] <= v : buf[dq[tail - 1]] >= v)) tail--; dq[tail++] = j; j++; }
    while (dq[head] < i - r) head++;
    dst[off + i * stride] = buf[dq[head]];
  }
}
function extFilter(g, w, h, r, isMax) {
  const t = new Float32Array(w * h), o = new Float32Array(w * h), m = Math.max(w, h), dq = new Int32Array(m), buf = new Float32Array(m);
  for (let y = 0; y < h; y++) runExt(g, t, w, 1, y * w, r, isMax, dq, buf);
  for (let x = 0; x < w; x++) runExt(t, o, h, w, x, r, isMax, dq, buf);
  return o;
}
// background under dark objects: closing (max then min) on a smoothed, downsampled copy, then upsampled
function background(g, w, h, rPx) {
  const ds = Math.max(1, Math.min(8, Math.floor(rPx / 6)));
  const d = downsample(boxBlur(g, w, h, 1), w, h, ds);
  const r = Math.max(2, Math.ceil(rPx / ds));
  let b = extFilter(extFilter(d.g, d.w, d.h, r, true), d.w, d.h, r, false);
  b = boxBlur(b, d.w, d.h, Math.max(1, Math.round(r / 2)));
  if (ds === 1 && d.w === w && d.h === h) return b;
  const o = new Float32Array(w * h), W = d.w, H = d.h;
  for (let y = 0; y < h; y++) { let fy = (y + 0.5) / ds - 0.5; if (fy < 0) fy = 0; if (fy > H - 1) fy = H - 1; const y0 = Math.floor(fy), y1 = Math.min(H - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) { let fx = (x + 0.5) / ds - 0.5; if (fx < 0) fx = 0; if (fx > W - 1) fx = W - 1; const x0 = Math.floor(fx), x1 = Math.min(W - 1, x0 + 1), tx = fx - x0;
      o[y * w + x] = (b[y0 * W + x0] * (1 - tx) + b[y0 * W + x1] * tx) * (1 - ty) + (b[y1 * W + x0] * (1 - tx) + b[y1 * W + x1] * tx) * ty; } }
  return o;
}
function morph(m, w, h, r, erode) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h), pre = new Int32Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) pre[x + 1] = pre[x] + m[o + x];
    for (let x = 0; x < w; x++) { const a = x > r ? x - r : 0, b = x + r < w ? x + r : w - 1, s = pre[b + 1] - pre[a]; tmp[o + x] = erode ? (s === b - a + 1 ? 1 : 0) : (s > 0 ? 1 : 0); } }
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) pre[y + 1] = pre[y] + tmp[y * w + x];
    for (let y = 0; y < h; y++) { const a = y > r ? y - r : 0, b = y + r < h ? y + r : h - 1, s = pre[b + 1] - pre[a]; out[y * w + x] = erode ? (s === b - a + 1 ? 1 : 0) : (s > 0 ? 1 : 0); } }
  return out;
}
function otsu(hist, n) {
  let sum = 0; for (let i = 0; i < hist.length; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, t = hist.length >> 1;
  for (let i = 0; i < hist.length; i++) { wB += hist[i]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; t = i; } }
  return t;
}
function fillHoles(m, w, h) {
  const n = w * h, seen = new Uint8Array(n), st = new Int32Array(n); let sp = 0;
  const push = i => { if (!m[i] && !seen[i]) { seen[i] = 1; st[sp++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) { const i = st[--sp], x = i % w; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < n - w) push(i + w); }
  const out = new Uint8Array(m); for (let i = 0; i < n; i++) if (!m[i] && !seen[i]) out[i] = 1;
  return out;
}
function labelCC(m, w, h) {
  const n = w * h, lab = new Int32Array(n), st = new Int32Array(n); let nl = 0;
  for (let i = 0; i < n; i++) { if (!m[i] || lab[i]) continue; nl++; let sp = 0; st[sp++] = i; lab[i] = nl;
    while (sp) { const p = st[--sp], x = p % w, y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const q = yy * w + xx; if (m[q] && !lab[q]) { lab[q] = nl; st[sp++] = q; } } } } }
  return { lab, n: nl };
}
function chamfer(m, w, h) {
  const n = w * h, d = new Int32Array(n), BIG = 1 << 28;
  for (let i = 0; i < n; i++) d[i] = m[i] ? BIG : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!m[i]) continue; let v = d[i];
    const L = x > 0 ? d[i - 1] : 0, U = y > 0 ? d[i - w] : 0, UL = (x > 0 && y > 0) ? d[i - w - 1] : 0, UR = (x < w - 1 && y > 0) ? d[i - w + 1] : 0;
    v = Math.min(v, L + 3, U + 3, UL + 4, UR + 4); d[i] = v; }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (!m[i]) continue; let v = d[i];
    const R = x < w - 1 ? d[i + 1] : 0, D = y < h - 1 ? d[i + w] : 0, DR = (x < w - 1 && y < h - 1) ? d[i + w + 1] : 0, DL = (x > 0 && y < h - 1) ? d[i + w - 1] : 0;
    v = Math.min(v, R + 3, D + 3, DR + 4, DL + 4); d[i] = v; }
  return d;
}
function reconstruct(f, g, w, h) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; let v = f[i];
    if (x > 0 && f[i - 1] > v) v = f[i - 1];
    if (y > 0) { if (f[i - w] > v) v = f[i - w]; if (x > 0 && f[i - w - 1] > v) v = f[i - w - 1]; if (x < w - 1 && f[i - w + 1] > v) v = f[i - w + 1]; }
    f[i] = v < g[i] ? v : g[i]; }
  const q = [];
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; let v = f[i];
    if (x < w - 1 && f[i + 1] > v) v = f[i + 1];
    if (y < h - 1) { if (f[i + w] > v) v = f[i + w]; if (x < w - 1 && f[i + w + 1] > v) v = f[i + w + 1]; if (x > 0 && f[i + w - 1] > v) v = f[i + w - 1]; }
    v = v < g[i] ? v : g[i]; f[i] = v;
    const nb = [x < w - 1 ? i + 1 : -1, y < h - 1 ? i + w : -1, (x < w - 1 && y < h - 1) ? i + w + 1 : -1, (x > 0 && y < h - 1) ? i + w - 1 : -1];
    for (const j of nb) { if (j >= 0 && f[j] < v && f[j] < g[j]) { q.push(i); break; } } }
  for (let hd = 0; hd < q.length; hd++) { const p = q[hd], x = p % w, y = (p - x) / w, fp = f[p];
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w || (!dx && !dy)) continue; const j = yy * w + xx;
        if (f[j] < fp && g[j] !== f[j]) { f[j] = fp < g[j] ? fp : g[j]; q.push(j); } } } }
  return f;
}
// marker-controlled watershed on the distance transform (splits touching particles at necks)
function watershed(m, w, h, depthPx) {
  const n = w * h, d = chamfer(m, w, h), H = Math.max(1, Math.round(depthPx * 3));
  const f = new Int32Array(n); for (let i = 0; i < n; i++) f[i] = d[i] > H ? d[i] - H : 0;
  reconstruct(f, d, w, h);
  const f2 = new Int32Array(n); for (let i = 0; i < n; i++) f2[i] = f[i] > 0 ? f[i] - 1 : 0;
  reconstruct(f2, f, w, h);
  const mk = new Uint8Array(n); for (let i = 0; i < n; i++) if (m[i] && f[i] > f2[i]) mk[i] = 1;
  const cc = labelCC(m, w, h), has = new Uint8Array(cc.n + 1), arg = new Int32Array(cc.n + 1).fill(-1);
  for (let i = 0; i < n; i++) { const c = cc.lab[i]; if (!c) continue; if (mk[i]) has[c] = 1; if (arg[c] < 0 || d[i] > d[arg[c]]) arg[c] = i; }
  for (let c = 1; c <= cc.n; c++) if (!has[c]) mk[arg[c]] = 1;
  const ml = labelCC(mk, w, h), lab = ml.lab;
  let maxD = 0; for (let i = 0; i < n; i++) if (d[i] > maxD) maxD = d[i];
  const buckets = new Array(maxD + 1); for (let i = 0; i <= maxD; i++) buckets[i] = [];
  for (let i = 0; i < n; i++) if (lab[i]) buckets[d[i]].push(i);
  for (let lv = maxD; lv >= 0; lv--) { const b = buckets[lv];
    for (let k = 0; k < b.length; k++) { const p = b[k], L = lab[p], x = p % w, y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const j = yy * w + xx;
          if (m[j] && !lab[j]) { lab[j] = L; buckets[d[j] < lv ? d[j] : lv].push(j); } } } }
    buckets[lv] = null; }
  return { lab, n: ml.n };
}
function convexHull(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cr = (o, a, c) => (a[0] - o[0]) * (c[1] - o[1]) - (a[1] - o[1]) * (c[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up);
}
// ferets of a convex polygon in physical units; pad = one pixel footprint (added once)
function ferets(hull, pad) {
  if (hull.length < 2) return [pad, pad];
  let fmax = 0; for (let i = 0; i < hull.length; i++) for (let j = i + 1; j < hull.length; j++) { const dx = hull[i][0] - hull[j][0], dy = hull[i][1] - hull[j][1], d = dx * dx + dy * dy; if (d > fmax) fmax = d; }
  fmax = Math.sqrt(fmax) + pad;
  if (hull.length < 3) return [fmax, pad];
  let fmin = Infinity;
  for (let i = 0; i < hull.length; i++) { const a = hull[i], c = hull[(i + 1) % hull.length], ex = c[0] - a[0], ey = c[1] - a[1], len = Math.hypot(ex, ey); if (!len) continue;
    let mx = 0; for (const p of hull) { const dd = Math.abs(ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / len; if (dd > mx) mx = dd; }
    if (mx < fmin) fmin = mx; }
  return [fmax, Math.min(fmax, fmin + pad)];
}

/* ---------------- geometry ---------------- */
function solve(A, b) { // Gaussian elimination with partial pivoting, A n×n (array of arrays)
  const n = b.length; A = A.map(r => r.slice()); b = b.slice();
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]]; const d = A[c][c]; if (Math.abs(d) < 1e-15) return null;
    for (let r = c + 1; r < n; r++) { const f = A[r][c] / d; if (!f) continue; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; } }
  const x = new Array(n); for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}
function normT(pts) { let mx = 0, my = 0; for (const p of pts) { mx += p[0]; my += p[1]; } mx /= pts.length; my /= pts.length;
  let s = 0; for (const p of pts) s += Math.hypot(p[0] - mx, p[1] - my); s = Math.SQRT2 / (s / pts.length || 1);
  return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1]; }
function mul3(A, B) { const C = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return C; }
function inv3(m) { const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det]; }
function apply(H, x, y) { const z = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z]; }
// homography src->dst, least squares with h33 = 1 on Hartley-normalised points
function fitH(src, dst) {
  if (src.length < 4) return null;
  const Ts = normT(src), Td = normT(dst), N = Array.from({ length: 8 }, () => new Array(8).fill(0)), r = new Array(8).fill(0);
  for (let k = 0; k < src.length; k++) {
    const [x, y] = apply(Ts, src[k][0], src[k][1]), [u, v] = apply(Td, dst[k][0], dst[k][1]);
    const rows = [[x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]];
    for (const R of rows) { for (let i = 0; i < 8; i++) { r[i] += R[i] * R[8]; for (let j = 0; j < 8; j++) N[i][j] += R[i] * R[j]; } }
  }
  const h = solve(N, r); if (!h) return null;
  const Hn = [...h, 1], H = mul3(inv3(Td), mul3(Hn, Ts)); const s = H[8]; return H.map(v => v / s);
}
// radial distortion about image centre: undistorted = c + (d - c)(1 + k1 rho^2), rho normalised by half-diagonal
function mkDist(w, h, k1) {
  const cx = w / 2, cy = h / 2, s2 = (w * w + h * h) / 4;
  return {
    k1,
    und(x, y) { const dx = x - cx, dy = y - cy, f = 1 + k1 * (dx * dx + dy * dy) / s2; return [cx + dx * f, cy + dy * f]; },
    dist(x, y) { let dx = x - cx, dy = y - cy; const ux = dx, uy = dy; for (let it = 0; it < 6; it++) { const f = 1 + k1 * (dx * dx + dy * dy) / s2; dx = ux / f; dy = uy / f; } return [cx + dx, cy + dy]; }
  };
}

/* ---------------- dot lattice ---------------- */
function findBlobs(g, w, h, bg, frac) {
  // Dark, roughly disc-shaped blobs. Printed dots are often fatter than designed and touch their neighbours,
  // so dots are found as the *cores* of the dark mask (distance transform), which stay separate when rims merge.
  const n = w * h, m = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = g[i] < frac * bg[i] ? 1 : 0;
  const d = chamfer(m, w, h), cc = labelCC(m, w, h);
  const A = new Float64Array(cc.n + 1), MD = new Int32Array(cc.n + 1);
  for (let i = 0; i < n; i++) { const L = cc.lab[i]; if (!L) continue; A[L]++; if (d[i] > MD[L]) MD[L] = d[i]; }
  // typical dot radius: area-weighted mode of the blobs' inscribed radius (merged dots keep a single dot's radius)
  const hist = new Map();
  for (let L = 1; L <= cc.n; L++) { if (A[L] < 6 || MD[L] < 4) continue; const r = MD[L] / 3, k = Math.round(Math.log2(r) * 4);
    hist.set(k, (hist.get(k) || 0) + Math.min(A[L], 6 * Math.PI * r * r)); }
  let bk = null, bv = 0; for (const [k] of hist) { const v = (hist.get(k - 1) || 0) + hist.get(k) + (hist.get(k + 1) || 0); if (v > bv) { bv = v; bk = k; } }
  if (bk === null) return [];
  const Rm = Math.pow(2, bk / 4), thr = Math.max(3, 0.5 * Rm * 3);
  const core = new Uint8Array(n); for (let i = 0; i < n; i++) core[i] = d[i] > thr ? 1 : 0;
  const { lab, n: nl } = labelCC(core, w, h);
  const CA = new Float64Array(nl + 1), SX = new Float64Array(nl + 1), SY = new Float64Array(nl + 1), CM = new Int32Array(nl + 1), x0 = new Int32Array(nl + 1).fill(1e9), x1 = new Int32Array(nl + 1).fill(-1), y0 = new Int32Array(nl + 1).fill(1e9), y1 = new Int32Array(nl + 1).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, L = lab[i]; if (!L) continue; CA[L]++; SX[L] += x; SY[L] += y; if (d[i] > CM[L]) CM[L] = d[i]; if (x < x0[L]) x0[L] = x; if (x > x1[L]) x1[L] = x; if (y < y0[L]) y0[L] = y; if (y > y1[L]) y1[L] = y; }
  const out = [];
  for (let L = 1; L <= nl; L++) { if (CA[L] < 1) continue;
    const r = CM[L] / 3, cx = SX[L] / CA[L], cy = SY[L] / CA[L];
    if (cx - r < 1 || cy - r < 1 || cx + r > w - 2 || cy + r > h - 2) continue;      // cut off by the frame
    const bw = x1[L] - x0[L] + 1, bh = y1[L] - y0[L] + 1;
    out.push({ x: cx, y: cy, a: Math.PI * r * r, fill: CA[L] / (Math.PI / 4 * bw * bh), asp: bw / bh }); }
  return out;
}
function gridIndex(pts, cell) {
  const G = new Map(), key = (i, j) => i * 100003 + j;
  pts.forEach((p, k) => { const i = Math.floor(p.x / cell), j = Math.floor(p.y / cell), K = key(i, j); if (!G.has(K)) G.set(K, []); G.get(K).push(k); });
  return { near(x, y, r) { const res = []; const i0 = Math.floor((x - r) / cell), i1 = Math.floor((x + r) / cell), j0 = Math.floor((y - r) / cell), j1 = Math.floor((y + r) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const c = G.get(key(i, j)); if (c) for (const k of c) { const d = Math.hypot(pts[k].x - x, pts[k].y - y); if (d <= r) res.push([k, d]); } }
    return res; } };
}
function median(a) { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

/** Detect and index the lattice on a (downsampled) linear grey image. Returns indexed dots in that image's pixels. */
function indexLattice(g, w, h) {
  // Try several darkness thresholds: 50 % suits crisp dots; lower ones isolate the black cores when
  // the print has grey halos around the dots (black showing through thin white) or the dots touch.
  const bg = background(g, w, h, Math.max(6, Math.round(Math.max(w, h) / 14)));
  let best = null;
  for (const frac of [0.5, 0.32, 0.2, 0.12]) {
    const r = latticeAt(findBlobs(g, w, h, bg, frac), w, h);
    if (r.ok && (!best || r.pts.length > best.pts.length * 1.15)) best = r;
  }
  return best || { ok: false, why: 'No calibration dot grid found. Is the tray in the picture, in focus and evenly lit?' };
}
function latticeAt(blobs, w, h) {
  const cands = blobs.filter(b => b.fill > 0.55 && b.fill < 1.2 && b.asp > 0.5 && b.asp < 2);
  if (cands.length < 12) return { ok: false };
  // the dots are the size class that forms a lattice; try the most common size classes, keep the best grid
  const hist = new Map(); for (const b of cands) { const k = Math.round(Math.log2(b.a) * 8); hist.set(k, (hist.get(k) || 0) + 1); }
  const peaks = [...hist.keys()].map(k => [k, (hist.get(k - 1) || 0) + hist.get(k) + (hist.get(k + 1) || 0)]).sort((a, b) => b[1] - a[1]);
  const tried = []; let best = null;
  for (const [k, c] of peaks) {
    if (tried.length >= 5 || c < 8) break;
    if (tried.some(t => Math.abs(t - k) <= 3)) continue; tried.push(k);
    const r = latticeFrom(cands, Math.pow(2, k / 8), w, h);
    if (r.ok && (!best || r.pts.length > best.pts.length)) best = r;
  }
  return best || { ok: false, why: 'Could not follow the calibration dot grid.' };
}
function latticeFrom(cands, aMode, w, h) {
  const dots = cands.filter(b => b.a > aMode * 0.5 && b.a < aMode * 2);
  if (dots.length < 12) return { ok: false };
  const dia = 2 * Math.sqrt(aMode / Math.PI), GI = gridIndex(dots, dia * 2.5);
  const nn = dots.map(p => { const c = GI.near(p.x, p.y, dia * 4).filter(q => q[1] > 0.5).sort((a, b) => a[1] - b[1]); return c.length ? c[0][1] : NaN; }).filter(isFinite);
  const pitch0 = median(nn); if (!isFinite(pitch0)) return { ok: false };
  // dot diameter is half the pitch on this tray; reject size classes that do not fit that geometry
  if (pitch0 < dia * 1.02 || pitch0 > dia * 3.5) return { ok: false };
  let cs = 0, sn = 0;
  for (const p of dots) for (const [k, d] of GI.near(p.x, p.y, pitch0 * 1.3)) { if (d < pitch0 * 0.7) continue; const t = 4 * Math.atan2(dots[k].y - p.y, dots[k].x - p.x); cs += Math.cos(t); sn += Math.sin(t); }
  const th = Math.atan2(sn, cs) / 4;
  let seed = -1, sd = Infinity;
  dots.forEach((p, k) => { const c = GI.near(p.x, p.y, pitch0 * 1.3).filter(q => q[1] > pitch0 * 0.7).length; const d = Math.hypot(p.x - w / 2, p.y - h / 2); if (c >= 3 && d < sd) { sd = d; seed = k; } });
  if (seed < 0) return { ok: false };
  const idx = new Array(dots.length).fill(null), used = new Map(), q = [];
  const A0 = [Math.cos(th) * pitch0, Math.sin(th) * pitch0], B0 = [-Math.sin(th) * pitch0, Math.cos(th) * pitch0];
  idx[seed] = { i: 0, j: 0, a: A0, b: B0 }; used.set('0,0', seed); q.push(seed);
  while (q.length) {
    const k = q.shift(), P = dots[k], I = idx[k];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const v = di ? [I.a[0] * di, I.a[1] * di] : [I.b[0] * dj, I.b[1] * dj];
      const tol = 0.3 * Math.hypot(v[0], v[1]);
      const c = GI.near(P.x + v[0], P.y + v[1], tol).sort((a, b) => a[1] - b[1]); if (!c.length) continue;
      const nk = c[0][0], key = (I.i + di) + ',' + (I.j + dj);
      if (idx[nk] || used.has(key)) continue;
      const real = [dots[nk].x - P.x, dots[nk].y - P.y];
      const na = di ? [real[0] * di, real[1] * di] : I.a, nb = dj ? [real[0] * dj, real[1] * dj] : I.b;
      idx[nk] = { i: I.i + di, j: I.j + dj, a: na, b: nb }; used.set(key, nk); q.push(nk);
    }
  }
  const pts = []; dots.forEach((p, k) => { if (idx[k]) pts.push({ i: idx[k].i, j: idx[k].j, x: p.x, y: p.y }); });
  if (pts.length < 12) return { ok: false };
  return { ok: true, pts, pitchPx: pitch0, dotDiaPx: dia, cands: dots };
}

/** Sub-pixel dot centres on the full-resolution image (intensity-weighted, background from an annulus). */
function refineDots(g, w, h, pts, pitchPx, dotDiaPx) {
  // Works for any dot size up to nearly a full pitch: background level is taken from the bright
  // interstitial corners of each dot's own lattice cell, not from a fixed annulus.
  const R = Math.min(0.5 * pitchPx, 0.65 * (dotDiaPx || pitchPx) + 2), Rc = 0.12 * pitchPx, st = Math.max(1, Math.floor(pitchPx / 40)), out = [];
  let tr = 0, per = 0; const core = [], dia = [], buf = [];
  for (const p of pts) {
    const x0 = Math.floor(p.x - R), x1 = Math.ceil(p.x + R), y0 = Math.floor(p.y - R), y1 = Math.ceil(p.y + R);
    if (x0 <= 0 || y0 <= 0 || x1 >= w - 1 || y1 >= h - 1) continue;
    buf.length = 0; let sc = 0, nc = 0;
    for (let y = y0; y <= y1; y += st) for (let x = x0; x <= x1; x += st) buf.push(g[y * w + x]);
    for (let y = Math.floor(p.y - Rc); y <= p.y + Rc; y++) for (let x = Math.floor(p.x - Rc); x <= p.x + Rc; x++) { sc += g[y * w + x]; nc++; }
    buf.sort((a, b) => a - b);
    const bgL = buf[Math.floor(0.92 * (buf.length - 1))], fgL = sc / nc, den = bgL - fgL; if (den <= 0.05 * bgL) continue; core.push(fgL / bgL);
    let sw = 0, sx = 0, sy = 0, ntr = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { if (Math.hypot(x - p.x, y - p.y) > R) continue;
      let c = (bgL - g[y * w + x]) / den; if (c < 0.12) continue; if (c > 1) c = 1; sw += c; sx += c * x; sy += c * y; if (c > 0.1 && c < 0.9) ntr++; }
    if (sw <= 0) continue;
    out.push({ i: p.i, j: p.j, x: sx / sw, y: sy / sw });
    tr += ntr; per += 2 * Math.sqrt(Math.PI * sw); dia.push(2 * Math.sqrt(sw / Math.PI));
  }
  return { pts: out, edgeWidthPx: per ? tr / per : NaN, coreRatio: median(core), dotDiaPx: median(dia) };
}

function fitWithDistortion(pts, w, h, pitch) {
  const src = pts.map(p => [p.i * pitch, p.j * pitch]);
  const evalK = k1 => { const D = mkDist(w, h, k1), dst = pts.map(p => D.und(p.x, p.y)), H = fitH(src, dst); if (!H) return { e: Infinity };
    let e = 0; for (let k = 0; k < src.length; k++) { const q = apply(H, src[k][0], src[k][1]); e += (q[0] - dst[k][0]) ** 2 + (q[1] - dst[k][1]) ** 2; } return { e: e / src.length, H, D }; };
  let a = -0.25, b = 0.25; const gr = (Math.sqrt(5) - 1) / 2; let c = b - gr * (b - a), d = a + gr * (b - a), fc = evalK(c).e, fd = evalK(d).e;
  for (let it = 0; it < 40; it++) { if (fc < fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = evalK(c).e; } else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = evalK(d).e; } }
  const r0 = evalK(0), rk = evalK((a + b) / 2);
  return rk.e < r0.e * 0.9 ? rk : r0;   // only keep k1 if it clearly helps
}

function planeResiduals(pts, fit, pitch) {
  const Hi = inv3(fit.H); const res = pts.map(p => { const u = fit.D.und(p.x, p.y), q = apply(Hi, u[0], u[1]); return Math.hypot(q[0] - p.i * pitch, q[1] - p.j * pitch); });
  return res;
}

/** Full calibration from a full-res linear grey image. */
function invertAbout(g, ref) { const o = new Float32Array(g.length); for (let i = 0; i < g.length; i++) { const v = ref - g[i]; o[i] = v > 0 ? v : 0; } return o; }
function calibrate(g, w, h, opts = {}) {
  const lay = opts.layout || LAYOUT, pitch = opts.pitch_mm || lay.pitch_mm;
  const f = Math.max(1, Math.floor(Math.max(w, h) / 1400)), d = downsample(g, w, h, f);
  // Lighting: 'dark' = dark dots and particles on a bright (backlit) tray; 'bright' = white dots and bright
  // particles on a black tray lit from the side. Bright scenes are inverted about a white reference so the
  // rest of the pipeline is identical.
  const smp = []; for (let i = 0; i < d.g.length; i += 7) smp.push(d.g[i]); smp.sort((a, b) => a - b);
  const med = smp[smp.length >> 1], whiteRef = smp[Math.floor(0.98 * (smp.length - 1))] || 1;
  const want = opts.polarity || 'auto';
  const order = want === 'dark' ? ['dark'] : want === 'bright' ? ['bright'] : med < 0.4 * whiteRef ? ['bright', 'dark'] : ['dark', 'bright'];
  let L = null, polarity = order[0];
  for (const pol of order) { const r = indexLattice(pol === 'bright' ? invertAbout(d.g, whiteRef) : d.g, d.w, d.h); if (r.ok && (!L || !L.ok)) { L = r; polarity = pol; } else if (!L) L = r; if (L.ok) break; }
  if (!L.ok) return L;
  if (polarity === 'bright') g = invertAbout(g, whiteRef);
  let pts = L.pts.map(p => ({ i: p.i, j: p.j, x: (p.x + 0.5) * f - 0.5, y: (p.y + 0.5) * f - 0.5 }));
  const pitchPx = L.pitchPx * f;
  // coarse fit, outlier rejection, fill-in of missed sites
  let fit = { H: fitH(pts.map(p => [p.i * pitch, p.j * pitch]), pts.map(p => [p.x, p.y])), D: mkDist(w, h, 0) };
  if (!fit.H) return { ok: false, why: 'Calibration fit failed.' };
  const candFull = L.cands.map(c => ({ x: (c.x + 0.5) * f - 0.5, y: (c.y + 0.5) * f - 0.5 })), GI = gridIndex(candFull, pitchPx);
  for (let pass = 0; pass < 2; pass++) {
    let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity; for (const p of pts) { i0 = Math.min(i0, p.i); i1 = Math.max(i1, p.i); j0 = Math.min(j0, p.j); j1 = Math.max(j1, p.j); }
    const np = [], seen = new Set();
    for (let i = i0 - 3; i <= i1 + 3; i++) for (let j = j0 - 3; j <= j1 + 3; j++) {
      const q = fit.D.dist(...apply(fit.H, i * pitch, j * pitch)); if (q[0] < 0 || q[1] < 0 || q[0] >= w || q[1] >= h) continue;
      const c = GI.near(q[0], q[1], 0.22 * pitchPx).sort((a, b) => a[1] - b[1]); if (!c.length || seen.has(c[0][0])) continue;
      seen.add(c[0][0]); np.push({ i, j, x: candFull[c[0][0]].x, y: candFull[c[0][0]].y });
    }
    pts = np; if (pts.length < 12) return { ok: false, why: 'Too few dots matched the grid.' };
    fit = fitWithDistortion(pts, w, h, pitch);
  }
  // sub-pixel centres on the full image, then final fit with outlier rejection
  const R = refineDots(g, w, h, pts, pitchPx, L.dotDiaPx * f); pts = R.pts;
  fit = fitWithDistortion(pts, w, h, pitch);
  for (let it = 0; it < 2; it++) { const res = planeResiduals(pts, fit, pitch), med = median(res); const keep = pts.filter((_, k) => res[k] < Math.max(4 * med, 0.02 * pitch)); if (keep.length === pts.length) break; pts = keep; fit = fitWithDistortion(pts, w, h, pitch); }
  const res = planeResiduals(pts, fit, pitch), rms = Math.sqrt(res.reduce((a, b) => a + b * b, 0) / res.length);
  // occupancy and window search
  const occ = new Map(), K = (i, j) => i + ',' + j; for (const p of pts) occ.set(K(p.i, p.j), 1);
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity; for (const p of pts) { i0 = Math.min(i0, p.i); i1 = Math.max(i1, p.i); j0 = Math.min(j0, p.j); j1 = Math.max(j1, p.j); }
  const inImg = (i, j) => { const q = fit.D.dist(...apply(fit.H, i * pitch, j * pitch)), m = 0.3 * pitchPx; return q[0] > m && q[1] > m && q[0] < w - m && q[1] < h - m; };
  const state = (i, j) => occ.has(K(i, j)) ? 1 : inImg(i, j) ? 0 : -1;
  let best = null;
  for (const win of lay.windows) for (const sw of [false, true]) {
    const di = sw ? win.j1 - win.j0 + 1 : win.i1 - win.i0 + 1, dj = sw ? win.i1 - win.i0 + 1 : win.j1 - win.j0 + 1;
    for (let a = i0 - di; a <= i1 + 1; a++) for (let b = j0 - dj; b <= j1 + 1; b++) {
      let sc = 0, inside = 0, ins = 0, ringP = 0;
      for (let i = a - 1; i <= a + di; i++) for (let j = b - 1; j <= b + dj; j++) {
        const s = state(i, j), isIn = i >= a && i < a + di && j >= b && j < b + dj;
        if (isIn) { if (s >= 0) ins++; if (s === 0) { sc += 1; inside++; } else if (s === 1) sc -= 3; }
        else { if (s === 1) { sc += 1; ringP++; } else if (s === 0) sc -= 2; }
      }
      if (ins < 0.5 * di * dj || inside < 0.8 * ins || ringP < 6) continue;
      if (!best || sc > best.sc) best = { sc, win, a, b, di, dj };
    }
  }
  if (!best) return { ok: false, why: 'Dots found, but no sample window (L or S) is in view. Centre the camera over a window.' };
  const dotDiaMm = isFinite(R.dotDiaPx) ? R.dotDiaPx * pitch / pitchPx : lay.dot_d_mm;
  const r = Math.max(lay.dot_d_mm / 2, Math.min(dotDiaMm / 2, 0.48 * pitch)), mg = lay.roi_margin_mm;
  const roi = [(best.a - 1) * pitch + r + mg, (best.a + best.di) * pitch - r - mg, (best.b - 1) * pitch + r + mg, (best.b + best.dj) * pitch - r - mg];
  const Hi = inv3(fit.H);
  const cal = { ok: true, w, h, H: fit.H, Hi, k1: fit.D.k1, pitch, nDots: pts.length, rmsUm: rms * 1000, window: best.win.name, roi,
    edgeWidthPx: R.edgeWidthPx, dotCoreRatio: R.coreRatio, dotDiaMm, polarity, whiteRef, dots: pts.map(p => [p.x, p.y]) };
  const ctr = toImage(cal, (roi[0] + roi[1]) / 2, (roi[2] + roi[3]) / 2);
  cal.umPerPx = Math.sqrt(jacDet(cal, ctr[0], ctr[1])) * 1000;
  // fraction of ROI inside the frame
  return cal;
}
function toPlane(cal, x, y) { const D = mkDist(cal.w, cal.h, cal.k1), u = D.und(x, y); return apply(cal.Hi, u[0], u[1]); }
function toImage(cal, X, Y) { const D = mkDist(cal.w, cal.h, cal.k1); return D.dist(...apply(cal.H, X, Y)); }
function jacDet(cal, x, y) { const a = toPlane(cal, x, y), b = toPlane(cal, x + 1, y), c = toPlane(cal, x, y + 1); return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])); }
function roiPolygon(cal, n = 16) {
  const [x0, x1, y0, y1] = cal.roi, P = [], C = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  for (let e = 0; e < 4; e++) { const A = C[e], B = C[(e + 1) % 4]; for (let k = 0; k < n; k++) { const t = k / n; P.push(toImage(cal, A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t)); } }
  return P;
}
function polyMask(poly, x0, y0, w, h, f) { // mask over a crop whose pixel (X,Y) covers original px x0+X*f .. ; centre at x0+(X+.5)f-.5
  const m = new Uint8Array(w * h);
  for (let Y = 0; Y < h; Y++) { const y = y0 + (Y + 0.5) * f - 0.5, xs = [];
    for (let k = 0; k < poly.length; k++) { const a = poly[k], b = poly[(k + 1) % poly.length]; if ((a[1] <= y) !== (b[1] <= y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) { let X0 = Math.ceil((xs[k] - x0 + 0.5) / f - 0.5), X1 = Math.floor((xs[k + 1] - x0 + 0.5) / f - 0.5); if (X0 < 0) X0 = 0; if (X1 > w - 1) X1 = w - 1; for (let X = X0; X <= X1; X++) m[Y * w + X] = 1; } }
  return m;
}

/**
 * Measure particles inside the calibrated ROI.
 * opts: thrMode 'half'|'otsu'|'manual', thr (0..1), open (px), split (bool), splitDepthUm, band (px), maxSizeUm, heightZmm (0 = off), maxPix
 */
function measureParticles(g, w, h, cal, opts = {}) {
  const o = Object.assign({ thrMode: 'half', thr: 0.5, open: 1, split: true, splitDepthUm: 20, band: 3, maxSizeUm: 2500, heightZmm: 0, maxPix: 6e6, brightThr: 0.15 }, opts);
  const bright = cal.polarity === 'bright';
  if (bright) g = invertAbout(g, cal.whiteRef);
  const poly = roiPolygon(cal);
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity; for (const p of poly) { bx0 = Math.min(bx0, p[0]); by0 = Math.min(by0, p[1]); bx1 = Math.max(bx1, p[0]); by1 = Math.max(by1, p[1]); }
  const pad = Math.ceil(0.25 * cal.pitch * 1000 / cal.umPerPx);
  bx0 = Math.max(0, Math.floor(bx0) - pad); by0 = Math.max(0, Math.floor(by0) - pad); bx1 = Math.min(w - 1, Math.ceil(bx1) + pad); by1 = Math.min(h - 1, Math.ceil(by1) + pad);
  const cw0 = bx1 - bx0 + 1, ch0 = by1 - by0 + 1;
  const f = Math.max(1, Math.ceil(Math.sqrt(cw0 * ch0 / o.maxPix)));
  const cw = Math.floor(cw0 / f), ch = Math.floor(ch0 / f), n = cw * ch, gc = new Float32Array(n), kf = 1 / (f * f);
  for (let Y = 0; Y < ch; Y++) for (let X = 0; X < cw; X++) { let s = 0; for (let dy = 0; dy < f; dy++) { const r = (by0 + Y * f + dy) * w + bx0 + X * f; for (let dx = 0; dx < f; dx++) s += g[r + dx]; } gc[Y * cw + X] = s * kf; }
  const umpx = cal.umPerPx * f;                      // approximate, at ROI centre, crop pixels
  const inR = polyMask(poly, bx0, by0, cw, ch, f);
  // flat field
  const bg = background(gc, cw, ch, 0.6 * o.maxSizeUm / umpx + 4);
  const r = new Float32Array(n); for (let i = 0; i < n; i++) r[i] = gc[i] / (bg[i] || 1e-6);
  const NB = 400, hst = new Uint32Array(NB); let nin = 0;
  for (let i = 0; i < n; i++) if (inR[i]) { const k = Math.round(r[i] * 200); if (k >= 0 && k < NB) hst[k]++; nin++; }
  let mk = 100, mv = 0; for (let k = 120; k < NB; k++) if (hst[k] > mv) { mv = hst[k]; mk = k; }   // background mode (ratio > 0.6)
  const norm = mk / 200; for (let i = 0; i < n; i++) r[i] /= norm;
  let T = o.thr;
  if (bright) T = 1 - Math.min(0.9, Math.max(0.02, o.brightThr));   // a particle is anything brighter than brightThr x dot white
  else if (o.thrMode === 'half') T = 0.5;
  else if (o.thrMode === 'otsu') { const H2 = new Uint32Array(256); let c = 0; for (let i = 0; i < n; i++) if (inR[i]) { let k = Math.round(r[i] * 200); if (k < 0) k = 0; if (k > 255) k = 255; H2[k]++; c++; } T = otsu(H2, c) / 200; }
  let m = new Uint8Array(n); for (let i = 0; i < n; i++) m[i] = r[i] < T ? 1 : 0;
  const op = Math.round(o.open / f); if (op > 0) m = morph(morph(m, cw, ch, op, true), cw, ch, op, false);
  m = fillHoles(m, cw, ch);
  const LB = o.split ? watershed(m, cw, ch, Math.max(1, o.splitDepthUm / umpx)) : labelCC(m, cw, ch);
  const lab = LB.lab, nl = LB.n;
  // per-label stats
  const edge = new Uint8Array(nl + 1), A = new Float64Array(nl + 1), SX = new Float64Array(nl + 1), SY = new Float64Array(nl + 1);
  const NH = 50, rh = new Uint32Array((nl + 1) * NH);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const i = y * cw + x, L = lab[i]; if (!L) continue;
    A[L]++; SX[L] += x; SY[L] += y; if (!inR[i] || x === 0 || y === 0 || x === cw - 1 || y === ch - 1) edge[L] = 1;
    let k = Math.floor(r[i] * NH); if (k < 0) k = 0; if (k >= NH) k = NH - 1; rh[L * NH + k]++; }
  // core (fully dark) level: per particle only where the particle is big enough for blur not to lift its core;
  // otherwise the median core level of the big ones, else the black calibration dots
  const sigEst = isFinite(cal.edgeWidthPx) ? Math.min(2.5, cal.edgeWidthPx / 2.56) / f : 1;
  const d = Math.max(Math.round(o.band), Math.ceil(2.5 * sigEst));
  const bigA = Math.PI * Math.pow(3 * sigEst + 3, 2), rfg = new Float32Array(nl + 1), bigCores = [];
  // (side-lit particles vary in brightness, so their reference level is the particle's median, not its extreme)
  for (let L = 1; L <= nl; L++) { const tgt = (bright ? 0.5 : 0.1) * A[L]; let c = 0, k = 0; for (; k < NH; k++) { c += rh[L * NH + k]; if (c >= tgt) break; } rfg[L] = (k + 0.5) / NH; if (A[L] >= bigA) bigCores.push(rfg[L]); }
  const coreG = bigCores.length >= 3 ? median(bigCores) : (isFinite(cal.dotCoreRatio) ? Math.max(0, cal.dotCoreRatio) : 0.05);
  for (let L = 1; L <= nl; L++) if (A[L] < bigA) rfg[L] = coreG;
  // edge band: distance (chessboard) to the other phase, up to d
  const distIn = new Uint8Array(n).fill(255), owner = new Int32Array(n), q = new Int32Array(n);
  let qh = 0, qt = 0;
  for (let i = 0; i < n; i++) if (!lab[i]) { distIn[i] = 0; q[qt++] = i; }
  while (qh < qt) { const p = q[qh++], x = p % cw, y = (p - x) / cw, dv = distIn[p]; if (dv >= d) continue;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= ch) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= cw) continue; const j = yy * cw + xx; if (distIn[j] > dv + 1) { distIn[j] = dv + 1; q[qt++] = j; } } } }
  const distOut = new Uint8Array(n).fill(255); qh = qt = 0;
  for (let i = 0; i < n; i++) if (lab[i]) { distOut[i] = 0; owner[i] = lab[i]; q[qt++] = i; }
  while (qh < qt) { const p = q[qh++], x = p % cw, y = (p - x) / cw, dv = distOut[p]; if (dv >= d) continue;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= ch) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= cw) continue; const j = yy * cw + xx; if (distOut[j] > dv + 1) { distOut[j] = dv + 1; owner[j] = owner[p]; q[qt++] = j; } } } }
  const sub = new Float64Array(nl + 1);
  for (let i = 0; i < n; i++) { const L = owner[i]; if (!L || distOut[i] > d) continue;
    const opaque = rfg[L] < 0.6;
    if (lab[i]) { if (distIn[i] > d || !opaque) { sub[L] += 1; continue; } }
    else if (!opaque) continue;
    let c = (1 - r[i]) / (1 - rfg[L]); if (bright) { if (c < 0) c = 0; else if (c > 1) c = 1; } else if (c < -1) c = -1; else if (c > 2) c = 2; sub[L] += c; }
  // geometry: boundary pixels -> hull -> plane
  const isB = (i, L, x, y) => x === 0 || y === 0 || x === cw - 1 || y === ch - 1 || lab[i - 1] !== L || lab[i + 1] !== L || lab[i - cw] !== L || lab[i + cw] !== L;
  const bpts = new Array(nl + 1); for (let L = 1; L <= nl; L++) bpts[L] = [];
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const i = y * cw + x, L = lab[i]; if (L && A[L] >= 3 && isB(i, L, x, y)) bpts[L].push([x, y]); }
  const toOrig = (x, y) => [bx0 + (x + 0.5) * f - 0.5, by0 + (y + 0.5) * f - 0.5];
  const parts = [], Zum = o.heightZmm > 0 ? o.heightZmm * 1000 : 0;
  for (let L = 1; L <= nl; L++) {
    if (A[L] < 3) continue;
    const [cx, cy] = toOrig(SX[L] / A[L], SY[L] / A[L]);
    const ci = Math.round(SY[L] / A[L]) * cw + Math.round(SX[L] / A[L]); if (!inR[ci] && edge[L]) continue; // e.g. calibration dots
    const J = jacDet(cal, cx, cy) * f * f;              // mm^2 per crop pixel at this particle
    const areaMM = Math.max(sub[L], 0.25) * J, pxmm = Math.sqrt(J);
    const hullPx = convexHull(bpts[L]).map(p => toOrig(p[0], p[1]));
    const hullMM = hullPx.map(p => toPlane(cal, p[0], p[1]));
    const [fmx, fmn] = ferets(hullMM, pxmm);
    let ecd = 2000 * Math.sqrt(areaMM / Math.PI), fmax = fmx * 1000, fmin = fmn * 1000;
    if (Zum) { const k = 1 / (1 + ecd / (2 * Zum)); ecd *= k; fmax *= k; fmin *= k; }
    parts.push({ id: parts.length + 1, ecd, fmax, fmin, areaUm2: areaMM * 1e6, binAreaUm2: A[L] * J * 1e6, cx, cy, edge: !!edge[L],
      aspect: fmin / fmax, round: Math.min(1, 4 * areaMM * 1e6 / (Math.PI * fmax * fmax)), opaque: rfg[L] < 0.6, hull: hullPx.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]) });
  }
  return { parts, roiPoly: poly, crop: [bx0, by0, cw0, ch0], f, thr: T, bgNorm: norm, umPerPx: cal.umPerPx };
}

/** Quality verdict for 200 µm particles. */
function quality(cal) {
  const px200 = 200 / cal.umPerPx;
  // Dot edges only tell us about focus when the dots print crisp. On a backlit white tray each dot has a soft
  // shadow (light scattering in the plastic), which looks like blur but is not.
  const dotsCrisp = !(cal.dotDiaMm > 1.3 * LAYOUT.dot_d_mm);
  const sig = dotsCrisp ? cal.edgeWidthPx / 2.56 : NaN;
  const edgeTerm = 0.25 / px200 * 100, blurTerm = isFinite(sig) ? Math.max(0, sig - 2) * 0.6 / px200 * 100 : 0;
  const scaleTerm = Math.hypot(cal.rmsUm / (cal.pitch * 1000) / Math.sqrt(Math.max(1, cal.nDots)) * 100 * 3, 0.1);
  const est = Math.hypot(edgeTerm, blurTerm, scaleTerm);
  let level = 'good', msg = '';
  if (px200 < 12) { level = 'bad'; msg = `Too coarse: 200 µm spans only ${px200.toFixed(1)} px. Use a closer setting or a clip-on macro lens.`; }
  else if (px200 < 20) { level = 'warn'; msg = `200 µm spans ${px200.toFixed(1)} px; aim for 20 px or more.`; }
  if (isFinite(sig) && sig > 3) { level = level === 'bad' ? 'bad' : 'warn'; msg += (msg ? ' ' : '') + `Image looks soft (edge blur ≈ ${sig.toFixed(1)} px). Tap to focus on the tray and retake.`; }
  if (cal.rmsUm > 100) { level = level === 'bad' ? 'bad' : 'warn'; msg += (msg ? ' ' : '') + `Calibration residual is high (${cal.rmsUm.toFixed(0)} µm).`; }
  if (!msg) msg = `Resolution is good: 200 µm spans ${px200.toFixed(0)} px.`;
  if (!dotsCrisp) msg += ' Sharpness is not checked on this tray (soft dot shadows); judge focus by eye.';
  return { level, msg, px200, blurSigmaPx: sig, est200pct: est, polarity: cal.polarity || 'dark' };
}

/* ---------------- statistics (shared with the desktop app) ---------------- */
function wpct(x, w, W, p) {
  let c = 0, prevPos = 0, prevX = x[0];
  for (let i = 0; i < x.length; i++) { const pos = (c + w[i] / 2) / W;
    if (pos >= p) { if (i === 0) return x[0]; const t = (p - prevPos) / ((pos - prevPos) || 1); return prevX + t * (x[i] - prevX); }
    prevPos = pos; prevX = x[i]; c += w[i]; }
  return x[x.length - 1];
}
function nice(v) { const e = Math.floor(Math.log10(v)), f = v / 10 ** e; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * 10 ** e; }
function makeEdges(min, max, bins) {
  if (bins === 'lin') { const step = nice(Math.max(max - min, 1e-9) / 18); let a = Math.floor(min / step) * step, b = Math.ceil(max / step) * step; if (b <= a) b = a + step;
    const e = []; for (let v = a; v <= b + step * 1e-6; v += step) e.push(+v.toPrecision(12)); return e; }
  const q = +bins; let k0 = Math.floor(q * Math.log2(min)), k1 = Math.ceil(q * Math.log2(max)); if (k1 <= k0) k1 = k0 + 1;
  const e = []; for (let k = k0; k <= k1; k++) e.push(2 ** (k / q)); return e;
}
function stats(sizes, masses, bins = '2') {
  const n = sizes.length; if (!n) return null;
  const arr = sizes.map((s, i) => [s, masses[i]]).sort((a, b) => a[0] - b[0]);
  const x = arr.map(a => a[0]), m = arr.map(a => a[1]), one = new Array(n).fill(1);
  let M = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, md = 0; for (let i = 0; i < n; i++) { const d = x[i]; M += m[i]; s1 += d; s2 += d * d; s3 += d * d * d; s4 += d * d * d * d; md += m[i] * d; }
  const mean = s1 / n; let v = 0, vm = 0; const mmean = md / M; for (let i = 0; i < n; i++) { v += (x[i] - mean) ** 2; vm += m[i] * (x[i] - mmean) ** 2; }
  const pack = (w, W, mu, sd) => { const d10 = wpct(x, w, W, .1), d50 = wpct(x, w, W, .5), d90 = wpct(x, w, W, .9); return { d10, d50, d90, span: (d90 - d10) / d50, mean: mu, sd }; };
  const st = { n, x, m, M, min: x[0], max: x[n - 1], d32: s3 / s2, d43: s4 / s3, number: pack(one, n, mean, Math.sqrt(v / Math.max(1, n - 1))), mass: pack(m, M, mmean, Math.sqrt(vm / M)) };
  const edges = makeEdges(st.min, st.max, bins), nb = edges.length - 1, cnt = new Array(nb).fill(0), ms = new Array(nb).fill(0);
  for (let i = 0; i < n; i++) { let lo = 0, hi = nb - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (edges[mid] <= x[i]) lo = mid; else hi = mid - 1; } cnt[lo]++; ms[lo] += m[i]; }
  let cn = 0, cm = 0; st.bins = []; for (let b = 0; b < nb; b++) { cn += cnt[b]; cm += ms[b];
    st.bins.push({ lo: edges[b], hi: edges[b + 1], cnt: cnt[b], mass: ms[b], np: cnt[b] / n * 100, mp: ms[b] / M * 100, cnp: cn / n * 100, cmp: cm / M * 100 }); }
  st.edges = edges; st.log = bins !== 'lin';
  return st;
}

const API = { LAYOUT, grayLinear, downsample, boxBlur, background, calibrate, measureParticles, quality, stats, toPlane, toImage, roiPolygon, fitH, apply, inv3, mkDist };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.PF = API;
})(typeof self !== 'undefined' ? self : this);
