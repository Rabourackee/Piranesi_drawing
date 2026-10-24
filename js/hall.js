'use strict';
/*
 * The imagined prison. Around the user's sketch lies a flagstone floor in true one-point
 * perspective, with the vaults lost above the frame; there are no fixed walls to fight the
 * user's own drawing. The "Imagination" slider then grows echoes of the user's bay down the
 * hall, bridges, stairs, chains and ropes, all out of the user's own strokes and built with
 * the same builders. The hall's width (Xl, Xr) still bounds where they may grow.
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
      Yc: 0, // set below: the vaults are lost above the frame
      // the hall runs deeper than the user's furthest architecture
      zB: Math.max(r.range(4.2, 6.5), zMin + 1.6, zFar * 1.12 + 0.3),
      bay: r.range(260, 420),
      archFrac: r.range(0.38, 0.6),
      upper: r.chance(0.65),
      bayStart: r.range(0.9, 1.2),
    };
    // no fixed walls, back wall or ceiling are drawn: they would fight the user's own
    // perspective. The vaults stand above the frame at every depth, so piers rise out of view
    // and chains hang from out of view; only the floor is laid.
    H.Yc = Math.min(-60, (pt.y - 40 - vp.y) * H.zB * 1.3);
    H.proj = (X, Y, z) => P(vp.x + X / z, vp.y + Y / z);
    sc.hall = H;
    items.push({ z: H.zB * 1.4, pri: 0, order: 2, draw: (pl, rr) => floor(pl, sc, rr) });
    return imagine(sc, r.fork(99), amt, zMin, user);
  }

  const cross = (sc, z) => {
    const H = sc.hall, vp = sc.vp;
    return { L: vp.x + H.Xl / z, R: vp.x + H.Xr / z, top: vp.y + H.Yc / z, gy: sc.floorAt(z) };
  };

  function floor(pl, sc, r) {
    // wide enough that its side edges stay outside the plate until deep in the haze
    const H = sc.hall, pr = H.proj, z0 = 0.85, z1 = H.zB * 1.4;
    const Xl = H.Xl * 3.5, Xr = H.Xr * 3.5;
    const q = [pr(Xl, H.Yf, z0), pr(Xr, H.Yf, z0), pr(Xr, H.Yf, z1), pr(Xl, H.Yf, z1)];
    pl.fill([q]);
    pl.clip([q]);
    pl.hatch([q], 0, pl.spacing(0.16), { w: 0.45, a: 0.6 });
    const S = r.range(70, 110);
    // the joints stop short of the horizon, so the floor fades into the haze instead of
    // crowding into a hard band
    const zj = H.zB * 0.75;
    for (let X = Math.ceil(Xl / S) * S; X <= Xr; X += S) pl.ink(pr(X, H.Yf, z0), pr(X, H.Yf, zj * r.range(0.8, 1.1)), 0.55, 0.75, 0.3, 0.15);
    for (let Zw = z0 * sc.f; Zw <= zj * sc.f; Zw += S * (1 + (Zw / sc.f) * 0.15)) { const z = Zw / sc.f; pl.ink(pr(Xl, H.Yf, z), pr(Xr, H.Yf, z), 0.55, 0.75 - 0.4 * (z / zj), 0.3, 0.2); }
    for (let i = 0; i < 6; i++) {
      let p = pr(r.range(H.Xl, H.Xr), H.Yf, r.range(1, H.zB));
      const pts = [p];
      for (let k = 0; k < 6; k++) { p = P(p.x + r.range(-9, 9), p.y + r.range(-3, 3)); pts.push(p); }
      pl.path(pts, false, 0.55, 0.7, 0.2);
    }
    pl.unclip();
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
          o.x0 = s.x0 <= pt.x + 2 ? pt.x - 20 : sx(s.x0, k);
          o.x1 = s.x1 >= pt.x + pt.w - 2 ? pt.x + pt.w + 20 : sx(s.x1, k);
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

    return specs;
  }

  return { build, PRI };
})();
