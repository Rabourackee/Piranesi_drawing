'use strict';
/*
 * Plants, the way Piranesi lets them take a ruin: they root where stones meet, at the
 * corners of things. Shrubs burst from broken tops and the ends of cornices, leaning out
 * over the void; ivy trails down from the corners of bridges and arches; tufts of grass
 * gather at the feet of piers and stairs. Each element grows its own plants right after it
 * is drawn, so anything nearer still hides them.
 */
const Flora = (() => {
  const { P, clamp } = G;
  const PI = Math.PI;

  /* A shrub leaning out from a corner: arching stems, each ending in a clump of leaves. */
  function spray(pl, x, y, size, dir, r) {
    // a dense crown on the corner itself, then stems arching out over the edge
    Wear.shrub(pl, x + dir * size * 0.2, y, size * r.range(0.55, 0.8), r);
    const n = r.int(3, 6);
    for (let i = 0; i < n; i++) {
      const a = -PI / 2 + dir * r.range(0.2, 1.1), L = size * r.range(0.5, 1.1);
      const tip = P(x + Math.cos(a) * L, y + Math.sin(a) * L * 0.8);
      const mid = P(x + Math.cos(a) * L * 0.4 + dir * L * 0.15, y + Math.sin(a) * L * 0.55);
      pl.path([P(x, y), mid, tip], false, 0.6, 0.9, 0.2);
      Wear.shrub(pl, tip.x, tip.y + size * 0.12, size * r.range(0.35, 0.6), r);
    }
    // a sprig or two drooping over the edge
    for (let i = 0; i < r.int(0, 2); i++) {
      const a = P(x + dir * size * r.range(0.3, 0.6), y - size * 0.1), b = P(a.x + dir * size * r.range(0.3, 0.6), a.y + size * r.range(0.4, 0.9));
      pl.path([a, P((a.x + b.x) / 2 + dir * size * 0.2, a.y + size * 0.05), b], false, 0.5, 0.9, 0.2);
      Wear.shrub(pl, b.x, b.y + size * 0.15, size * 0.3, r);
    }
    Wear.tuft(pl, x, y, size * 0.6, r);
  }

  /* Ivy falling from a corner: strands reach out a little, then hang, leaves thick near the top. */
  function ivy(pl, x, y, len, dir, r) {
    const n = r.int(3, 6);
    for (let i = 0; i < n; i++) {
      const out = dir * r.range(2, 12), L = len * r.range(0.4, 1);
      const pts = [P(x, y)];
      let p = P(x + out, y + r.range(1, 4)), s = r.next() * 10;
      pts.push(p);
      for (let k = 0; k < L / 4; k++) {
        p = P(x + out + Math.sin(s + k * 0.4) * L * 0.05 + r.range(-0.5, 0.5), p.y + 4);
        pts.push(p);
      }
      pl.path(pts, false, 0.5, 0.9, 0.15);
      for (let k = 1; k < pts.length; k += r.int(1, 3)) {
        if (r.chance(k / pts.length * 0.6)) continue;
        const c = pts[k], side = r.sign(), lw = r.range(2.2, 4.2);
        const lf = G.ellipse(c.x + side * lw, c.y + lw * 0.3, lw, lw * 0.55, 0, PI * 2, 6);
        pl.fill([lf]);
        // leaves in the shade of the others are dark
        if (r.chance(0.5)) { pl.clip([lf]); pl.hatch([lf], 0.9, 1.3, { w: 0.4, a: 0.85, brk: 0 }); pl.unclip(); }
        pl.path(lf, true, 0.45, 0.9, 0.05);
      }
    }
    Wear.shrub(pl, x + dir * 3, y + 2, clamp(len * 0.22, 6, 24), r);
  }

  /* Corners where something can take root, with the kind of growth each suits. */
  function corners(sc, s, r) {
    const o = [];
    switch (s.kind) {
      case 'pier': {
        const xl = s.x - s.w / 2, xr = s.x + s.w / 2;
        if (s.freeTop) o.push({ x: xl + 2, y: s.y0, dir: -1, t: 'spray' }, { x: xr - 2, y: s.y0, dir: 1, t: 'spray' }, { x: xr, y: s.y0 + 4, dir: 1, t: 'ivy' });
        o.push({ x: xl, y: s.y1, dir: -1, t: 'tuft' }, { x: xr, y: s.y1, dir: 1, t: 'tuft' });
        break;
      }
      case 'wall':
        o.push({ x: s.x0 + 3, y: s.y0, dir: -1, t: 'spray' }, { x: s.x1 - 3, y: s.y0, dir: 1, t: 'spray' }, { x: s.x1, y: s.y0 + 4, dir: 1, t: 'ivy' }, { x: s.x0, y: s.y1, dir: -1, t: 'tuft' });
        break;
      case 'beam': {
        for (const e of [-1, 1]) {
          const x = e < 0 ? s.x0 + 3 : s.x1 - 3;
          o.push({ x, y: Build.beamTop(s, x), dir: e, t: 'spray' }, { x, y: Build.beamBottom(s, x), dir: e, t: 'ivy' });
        }
        break;
      }
      case 'arch': {
        const L = s.L ?? s.cx - s.rx - s.pw, R = s.R ?? s.cx + s.rx + s.pw;
        if (s.freeTop) o.push({ x: L + 3, y: s.top, dir: -1, t: 'spray' }, { x: R - 3, y: s.top, dir: 1, t: 'spray' });
        o.push({ x: s.cx + r.sign() * s.rx * 0.2, y: Build.archIntradosY(s, s.cx) + 2, dir: 1, t: 'ivy' });
        o.push({ x: s.cx - s.rx, y: s.gy, dir: 1, t: 'tuft' }, { x: s.cx + s.rx, y: s.gy, dir: -1, t: 'tuft' }, { x: L, y: s.gy, dir: -1, t: 'tuft' });
        break;
      }
      case 'stair': {
        const dir = Math.sign(s.E.x - s.S.x) || 1;
        o.push({ x: s.E.x, y: s.E.y, dir, t: 'spray' }, { x: s.S.x, y: s.S.y, dir: -dir, t: 'tuft' });
        if (!s.solid) o.push({ x: s.E.x, y: s.E.y + 6, dir, t: 'ivy' });
        break;
      }
      case 'spiral':
        o.push({ x: s.x, y: s.y0, dir: 1, t: 'spray' }, { x: s.x, y: s.y1, dir: -1, t: 'tuft' });
        break;
    }
    return o;
  }

  function grow(pl, sc, s, r) {
    const pt = sc.plate, wr = sc.wear ?? 0.55;
    const k = clamp(1.25 / Math.sqrt(s.z), 0.35, 1.25);
    for (const c of corners(sc, s, r)) {
      if (c.x < pt.x + 4 || c.x > pt.x + pt.w - 4 || c.y < pt.y + 4 || c.y > pt.y + pt.h - 2) continue;
      if (!r.chance((c.t === 'tuft' ? 0.3 : 0.25) + wr * 0.5)) continue;
      if (c.t === 'spray') spray(pl, c.x, c.y, r.range(22, 46) * k, c.dir, r);
      else if (c.t === 'ivy') ivy(pl, c.x, c.y, r.range(40, 120) * k, c.dir, r);
      else Wear.tuft(pl, c.x, c.y, r.range(10, 20) * k, r);
    }
  }

  return { grow };
})();
