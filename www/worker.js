/* Analysis worker: keeps the UI responsive while 12-48 MP photos are processed. */
importScripts('core.js');
self.onmessage = (e) => {
  const m = e.data;
  try {
    const g = PF.grayLinear(new Uint8ClampedArray(m.rgba), m.w, m.h);
    const o = m.opts, coin = o.quick && o.coinDia > 0;
    // Quick estimate: a coin (or other round object) gives the scale, or a printed reference card at its nominal pitch.
    const cal = coin ? PF.calibrateCoin(g, m.w, m.h, { coinDiaMm: o.coinDia, coinThickMm: o.coinThick, polarity: o.polarity })
      : PF.calibrate(g, m.w, m.h, { pitch_mm: o.quick ? PF.LAYOUT.pitch_mm : o.pitch, polarity: o.polarity });
    if (m.kind === 'live') {
      if (!cal.ok) { self.postMessage({ id: m.id, kind: 'live', ok: false, why: cal.why }); return; }
      const a = PF.toPlane(cal, 0, m.h / 2), b = PF.toPlane(cal, m.w, m.h / 2);
      const fovW = Math.hypot(b[0] - a[0], b[1] - a[1]);
      self.postMessage({ id: m.id, kind: 'live', ok: true, window: cal.window, fovWmm: fovW, roiPoly: PF.roiPolygon(cal, 4),
        edgeWidthPx: cal.edgeWidthPx, nDots: cal.nDots, coin: cal.kind === 'coin' });
      return;
    }
    if (!cal.ok) { self.postMessage({ id: m.id, ok: false, why: cal.why }); return; }
    const res = PF.measureParticles(g, m.w, m.h, cal, m.opts);
    const q = PF.quality(cal);
    delete cal.dots;
    self.postMessage({ id: m.id, ok: true, cal, res, q });
  } catch (err) {
    self.postMessage({ id: m.id, kind: m.kind, ok: false, why: 'Analysis error: ' + (err && err.message || err) });
  }
};
