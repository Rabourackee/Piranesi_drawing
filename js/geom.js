'use strict';
/* Small 2D geometry toolkit. Points are plain {x, y} objects. */
const G = (() => {
  const P = (x, y) => ({ x, y });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const lerp = (a, b, t) => P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const mix = (a, b, t) => a + (b - a) * t;
  const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const angDiff = (a, b) => {
    let d = a - b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };
  function polyLength(p) { let L = 0; for (let i = 1; i < p.length; i++) L += dist(p[i - 1], p[i]); return L; }
  function polyArea(p) {
    let a = 0;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j].x + p[i].x) * (p[j].y - p[i].y);
    return a / 2;
  }
  /* Even spacing along a polyline (corners are not preserved). */
  function resample(p, step) {
    if (p.length < 2) return p.map(q => P(q.x, q.y));
    const out = [P(p[0].x, p[0].y)];
    let need = step;
    for (let i = 1; i < p.length; i++) {
      let a = p[i - 1];
      const b = p[i];
      let d = dist(a, b);
      while (d >= need && d > 0) {
        const q = lerp(a, b, need / d);
        out.push(q); a = q; d = dist(a, b); need = step;
      }
      need -= d;
    }
    const last = p[p.length - 1];
    if (dist(out[out.length - 1], last) > step * 0.25) out.push(P(last.x, last.y));
    return out;
  }
  /* Subdivide each segment (corners preserved). */
  function subdivide(p, step, closed) {
    const pts = closed ? p.concat([p[0]]) : p;
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const n = Math.max(1, Math.ceil(dist(a, b) / step));
      for (let k = 0; k < n; k++) out.push(lerp(a, b, k / n));
    }
    const l = pts[pts.length - 1];
    out.push(P(l.x, l.y));
    return out;
  }
  function segDist(p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y, l2 = abx * abx + aby * aby;
    let t = l2 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
  }
  function rdp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const a = pts[0], b = pts[pts.length - 1];
    let dmax = 0, idx = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], a, b); if (d > dmax) { dmax = d; idx = i; } }
    if (dmax > eps) {
      const l = rdp(pts.slice(0, idx + 1), eps), r = rdp(pts.slice(idx), eps);
      return l.slice(0, -1).concat(r);
    }
    return [a, b];
  }
  function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  const bboxRings = rings => bbox(rings.flat());
  function centroid(pts) { let x = 0, y = 0; for (const p of pts) { x += p.x; y += p.y; } return P(x / pts.length, y / pts.length); }
  function pointInPoly(p, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  }
  function pointInRings(p, rings) { let c = false; for (const r of rings) if (pointInPoly(p, r)) c = !c; return c; }
  const rect = (x, y, w, h) => [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
  /* Elliptical arc; y grows downward so positive angles go "up". */
  function ellipse(cx, cy, rx, ry, a0, a1, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      out.push(P(cx + rx * Math.cos(a), cy - ry * Math.sin(a)));
    }
    return out;
  }
  function smoothPts(p, it = 1) {
    let q = p;
    for (let k = 0; k < it; k++) {
      if (q.length < 3) return q;
      const r = [q[0]];
      for (let i = 1; i < q.length - 1; i++) r.push(P((q[i - 1].x + 2 * q[i].x + q[i + 1].x) / 4, (q[i - 1].y + 2 * q[i].y + q[i + 1].y) / 4));
      r.push(q[q.length - 1]);
      q = r;
    }
    return q;
  }
  function median(arr) { const s = arr.slice().sort((a, b) => a - b); return s[s.length >> 1]; }
  return {
    P, dist, lerp, clamp, mix, smoothstep, angDiff, polyLength, polyArea, resample, subdivide, segDist,
    rdp, bbox, bboxRings, centroid, pointInPoly, pointInRings, rect, ellipse, smoothPts, median,
  };
})();
