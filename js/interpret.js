'use strict';
/*
 * Reading a sketch. Each stroke is measured (straightness, corners, bulge, closure, size)
 * and classified into an architectural intention, then regularised into a clean spec:
 * verticals snap plumb, arcs become true elliptical arches, loops become windows, etc.
 */
const Interp = (() => {
  const { P, clamp, bbox, dist } = G;

  function analyze(pts) {
    const len = G.polyLength(pts);
    const a = pts[0], b = pts[pts.length - 1];
    const chord = dist(a, b);
    const bb = bbox(pts);
    const simp = G.rdp(pts, 3.5);
    let corners = 0, hv = 0, segs = 0;
    for (let i = 1; i < simp.length - 1; i++) {
      const d1 = Math.atan2(simp[i].y - simp[i - 1].y, simp[i].x - simp[i - 1].x);
      const d2 = Math.atan2(simp[i + 1].y - simp[i].y, simp[i + 1].x - simp[i].x);
      if (Math.abs(G.angDiff(d2, d1)) > 0.75) corners++;
    }
    for (let i = 1; i < simp.length; i++) {
      const dx = simp[i].x - simp[i - 1].x, dy = simp[i].y - simp[i - 1].y;
      if (Math.hypot(dx, dy) < 4) continue;
      segs++;
      const r = Math.abs(dy) / (Math.abs(dx) + 1e-6);
      if (r < 0.4 || r > 2.5) hv++;
    }
    // wiggle: how many times the stroke swings clearly across its chord
    let wiggle = 0, side = 0;
    if (chord > 1) {
      for (const p of pts) {
        const dev = ((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / chord;
        const sd = dev > 3 ? 1 : dev < -3 ? -1 : 0;
        if (sd && sd !== side) { if (side) wiggle++; side = sd; }
      }
    }
    // monotony: does the stroke keep heading the same way in x and in y (a sweeping curve)?
    let sx = 0, sy = 0, nseg = 0;
    const sdx = Math.sign(b.x - a.x), sdy = Math.sign(b.y - a.y);
    const rs = G.resample(pts, 6);
    for (let i = 1; i < rs.length; i++) {
      nseg++;
      if (Math.sign(rs[i].x - rs[i - 1].x) === sdx || Math.abs(rs[i].x - rs[i - 1].x) < 0.8) sx++;
      if (Math.sign(rs[i].y - rs[i - 1].y) === sdy || Math.abs(rs[i].y - rs[i - 1].y) < 0.8) sy++;
    }
    const mono = nseg > 0 && sx / nseg > 0.88 && sy / nseg > 0.88;
    const baseY = (a.y + b.y) / 2;
    return {
      len, chord, bb, diag: Math.hypot(bb.w, bb.h), dx: b.x - a.x, dy: b.y - a.y, wiggle, mono,
      corners, hv, segs, straight: chord / (len || 1), up: baseY - bb.y0, down: bb.y1 - baseY,
    };
  }

  function classify(pts) {
    if (pts.length < 2) return 'figure';
    const s = analyze(pts);
    if (s.diag < 20) return 'figure';
    if (s.len > 60 && s.chord < Math.max(16, s.len * 0.17)) return 'window';
    const adx = Math.abs(s.dx), ady = Math.abs(s.dy);
    if (s.corners >= 3 && s.hv >= s.segs * 0.6 && ady > adx * 0.2 && adx > ady * 0.2) return 'stair';
    if (ady > adx * 1.5 && s.wiggle >= 3 && s.straight > 0.55) return 'hang';
    if (s.straight > 0.9) {
      if (ady > adx * 2) return 'pier';
      if (adx > ady * 2.5) return 'beam';
      return 'stair';
    }
    if (adx > ady * 1.2) {
      if (s.up > adx * 0.2 && s.up > s.down * 2) return 'arch';
      if (s.up > adx * 0.04 && s.up > s.down * 2) return 'beam'; // a gentle hump: a curved bridge
      if (s.down > adx * 0.08 && s.down > s.up * 2) return 'chain';
    }
    if (ady > adx * 0.25 && adx > ady * 0.25 && s.straight > 0.72 && s.mono) return 'stair'; // a sweeping stair
    if (ady > adx * 1.5 && s.straight > 0.55) return 'hang';
    return 'rope';
  }

  function windowShape(pts) {
    const bb = bbox(pts);
    const ratio = Math.abs(G.polyArea(pts)) / Math.max(1, bb.w * bb.h);
    const per = G.polyLength(pts);
    const simp = G.rdp(pts.concat([pts[0]]), per * 0.05);
    if (simp.length <= 7 && ratio > 0.8) return 'rect';
    if (ratio > 0.62) return 'round';
    return 'free';
  }

  /* Turns a stored stroke into a builder spec, or null. */
  function toSpec(st, sc, r) {
    const pts = st.pts, z = st.z || 1, kind = st.kind;
    if (!pts || !pts.length) return null;
    const bb = bbox(pts), a = pts[0], b = pts[pts.length - 1];
    const vp = sc.vp, gy = sc.floorAt(z), pt = sc.plate;
    switch (kind) {
      case 'pier': {
        const x = G.median(pts.map(p => p.x));
        let y0 = bb.y0, y1 = bb.y1;
        if (y1 > vp.y) y1 = Math.max(y1, gy);
        if (y0 < pt.y + 30) y0 = pt.y - 20;
        if (y1 - y0 < 30) y1 = y0 + 30;
        return { kind, z, x, y0, y1, w: clamp((y1 - y0) * 0.11, 18, 95), ring: r.chance(0.45) };
      }
      case 'beam': {
        const baseY = (a.y + b.y) / 2, up = baseY - bb.y0;
        const curved = up > Math.max(6, bb.w * 0.04) && Math.abs(a.y - b.y) < bb.w * 0.25;
        const y = curved ? baseY : G.median(pts.map(p => p.y));
        let x0 = bb.x0, x1 = bb.x1;
        if (x0 < pt.x + 30) x0 = pt.x - 20;
        if (x1 > pt.x + pt.w - 30) x1 = pt.x + pt.w + 20;
        if (x1 - x0 < 30) x1 = x0 + 30;
        const spec = { kind, z, x0, x1, y, h: clamp((x1 - x0) * 0.04, 9, 28), rail: r.chance(0.8), chains: r.int(0, 2) };
        if (curved) spec.arc = up * (x1 - x0) / Math.max(1, bb.w);
        return spec;
      }
      case 'arch': {
        const L = Math.min(a.x, b.x), R = Math.max(a.x, b.x);
        const rx = Math.max(14, (R - L) / 2), cx = (L + R) / 2;
        const by = Math.max(a.y, b.y);
        const ry = clamp(by - bb.y0, rx * 0.35, rx * 2.4);
        const t = clamp(rx * 0.22, 10, 60);
        return {
          kind, z, cx, by, rx, ry, t, pw: clamp(rx * 0.5, t * 1.3, 140),
          top: by - ry - t - clamp(t * 1.4, 14, 90), gy: Math.max(gy, by),
          depth: clamp(rx * 1.5, 60, 520), walkway: r.chance(0.6), lantern: r.chance(0.25),
        };
      }
      case 'stair': {
        const S = a.y > b.y ? P(a.x, a.y) : P(b.x, b.y);
        const E = a.y > b.y ? P(b.x, b.y) : P(a.x, a.y);
        const solid = S.y > gy - 50 && S.y > vp.y;
        if (solid) S.y = gy;
        if (S.y - E.y < 12 && Math.abs(S.x - E.x) < 20) return null;
        if (S.y - E.y < 12) return { kind: 'beam', z, x0: Math.min(S.x, E.x), x1: Math.max(S.x, E.x), y: E.y, h: 12, rail: true, chains: 0 };
        if (Math.abs(S.x - E.x) < 8) E.x = S.x + 8;
        const spec = { kind, z, S, E, solid, rail: r.chance(0.8) };
        // a sweeping stroke keeps its curve: the steps follow the drawn stringer
        const an = analyze(pts);
        let dev = 0;
        for (const p of pts) dev = Math.max(dev, G.segDist(p, a, b));
        if (an.mono && an.corners < 3 && dev > an.chord * 0.05) {
          let path = G.resample(G.smoothPts(pts, 3), 10);
          if (path[0].y < path[path.length - 1].y) path = path.reverse();
          path[0] = S;
          path[path.length - 1] = E;
          spec.path = path;
        }
        return spec;
      }
      case 'chain': {
        const L = a.x < b.x ? a : b, R = a.x < b.x ? b : a;
        return { kind, z, A: P(L.x, L.y), B: P(R.x, R.y), sag: Math.max(4, bb.y1 - (a.y + b.y) / 2), link: clamp(dist(a, b) / 30, 4, 9) };
      }
      case 'hang': {
        const top = a.y < b.y ? a : b, bot = a.y < b.y ? b : a;
        return { kind, z, x: top.x, y0: bb.y0, y1: bb.y1, sway: bot.x - top.x, link: clamp((bb.y1 - bb.y0) / 28, 4, 9), end: r.pick(['lantern', 'hook', 'weight', 'ring', 'lantern']) };
      }
      case 'window': {
        if (pts.length < 3 || bb.w < 8 || bb.h < 8) return null;
        const shape = windowShape(pts);
        const loop = shape === 'free' ? G.resample(G.smoothPts(pts, 2), 6) : pts;
        return { kind, z, pts: loop, shape, bright: bb.cy < vp.y };
      }
      case 'figure': {
        const y = bb.y1;
        const h = y > vp.y ? clamp((y - vp.y) * 0.13, 8, 44) : clamp(16 / z, 8, 22);
        return { kind, z, x: bb.cx, y, h };
      }
      case 'rope':
        return pts.length > 2 ? { kind, z, pts: pts.slice(), w: 2 } : null;
    }
    return null;
  }

  return { analyze, classify, toSpec };
})();
