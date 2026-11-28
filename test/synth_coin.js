// Coin-reference test: grey coin + dark particles on a light surface, tilted camera (affine foreshortening).
// node synth_coin.js [umPerPx] [tiltDeg] [INV]
const PF = require('../www/core.js');
const UM = +(process.argv[2] || 35), TILT = +(process.argv[3] || 12) * Math.PI / 180, INV = process.argv[4] === 'INV';
let s = 12345; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const W = 4032, H = 3024, sc = 1000 / UM, D = 24.26, T = 1.75, Z = W / sc / 1.25;   // mm
const rot = 0.5, c = Math.cos(rot), sn = Math.sin(rot), ct = Math.cos(TILT);
// image -> plane (mm): undo rotation, then stretch foreshortened axis
const toPlane = (x, y) => { const dx = (x - W / 2) / sc, dy = (y - H / 2) / sc; const u = dx * c + dy * sn, v = (-dx * sn + dy * c) / ct; return [u, v]; };
const coin = { x: -0.28 * W / sc, y: 0.13 * H / sc }, rimScale = Z / (Z - T);
const sizes = [2000, 2000, 1500, 1500, 1000, 1000, 1000, 1000, ...Array(12).fill(700), ...Array(14).fill(500), ...Array(14).fill(300)];
const parts = [];
for (const d of sizes) for (let a = 0; a < 3000; a++) { const r = d / 2000, x = -70 + rnd() * 140, y = -50 + rnd() * 100;
  if (Math.hypot(x - coin.x, y - coin.y) < D / 2 * 1.35 + r) continue;
  if (parts.every(p => Math.hypot(p.x - x, p.y - y) > p.r + r + 0.4)) { parts.push({ x, y, r, d }); break; } }
const img = new Float32Array(W * H), SS = 3;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let v = 0;
  for (let a = 0; a < SS; a++) for (let b = 0; b < SS; b++) { const p = toPlane(x - 0.5 + (a + 0.5) / SS, y - 0.5 + (b + 0.5) / SS);
    let val = INV ? 0.04 : 0.8;
    const dc = Math.hypot(p[0] - coin.x, p[1] - coin.y);
    if (dc <= D / 2 * rimScale) val = (INV ? 0.5 : 0.3) + 0.05 * Math.sin(p[0] * 3) * Math.cos(p[1] * 2.3);
    else if (Math.abs(x - W / 2) < W) { for (const q of parts) if ((p[0] - q.x) ** 2 + (p[1] - q.y) ** 2 <= q.r * q.r) { val = INV ? 0.75 : 0.03; break; } }
    v += val; }
  if (a0(x, y)) {}
  img[y * W + x] = v / (SS * SS) * (1 - 0.15 * ((x - W / 2) ** 2 + (y - H / 2) ** 2) / (W * W / 4 + H * H / 4));
}
function a0() { return false; }
const rgba = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) { let v = Math.max(0, img[i] + 0.006 * gauss()); const sv = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; const k = Math.round(Math.min(1, sv) * 255); rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = k; rgba[i * 4 + 3] = 255; }
const g = PF.grayLinear(rgba, W, H), t0 = Date.now();
const cal = PF.calibrateCoin(g, W, H, { coinDiaMm: D, coinThickMm: T });
if (!cal.ok) { console.log('FAIL', cal.why); process.exit(1); }
const res = PF.measureParticles(g, W, H, cal, {});
console.log(`polarity ${cal.polarity}  um/px true ${UM} (x ${(1/ct).toFixed(3)} on the tilted axis)  measured ${cal.umPerPx.toFixed(2)}  tilt ${cal.tiltDeg.toFixed(1)} deg (true ${(TILT*180/Math.PI).toFixed(1)})  cam dist ${cal.camDistMm.toFixed(0)} mm (true ${Z.toFixed(0)})  f ${res.f}  detected ${res.parts.length} (true ${parts.length})  ${(Date.now()-t0)/1000}s`);
const by = {};
for (const p of parts) { const X = W / 2 + sc * (p.x * c - p.y * ct * sn), Y = H / 2 + sc * (p.x * sn + p.y * ct * c); let best = null, bd = 1e9; for (const m of res.parts) { const dd = Math.hypot(m.cx - X, m.cy - Y); if (dd < bd) { bd = dd; best = m; } } if (best && bd < 12) (by[p.d] = by[p.d] || []).push((best.ecd / p.d - 1) * 100); }
for (const d of Object.keys(by).map(Number).sort((a, b) => a - b)) { const e = by[d], mean = e.reduce((a, b) => a + b, 0) / e.length; console.log(`  D=${String(d).padStart(4)} um  n=${String(e.length).padStart(2)}  mean err ${mean.toFixed(2).padStart(6)}%  max|err| ${Math.max(...e.map(Math.abs)).toFixed(2)}%`); }
