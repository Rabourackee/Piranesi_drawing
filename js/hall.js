'use strict';
/*
 * The imagined prison. Around the user's sketch we build a procedural hall in true
 * one-point perspective: a flagstone floor, a timbered ceiling, arcaded side walls, a back
 * wall with a great arch and a misty vista beyond. The "Imagination" slider then grows
 * echoes of the user's bay down the hall, bridges, stairs, chains, ropes and tiny figures,
 * all out of the user's own strokes and built with the same builders.
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
  function build(sc, r, items, amt, zMin = 1.3, zFar = 1, user = []) {
    const vp = sc.vp, pt = sc.plate;
    const H = {
      Xl: pt.x - vp.x - r.range(20, 120),
      Xr: pt.x + pt.w - vp.x + r.range(20, 120),
      Yf: sc.Yf,
      Yc: pt.y - vp.y - r.range(150, 420),
      // the back wall always stands behind the user's furthest architecture
      zB: Math.max(r.range(4.2, 6.5), zMin + 1.6, zFar * 1.12 + 0.3),
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
    return imagine(sc, r.fork(99), amt, zMin, user);
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
   * Imagined structures, grown only out of what the user drew:
   *   echoes      the user's bay repeats down the hall in true perspective, the way Piranesi
   *               lets an arcade or a row of piers recede into the gloom
   *   bridges     pairs of piers at one depth are joined by a bridge
   *   stairs      climb from the floor to a bridge's free end, or a spiral carries it
   *   tackle      chains, lanterns and ropes hang from real soffits
   * Each piece touches what holds it; anything still floating is removed by the audit.
   */
  function imagine(sc, r, amt, zMin, user) {
    const H = sc.hall, vp = sc.vp, pt = sc.plate;
    const specs = [];
    const STRUCT = { pier: 1, beam: 1, arch: 1, stair: 1 };
    const base = user.filter(s => STRUCT[s.kind]);
    if (amt <= 0 || !base.length) return specs;
    const ceil = z => Math.max(vp.y + H.Yc / z, pt.y - 20);
    const zLim = H.zB - 0.35;
    const sx = (x, k) => vp.x + (x - vp.x) * k, sy = (y, k) => vp.y + (y - vp.y) * k;
    const at = (p, k) => P(sx(p.x, k), sy(p.y, k));
    const strip = ({ user: _u, order: _o, style: _s, ...rest }) => rest;

    /* the same element moved back to depth z2: everything scales about the vanishing point */
    function echo(s, z2) {
      const k = s.z / z2, c = cross(sc, z2);
      const inside = (x0, x1) => x0 > c.L - 10 && x1 < c.R + 10;
      const o = { ...strip(s), z: z2, echo: true };
      switch (s.kind) {
        case 'pier': {
          o.x = sx(s.x, k); o.w = s.w * k;
          o.y0 = s.y0 <= pt.y + 30 ? ceil(z2) : sy(s.y0, k);
          o.y1 = sy(s.y1, k);
          return inside(o.x - o.w, o.x + o.w) ? o : null;
        }
        case 'beam': {
          o.x0 = s.x0 <= pt.x + 2 ? c.L - 8 : Math.max(c.L - 8, sx(s.x0, k));
          o.x1 = s.x1 >= pt.x + pt.w - 2 ? c.R + 8 : Math.min(c.R + 8, sx(s.x1, k));
          o.y = sy(s.y, k); o.h = s.h * k;
          if (s.arc) o.arc = s.arc * k;
          o.chains = 0;
          return o.x1 - o.x0 > 30 / z2 ? o : null;
        }
        case 'arch': {
          Object.assign(o, { cx: sx(s.cx, k), by: sy(s.by, k), rx: s.rx * k, ry: s.ry * k, t: s.t * k, pw: s.pw * k, top: Math.max(sy(s.top, k), ceil(z2)), gy: sy(s.gy, k), lantern: false });
          if (s.L != null) o.L = sx(s.L, k);
          if (s.R != null) o.R = sx(s.R, k);
          return inside(o.L ?? o.cx - o.rx - o.pw, o.R ?? o.cx + o.rx + o.pw) ? o : null;
        }
        case 'stair': {
          o.S = at(s.S, k); o.E = at(s.E, k);
          if (s.path) o.path = s.path.map(p => at(p, k));
          return inside(Math.min(o.S.x, o.E.x), Math.max(o.S.x, o.E.x)) ? o : null;
        }
      }
      return null;
    }

    // 1. echoes: the bay drawn at each depth layer repeats, thinning out as it recedes
    const bay = r.range(0.55, 0.95);
    const nE = amt < 0.3 ? 1 : amt < 0.6 ? 2 : 3;
    const layers = new Map();
    for (const s of base) {
      const key = s.z.toFixed(2);
      if (!layers.has(key)) layers.set(key, []);
      layers.get(key).push(s);
    }
    for (const group of layers.values()) {
      const z0 = group[0].z;
      for (let i = 1; i <= nE; i++) {
        const z2 = z0 + bay * i * Math.sqrt(z0);
        if (z2 > zLim) break;
        const keep = i === 1 ? 1 : i === 2 ? 0.75 : 0.5;
        for (const s of group) if (r.chance(keep)) { const e = echo(s, z2); if (e) specs.push(e); }
      }
    }

    const all = () => user.concat(specs);
    const sameZ = (a, b) => Math.abs(a - b) / Math.min(a, b) < 0.06;
    const boxes = z => all().filter(s => sameZ(s.z, z)).map(s => Structure.boxOf(s)).filter(Boolean);
    const free = (z, b) => boxes(z).every(o => o.x1 < b.x0 || o.x0 > b.x1 || o.y1 < b.y0 || o.y0 > b.y1);

    // 2. bridges between neighbouring piers at one depth that are not already joined
    const piers = all().filter(s => s.kind === 'pier');
    const beams = () => all().filter(s => s.kind === 'beam');
    for (let i = 0; i < piers.length; i++) for (let j = i + 1; j < piers.length; j++) {
      const a = piers[i], b = piers[j];
      if (!sameZ(a.z, b.z) || !r.chance(0.35 + amt * 0.4)) continue;
      const [L, R] = a.x < b.x ? [a, b] : [b, a];
      const gap = R.x - R.w / 2 - (L.x + L.w / 2);
      if (gap < 40 / a.z || gap > pt.w * 0.6) continue;
      if (piers.some(p => p !== a && p !== b && sameZ(p.z, a.z) && p.x > L.x && p.x < R.x)) continue;
      const lo = Math.max(L.y0, R.y0) + 40 / a.z, hi = Math.min(L.y1, R.y1) - 90 / a.z;
      if (hi - lo < 30) continue;
      if (beams().some(bm => sameZ(bm.z, a.z) && bm.x0 < R.x && bm.x1 > L.x)) continue;
      const y = mix(lo, hi, r.range(0.15, 0.7));
      const s = { kind: 'beam', z: a.z, x0: L.x, x1: R.x, y, h: r.range(14, 24) / Math.sqrt(a.z), depth: Math.min(L.w, R.w) * 1.1, rail: r.chance(0.85), chains: r.chance(0.3) ? 1 : 0 };
      if (r.chance(0.35)) s.arc = r.range(8, 30) / a.z;
      specs.push(s);
    }

    // 3. stairs: from the floor up to a bridge's free end, or a spiral that carries it
    for (const b of beams()) {
      if (!r.chance(0.3 + amt * 0.35)) continue;
      const z = b.z, gy = sc.floorAt(z), c = cross(sc, z), rise = gy - b.y;
      if (rise < 70 / z) continue;
      for (const e of r.chance(0.5) ? [-1, 1] : [1, -1]) {
        const xe = e < 0 ? b.x0 : b.x1;
        if (xe <= c.L + 10 || xe >= c.R - 10 || xe <= pt.x + 10 || xe >= pt.x + pt.w - 10) continue;
        const run = rise * r.range(0.6, 0.85), sxp = xe + e * run;
        const box = { x0: Math.min(xe + e * 6, sxp), x1: Math.max(xe + e * 6, sxp), y0: b.y - 30, y1: gy };
        if (sxp > c.L + 6 && sxp < c.R - 6 && free(z, box)) {
          specs.push({ kind: 'stair', z, S: P(sxp, gy), E: P(xe, b.y), solid: true, rail: true, depth: (b.depth || 120) * 0.8 });
          break;
        }
        const R = clamp(rise * 0.12, 14 / z, 50 / z), xs = xe + e * R * 0.6;
        const sbox = { x0: Math.min(xe + e * 4, xs + e * R), x1: Math.max(xe + e * 4, xs + e * R), y0: b.y + b.h, y1: gy };
        if (xs - R > c.L && xs + R < c.R && free(z, sbox)) {
          specs.push({ kind: 'spiral', z: z * 1.001, x: xs, y0: b.y + b.h * 0.5, y1: gy, R, phase: r.range(0, PI * 2) });
          break;
        }
      }
    }

    // 4. tackle hanging from soffits, and chains slung between neighbouring piers
    for (const b of beams()) {
      if (!r.chance(0.2 + amt * 0.3)) continue;
      const x = mix(b.x0, b.x1, r.range(0.2, 0.8)), z = b.z, gy = sc.floorAt(z);
      if (x < pt.x + 20 || x > pt.x + pt.w - 20) continue;
      if (r.chance(0.6)) specs.push({ kind: 'hang', z: z * 0.999, x, y0: b.y, y1: mix(b.y, gy, r.range(0.2, 0.45)), link: clamp(7 / z, 3, 8), sway: 0, end: r.pick(['lantern', 'lantern', 'hook', 'weight', 'ring']) });
      else specs.push({ kind: 'rope', z: z * 0.999, pts: [P(x, b.y + b.h), P(x + r.range(-6, 6) / z, gy)], w: 2 / z, auto: true });
    }
    for (let i = 0; i < piers.length; i++) for (let j = i + 1; j < piers.length; j++) {
      const a = piers[i], b = piers[j];
      if (!sameZ(a.z, b.z) || !r.chance(0.15 + amt * 0.2)) continue;
      const [L, R] = a.x < b.x ? [a, b] : [b, a];
      const gap = R.x - L.x;
      if (gap < 60 / a.z || gap > pt.w * 0.5) continue;
      const y = mix(Math.max(L.y0, R.y0), Math.min(L.y1, R.y1), r.range(0.15, 0.4));
      specs.push({ kind: 'chain', z: a.z * 0.998, A: P(L.x + L.w / 2, y), B: P(R.x - R.w / 2, y + r.range(-10, 10) / a.z), sag: gap * r.range(0.12, 0.3), link: clamp(6 / a.z, 3, 8) });
    }

    // 5. a high bridge or a transverse arch from wall to wall, deeper than the user's work
    if (r.chance(0.25 + amt * 0.3)) {
      const z = r.range(zMin + 0.2, Math.max(zMin + 0.3, zLim - 0.3)), c = cross(sc, z);
      if (r.chance(0.5)) {
        const y = mix(Math.max(c.top, pt.y) + 30 / z, vp.y, r.range(0.05, 0.3));
        const s = { kind: 'beam', z, x0: c.L - 8, x1: c.R + 8, y, h: r.range(18, 28) / z, depth: r.range(110, 220), rail: true, chains: 0 };
        if (r.chance(0.45)) s.arc = r.range(12, 40) / z;
        specs.push(s);
      } else {
        const s = wallArch(sc, z, r, r.range(0.3, 0.37));
        specs.push({ ...s, depth: r.range(90, 180), walkway: false, lantern: false });
      }
    }

    return specs;
  }

  return { build, PRI };
})();
