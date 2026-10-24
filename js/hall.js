'use strict';
/*
 * The imagined prison. Around the user's sketch we build a procedural hall in true
 * one-point perspective: a flagstone floor, a timbered ceiling, arcaded side walls, a back
 * wall with a great arch and a misty vista beyond. The "Imagination" slider then scatters
 * bridges, stairs, piers, transverse arches, chains, pulleys, ropes and tiny figures
 * through the depth. All of it uses the same builders as the user's own strokes.
 *
 * World convention: screen = vp + (X, Y) / z, where z = 1 is the picture plane.
 */
const Hall = (() => {
  const { P, clamp, mix, rect } = G;
  const PI = Math.PI;
  const PRI = { wall: 0, window: 0, arch: 1, pier: 2, stair: 3, spiral: 3, beam: 4, pulley: 5, rope: 5, chain: 6, hang: 6, figure: 7 };

  /*
   * Pushes the hall shell into items and returns the imagined element specs (which still go
   * through the structural pass). zMin is where the user's own architecture ends in depth;
   * nothing is imagined in front of it, so nothing intrudes into the user's vaults.
   */
  function build(sc, r, items, amt, zMin = 1.3) {
    const vp = sc.vp, pt = sc.plate;
    const H = {
      Xl: pt.x - vp.x - r.range(20, 120),
      Xr: pt.x + pt.w - vp.x + r.range(20, 120),
      Yf: sc.Yf,
      Yc: pt.y - vp.y - r.range(150, 420),
      zB: Math.max(r.range(4.2, 6.5), zMin + 1.6),
      bay: r.range(260, 420),
      archFrac: r.range(0.38, 0.6),
      upper: r.chance(0.65),
      bayStart: r.range(0.9, 1.2),
    };
    H.proj = (X, Y, z) => P(vp.x + X / z, vp.y + Y / z);
    sc.hall = H;
    const add = (z, draw, order) => items.push({ z, pri: 0, order, draw });
    add(H.zB * 2.1, (pl, rr) => vista(pl, sc, rr), 0);
    add(H.zB + 0.06, (pl, rr) => backWall(pl, sc, rr), 1);
    add(H.zB + 0.05, (pl, rr) => floor(pl, sc, rr), 2);
    add(H.zB + 0.05, (pl, rr) => ceiling(pl, sc, rr), 3);
    add(H.zB + 0.04, (pl, rr) => sideWall(pl, sc, -1, rr), 4);
    add(H.zB + 0.04, (pl, rr) => sideWall(pl, sc, 1, rr), 5);
    return imagine(sc, r.fork(99), amt, zMin);
  }

  const cross = (sc, z) => {
    const H = sc.hall, vp = sc.vp;
    return { L: vp.x + H.Xl / z, R: vp.x + H.Xr / z, top: vp.y + H.Yc / z, gy: sc.floorAt(z) };
  };

  function wallArch(sc, z, r, frac) {
    const c = cross(sc, z), w = c.R - c.L, vp = sc.vp;
    const rx = w * frac;
    const top = c.top;
    const by = c.gy - (c.gy - top) * r.range(0.28, 0.42);
    let ry = Math.max(rx * r.range(1.0, 1.4), by - vp.y + 10 / z);
    ry = Math.min(ry, by - top - rx * 0.3);
    const cx = clamp(vp.x + r.range(-0.3, 0.3) * rx, c.L + rx * 1.3, c.R - rx * 1.3);
    return { kind: 'arch', z, cx, by, rx, ry: Math.max(ry, rx * 0.5), t: rx * 0.17, L: c.L, R: c.R, top, gy: c.gy };
  }

  function vista(pl, sc, r) {
    const z = sc.hall.zB * 2.1;
    const s = wallArch(sc, z, r, r.range(0.14, 0.22));
    Build.arch(pl, sc, Build.style({ ...s, depth: 90, walkway: false, lantern: false }, r), r);
  }

  function backWall(pl, sc, r) {
    const s = wallArch(sc, sc.hall.zB, r, r.range(0.2, 0.28));
    Build.arch(pl, sc, Build.style({ ...s, depth: 140, walkway: false, lantern: false }, r), r);
  }

  function floor(pl, sc, r) {
    const H = sc.hall, pr = H.proj, z0 = 0.85, z1 = H.zB;
    const q = [pr(H.Xl, H.Yf, z0), pr(H.Xr, H.Yf, z0), pr(H.Xr, H.Yf, z1), pr(H.Xl, H.Yf, z1)];
    pl.fill([q]);
    pl.clip([q]);
    pl.hatch([q], 0, pl.spacing(0.16), { w: 0.45, a: 0.6 });
    const S = r.range(70, 110);
    for (let X = Math.ceil(H.Xl / S) * S; X <= H.Xr; X += S) pl.ink(pr(X, H.Yf, z0), pr(X, H.Yf, z1), 0.55, 0.75, 0.3, 0.15);
    for (let Zw = z0 * sc.f; Zw <= z1 * sc.f; Zw += S) { const z = Zw / sc.f; pl.ink(pr(H.Xl, H.Yf, z), pr(H.Xr, H.Yf, z), 0.55, 0.75, 0.3, 0.2); }
    for (let i = 0; i < 6; i++) {
      let p = pr(r.range(H.Xl, H.Xr), H.Yf, r.range(1, z1));
      const pts = [p];
      for (let k = 0; k < 6; k++) { p = P(p.x + r.range(-9, 9), p.y + r.range(-3, 3)); pts.push(p); }
      pl.path(pts, false, 0.55, 0.7, 0.2);
    }
    pl.unclip();
  }

  function ceiling(pl, sc, r) {
    const H = sc.hall, pr = H.proj, f = sc.f, z0 = 0.85, z1 = H.zB;
    const q = [pr(H.Xl, H.Yc, z0), pr(H.Xr, H.Yc, z0), pr(H.Xr, H.Yc, z1), pr(H.Xl, H.Yc, z1)];
    pl.fill([q]);
    pl.shade([q], 0.6, [{ vp: sc.vp }, { a: 0 }, { a: 0.6 }]);
    const S = r.range(150, 240), bh = r.range(26, 44), bd = r.range(24, 40);
    for (let Zw = z1 * f - S * 0.5; Zw >= z0 * f; Zw -= S) {
      const z = Zw / f, z2 = (Zw + bd) / f;
      const under = [pr(H.Xl, H.Yc + bh, z), pr(H.Xr, H.Yc + bh, z), pr(H.Xr, H.Yc + bh, z2), pr(H.Xl, H.Yc + bh, z2)];
      pl.fill([under]);
      pl.shade([under], 0.82, [{ a: 0 }, { vp: sc.vp }]);
      const front = [pr(H.Xl, H.Yc, z), pr(H.Xr, H.Yc, z), pr(H.Xr, H.Yc + bh, z), pr(H.Xl, H.Yc + bh, z)];
      pl.fill([front]);
      pl.shade([front], 0.38, [{ a: 0 }]);
      pl.outline(front, true, 0.9);
    }
  }

  function sideWall(pl, sc, side, r) {
    const H = sc.hall, f = sc.f, X = side < 0 ? H.Xl : H.Xr;
    const pr = (Y, z, dx = 0) => H.proj(X + dx, Y, z);
    const z0 = 0.75, z1 = H.zB;
    const wall = [pr(H.Yc, z0), pr(H.Yc, z1), pr(H.Yf, z1), pr(H.Yf, z0)];
    const spring = H.Yf - (H.Yf - H.Yc) * H.archFrac;
    const th = 60 * side;
    const pierW = H.bay * 0.26;
    const ops = [], deep = [];
    for (let i = 0; i < 40; i++) {
      const za = H.bayStart + (i * H.bay + pierW / 2) / f, zb = H.bayStart + ((i + 1) * H.bay - pierW / 2) / f;
      if (zb > z1 - 0.02) break;
      const rr = ((zb - za) * f) / 2, zm = (za + zb) / 2;
      const mk = dx => {
        const o = [pr(H.Yf, za, dx), pr(spring, za, dx)];
        for (let k = 1; k < 16; k++) { const a = PI - (k * PI) / 16; o.push(pr(spring - rr * Math.sin(a), zm + (rr * Math.cos(a)) / f, dx)); }
        o.push(pr(spring, zb, dx), pr(H.Yf, zb, dx));
        return o;
      };
      ops.push(mk(0));
      deep.push(mk(th));
      if (H.upper) {
        const wh = rr * 0.9, ww = rr * 0.6;
        const yb = spring - rr - (H.Yf - H.Yc) * 0.07, yt = yb - wh;
        if (yt > H.Yc + 30) {
          const mkw = dx => {
            const o = [pr(yb, zm - ww / 2 / f, dx), pr(yt + ww / 2, zm - ww / 2 / f, dx)];
            for (let k = 1; k < 10; k++) { const a = PI - (k * PI) / 10; o.push(pr(yt + ww / 2 - (ww / 2) * Math.sin(a), zm + ((ww / 2) * Math.cos(a)) / f, dx)); }
            o.push(pr(yt + ww / 2, zm + ww / 2 / f, dx), pr(yb, zm + ww / 2 / f, dx));
            return o;
          };
          ops.push(mkw(0));
          deep.push(mkw(th));
        }
      }
    }
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      pl.fill([o]);
      pl.shade([o], 0.88, [{ a: PI / 2 }, { a: 0.7 }, { a: -0.7 }, { a: 0 }]);
      pl.clip([o]);
      pl.fill([o, deep[i]]);
      pl.shade([o, deep[i]], side < 0 ? 0.3 : 0.55, [{ vp: sc.vp }, { a: PI / 2 }]);
      pl.path(deep[i], true, 0.6, 0.8, 0.2);
      pl.unclip();
    }
    const rings = [wall, ...ops];
    pl.fill(rings);
    pl.shade(rings, side < 0 ? 0.5 : 0.32, [{ vp: sc.vp }, { a: PI / 2 }, { a: side < 0 ? 0.9 : -0.9 }]);
    pl.clip(rings);
    for (let Y = H.Yc + 20; Y < H.Yf; Y += r.range(38, 55)) pl.ink(pr(Y, z0), pr(Y, z1), 0.5, 0.7, 0.3, 0.2);
    pl.unclip();
    for (const o of ops) pl.outline(o, true, 0.9);
    pl.path([pr(H.Yf, z0), pr(H.Yf, z1)], false, 0.9, 0.9, 0.3);
    pl.path([pr(H.Yc, z1), pr(H.Yf, z1)], false, 0.9, 0.9, 0.3);
  }

  /*
   * Imagined structures. The view axis around the vanishing point is kept clear; everything
   * minor lives in two side lanes against the hall walls, the way Piranesi stacks galleries,
   * stairs and tackle along the flanks and leaves the deep centre open:
   *   galleries   cantilever from a side wall (the structural pass props their free end)
   *   stairs      climb to a gallery inside its lane, as one flight or a switchback
   *   colonnades  pairs of piers, one per lane, from floor to vault
   *   tackle      lanterns, pulleys and ropes hung in the lanes from vaults or galleries
   *   spans       at most one bridge crosses the hall, and only high up
   *   arches      at most one transverse arch, centred so it frames the view
   */
  function imagine(sc, r, amt, zMin) {
    const H = sc.hall, vp = sc.vp, pt = sc.plate;
    const specs = [], platforms = [];
    const zMax = Math.min(H.zB - 0.4, zMin + 2.6);
    if (zMax <= zMin + 0.1 || amt <= 0) return specs;
    const zr = () => r.range(zMin, zMax);
    const ceil = z => Math.max(vp.y + H.Yc / z, pt.y - 20);
    const visTop = z => Math.max(ceil(z), pt.y);
    const clearHalf = z => (pt.w * 0.15) / Math.sqrt(z);
    // lane: side -1 has its wall on the left; at(f) runs from the wall (f=0) to the inner edge (f=1)
    function lanes(z) {
      const c = cross(sc, z), cz = clearHalf(z);
      const L = [
        { side: -1, wall: c.L, inner: vp.x - cz },
        { side: 1, wall: c.R, inner: vp.x + cz },
      ].filter(l => Math.abs(l.inner - l.wall) > 50 / z);
      for (const l of L) l.at = f => mix(l.wall, l.inner, f);
      return L;
    }

    function gallery(z, l) {
      const c = cross(sc, z);
      const y = mix(visTop(z) + 50 / z, c.gy - 110 / z, r.range(0.1, 0.75));
      if (c.gy - y < 80 / z) return null;
      if (platforms.some(p => p.lane.side === l.side && Math.abs(p.z - z) < 0.2 && Math.abs(p.y - y) < 70 / z)) return null;
      const xw = l.wall + l.side * 8, xi = l.at(r.range(0.65, 0.95));
      const s = { kind: 'beam', z, x0: Math.min(xw, xi), x1: Math.max(xw, xi), y, h: r.range(18, 28) / z, depth: r.range(110, 220), rail: r.chance(0.9), chains: r.chance(0.4) ? 1 : 0 };
      specs.push(s);
      const p = { z, x0: s.x0, x1: s.x1, y, lane: l, xi };
      platforms.push(p);
      return p;
    }

    function stairTo(p) {
      const z = p.z * 1.001, c = cross(sc, z), l = p.lane, gy = c.gy;
      const rise = gy - p.y;
      if (rise < 40 / z) return;
      const toWall = l.side; // +1 means the wall is to the right
      const avail = Math.abs(p.xi - l.wall) * 0.85;
      const run = rise * r.range(0.65, 0.9);
      if (r.chance(0.3)) {
        // a spiral stair winding up just beyond the gallery's free end, which it also carries
        const R = clamp(rise * 0.13, 16 / z, 55 / z);
        specs.push({ kind: 'spiral', z, x: p.xi - l.side * R * 0.6, y0: p.y, y1: gy, R, phase: r.range(0, Math.PI * 2) });
        return;
      }
      if (run <= avail) {
        const sx = p.xi + toWall * avail * 0.08;
        specs.push({ kind: 'stair', z, S: P(sx, gy), E: P(sx + toWall * run, p.y), solid: true, rail: true, depth: r.range(70, 140) });
        return;
      }
      // switchback: out from the wall to a landing, then back up to the gallery
      const ym = (gy + p.y) / 2, run2 = Math.min(avail * 0.85, (rise / 2) * 0.9);
      if (run2 < 20 / z) return;
      const s1 = l.wall - toWall * avail * 0.06;
      const e1 = s1 - toWall * run2;
      const lh = clamp(14 / z, 6, 16);
      specs.push({ kind: 'stair', z, S: P(s1, gy), E: P(e1, ym), solid: true, rail: true, depth: r.range(70, 140) });
      const land = { kind: 'beam', z, x0: Math.min(l.wall + toWall * 8, e1 - toWall * 14), x1: Math.max(l.wall + toWall * 8, e1 - toWall * 14), y: ym, h: lh, depth: r.range(70, 140), rail: true, chains: 0 };
      specs.push(land);
      platforms.push({ z, x0: land.x0, x1: land.x1, y: ym, lane: l, xi: e1 });
      specs.push({ kind: 'stair', z: z * 0.997, S: P(e1 + toWall * 4, ym), E: P(e1 + toWall * (4 + run2), p.y), solid: false, rail: true, depth: r.range(70, 140) });
    }

    const n = Math.round(amt * 14);
    const kinds = ['gallery', 'gallery', 'gallery', 'gallery', 'colonnade', 'colonnade', 'lantern', 'lantern', 'pulley', 'rope', 'rope', 'span', 'arch'];
    let spans = 0, arches = 0;
    for (let i = 0; i < n; i++) {
      const k = r.pick(kinds), z = zr(), c = cross(sc, z), L = lanes(z);
      if (!L.length && k !== 'span' && k !== 'arch') continue;
      const l = L.length ? r.pick(L) : null;
      switch (k) {
        case 'gallery': {
          const p = gallery(z, l);
          if (p && r.chance(0.7)) stairTo(p);
          break;
        }
        case 'colonnade': {
          const w = r.range(55, 95) / z, f = r.range(0.3, 0.6);
          const pair = L.map(ll => ({ kind: 'pier', z, x: ll.at(f), w, y0: ceil(z), y1: c.gy, ring: r.chance(0.3), canWrap: r.chance(0.55) }));
          specs.push(...pair);
          // the pair carries a great arch between them; its opening keeps the centre clear
          if (pair.length === 2 && arches++ < 2 && r.chance(0.6)) {
            const Lx = Math.min(pair[0].x, pair[1].x), Rx = Math.max(pair[0].x, pair[1].x);
            const rx = (Rx - Lx) / 2 - w * 0.5, top = ceil(z);
            const by = c.gy - (c.gy - Math.max(top, pt.y)) * r.range(0.35, 0.5);
            const t = clamp(rx * 0.16, 8, 50);
            const ry = Math.min(rx * r.range(0.6, 1.1), by - Math.max(top, pt.y - 60) - t * 1.6);
            if (rx > 40 / z && ry > rx * 0.3) specs.push({ kind: 'arch', z: z * 1.004, cx: (Lx + Rx) / 2, by, rx, ry, t, L: Lx, R: Rx, top, gy: c.gy, depth: w * 1.2, walkway: false, lantern: false });
          }
          break;
        }
        case 'lantern': {
          const x = l.at(r.range(0.3, 0.9)), y0 = ceil(z);
          specs.push({ kind: 'hang', z, x, y0, y1: mix(visTop(z), c.gy, r.range(0.2, 0.45)), link: 7 / z, sway: 0, end: r.pick(['lantern', 'lantern', 'hook', 'weight', 'ring']) });
          break;
        }
        case 'pulley': {
          const x = l.at(r.range(0.35, 0.85)), y = mix(visTop(z), c.gy, r.range(0.12, 0.3));
          specs.push({ kind: 'pulley', z, x, y, rad: r.range(10, 20) / z, y0: ceil(z), yl: mix(y, c.gy, r.range(0.4, 0.85)), yr: mix(y, c.gy, r.range(0.3, 0.6)) });
          break;
        }
        case 'rope': {
          // a taut tackle line from the vault down to a gallery or the floor, inside the lane
          const p = platforms.find(q => q.lane.side === l.side && Math.abs(q.z - z) < 0.3);
          const zz = p ? p.z : z;
          const a = P(l.at(r.range(0.2, 0.9)), ceil(zz));
          const bx = p ? mix(p.x0, p.x1, r.range(0.2, 0.8)) : l.at(r.range(0.1, 0.9));
          const b = P(bx, p ? p.y : cross(sc, zz).gy);
          specs.push({ kind: 'rope', z: zz, pts: Build.sag(a, b, r.range(2, 12) / zz, 20), w: 2.2 / zz, auto: true });
          break;
        }
        case 'span': {
          if (spans++ >= 1) break;
          const y = mix(visTop(z) + 30 / z, vp.y, r.range(0.05, 0.35));
          const s = { kind: 'beam', z, x0: c.L - 8, x1: c.R + 8, y, h: r.range(18, 28) / z, depth: r.range(110, 220), rail: true, chains: 0 };
          if (r.chance(0.45)) s.arc = r.range(12, 40) / z;
          specs.push(s);
          break;
        }
        case 'arch': {
          if (arches++ >= 1) break;
          const z2 = r.range(zMin + 0.2, Math.max(zMin + 0.3, zMax));
          const s = wallArch(sc, z2, r, r.range(0.3, 0.37));
          specs.push({ ...s, depth: r.range(90, 180), walkway: false, lantern: false });
          break;
        }
      }
    }
    // figures: on galleries and landings, or walking on the floor
    const nf = Math.round(amt * r.range(2, 6));
    for (let i = 0; i < nf; i++) {
      if (platforms.length && r.chance(0.6)) {
        const p = r.pick(platforms);
        if (p.x1 - p.x0 > 40) specs.push({ kind: 'figure', z: p.z * 0.999, x: r.range(p.x0 + 14, p.x1 - 14), y: p.y, h: 46 / p.z });
      } else {
        const z = zr(), c = cross(sc, z);
        specs.push({ kind: 'figure', z, x: r.range(Math.max(c.L, pt.x) + 20, Math.min(c.R, pt.x + pt.w) - 20), y: c.gy, h: 52 / z });
      }
    }
    return specs;
  }

  return { build, PRI };
})();
