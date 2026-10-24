'use strict';
/*
 * Architectural builders. Each one turns an interpreted spec into etched geometry.
 *
 * The workhorse is prism(): a flat outline drawn in the picture plane at depth z is chipped
 * and roughened by time, then extruded toward the vanishing point. Every edge becomes a
 * receding face; faces are culled against the VP, painter-sorted, toned by a fixed
 * upper-left light, and hatched in the face's own (along-edge, into-depth) coordinates.
 *
 * Every element type comes in several styles (picked by style() from the seed), so a plate
 * mixes square and round piers, flat, arched and timber bridges, different arch rings and
 * keystones, solid, vaulted, flying, curved and spiral stairs.
 */
const Build = (() => {
  const { P, dist, lerp, clamp, rect, ellipse, bbox } = G;
  const PI = Math.PI, HALF = PI / 2;
  const LIGHT = { x: -0.55, y: -0.835 };

  const faceTone = (nx, ny, hole) =>
    clamp(0.5 - 0.42 * (nx * LIGHT.x + ny * LIGHT.y) + (hole ? 0.15 : 0), 0.04, 0.97);
  const wearOf = (sc, r, k = 1) => clamp((sc.wear ?? 0.5) * k * r.range(0.6, 1.4), 0, 1.2);

  /* Point p (in the plane at depth z) pushed back by D*w world px toward the VP. */
  function makeExt(sc, z, D) {
    return (p, w = 1) => {
      const k = z / (z + (D * w) / sc.f);
      return P(sc.vp.x + (p.x - sc.vp.x) * k, sc.vp.y + (p.y - sc.vp.y) * k);
    };
  }

  function sag(a, b, s, n = 28) {
    const out = [];
    for (let i = 0; i <= n; i++) { const t = i / n; out.push(P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + 4 * s * t * (1 - t))); }
    return out;
  }

  /* ---------------------------------------------------------------- styles */
  /* Picks the look of an element from the seed; called before the structural pass. */
  function style(s, r) {
    if (s.style) return s;
    switch (s.kind) {
      case 'pier':
        s.style = s.w > 75 ? r.pick(['tower', 'tower', 'square', 'banded', 'rubble']) : r.pick(['square', 'banded', 'column', 'column', 'pilaster', 'rubble']);
        break;
      case 'beam': {
        const len = s.x1 - s.x0;
        s.style = s.landing || len < 120 ? r.pick(['flat', 'flat', 'timber']) : r.pick(['flat', 'flat', 'arched', 'arched', 'timber']);
        s.railStyle = !s.rail ? 'none' : s.style === 'timber' ? 'timber' : r.pick(['baluster', 'baluster', 'iron', 'parapet', 'broken']);
        if (s.style === 'arched') s.archK = r.range(2.4, 4.2);
        break;
      }
      case 'arch':
        s.shape = s.ry < s.rx * 0.62 ? 'segmental' : 'round';
        s.ring = r.pick(['voussoir', 'voussoir', 'gibbs', 'archivolt', 'rough']);
        s.key = r.pick(['plain', 'proud', 'proud', 'scroll']);
        s.quoins = r.chance(0.4);
        s.style = s.ring;
        break;
      case 'stair':
        s.style = s.solid ? r.pick(['solid', 'solid', 'vaulted']) : 'flying';
        s.railStyle = !s.rail ? 'none' : r.pick(['iron', 'iron', 'baluster', 'parapet']);
        break;
      case 'window':
        if (s.shape === 'rect' && r.chance(0.4)) s.shape = 'archtop';
        s.grille = s.shape === 'round' ? r.pick(['radial', 'bars', 'lattice']) : r.pick(['bars', 'bars', 'lattice', 'broken']);
        s.style = s.shape;
        break;
      case 'wall':
        s.style = r.pick(['ashlar', 'ashlar', 'rubble', 'banded']);
        break;
      default:
        s.style = 'plain';
    }
    return s;
  }

  /* ---------------------------------------------------------------- geometry shared with Structure */
  function beamTop(s, x) {
    if (!s.arc) return s.y;
    const hs = (s.x1 - s.x0) / 2, u = clamp((x - (s.x0 + hs)) / (hs || 1), -1, 1);
    return s.y - s.arc * (1 - u * u);
  }
  function beamBottom(s, x) {
    const t = beamTop(s, x);
    if (s.style !== 'arched') return t + s.h;
    const hs = (s.x1 - s.x0) / 2, u = clamp((x - (s.x0 + hs)) / (hs || 1), -1, 1);
    const Hd = s.h * (s.archK || 3);
    return t + Hd - (Hd - s.h) * Math.sqrt(Math.max(0, 1 - u * u));
  }
  /* Arch intrados (and concentric extrados with offset k), parameter u in [0,1] left to right. */
  function archPoint(s, u, k = 0) {
    if (s.shape === 'segmental') {
      const R = (s.rx * s.rx + s.ry * s.ry) / (2 * s.ry), cyc = s.by + R - s.ry;
      const al = Math.asin(clamp(s.rx / R, 0, 1)), th = HALF + al - 2 * al * u;
      return P(s.cx + (R + k) * Math.cos(th), cyc - (R + k) * Math.sin(th));
    }
    const a = PI - u * PI;
    return P(s.cx + (s.rx + k) * Math.cos(a), s.by - (s.ry + k) * Math.sin(a));
  }
  const archCurve = (s, n, k = 0) => Array.from({ length: n + 1 }, (_, i) => archPoint(s, i / n, k));
  function archIntradosY(s, x) {
    const dx = clamp(x - s.cx, -s.rx, s.rx);
    if (s.shape === 'segmental') {
      const R = (s.rx * s.rx + s.ry * s.ry) / (2 * s.ry), cyc = s.by + R - s.ry;
      return cyc - Math.sqrt(Math.max(0, R * R - dx * dx));
    }
    const u = dx / s.rx;
    return s.by - s.ry * Math.sqrt(Math.max(0, 1 - u * u));
  }
  /* Stair profile: steps placed at equal arc length along the stringer path (straight or curved). */
  function stairProfile(s) {
    const path = s.path && s.path.length > 2 ? s.path : [s.S, s.E];
    const len = Math.max(1, G.polyLength(path));
    const n = clamp(Math.round(len / 16), 3, 40);
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + dist(path[i - 1], path[i]));
    const at = d => {
      let i = 1;
      while (i < path.length - 1 && cum[i] < d) i++;
      const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      return lerp(path[i - 1], path[i], clamp(t, 0, 1));
    };
    const Q = [];
    for (let k = 0; k <= n; k++) Q.push(k === 0 ? P(s.S.x, s.S.y) : k === n ? P(s.E.x, s.E.y) : at((len * k) / n));
    // treads must climb monotonically
    for (let k = 1; k <= n; k++) if (Q[k].y > Q[k - 1].y - 1) Q[k] = P(Q[k].x, Q[k - 1].y - 1);
    const top = [Q[0]], treads = [];
    for (let k = 0; k < n; k++) {
      top.push(P(Q[k].x, Q[k + 1].y), P(Q[k + 1].x, Q[k + 1].y));
      treads.push({ xa: Q[k].x, xb: Q[k + 1].x, y: Q[k + 1].y });
    }
    return { Q, n, top, treads, dir: Math.sign(s.E.x - s.S.x) || 1, rh: (s.S.y - s.E.y) / n };
  }
  function stairTop(s, x) {
    const { treads } = stairProfile(s);
    let best = treads[0], bd = Infinity;
    for (const t of treads) {
      const lo = Math.min(t.xa, t.xb), hi = Math.max(t.xa, t.xb);
      if (x >= lo && x <= hi) return t.y;
      const d = Math.min(Math.abs(x - lo), Math.abs(x - hi));
      if (d < bd) { bd = d; best = t; }
    }
    return best.y;
  }

  /* ---------------------------------------------------------------- the extruded prism */
  function prism(pl, sc, o) {
    const vp = sc.vp, r = o.r || pl.r;
    const ext = makeExt(sc, o.z, o.depth);
    let rings = o.rings;
    // breaches: ragged holes right through the wall, revealing what lies behind it
    let breaches = [];
    if (o.breach && o.breach.n > 0) {
      breaches = Wear.patches(rings, o.breach.n, o.breach.size, r, o.breach.avoid || [], o.breach.zone);
      rings = rings.concat(breaches);
    }
    const wr = o.wear ?? 0;
    if (wr > 0.01) rings = rings.map((ring, i) => Wear.chip(ring, i > 0, wr, o.chipScale || 8, r, o.floorY));
    const amp = (o.rough ?? 1) * (sc.hand ?? 0.6) * 0.9;
    if (amp > 0.05) rings = rings.map(ring => Wear.roughen(ring, amp, 24, r, o.floorY));
    const faces = [];
    rings.forEach((ring, ri) => {
      const rf = [];
      let u = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const L = dist(a, b);
        if (L < 0.05) continue;
        let nx = (b.y - a.y) / L, ny = -(b.x - a.x) / L;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (G.pointInRings(P(mx + nx * 0.6, my + ny * 0.6), rings)) { nx = -nx; ny = -ny; }
        // shade by the edge this piece was roughened from, so tone stays calm along a surface
        let tnx = nx, tny = ny, dir = Math.atan2(b.y - a.y, b.x - a.x);
        if (a.pa != null && !a.chip) {
          dir = a.pa;
          tnx = Math.sin(a.pa); tny = -Math.cos(a.pa);
          if (tnx * nx + tny * ny < 0) { tnx = -tnx; tny = -tny; }
        }
        const facing = (vp.x - mx) * nx + (vp.y - my) * ny > 0;
        const onFloor = o.floorY != null && a.y >= o.floorY - 1.5 && b.y >= o.floorY - 1.5;
        const flush = o.holesOnly && ri === 0;
        rf.push({ a, b, L, nx, ny, tnx, tny, mx, my, u0: u, u1: u + L, vis: facing && !onFloor && !flush, hole: ri > 0, dir });
        u += L;
      }
      rf.forEach((f, i) => { f.prev = rf[(i - 1 + rf.length) % rf.length]; f.next = rf[(i + 1) % rf.length]; });
      faces.push(...rf);
    });
    // In one-point extrusion, the face whose front edge is nearer the VP is nearer the eye.
    const vis = faces.filter(f => f.vis);
    for (const f of vis) f.d = Math.hypot(f.mx - vp.x, f.my - vp.y);
    vis.sort((p, q) => q.d - p.d);
    for (const f of vis) sideFace(pl, f, ext, o);

    pl.fill(rings);
    const fr = o.front || {};
    if (fr.tone) pl.shade(rings, fr.tone, fr.dirs || [{ a: 0 }]);
    if (fr.texture) fr.texture(pl, ext, rings);
    for (const ring of rings) pl.outline(ring, true, o.lineW || 1.45);
    // stones that fell out of a breach lie on its lower lip
    for (const b of breaches) {
      const low = b.reduce((m, q) => (q.y > m.y ? q : m), b[0]);
      if (r.chance(0.7)) Wear.rubble(pl, low.x, low.y, o.breach.size * 0.3, clamp(o.breach.size * 0.1, 2, 8), r);
    }
    // the final touch of time: carved surface broken away and replaced by fractured stone
    if (o.spall && o.spall.n > 0) {
      for (const sp of Wear.patches(rings, o.spall.n, o.spall.size, r, o.spall.avoid || [])) Wear.spall(pl, sp, r, fr.dirs);
    }
    return { ext, rings };
  }

  function sideFace(pl, f, ext, o) {
    const A = f.a, B = f.b, A2 = ext(A), B2 = ext(B);
    pl.fill([[A, B, B2, A2]]);
    const tone = Math.round(clamp(faceTone(f.tnx, f.tny, f.hole) + 0.06 + (o.sideBias || 0), 0, 1) * 10) / 10;
    const t = tone * (1 - pl.fog * 0.5);
    const sp = pl.spacing(t), r = pl.r, sk = pl.sketch;
    if (t > 0.07) {
      // receding strokes on a grid measured along the whole ring (curved vaults stay continuous),
      // nudged off the grid and of uneven reach, as if laid in by hand
      const U0 = 1.25, m = Math.max(2, Math.round(sp / U0)), half = m >> 1;
      const dense = t > 0.78;
      for (let k = Math.ceil(f.u0 / U0); k * U0 < f.u1; k++) {
        const km = ((k % m) + m) % m;
        if (km !== 0 && !(dense && km === half)) continue;
        if (r.next() < 0.05 * sk) continue;
        const s = clamp((k * U0 - f.u0 + (r.next() - 0.5) * U0 * m * 0.35 * sk) / f.L, 0, 1);
        const p = lerp(A, B, s);
        const reach = r.next() < 0.3 * sk ? r.range(0.55, 0.92) : r.range(0.93, 1.0);
        pl.ink(p, ext(p, reach), 0.5, 0.8, 0.22, 0.08, sp * 0.4);
      }
    }
    if (t > 0.36) {
      let nr = clamp(Math.round((o.depth * 0.28) / sp), 1, 34);
      if (t > 0.7) nr = nr * 2 + 1;
      for (let j = 1; j <= nr; j++) {
        if (r.next() < 0.08 * sk) continue;
        const w = j / (nr + 1);
        pl.ink(ext(A, w), ext(B, w), 0.45, 0.72, 0.12, 0);
      }
    }
    pl.ink(A2, B2, 0.6, 0.8, 0.2, 0.1);
    const crease = g => !g.vis || Math.abs(G.angDiff(g.dir, f.dir)) > 0.45;
    if (crease(f.prev)) pl.ink(A, A2, 0.85, 0.9, 0.25, 0.08);
    if (crease(f.next)) pl.ink(B, B2, 0.85, 0.9, 0.25, 0.08);
  }

  /* ---------------------------------------------------------------- masonry */
  /*
   * Stone coursing drawn loosely into a face. Types: ashlar, banded (alternating smooth and
   * worm-eaten rusticated courses), rubble (irregular rounded stones). Fallen-out blocks,
   * stains, cracks and water streaks scale with wear.
   */
  function masonry(pl, rings, o) {
    const r = o.r || pl.r, type = o.type || 'ashlar', wr = o.wear ?? 0.5;
    const bb = G.bboxRings(rings);
    const ch = Math.max(4, o.course), bw = Math.max(6, o.block);
    const inside = p => G.pointInRings(p, rings);
    const blockIn = (x0, y0, x1, y1) => inside(P(x0 + 1, y0 + 1)) && inside(P(x1 - 1, y0 + 1)) && inside(P(x0 + 1, y1 - 1)) && inside(P(x1 - 1, y1 - 1));
    if (type === 'rubble') pl.clip(rings);
    let yb = bb.y1, row = 0;
    while (yb > bb.y0) {
      const smooth = type === 'banded' && row % 2 === 1;
      const hh = ch * (type === 'banded' ? (smooth ? 0.5 : 1.15) : type === 'rubble' ? 0.55 + 0.6 * r.next() : 0.7 + 0.6 * r.next());
      const yt = yb - hh;
      if (type !== 'rubble') {
        pl.loose(rings, P(bb.x0 - 4, yt), P(bb.x1 + 4, yt), 0.8, 0.9, 0.6, 0.3);
        if (o.rust) {
          pl.loose(rings, P(bb.x0, yt + 1.3), P(bb.x1, yt + 1.3), 0.6, 0.7, 0.6, 0.45);
          if (!smooth) pl.loose(rings, P(bb.x0, yt + 2.4), P(bb.x1, yt + 2.4), 0.4, 0.45, 0.6, 0.6);
        }
      }
      let x = bb.x0 - r.next() * bw + (row % 2) * bw * 0.5;
      while (x < bb.x1) {
        const x0 = x;
        x += bw * (type === 'rubble' ? 0.45 + 0.7 * r.next() : 0.6 + 0.9 * r.next());
        const bx0 = Math.max(x0, bb.x0), bx1 = Math.min(x, bb.x1);
        if (type === 'rubble') {
          if (bx1 - bx0 > 3 && inside(P((bx0 + bx1) / 2, (yt + yb) / 2))) {
            const rr = Math.min(4, (bx1 - bx0) * 0.3, hh * 0.3), j = () => r.range(-0.9, 0.9);
            const st = [P(bx0 + rr + j(), yt + j()), P(bx1 - rr + j(), yt + j()), P(bx1 + j(), yt + rr + j()), P(bx1 + j(), yb - rr + j()), P(bx1 - rr + j(), yb + j()), P(bx0 + rr + j(), yb + j()), P(bx0 + j(), yb - rr + j()), P(bx0 + j(), yt + rr + j())];
            pl.path(st, true, 0.65, 0.85, 0.3);
            for (let k = 1; k <= 2; k++) pl.ink(P(bx0 + (bx1 - bx0) * 0.45, yb - k * 1.4), P(bx1 - 1, yb - k * 1.4 - 0.5), 0.4, 0.7, 0.2, 0);
          }
          continue;
        }
        if (x < bb.x1 && !smooth) {
          pl.loose(rings, P(x, yt), P(x, yb), 0.7, 0.85, 0.3, 0);
          if (o.rust) pl.loose(rings, P(x + 1.3, yt + 1), P(x + 1.3, yb), 0.45, 0.55, 0.3, 0.3);
        }
        if (bx1 - bx0 > 5 && blockIn(bx0, yt, bx1, yb)) {
          if (!smooth && r.chance(wr * 0.07)) Wear.cavity(pl, bx0 + 1, yt + 1.5, bx1 - 1, yb - 0.5, r);
          else if ((type === 'banded' && !smooth) || (o.vermic && r.chance(0.35))) Wear.vermiculate(pl, bx0 + 2, yt + 3, bx1 - 2, yb - 2, r);
          else if (r.chance(o.stain ?? 0.22)) {
            const sp = r.range(2.2, 3.6) / pl.density;
            for (let y = yt + 2.5; y < yb - 1; y += sp) {
              const a = bx0 + r.next() * (bx1 - bx0) * 0.3, b = bx1 - r.next() * (bx1 - bx0) * 0.3;
              if (b > a + 1) pl.ink(P(a, y), P(b, y + r.range(-0.6, 0.6)), 0.45, 0.75, 0.4, 0.3);
            }
          }
        }
      }
      yb = yt;
      row++;
    }
    if (type === 'rubble') pl.unclip();
    // pits and ticks where low-frequency noise says the stone is worn
    const n = Math.min(500, ((bb.w * bb.h) / 650) * (0.5 + wr));
    const s = r.next() * 50;
    for (let i = 0; i < n; i++) {
      const x = bb.x0 + r.next() * bb.w, y = bb.y0 + r.next() * bb.h;
      if (Rng.fbm(x * 0.018, y * 0.018, s) < 0.5 || !inside(P(x, y))) continue;
      const L = 0.8 + r.next() * 3, a = r.next() * PI;
      pl.ink(P(x, y), P(x + Math.cos(a) * L, y + Math.sin(a) * L), 0.5, 0.7, 0, 0);
    }
    pl.clip(rings);
    const cracks = (r.chance(o.crack ?? 0.5) ? 1 : 0) + (r.chance(wr * 0.6) ? 1 : 0);
    for (let c = 0; c < cracks; c++) {
      const p = P(bb.x0 + r.next() * bb.w, bb.y0 + r.next() * bb.h * 0.7);
      if (inside(p)) Wear.crack(pl, p, Math.min(bb.h, 40 + r.next() * 60), r);
    }
    if (r.chance(wr * 0.6)) {
      const x = bb.x0 + r.range(0.1, 0.9) * bb.w;
      Wear.streaks(pl, x, bb.y0 + r.range(0, 0.2) * bb.h, bb.h * r.range(0.2, 0.5), r);
    }
    pl.unclip();
  }

  /* ---------------------------------------------------------------- ironmongery */
  function chainAlong(pl, pts, link, w = 1) {
    const R = G.resample(pts, link * 0.85);
    for (let i = 0; i < R.length - 1; i++) {
      const a = R[i], b = R[i + 1], c = lerp(a, b, 0.5);
      const ang = Math.atan2(b.y - a.y, b.x - a.x), ca = Math.cos(ang), sa = Math.sin(ang);
      if (i % 2 === 0) {
        const lp = [];
        for (let k = 0; k < 12; k++) {
          const t = (k / 12) * 2 * PI, ex = Math.cos(t) * link * 0.58, ey = Math.sin(t) * link * 0.3;
          lp.push(P(c.x + ex * ca - ey * sa, c.y + ex * sa + ey * ca));
        }
        pl.fill([lp]);
        pl.path(lp, true, 0.75 * w, 0.92, 0.05);
      } else {
        pl.raw([P(c.x - ca * link * 0.55, c.y - sa * link * 0.55), P(c.x + ca * link * 0.55, c.y + sa * link * 0.55)], 1.6 * w, 0.95);
      }
    }
  }
  function lantern(pl, x, y, sz) {
    const cap = [P(x, y), P(x + sz * 0.45, y + sz * 0.38), P(x - sz * 0.45, y + sz * 0.38)];
    const body = [P(x - sz * 0.4, y + sz * 0.38), P(x + sz * 0.4, y + sz * 0.38), P(x + sz * 0.3, y + sz * 1.2), P(x - sz * 0.3, y + sz * 1.2)];
    const tip = [P(x - sz * 0.3, y + sz * 1.2), P(x + sz * 0.3, y + sz * 1.2), P(x, y + sz * 1.55)];
    for (const q of [body, cap, tip]) pl.fill([q]);
    pl.shade([cap], 0.7, [{ a: 0.3 }, { a: -0.9 }]);
    pl.shade([tip], 0.75, [{ a: 0 }, { a: HALF }]);
    for (const f of [-0.15, 0.15]) pl.ink(P(x + f * sz * 1.8, y + sz * 0.4), P(x + f * sz * 1.4, y + sz * 1.18), 0.6, 0.9, 0.05, 0);
    for (const q of [body, cap, tip]) pl.path(q, true, 0.75, 0.95, 0.08);
  }
  function hook(pl, x, y, sz) {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const a = PI + (i / 12) * PI * 1.25; pts.push(P(x + sz * 0.35 + Math.cos(a) * sz * 0.35, y + sz * 0.9 - Math.sin(a) * sz * 0.35)); }
    pl.raw([P(x, y), P(x, y + sz * 0.9)], 1.6, 0.95);
    pl.path(pts, false, 1.5, 0.95, 0.05);
  }
  function weight(pl, x, y, sz) {
    const q = [P(x - sz * 0.3, y), P(x + sz * 0.3, y), P(x + sz * 0.45, y + sz * 0.9), P(x - sz * 0.45, y + sz * 0.9)];
    pl.fill([q]);
    pl.shade([q], 0.85, [{ a: HALF }, { a: 0.6 }, { a: -0.6 }]);
    pl.path(q, true, 0.9, 0.95, 0.05);
  }
  function ringEnd(pl, x, y, sz) {
    pl.path(ellipse(x, y + sz * 0.45, sz * 0.4, sz * 0.45, 0, 2 * PI, 16), true, 1.4, 0.95, 0.05);
  }
  /* A small volute, used on keystones and stair newels. */
  function scroll(pl, x, y, rad, dir) {
    const pts = [];
    for (let i = 0; i <= 26; i++) { const t = i / 26, a = t * PI * 3.2, rr = rad * (1 - t * 0.85); pts.push(P(x + dir * Math.cos(a) * rr, y + Math.sin(a) * rr)); }
    pl.path(pts, false, 0.7, 0.9, 0.05);
  }

  /* An arched doorway cut into a pier: the head of an entangled stair. */
  function doorPoly(d) {
    const hw = d.w / 2, spring = d.y - d.h + hw;
    return [P(d.x - hw, d.y), P(d.x - hw, spring), ...ellipse(d.x, spring, hw, hw, PI, 0, 12).slice(1, -1), P(d.x + hw, spring), P(d.x + hw, d.y)];
  }
  function doorway(pl, q, r) {
    pl.fill([q]);
    pl.shade([q], 0.96, [{ a: HALF }, { a: 0.7 }, { a: -0.7 }, { a: 0 }]);
    const bb = bbox(q);
    // the lit reveal on the right-hand jamb, and a threshold
    pl.ink(P(bb.x1 - 2, bb.y1), P(bb.x1 - 2, bb.y0 + bb.w * 0.5), 0.5, 0.5, 0.2, 0);
    pl.outline(q, true, 1.2);
    const th = rect(bb.x0 - 2, bb.y1 - 2, bb.w + 4, 2.5);
    pl.fill([th]);
    pl.outline(th, true, 0.7);
  }
  /*
   * A corbel, console or timber brace under a beam where it grows out of its support.
   * x is the support face, y the underside of the beam, dir points into the span.
   */
  function corbel(pl, x, y, dir, sz, style, r, freeStanding = false) {
    if (style === 'timber') {
      const a = P(x + (freeStanding ? -dir * sz * 0.2 : 0), y + sz * 2), b = P(x + dir * sz * 1.6, y);
      const nx = -(b.y - a.y), ny = b.x - a.x, l = Math.hypot(nx, ny) || 1, o = 1.6;
      const q = [P(a.x + (nx / l) * o, a.y + (ny / l) * o), P(b.x + (nx / l) * o, b.y + (ny / l) * o), P(b.x - (nx / l) * o, b.y - (ny / l) * o), P(a.x - (nx / l) * o, a.y - (ny / l) * o)];
      pl.fill([q]);
      pl.shade([q], 0.55, [{ a: Math.atan2(b.y - a.y, b.x - a.x) }]);
      pl.outline(q, true, 0.8);
      return;
    }
    if (style === 'console' || r.chance(0.5)) {
      // a scrolled console: square top, swelling curve down to a point on the support
      const pts = [P(x, y), P(x + dir * sz * 0.9, y)];
      for (let i = 1; i <= 8; i++) { const t = i / 8; pts.push(P(x + dir * sz * 0.9 * (1 - Math.sin(t * HALF)), y + sz * 1.7 * (1 - Math.cos(t * HALF)))); }
      pts.push(P(x, y + sz * 1.7));
      pl.fill([pts]);
      pl.shade([pts], 0.42, [{ a: HALF }, { a: 0 }]);
      pl.outline(pts, true, 0.9);
      scroll(pl, x + dir * sz * 0.35, y + sz * 1.2, sz * 0.22, -dir);
      return;
    }
    // stepped corbel: courses projecting further as they rise
    for (let k = 0; k < 3; k++) {
      const wd = sz * (1 - k * 0.28), ht = sz * 0.42, yy = y + k * ht;
      const q = dir > 0 ? rect(x, yy, wd, ht) : rect(x - wd, yy, wd, ht);
      pl.fill([q]);
      pl.shade([q], 0.3 + k * 0.12, [{ a: 0 }]);
      pl.outline(q, true, 0.8);
    }
  }

  /* ---------------------------------------------------------------- piers */
  function pier(pl, sc, s, r) {
    const st = s.style || 'square';
    if (st === 'column' || st === 'tower') return roundPier(pl, sc, s, r, st);
    const z = s.z, w = s.w, x = s.x, yTop = s.y0, yBot = s.y1, H = yBot - yTop;
    const wr = wearOf(sc, r);
    const D = w * r.range(0.9, 1.6) * sc.depthMul;
    const ruin = s.freeTop && r.chance(0.35 + wr * 0.5) && H > w * 1.5;
    const capType = r.pick(['block', 'cornice', 'cornice', 'corbel']);
    const capH = ruin ? 0 : clamp(w * r.range(0.22, 0.38), 5, 44), baseH = clamp(w * r.range(0.3, 0.5), 6, 60);
    const floorY = sc.floorAt(z);
    const y0s = yTop + capH, y1s = yBot - baseH, x0 = x - w / 2, x1 = x + w / 2;
    let shaft, topPts = null;
    if (ruin) {
      topPts = Wear.ruinTop(x0, x1, yTop, Math.min(H * 0.3, w * 1.1), w * r.range(0.25, 0.45), r);
      shaft = [P(x0, y1s), P(x1, y1s), ...topPts];
    } else shaft = rect(x0, y0s, w, Math.max(4, y1s - y0s));
    const type = st === 'banded' ? 'banded' : st === 'rubble' ? 'rubble' : 'ashlar';
    const dirs = r.pick([[{ a: HALF }, { a: 0 }, { a: PI / 4 }], [{ a: HALF + 0.1 }, { a: 0.08 }, { a: -PI / 4 }], [{ a: 0 }, { a: HALF }, { a: PI / 4 }]]);
    const door = s.door ? doorPoly(s.door) : null;
    prism(pl, sc, {
      rings: [shaft], z, depth: D, floorY, wear: wr, chipScale: clamp(w * 0.13, 4, 13), r,
      spall: { n: Math.round(wr * (H * w) / 26000 + r.next() * wr * 0.7), size: clamp(w * 0.32, 8, 34), avoid: door ? [door] : [] },
      front: { tone: 0.2 + r.range(-0.05, 0.1), dirs, texture: (p, e, rg) => {
        masonry(p, rg, { type, course: clamp(w * r.range(0.4, 0.6), 8, 46), block: w * r.range(0.7, 1.0), rust: type !== 'rubble', r, crack: 0.7, stain: 0.3, wear: wr, vermic: st === 'square' && r.chance(0.3) });
        if (door) doorway(p, door, r);
      } },
    });
    if (st === 'pilaster' && y1s - y0s > 30) {
      const pw = w * r.range(0.45, 0.6);
      const strip = rect(x - pw / 2, y0s + 2, pw, y1s - y0s - 2);
      prism(pl, sc, {
        rings: [strip], z: z * 0.992, depth: w * 0.15, wear: wr * 0.6, chipScale: 5, r,
        front: { tone: 0.14, dirs: [{ a: HALF }], texture: p => {
          const nf = Math.max(2, Math.round(pw / 7));
          for (let i = 1; i < nf; i++) { const xx = x - pw / 2 + (pw * i) / nf; p.ink(P(xx, y0s + 8), P(xx, y1s - 8), 0.55, 0.75, 0.2, 0.15); p.ink(P(xx + 1.4, y0s + 8), P(xx + 1.4, y1s - 8), 0.35, 0.5, 0.2, 0.3); }
        } },
      });
    }
    // plinth
    const bw = w * r.range(1.15, 1.35);
    const tiers = r.chance(0.5) ? 2 : 1;
    for (let k = 0; k < tiers; k++) {
      const tw = bw * (1 - k * 0.12), th = baseH / tiers, ty = yBot - th * (k + 1);
      const pq = rect(x - tw / 2, ty, tw, th);
      prism(pl, sc, {
        rings: [pq], z: z * (0.985 + k * 0.004), depth: D * 1.06, floorY, wear: wr * 0.8, chipScale: 5, r,
        front: { tone: 0.14, dirs: [{ a: 0 }], texture: p => {
          p.ink(P(x - tw / 2, ty + th * 0.4), P(x + tw / 2, ty + th * 0.4), 0.6, 0.8, 0.3, 0.1);
          p.shade([rect(x - tw / 2, ty + th * 0.4, tw, th * 0.25)], 0.6, [{ a: 0 }]);
        } },
      });
    }
    // capital
    if (!ruin) {
      if (capType === 'cornice') {
        const hs = [0.3, 0.3, 0.4], ws = [1.1, 1.25, 1.42];
        let yy = y0s;
        for (let k = 0; k < 3; k++) {
          const ch = capH * hs[k], cw = w * ws[k];
          yy -= ch;
          const cq = rect(x - cw / 2, yy, cw, ch);
          prism(pl, sc, { rings: [cq], z: z * (0.988 - k * 0.003), depth: D * (1.02 + k * 0.03), wear: wr * 0.7, chipScale: 4, r, front: { tone: k === 1 ? 0.55 : 0.12, dirs: [{ a: 0 }, { a: HALF }] }, lineW: 1 });
        }
      } else {
        const cw = w * r.range(1.2, 1.4);
        const cq = rect(x - cw / 2, yTop, cw, capH);
        prism(pl, sc, {
          rings: [cq], z: z * 0.985, depth: D * 1.06, wear: wr * 0.7, chipScale: 5, r,
          front: { tone: 0.12, dirs: [{ a: 0 }], texture: p => {
            for (const f of [0.35, 0.6]) p.ink(P(x - cw / 2, yTop + capH * f), P(x + cw / 2, yTop + capH * f), 0.6, 0.85, 0.3, 0.1);
            p.shade([rect(x - cw / 2, yTop + capH * 0.6, cw, capH * 0.4)], 0.62, [{ a: 0 }, { a: HALF }]);
          } },
        });
        if (capType === 'corbel') for (const d of [-1, 1]) {
          const bx = x + d * (w / 2 - w * 0.08);
          const br = [P(bx, y0s), P(bx + d * w * 0.16, y0s), P(bx + d * w * 0.16, y0s + capH * 0.4), P(bx, y0s + capH * 1.3)];
          pl.fill([br]);
          pl.shade([br], 0.45, [{ a: HALF }]);
          pl.outline(br, true, 0.8);
          scroll(pl, bx + d * w * 0.06, y0s + capH * 0.75, w * 0.06, d);
        }
      }
    }
    if (s.ring && H > w * 2.5) {
      const ry = y0s + Math.min(H * 0.3, w * 1.2), rr = clamp(w * 0.1, 3, 9);
      const xs = [x - w * 0.3, x + w * 0.3];
      for (const xx of xs) {
        pl.raw([P(xx, ry - rr * 0.4), P(xx, ry + rr * 0.2)], 2, 0.95);
        pl.path(ellipse(xx, ry + rr, rr * 0.8, rr, 0, 2 * PI, 14), true, 1.2, 0.95, 0.05);
      }
      chainAlong(pl, sag(P(xs[0], ry + 2 * rr), P(xs[1], ry + 2 * rr), w * r.range(0.5, 1.2)), clamp(rr * 1.1, 3, 9));
    }
    if (ruin) {
      const yAt = xx => { let best = topPts[0]; for (const q of topPts) if (Math.abs(q.x - xx) < Math.abs(best.x - xx)) best = q; return best.y; };
      Wear.overgrow(pl, x0, x1, yAt, w * 0.3, 0.6 + wr, r);
      if (r.chance(0.7)) Wear.rubble(pl, x + r.sign() * w * r.range(0.6, 0.9), yBot, w * 0.45, clamp(w * 0.16, 3, 14), r);
    } else if (r.chance(wr * 0.4)) Wear.tuft(pl, x + r.range(-0.4, 0.4) * w, yTop, w * 0.22, r);
    if (r.chance(wr * 0.3) && H > 60) Wear.vine(pl, x + r.range(-0.35, 0.35) * w, y0s + 2, Math.min(H * 0.4, r.range(25, 80)), r);
    if (r.chance(wr * 0.3)) Wear.tuft(pl, x + r.sign() * w * 0.5, yBot - baseH, w * 0.18, r);
    if (z <= 1.3) sc.casts.push({ poly: rect(x0, y0s, w, y1s - y0s).map(p => P(p.x + w * 0.9, p.y + w * 0.35)), k: 0.55 });
  }

  /* Round columns and towers: curved silhouette, shading along the curvature, curved joints. */
  function roundPier(pl, sc, s, r, st) {
    const z = s.z, x = s.x, yTop = s.y0, yBot = s.y1, vp = sc.vp;
    const tower = st === 'tower';
    const R = (s.w / 2) * (tower ? 1.1 : 0.85);
    const wr = wearOf(sc, r);
    const ruin = s.freeTop && r.chance(0.4 + wr * 0.5) && yBot - yTop > R * 4;
    const k = y => clamp((y - vp.y) / 900, -0.3, 0.3); // ellipse squash of a horizontal circle at height y
    const capH = ruin ? 0 : clamp(R * (tower ? 0.55 : 0.75), 5, 50), baseH = clamp(R * (tower ? 0.45 : 0.6), 5, 50);
    const yA = yTop + capH, yB = yBot - baseH;
    const rAt = y => (tower ? R : R * (1 - 0.12 * clamp((yB - y) / Math.max(1, yB - yA), 0, 1)));
    const circ = (y, rr, phi) => P(x + rr * Math.sin(phi), y + k(y) * rr * Math.cos(phi));
    const arc = (y, rr, n = 20) => Array.from({ length: n + 1 }, (_, i) => circ(y, rr, -HALF + (PI * i) / n));
    let topEdge;
    if (ruin) {
      const rg = r.fork(3), s0 = rg.next() * 10;
      topEdge = Array.from({ length: 13 }, (_, i) => {
        const phi = HALF - (PI * i) / 12;
        const drop = (Rng.noise1(s0 + i * 0.6) * 0.8 + rg.next() * 0.3) * R * 1.4;
        return P(x + rAt(yTop + drop) * Math.sin(phi), yTop + drop + k(yTop) * R * Math.cos(phi));
      });
    } else topEdge = arc(yA, rAt(yA)).reverse();
    const yS = ruin ? Math.max(...topEdge.map(p => p.y)) : yA;
    const left = [P(x - rAt(topEdge[topEdge.length - 1].y), topEdge[topEdge.length - 1].y), P(x - rAt(yB), yB)];
    const right = [P(x + rAt(yB), yB), P(x + rAt(topEdge[0].y), topEdge[0].y)];
    const body = [...left, ...arc(yB, rAt(yB)).slice(1, -1), ...right, ...topEdge];
    pl.fill([body]);
    // tone around the drum: lit on the left, a sliver of reflected light on the far right
    const toneAt = phi => clamp(0.5 - 0.42 * (-0.62 * Math.sin(phi) + 0.45 * Math.cos(phi)) - (phi > 1.25 ? 0.12 : 0) + 0.04, 0.05, 0.95) * (1 - pl.fog * 0.5);
    let acc = 0, lastX = x - R;
    for (let phi = -HALF + 0.02; phi < HALF - 0.02; phi += 0.012) {
      const xm = x + R * Math.sin(phi);
      acc += xm - lastX;
      lastX = xm;
      const t = toneAt(phi);
      if (t < 0.08 || acc < pl.spacing(t)) continue;
      acc = 0;
      pl.loose([body], circ(yS - 4, rAt(yS), phi), circ(yB + 4, rAt(yB), phi), 0.5, 0.82, 0.3, 0.08, 2);
    }
    // curved cross-hatching on the shadow side follows the horizontal circles
    const phiDark = Math.asin(0.15);
    const sp2 = pl.spacing(0.7) * 1.3;
    for (let y = yS + sp2; y < yB - 1; y += sp2 * r.range(0.85, 1.15)) {
      const pts = [];
      for (let phi = phiDark + r.range(-0.15, 0.15); phi < HALF - 0.05; phi += 0.08) pts.push(circ(y, rAt(y), phi));
      if (pts.length > 1) pl.path(pts, false, 0.45, 0.78, 0.25);
    }
    if (tower) {
      // curved coursing and staggered joints
      const ch = clamp(R * r.range(0.32, 0.5), 7, 30);
      let row = 0;
      for (let y = yB - ch; y > yS + 2; y -= ch * r.range(0.8, 1.2), row++) {
        pl.path(arc(y, rAt(y), 16).map(p => p), false, 0.65, 0.85, 0.3, 0.2);
        for (let phi = -HALF + ((row % 2) * 0.35 + r.next() * 0.3); phi < HALF - 0.1; phi += r.range(0.5, 0.8)) {
          pl.ink(circ(y, rAt(y), phi), circ(y + ch * 0.9, rAt(y), phi), 0.55, 0.8, 0.15, 0);
        }
        if (r.chance(wr * 0.08)) {
          const phi = r.range(-1, 0.8), c0 = circ(y + 2, rAt(y), phi), c1 = circ(y + ch - 1, rAt(y), phi + 0.3);
          Wear.cavity(pl, c0.x, c0.y, c1.x, c1.y, r);
        }
      }
      if (r.chance(0.6)) {
        // an arrow-slit window
        const phi = r.range(-0.4, 0.3), yy = r.range(yS + (yB - yS) * 0.2, yS + (yB - yS) * 0.6), c = circ(yy, rAt(yy), phi);
        const sw = R * 0.08 * Math.cos(phi) + 1.2, sh = R * 0.55;
        const sl = [P(c.x - sw, c.y), P(c.x + sw, c.y), P(c.x + sw, c.y + sh), P(c.x - sw, c.y + sh)];
        pl.fill([sl]);
        pl.shade([sl], 0.95, [{ a: HALF }, { a: 0.5 }, { a: -0.5 }]);
        pl.outline(sl, true, 0.8);
      }
    } else {
      // fluting
      const nf = 12;
      for (let i = 0; i < nf; i++) {
        const phi = -HALF + ((i + 0.5) * PI) / nf;
        if (Math.cos(phi) < 0.2) continue;
        pl.loose([body], circ(yS + 3, rAt(yS), phi), circ(yB - 3, rAt(yB), phi), 0.45, 0.6, 0.2, 0.15, 1.5);
      }
      const n = Math.round(((yB - yS) * R) / 900 * (0.5 + wr));
      for (let i = 0; i < n; i++) {
        const p = circ(r.range(yS, yB), R * 0.9, r.range(-1.3, 1.3)), a = r.next() * PI, L = r.range(1, 3);
        pl.ink(p, P(p.x + Math.cos(a) * L, p.y + Math.sin(a) * L), 0.5, 0.7, 0, 0);
      }
      if (r.chance(wr * 0.5)) { pl.clip([body]); Wear.crack(pl, circ(r.range(yS, yB - 40), R * 0.6, r.range(-0.8, 0.5)), 50, r); pl.unclip(); }
    }
    pl.outline(left, false, 1.4);
    pl.outline(right, false, 1.4);
    pl.outline(arc(yB, rAt(yB)), false, 1.1);
    pl.outline(topEdge, false, 1.1);
    // base: torus and square plinth
    const tor = arc(yB + baseH * 0.3, R * 1.12).concat(arc(yB, R * 1.12).reverse());
    const plq = rect(x - R * 1.3, yB + baseH * 0.35, R * 2.6, baseH * 0.65);
    prism(pl, sc, { rings: [plq], z: z * 0.99, depth: R * 2.4 * sc.depthMul, floorY: sc.floorAt(z), wear: wr * 0.7, chipScale: 4, r, front: { tone: 0.14, dirs: [{ a: 0 }] } });
    pl.fill([tor]);
    pl.shade([tor], 0.35, [{ a: 0 }]);
    pl.outline(tor, true, 0.9);
    if (!ruin) {
      if (tower) {
        const band = arc(yA - capH * 0.6, R * 1.12).concat(arc(yA, R * 1.12).reverse());
        pl.fill([band]);
        pl.shade([band], 0.25, [{ a: 0 }]);
        pl.outline(band, true, 1);
        for (let phi = -HALF + 0.15; phi < HALF; phi += 0.28) {
          const a = circ(yA, R * 1.05, phi), b = circ(yA, R * 1.05, phi + 0.12);
          const cq = [a, b, P(b.x, b.y + capH * 0.5), P(a.x, a.y + capH * 0.5)];
          pl.fill([cq]);
          pl.shade([cq], 0.55, [{ a: HALF }]);
          pl.path(cq, true, 0.6, 0.9, 0.05);
        }
        const cap = arc(yTop, R * 1.18).concat(arc(yA - capH * 0.6, R * 1.18).reverse());
        pl.fill([cap]);
        pl.shade([cap], 0.18, [{ a: 0 }]);
        pl.outline(cap, true, 1);
      } else {
        // echinus flaring out to a square abacus
        const ech = [P(x - rAt(yA), yA), ...Array.from({ length: 7 }, (_, i) => { const t = i / 6; return P(x - rAt(yA) - R * 0.38 * Math.sin(t * HALF), yA - capH * 0.45 * t); }),
          ...Array.from({ length: 7 }, (_, i) => { const t = 1 - i / 6; return P(x + rAt(yA) + R * 0.38 * Math.sin(t * HALF), yA - capH * 0.45 * t); }), P(x + rAt(yA), yA)];
        pl.fill([ech]);
        pl.shade([ech], 0.4, [{ a: 0 }, { a: HALF }]);
        pl.outline(ech, true, 1);
        const ab = rect(x - R * 1.45, yTop, R * 2.9, capH * 0.55);
        prism(pl, sc, { rings: [ab], z: z * 0.99, depth: R * 2.6 * sc.depthMul, wear: wr * 0.7, chipScale: 4, r, front: { tone: 0.12, dirs: [{ a: 0 }] } });
      }
    } else {
      Wear.overgrow(pl, x - R, x + R, xx => { let b = topEdge[0]; for (const q of topEdge) if (Math.abs(q.x - xx) < Math.abs(b.x - xx)) b = q; return b.y; }, R * 0.6, 0.7 + wr, r);
      // a fallen drum lies beside the broken shaft
      const fx = x + r.sign() * R * r.range(1.6, 2.4), fr = R * r.range(0.6, 0.9);
      const drum = [P(fx - fr * 1.4, yBot), P(fx - fr * 1.4, yBot - fr * 1.6), P(fx + fr * 1.4, yBot - fr * 1.6), P(fx + fr * 1.4, yBot)];
      pl.fill([drum]);
      pl.shade([drum], 0.3, [{ a: 0 }]);
      pl.outline(drum, true, 1);
      const face = ellipse(fx + fr * 1.4, yBot - fr * 0.8, fr * 0.35, fr * 0.8, 0, 2 * PI, 16);
      pl.fill([face]);
      pl.shade([face], 0.55, [{ a: 1.2 }]);
      pl.outline(face, true, 0.9);
      Wear.rubble(pl, fx - fr * 2.2, yBot, R, clamp(R * 0.3, 3, 12), r);
    }
    if (r.chance(wr * 0.3)) Wear.vine(pl, x + r.range(-0.6, 0.6) * R, yS + 3, r.range(20, 70), r);
    if (z <= 1.3) sc.casts.push({ poly: rect(x - R, yS, 2 * R, yB - yS).map(p => P(p.x + R * 1.6, p.y + R * 0.6)), k: 0.55 });
  }

  /* ---------------------------------------------------------------- bridges */
  function baluster(pl, x, yb, h, w) {
    const prof = [[0, 0.42], [0.08, 0.42], [0.14, 0.28], [0.32, 0.5], [0.52, 0.42], [0.72, 0.2], [0.82, 0.17], [0.9, 0.34], [1, 0.34]];
    const left = prof.map(([f, k]) => P(x - k * w, yb - f * h));
    const right = prof.slice().reverse().map(([f, k]) => P(x + k * w, yb - f * h));
    const poly = left.concat(right);
    pl.fill([poly]);
    if (w > 2.5) { pl.clip([poly]); pl.hatch([rect(x, yb - h, w, h)], HALF, Math.max(1.2, w * 0.4), { w: 0.4, a: 0.8, brk: 0 }); pl.unclip(); }
    pl.path(poly, true, 0.55, 0.9, 0.05);
  }
  /*
   * Railings that follow the deck (flat or curved): balusters, wrought iron, a solid parapet,
   * timber posts with a rope, or a broken balustrade with missing sections.
   */
  function railing(pl, sc, s, x0, x1, hgt, z, D, r) {
    const st = s.railStyle || 'baluster';
    if (st === 'none') return;
    const yAt = x => beamTop(s, x);
    const band = (xa, xb, off, th) => {
      const n = s.arc ? clamp(Math.round((xb - xa) / 10), 2, 60) : 1, a = [], b = [];
      for (let i = 0; i <= n; i++) { const x = xa + ((xb - xa) * i) / n; a.push(P(x, yAt(x) - off - th)); b.push(P(x, yAt(x) - off)); }
      return a.concat(b.reverse());
    };
    const wr = wearOf(sc, r);
    if (st === 'parapet') {
      prism(pl, sc, {
        rings: [band(x0, x1, 0, hgt * 0.8)], z: z * 0.996, depth: D * 0.06, wear: wr, chipScale: clamp(hgt * 0.3, 3, 8), r, lineW: 1,
        front: { tone: 0.24, dirs: [{ a: 0 }], texture: (p, e, rg) => masonry(p, rg, { type: 'ashlar', course: hgt * 0.4, block: hgt * 1.2, rust: false, r, wear: wr, crack: 0.2 }) },
      });
      if (r.chance(wr * 0.8)) Wear.overgrow(pl, x0, x1, x => yAt(x) - hgt * 0.8, hgt * 0.5, wr, r);
      return;
    }
    if (st === 'timber') {
      const sp = Math.max(18, hgt * 1.6), posts = [];
      for (let x = x0 + sp * 0.3; x < x1; x += sp * r.range(0.8, 1.2)) posts.push(x);
      for (const x of posts) {
        const q = [P(x - 1.6, yAt(x)), P(x + 1.6, yAt(x)), P(x + 1.4, yAt(x) - hgt * r.range(0.9, 1.1)), P(x - 1.4, yAt(x) - hgt)];
        pl.fill([q]);
        pl.path(q, true, 0.7, 0.9, 0.1);
      }
      for (let i = 0; i < posts.length - 1; i++) {
        const a = P(posts[i], yAt(posts[i]) - hgt * 0.85), b = P(posts[i + 1], yAt(posts[i + 1]) - hgt * 0.85);
        rope(pl, sc, { pts: sag(a, b, hgt * 0.25, 10), w: 0.9 }, r);
      }
      return;
    }
    // gaps where the balustrade has fallen away
    const gaps = [];
    if (st === 'broken' || r.chance(wr * 0.25)) {
      for (let i = 0; i < r.int(1, 2); i++) { const c = r.range(x0, x1), w = r.range(0.08, 0.2) * (x1 - x0); gaps.push([c - w / 2, c + w / 2]); }
    }
    const inGap = x => gaps.some(([a, b]) => x > a && x < b);
    const pieces = [];
    let cur = x0;
    for (const [a, b] of gaps.slice().sort((p, q) => p[0] - q[0])) { if (a > cur + 4) pieces.push([cur, a]); cur = Math.max(cur, b); }
    if (x1 > cur + 4) pieces.push([cur, x1]);
    const railH = Math.max(2.5, hgt * 0.16), plinthH = Math.max(2, hgt * 0.12);
    prism(pl, sc, { rings: [band(x0, x1, 0, plinthH)], z: z * 0.997, depth: D * 0.06, front: { tone: 0.25, dirs: [{ a: 0 }] }, lineW: 0.8, rough: 0.6, wear: wr * 0.5, chipScale: 3, r });
    const sp = st === 'iron' ? Math.max(3.5, hgt * 0.28) : Math.max(4.5, hgt * 0.42);
    for (let x = x0 + sp * 0.6; x < x1 - sp * 0.3; x += sp) {
      if (inGap(x)) { if (r.chance(0.3)) Wear.rubble(pl, x, yAt(x) - plinthH, 2, Math.max(2, hgt * 0.15), r); continue; }
      const yb = yAt(x) - plinthH, hh = hgt - railH - plinthH;
      if (st === 'iron') {
        pl.ink(P(x, yb), P(x, yb - hh), 0.65, 0.95, 0.15, 0, 1);
        if (r.chance(0.5)) scroll(pl, x + sp * 0.25, yb - hh * 0.75, Math.min(sp * 0.3, 3), 1);
      } else baluster(pl, x, yb, hh, hgt * 0.26);
    }
    for (const [a, b] of pieces) {
      let q = band(a, b, hgt - railH, railH);
      if (gaps.length) q = Wear.chip(q, false, 1, 3, r);
      prism(pl, sc, { rings: [q], z: z * 0.995, depth: D * 0.1, front: { tone: 0.18, dirs: [{ a: 0 }] }, lineW: 0.85, rough: 0.6, r });
    }
  }

  function beam(pl, sc, s, r) {
    const { x0, x1, h, z } = s;
    const st = s.style || 'flat';
    const wr = wearOf(sc, r, st === 'timber' ? 0.6 : 1);
    const D = (s.depth || clamp((x1 - x0) * 0.45, 80, 380)) * sc.depthMul;
    const N = s.arc || st === 'arched' ? clamp(Math.round((x1 - x0) / 10), 8, 60) : 1;
    const top = [], bot = [];
    for (let i = 0; i <= N; i++) { const x = x0 + ((x1 - x0) * i) / N; top.push(P(x, beamTop(s, x))); bot.push(P(x, beamBottom(s, x))); }
    const body = top.concat(bot.slice().reverse());
    const yT = x => beamTop(s, x), yBt = x => beamBottom(s, x);
    const tone = { flat: 0.3, arched: 0.2, timber: 0.36 }[st] + r.range(-0.05, 0.05);
    prism(pl, sc, {
      rings: [body], z, depth: D, wear: wr * (st === 'arched' ? 0.8 : 0.6), chipScale: clamp(h * 0.35, 3, 10), r,
      spall: st === 'timber' ? null : { n: Math.round(wr * (x1 - x0) / 500 * r.next()), size: clamp(h * (st === 'arched' ? 1.2 : 0.6), 5, 26) },
      front: { tone, dirs: [{ a: 0 }, { a: HALF }, { a: -PI / 4 }], texture: (p, e, rg) => {
        const follow = off => top.map(q => P(q.x, q.y + off));
        if (st === 'flat') {
          p.path(follow(h * 0.28), false, 0.65, 0.85, 0.3, 0.2);
          p.path(follow(h * 0.72), false, 0.65, 0.85, 0.3, 0.2);
          const band = follow(h * 0.72).concat(follow(h).reverse());
          p.shade([band], 0.62, [{ a: 0 }, { a: HALF }]);
          const dsp = Math.max(3.5, h * 0.32);
          for (let xx = x0 + dsp * 0.5; xx < x1; xx += dsp) if (r.next() > wr * 0.2) p.loose(rg, P(xx, yT(xx) + h * 0.08), P(xx, yT(xx) + h * 0.28), 0.5, 0.75, 0.1, 0);
        } else if (st === 'arched') {
          masonry(p, rg, { type: 'ashlar', course: clamp(h * 0.9, 7, 26), block: clamp(h * 2, 14, 60), rust: true, r, wear: wr, crack: 0.6 });
          // voussoirs along the curved soffit
          const vt = h * 0.9, nV = clamp(Math.round((x1 - x0) / Math.max(8, vt * 0.7)), 5, 60);
          const inner = [], outer = [];
          for (let i = 0; i <= nV; i++) { const x = x0 + ((x1 - x0) * i) / nV; inner.push(P(x, yBt(x))); outer.push(P(x, yBt(x) - vt)); }
          const ring = outer.concat(inner.slice().reverse());
          p.fill([ring]);
          p.shade([ring], 0.12, [{ a: HALF }]);
          for (let i = 1; i < nV; i++) p.ink(inner[i], P(inner[i].x + (inner[i].x - (x0 + x1) / 2) * 0.04, outer[i].y), 0.65, 0.85, 0.15, 0);
          p.path(outer, false, 0.8, 0.9, 0.25, 0.15);
          const km = Math.round(nV / 2), kw = (x1 - x0) / nV * 0.7;
          const key = [P(inner[km].x - kw, inner[km].y), P(inner[km].x + kw, inner[km].y), P(inner[km].x + kw * 1.3, outer[km].y - vt * 0.3), P(inner[km].x - kw * 1.3, outer[km].y - vt * 0.3)];
          p.fill([key]);
          p.shade([key], 0.35, [{ a: HALF }]);
          p.outline(key, true, 1);
        } else {
          // timber: planks with grain, iron straps and bolts
          for (const f of [0.33, 0.66]) p.path(follow(h * f), false, 0.55, 0.8, 0.4, 0.3);
          for (let i = 0; i < Math.round((x1 - x0) / 25); i++) {
            const xx = r.range(x0, x1 - 20), yy = yT(xx) + h * r.range(0.1, 0.9), L = r.range(8, 22);
            const pts = Array.from({ length: 6 }, (_, j) => P(xx + (L * j) / 5, yy + Math.sin(j * 1.3 + i) * 0.8));
            p.path(pts, false, 0.4, 0.65, 0.2);
          }
          for (let xx = x0 + r.range(20, 50); xx < x1 - 10; xx += r.range(50, 90)) {
            const q = rect(xx, yT(xx) - 0.5, 4, h + 1);
            p.fill([q]);
            p.shade([q], 0.7, [{ a: HALF }]);
            p.path(q, true, 0.6, 0.9, 0.05);
            for (const f of [0.25, 0.75]) p.path(ellipse(xx + 2, yT(xx) + h * f, 0.9, 0.9, 0, 2 * PI, 6), true, 0.6, 0.9, 0);
          }
        }
      } },
    });
    for (const c of s.corbels || []) corbel(pl, c.x, yBt(c.x), -c.end, clamp(h * 1.2, 5, 34), st, r);
    if (s.consoleFrom) {
      const from = s.consoleFrom < 0 ? x0 : x1, dir = -s.consoleFrom, span = x1 - x0, sz = clamp(h * 1.1, 5, 30);
      for (let d = sz * 2.4; d < span * 0.8; d += sz * 2.6) corbel(pl, from + dir * d, yBt(from + dir * d), dir, sz * 0.8, st === 'timber' ? 'timber' : 'console', r, true);
    }
    railing(pl, sc, s, x0, x1, clamp(h * 1.5, 9, 40), z, D, r);
    // ironwork stays near the ends of the span, so it never hangs across the middle of the view
    const vis0 = Math.max(x0, sc.plate.x + 10), vis1 = Math.min(x1, sc.plate.x + sc.plate.w - 10);
    for (let i = 0; i < (s.chains || 0) && vis1 - vis0 > 60; i++) {
      const end = r.chance(0.5) ? vis0 : vis1, dir = end === vis0 ? 1 : -1;
      const xa = end + dir * r.range(0.04, 0.14) * (vis1 - vis0);
      if (r.chance(0.5)) {
        const xb = xa + dir * r.range(0.08, 0.16) * (vis1 - vis0);
        chainAlong(pl, sag(P(xa, yBt(xa)), P(xb, yBt(xb)), r.range(0.4, 0.9) * Math.abs(xb - xa)), clamp(h * 0.45, 3, 9));
      } else {
        hang(pl, sc, { x: xa, y0: yBt(xa), y1: yBt(xa) + r.range(2.5, 6) * h, z, link: clamp(h * 0.4, 3, 8), end: r.pick(['lantern', 'hook', 'weight', 'ring']), sway: 0 }, r);
      }
    }
    if (r.chance(wr * 0.45)) Wear.vine(pl, r.range(vis0, Math.max(vis0 + 1, vis1)), yBt((vis0 + vis1) / 2), r.range(15, 60), r);
    if (s.railStyle !== 'parapet' && r.chance(wr * 0.5)) Wear.overgrow(pl, x0, x1, yT, h * 0.7, wr * 0.6, r);
    if (z <= 1.3) sc.casts.push({ poly: body.map(p => P(p.x + h * 1.4, p.y + h * 2.2)), k: 0.5 });
  }

  /* ---------------------------------------------------------------- arches */
  function voussoirs(pl, s, r, wr) {
    const { rx, ry, t } = s;
    const ringStyle = s.ring || 'voussoir';
    let n = Math.round((PI * (rx + ry)) / 2 / Math.max(8, t * (ringStyle === 'gibbs' ? 0.8 : 0.55)));
    if (s.shape === 'segmental') n = Math.round(n * 0.6);
    if (n % 2 === 0) n++;
    n = clamp(n, 5, 45);
    const mid = (n - 1) / 2;
    const stone = (u0, u1, out) => {
      const q = [];
      for (let k = 0; k <= 3; k++) q.push(archPoint(s, u0 + ((u1 - u0) * k) / 3, 0));
      for (let k = 3; k >= 0; k--) q.push(archPoint(s, u0 + ((u1 - u0) * k) / 3, out));
      return q;
    };
    if (ringStyle === 'archivolt') {
      const N = 40, band = archCurve(s, N, 0).concat(archCurve(s, N, t).reverse());
      pl.fill([band]);
      pl.shade([band], 0.15, [{ a: 0 }]);
      for (const f of [0.22, 0.48, 0.74]) pl.path(archCurve(s, N, t * f), false, f === 0.48 ? 0.8 : 0.55, 0.85, 0.3, 0.2);
      pl.shade(archCurve(s, N, t * 0.48).concat(archCurve(s, N, t * 0.74).reverse()), 0.55, [{ a: HALF }]);
      pl.outline(band, true, 1);
    } else {
      for (let i = 0; i < n; i++) {
        if (i === mid) continue;
        const u0 = i / n, u1 = (i + 1) / n;
        const out = ringStyle === 'gibbs' && i % 2 === 1 ? t * 1.55 : t;
        let q = stone(u0, u1, out);
        if (ringStyle === 'rough' || wr > 0.4) q = Wear.chip(q, false, Math.min(1, wr), Math.max(3, t * 0.25), r);
        pl.fill([q]);
        const um = (u0 + u1) / 2, a = archPoint(s, um, 0), b = archPoint(s, um, 1), ra = Math.atan2(b.y - a.y, b.x - a.x);
        pl.shade([q], 0.06 + r.next() * 0.3, [{ a: ra + HALF }, { a: ra }]);
        if (ringStyle === 'rough') {
          const bb = bbox(q);
          pl.clip([q]);
          Wear.vermiculate(pl, bb.x0, bb.y0, bb.x1, bb.y1, r);
          pl.unclip();
        }
        pl.outline(q, true, 0.85);
      }
    }
    // keystone
    let u0 = mid / n, u1 = (mid + 1) / n;
    const kt = s.key === 'plain' ? t : t * 1.35;
    if (s.key !== 'plain') { const wv = (u1 - u0) * 0.2; u0 -= wv; u1 += wv; }
    const key = stone(u0, u1, kt);
    pl.fill([key]);
    pl.shade([key], 0.32, [{ a: HALF }, { a: 0 }]);
    pl.outline(key, true, 1.1);
    if (s.key === 'scroll') {
      const a = archPoint(s, u0, 0), b = archPoint(s, u1, 0), sz = Math.max(2, t * 0.18);
      scroll(pl, a.x + sz, a.y - sz * 1.2, sz, -1);
      scroll(pl, b.x - sz, b.y - sz * 1.2, sz, 1);
    }
  }

  function arch(pl, sc, s, r) {
    const { cx, by, rx, ry, t, z } = s;
    const gy = Math.max(s.gy, by + 1);
    const L = s.L ?? cx - rx - s.pw, R = s.R ?? cx + rx + s.pw, top = s.top;
    const wr = wearOf(sc, r);
    const N = clamp(Math.round((rx + ry) / 5), 16, 64);
    const inner = archCurve(s, N, 0);
    const opening = [P(cx - rx, gy), ...inner, P(cx + rx, gy)];
    const crown = archPoint(s, 0.5, t).y;
    // a ruined top: the wall above the ring has partly fallen
    let topPts = null;
    const ruinDrop = crown - t * 0.6 - top - 6;
    if (!s.walkway && s.freeTop && ruinDrop > 10 && r.chance(0.4 + wr * 0.5)) {
      topPts = Wear.ruinTop(L, R, top, ruinDrop, clamp(t * r.range(0.8, 1.6), 10, 70), r);
    }
    const outer = topPts ? [P(L, gy), P(R, gy), ...topPts] : rect(L, top, R - L, gy - top);
    const band = archCurve(s, N, t);
    const D = (s.depth || clamp(rx * 1.5, 60, 520)) * sc.depthMul;
    const ringZone = archCurve(s, N, t * 1.8).concat(archCurve(s, N, -3).reverse());
    const bz = { x0: L, x1: R, y0: top, y1: by, w: R - L, h: by - top };
    prism(pl, sc, {
      rings: [outer, opening], z, depth: D, floorY: gy, wear: wr * 0.8, chipScale: clamp(t * 0.4, 4, 16), r,
      breach: { n: r.chance(0.25 + wr * 0.75) ? r.int(1, 2) : 0, size: clamp(t * 1.6, 14, 80), avoid: [ringZone], zone: bz },
      spall: { n: Math.round(wr * 1.2 * r.next() + wr * 0.4), size: clamp(t * 0.9, 9, 44), avoid: [ringZone] },
      front: { tone: 0.16 + r.range(-0.04, 0.08), dirs: [{ a: 0 }, { a: HALF }, { a: PI / 4 }], texture: (p, e, rg) => {
        // masonry around, but not through, the arch ring
        p.clip([rg[0], band]);
        masonry(p, rg, { type: r.chance(0.2) ? 'banded' : 'ashlar', course: clamp(t * 0.7, 8, 40), block: clamp(t * 1.4, 14, 80), rust: true, r, crack: 0.7, wear: wr });
        p.unclip();
        if (s.quoins) {
          const qh = clamp(t * 0.75, 8, 40);
          let k = 0;
          for (let y = by; y < gy - 2; y += qh, k++) {
            const qw = k % 2 ? t * 0.9 : t * 1.5, hh = Math.min(qh, gy - y);
            for (const d of [-1, 1]) {
              const xe = cx + d * rx, q = d < 0 ? rect(xe - qw, y, qw, hh) : rect(xe, y, qw, hh);
              p.fill([q]);
              p.shade([q], 0.1 + r.next() * 0.2, [{ a: 0 }]);
              p.outline(q, true, 0.8);
            }
          }
        }
        voussoirs(p, s, r, wr);
        const ih = clamp(t * 0.3, 4, 18);
        for (const [xa, xb] of [[L, cx - rx], [cx + rx, R]]) {
          if (xb - xa < 2) continue;
          const q = rect(xa, by, xb - xa, ih);
          p.fill([q]);
          p.shade([q], 0.42, [{ a: 0 }]);
          p.ink(P(xa, by + ih * 0.4), P(xb, by + ih * 0.4), 0.6, 0.8, 0.2, 0.1);
          p.outline(q, true, 0.8);
          if (r.chance(wr * 0.5)) Wear.tuft(p, r.range(xa, xb), by, ih * 1.5, r);
        }
      } },
    });
    if (topPts) {
      const yAt = xx => { let b = topPts[0]; for (const q of topPts) if (Math.abs(q.x - xx) < Math.abs(b.x - xx)) b = q; return b.y; };
      Wear.overgrow(pl, L, R, yAt, clamp(t * 0.7, 8, 30), 0.8 + wr, r);
      if (r.chance(0.6)) Wear.rubble(pl, r.chance(0.5) ? L + r.range(5, 30) : R - r.range(5, 30), gy, clamp(t, 10, 50), clamp(t * 0.3, 3, 14), r);
    }
    if (s.walkway) {
      const bh = clamp(t * 0.5, 8, 26);
      beam(pl, sc, style({ kind: 'beam', x0: L - t * 0.3, x1: R + t * 0.3, y: top - bh, h: bh, z: z * 0.99, depth: clamp((s.depth || 200) * 0.3, 30, 110), rail: true, chains: 0, landing: true }, r), r);
    }
    if (s.lantern) hang(pl, sc, { x: cx, y0: archIntradosY(s, cx), y1: archIntradosY(s, cx) + ry * r.range(0.12, 0.24), z, link: clamp(t * 0.22, 3, 8), end: 'lantern' }, r);
    if (r.chance(wr * 0.4)) Wear.vine(pl, cx + r.range(-0.6, 0.6) * rx, archIntradosY(s, cx) + 4, r.range(20, 70), r);
  }

  /* ---------------------------------------------------------------- stairs */
  function stair(pl, sc, s, r) {
    const z = s.z, S = s.S, E = s.E;
    const prof = stairProfile(s);
    const { Q, n, dir, rh, treads } = prof;
    const wr = wearOf(sc, r);
    const gy = sc.floorAt(z);
    const pts = prof.top.slice();
    if (s.solid) pts.push(P(E.x, gy), P(S.x, gy));
    else {
      const th = Math.max(rh * 1.6, 6);
      for (let k = n; k >= 1; k--) pts.push(P(Q[k].x, Q[k].y + th));
      pts.push(P(lerp(Q[0], Q[1], 0.6).x, S.y));
    }
    const rings = [pts];
    // a vault opening under a solid flight
    if (s.style === 'vaulted' && S.y - E.y > 70) {
      const xs = lerp(S, E, 0.5).x, xe = lerp(S, E, 0.88).x;
      const topY = stairTop(s, xs);
      const Ha = gy - topY - rh * 1.8;
      if (Ha > 25) {
        const hw = Math.min(Math.abs(xe - xs), Ha * 1.1) / 2, hx = (xs + xe) / 2, spring = gy - Ha * 0.55;
        const hole = [P(hx - hw, gy), P(hx - hw, spring), ...ellipse(hx, spring, hw, Math.min(hw, Ha * 0.45), PI, 0, 16).slice(1, -1), P(hx + hw, spring), P(hx + hw, gy)];
        rings.push(hole);
      }
    }
    const D = (s.depth || clamp(Math.hypot(S.x - E.x, S.y - E.y) * 0.32, 50, 240)) * sc.depthMul;
    const slope = Math.atan2(E.y - S.y, E.x - S.x);
    prism(pl, sc, {
      rings, z, depth: D, floorY: gy, wear: wr * 0.8, chipScale: clamp(rh * 0.5, 3, 9), r,
      spall: s.solid ? { n: Math.round(wr * r.next()), size: clamp(rh * 1.6, 7, 26) } : null,
      front: { tone: 0.32 + r.range(-0.05, 0.05), dirs: [{ a: slope }, { a: HALF }, { a: slope + HALF }], texture: (p, e, rg) => {
        if (s.solid) masonry(p, rg, { type: r.chance(0.3) ? 'rubble' : 'ashlar', course: clamp(rh * 2, 8, 30), block: clamp(rh * 3.2, 14, 60), rust: false, r, wear: wr, crack: 0.5 });
        else p.path(Q.map(q => P(q.x, q.y + Math.max(rh * 1.6, 6) * 0.45)), false, 0.5, 0.75, 0.3, 0.2);
      } },
    });
    // railing following the nosings
    const rs = s.railStyle || 'iron';
    const hr = clamp(rh * 2.6, 9, 34);
    const posts = treads.map(t => P((t.xa + t.xb) / 2, t.y));
    if (rs !== 'none' && posts.length >= 2) {
      const tops = posts.map(p => P(p.x, p.y - hr));
      if (rs === 'parapet') {
        const q = tops.concat(posts.slice().reverse().map(p => P(p.x, p.y - hr * 0.1)));
        pl.fill([q]);
        pl.shade([q], 0.3, [{ a: slope }, { a: HALF }]);
        pl.outline(q, true, 1);
      } else {
        for (let i = 0; i < posts.length; i++) {
          if (rs === 'baluster') { if (i % 2 === 0) baluster(pl, posts[i].x, posts[i].y, hr * 0.85, hr * 0.2); }
          else if (r.next() > wr * 0.15) pl.ink(posts[i], tops[i], 0.6, 0.9, 0.12, 0, 1);
        }
        pl.path(tops, false, 1.3, 0.95, 0.3, 0.1);
        pl.path(tops.map(p => P(p.x, p.y + hr * 0.14)), false, 0.6, 0.85, 0.3, 0.2);
        const nw = posts[0];
        const q = rect(nw.x - 2.4, nw.y - hr * 1.15, 4.8, hr * 1.15);
        pl.fill([q]);
        pl.shade([q], 0.5, [{ a: HALF }]);
        pl.outline(q, true, 0.8);
        if (rs === 'iron') scroll(pl, nw.x - dir * 4, nw.y - hr * 0.6, Math.min(5, hr * 0.2), -dir);
      }
    }
    for (const t of treads) if (r.chance(wr * 0.12)) Wear.tuft(pl, r.range(Math.min(t.xa, t.xb), Math.max(t.xa, t.xb)), t.y, rh * 1.2, r);
    if (s.solid && r.chance(wr * 0.5)) Wear.rubble(pl, S.x - dir * rh * 2, gy, rh * 2, clamp(rh * 0.5, 2.5, 10), r);
    if (z <= 1.3) sc.casts.push({ poly: pts.map(p => P(p.x + 18, p.y + 14)), k: 0.45 });
  }

  /*
   * A spiral stair wound around a central newel, seen from the side: steps on the far side
   * are drawn first, then the newel, then the steps that come round toward us.
   */
  function spiral(pl, sc, s, r) {
    const { x, z } = s, yT = s.y0, yB = s.y1, R = s.R, rc = R * 0.22, phase = s.phase || 0;
    const vp = sc.vp;
    const rh = clamp(R * 0.28, 4, 14), n = Math.max(4, Math.round((yB - yT) / rh)), dTh = (2 * PI) / 14;
    const k = y => clamp((y - vp.y) / 900, -0.3, 0.3);
    const pt = (y, rr, th) => P(x + rr * Math.sin(th), y + k(y) * rr * Math.cos(th));
    const steps = [];
    for (let i = 0; i < n; i++) steps.push({ i, th: i * dTh + phase, y: yB - (i + 1) * (yB - yT) / n });
    const drawStep = st => {
      const a = st.th, b = st.th + dTh * 1.05;
      const tread = [pt(st.y, rc, a), pt(st.y, R, a), pt(st.y, R, (a + b) / 2), pt(st.y, R, b), pt(st.y, rc, b)];
      const riser = [pt(st.y, R, a), pt(st.y, R, (a + b) / 2), pt(st.y, R, b), pt(st.y + rh * 0.9, R, b), pt(st.y + rh * 0.9, R, (a + b) / 2), pt(st.y + rh * 0.9, R, a)];
      const front = Math.cos((a + b) / 2) > 0;
      pl.fill([riser]);
      pl.shade([riser], clamp(0.45 + 0.35 * Math.sin((a + b) / 2), 0.1, 0.9), [{ a: 0 }, { a: HALF }]);
      pl.outline(riser, true, front ? 0.9 : 0.6);
      pl.fill([tread]);
      if (k(st.y) < 0) pl.shade([tread], 0.75, [{ a: 0 }]);
      pl.path(tread, true, front ? 0.8 : 0.5, 0.9, 0.15);
    };
    const back = steps.filter(st => Math.cos(st.th + dTh / 2) <= 0), fwd = steps.filter(st => Math.cos(st.th + dTh / 2) > 0);
    back.forEach(drawStep);
    const newel = rect(x - rc, yT - rh * 2, rc * 2, yB - yT + rh * 2);
    pl.fill([newel]);
    pl.shade([newel], 0.45, [{ a: HALF }]);
    pl.outline(newel, true, 1);
    fwd.forEach(drawStep);
    // handrail: a helix along the outer edge, only where it comes toward us
    let run = [];
    for (let i = 0; i <= n * 4; i++) {
      const th = phase + (i / 4) * dTh, y = yB - ((i / 4) / n) * (yB - yT) - rh * 2.4;
      if (Math.cos(th) > -0.1) run.push(pt(y, R * 1.02, th));
      else { if (run.length > 1) pl.path(run, false, 1, 0.95, 0.2); run = []; }
    }
    if (run.length > 1) pl.path(run, false, 1, 0.95, 0.2);
    if (z <= 1.3) sc.casts.push({ poly: rect(x - R, yT, 2 * R, yB - yT).map(p => P(p.x + R, p.y + R * 0.4)), k: 0.45 });
  }

  /* ---------------------------------------------------------------- windows and walls */
  function windowEl(pl, sc, s, r) {
    let loop = s.pts;
    const z = s.z, bb0 = bbox(loop);
    if (s.shape === 'archtop') {
      const rr = bb0.w / 2, spring = bb0.y0 + Math.min(rr, bb0.h * 0.5);
      loop = [P(bb0.x0, bb0.y1), P(bb0.x0, spring), ...ellipse(bb0.cx, spring, rr, Math.min(rr, bb0.h * 0.5), PI, 0, 16).slice(1, -1), P(bb0.x1, spring), P(bb0.x1, bb0.y1)];
    }
    const bb = bbox(loop), m = Math.min(bb.w, bb.h);
    const fw = clamp(m * 0.2, 6, 26);
    const wr = wearOf(sc, r);
    let outer;
    if (s.shape === 'rect') outer = rect(bb.x0 - fw, bb.y0 - fw, bb.w + 2 * fw, bb.h + 2 * fw);
    else if (s.shape === 'round') outer = ellipse(bb.cx, bb.cy, bb.w / 2 + fw, bb.h / 2 + fw, 0, 2 * PI, 48).slice(0, -1);
    else {
      const c = G.centroid(loop);
      outer = loop.map(p => { const d = dist(p, c) || 1; return P(c.x + (p.x - c.x) * (1 + fw / d), c.y + (p.y - c.y) * (1 + fw / d)); });
    }
    const D = clamp(m * 0.7, 25, 140) * sc.depthMul;
    const ext = makeExt(sc, z, D);
    const back = loop.map(p => ext(p));
    const bbb = bbox(back);
    pl.clip([loop]);
    pl.fill([loop]);
    if (!s.bright) pl.shade([back], 0.95, [{ a: 0.9 }, { a: -0.7 }, { a: 0 }, { a: HALF }]);
    pl.clip([back]);
    const bw = s.bright ? 2.2 : 1.4, gr = s.grille || 'bars';
    if (gr === 'lattice') {
      const sp = clamp(bbb.w / 4, 6, 16);
      for (let d = -bbb.h; d < bbb.w + bbb.h; d += sp) {
        pl.ink(P(bbb.x0 + d, bbb.y0), P(bbb.x0 + d - bbb.h, bbb.y1), bw * 0.8, 0.95, 0.15, 0);
        pl.ink(P(bbb.x0 + d - bbb.h, bbb.y0), P(bbb.x0 + d, bbb.y1), bw * 0.8, 0.95, 0.15, 0);
      }
    } else if (gr === 'radial') {
      const c = P(bbb.cx, bbb.cy);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * 2 * PI; pl.ink(c, P(c.x + Math.cos(a) * bbb.w, c.y + Math.sin(a) * bbb.h), bw, 0.95, 0.1, 0); }
      pl.path(ellipse(c.x, c.y, bbb.w * 0.22, bbb.h * 0.22, 0, 2 * PI, 16), true, bw, 0.95, 0.1);
    } else {
      const bsp = clamp(bbb.w / 5, 6, 16);
      for (let x = bbb.x0 + bsp * 0.5; x < bbb.x1; x += bsp) {
        if (gr === 'broken' && r.chance(0.3)) {
          // a bar wrenched aside
          const bend = r.range(4, 9) * r.sign();
          pl.path([P(x, bbb.y0 - 2), P(x, bbb.y0 + bbb.h * 0.4), P(x + bend, bbb.y0 + bbb.h * 0.7), P(x + bend * 1.3, bbb.y0 + bbb.h * 0.8)], false, bw, 0.95, 0.1);
          continue;
        }
        pl.ink(P(x, bbb.y0 - 2), P(x, bbb.y1 + 2), bw, 0.95, 0.15, 0, 1);
      }
      for (const f of [0.33, 0.66]) pl.ink(P(bbb.x0 - 2, bbb.y0 + bbb.h * f), P(bbb.x1 + 2, bbb.y0 + bbb.h * f), 1.6, 0.95, 0.15, 0, 1);
    }
    pl.unclip();
    pl.unclip();
    prism(pl, sc, {
      rings: [outer, loop], z, depth: D, holesOnly: true, wear: wr * 0.7, chipScale: clamp(fw * 0.4, 3, 10), r,
      front: { tone: 0.24, dirs: [{ a: HALF }, { a: 0 }], texture: p => {
        if (s.shape === 'round' || s.shape === 'archtop') {
          const cnt = clamp(Math.round((PI * (bb.w + bb.h)) / 2 / 14), 8, 28);
          const cy = s.shape === 'round' ? bb.cy : bb.y0 + Math.min(bb.w / 2, bb.h * 0.5);
          const ry = s.shape === 'round' ? bb.h / 2 : Math.min(bb.w / 2, bb.h * 0.5);
          for (let i = 0; i < cnt; i++) {
            const a = s.shape === 'round' ? (i / cnt) * 2 * PI : (i / (cnt - 1)) * PI;
            p.ink(P(bb.cx + (bb.w / 2) * Math.cos(a), cy - ry * Math.sin(a)), P(bb.cx + (bb.w / 2 + fw) * Math.cos(a), cy - (ry + fw) * Math.sin(a)), 0.7, 0.85, 0.1, 0);
          }
        } else if (s.shape === 'rect') {
          for (const f of [0.3, 0.5, 0.7]) p.ink(P(bb.x0 + bb.w * f, bb.y0), P(bb.x0 + bb.w * (f + (f - 0.5) * 0.5), bb.y0 - fw), 0.7, 0.85, 0.1, 0);
        }
        if (s.shape !== 'round') {
          const sill = rect(bb.x0 - fw * 1.4, bb.y1 + fw * 0.7, bb.w + fw * 2.8, fw * 0.45);
          p.fill([sill]);
          p.shade([sill], 0.5, [{ a: 0 }]);
          p.outline(sill, true, 0.9);
          if (r.chance(wr * 0.6)) Wear.tuft(p, r.range(sill[0].x, sill[1].x), sill[0].y, fw, r);
        }
      } },
    });
    if (s.bright && z <= 1.3) {
      const c = P(bb.cx, bb.cy), dx = 0.55, dy = 0.835, Lr = 900, hw = Math.max(bb.w, bb.h) * 0.6;
      sc.shafts.push({ poly: [P(c.x - hw, c.y), P(c.x + hw, c.y), P(c.x + hw * 2.2 + dx * Lr, c.y + dy * Lr), P(c.x - hw * 2.2 + dx * Lr, c.y + dy * Lr)] });
    }
  }

  /* A masonry wall panel: gives a window something to be cut into. */
  function wall(pl, sc, s, r) {
    const W = s.x1 - s.x0, wr = wearOf(sc, r);
    const body = rect(s.x0, s.y0, W, s.y1 - s.y0);
    prism(pl, sc, {
      rings: [body], z: s.z, depth: (s.depth || 60) * sc.depthMul, floorY: sc.floorAt(s.z), wear: wr, chipScale: clamp(W * 0.05, 4, 12), r,
      breach: { n: r.chance(wr * 0.6) ? 1 : 0, size: clamp(W * 0.18, 12, 50), avoid: s.avoid || [], zone: { x0: s.x0, x1: s.x1, y0: s.y0, y1: s.y0 + (s.y1 - s.y0) * 0.75, w: W, h: (s.y1 - s.y0) * 0.75 } },
      spall: { n: Math.round(wr * 1.2 * r.next() + wr * 0.4), size: clamp(W * 0.14, 9, 38), avoid: s.avoid || [] },
      front: { tone: 0.24 + r.range(-0.05, 0.05), dirs: [{ a: 0 }, { a: HALF }, { a: PI / 4 }], texture: (p, e, rg) => masonry(p, rg, { type: s.style === 'plain' ? 'ashlar' : s.style || 'ashlar', course: clamp(W * 0.12, 9, 30), block: clamp(W * 0.32, 16, 70), rust: true, r, stain: 0.28, wear: wr }) },
    });
    if (r.chance(wr * 0.5)) Wear.rubble(pl, s.x0 + r.range(0, W), s.y1, W * 0.25, clamp(W * 0.05, 3, 10), r);
    if (s.z <= 1.3) sc.casts.push({ poly: body.map(p => P(p.x + 24, p.y + 12)), k: 0.45 });
  }

  /* ---------------------------------------------------------------- figures and tackle */
  function figure(pl, sc, s, r) {
    const h = s.h, x = s.x, y = s.y;
    const f = s.facing || r.sign();
    const pose = s.pose || r.pick(['stand', 'point', 'staff', 'hunch', 'stride', 'point', 'sit']);
    const lean = (pose === 'hunch' || pose === 'chained' ? 0.16 : pose === 'climb' ? 0.12 : r.range(-0.03, 0.05)) * h * f;
    const hh = pose === 'sit' || pose === 'chained' ? h * 0.72 : h;
    const hr = h * 0.075;
    const head = P(x + lean, y - hh + hr);
    const shY = y - hh + hr * 2.3, sh = h * 0.12;
    const seated = pose === 'sit' || pose === 'chained';
    const hemY = y - h * (pose === 'stride' || pose === 'climb' ? 0.24 : seated ? 0.05 : 0.17);
    const hw = h * (pose === 'stride' || pose === 'climb' ? 0.2 : seated ? 0.24 : 0.15);
    const sway = r.range(-0.04, 0.06) * h * f;
    const body = [
      P(head.x - sh * 0.45, shY - hr * 0.5), P(head.x + sh * 0.45, shY - hr * 0.5), P(head.x + sh, shY + hr * 0.7),
      P(x + hw + sway, hemY), P(x + sway * 0.3, hemY + h * 0.03), P(x - hw + sway, hemY), P(head.x - sh, shY + hr * 0.7),
    ];
    if (pose === 'climb') {
      // the back foot on this tread, the front one lifted to the next
      pl.ink(P(x - f * hw * 0.35, hemY), P(x - f * h * 0.1, y), 0.8, 0.95, 0.1, 0);
      pl.ink(P(x + f * hw * 0.35, hemY), P(x + f * h * 0.16, y - h * 0.09), 0.8, 0.95, 0.1, 0);
    } else if (!seated) {
      const st = pose === 'stride' ? h * 0.14 : h * 0.05;
      pl.ink(P(x - hw * 0.35, hemY), P(x - st - hw * 0.2, y), 0.8, 0.95, 0.1, 0);
      pl.ink(P(x + hw * 0.35, hemY), P(x + st + hw * 0.2, y), 0.8, 0.95, 0.1, 0);
    }
    pl.fill([body]);
    pl.clip([body]);
    pl.hatch([rect(x + sway * 0.2, shY - hr, h * 0.5, h)], 1.2, Math.max(1.1, h * 0.055), { w: 0.45, a: 0.85, brk: 0 });
    pl.unclip();
    pl.outline(body, true, 0.75);
    const hd = ellipse(head.x, head.y, hr, hr * 1.1, 0, 2 * PI, 10);
    pl.fill([hd]);
    pl.path(hd, true, 0.7, 0.95, 0.05);
    const shoulder = P(head.x + f * sh * 0.85, shY + hr * 0.5);
    if (pose === 'point') pl.ink(shoulder, P(x + f * h * 0.45, y - h * r.range(0.85, 1.1)), 0.8, 0.95, 0.1, 0);
    else if (pose === 'staff') {
      const sx = x + f * h * 0.28;
      pl.ink(P(sx, y), P(sx + f * h * 0.05, y - h * 1.08), 0.8, 0.95, 0.1, 0);
      pl.ink(shoulder, P(sx + f * h * 0.03, y - h * 0.62), 0.7, 0.95, 0.1, 0);
    } else if (pose === 'hunch') pl.ink(shoulder, P(x + f * h * 0.3, y - h * 0.45), 0.7, 0.95, 0.1, 0);
    else if (pose === 'chained') {
      // arms drawn to the knees, a chain from the wrist to a ring in the pier
      const wrist = P(x + f * h * 0.18, y - h * 0.28);
      pl.ink(shoulder, wrist, 0.7, 0.95, 0.1, 0);
      if (s.chainTo != null) {
        const ring = P(s.chainTo, y - h * 0.62);
        chainAlong(pl, sag(wrist, ring, h * 0.12, 10), clamp(h * 0.07, 1.6, 4));
        pl.path(ellipse(ring.x, ring.y, h * 0.06, h * 0.07, 0, 2 * PI, 8), true, 0.6, 0.95, 0.05);
      }
    }
    else pl.ink(shoulder, P(x + f * h * 0.2, y - hh * 0.48), 0.7, 0.95, 0.1, 0);
    for (let i = 0; i < 3; i++) pl.ink(P(x - hw * 0.2, y + i * 0.9), P(x + h * (0.5 - i * 0.12), y + i * 0.9), 0.5, 0.75, 0.1, 0);
  }

  function chain(pl, sc, s, r) { chainAlong(pl, sag(s.A, s.B, s.sag), s.link || 6); }

  function hang(pl, sc, s, r) {
    const { x, y0, z } = s;
    const y1 = Math.min(s.y1, sc.floorAt(z) - 12);
    if (y1 <= y0 + 8) return;
    const sw = s.sway ?? r.range(-0.08, 0.08) * (y1 - y0);
    const pts = [];
    for (let i = 0; i <= 20; i++) { const t = i / 20; pts.push(P(x + sw * t * t, y0 + (y1 - y0) * t)); }
    const link = clamp(s.link || 6 / z, 2.5, 9);
    chainAlong(pl, pts, link);
    const e = pts[pts.length - 1], sz = link * 3.2;
    if (s.end === 'lantern') lantern(pl, e.x, e.y, sz);
    else if (s.end === 'hook') hook(pl, e.x, e.y, sz);
    else if (s.end === 'weight') weight(pl, e.x, e.y, sz);
    else ringEnd(pl, e.x, e.y, sz);
  }

  function rope(pl, sc, s, r) {
    const R = G.resample(G.smoothPts(s.pts, 3), 3);
    if (R.length < 3) return;
    const w = s.w || 2.2;
    const Lp = [], Rp = [];
    for (let i = 0; i < R.length; i++) {
      const a = R[Math.max(0, i - 1)], b = R[Math.min(R.length - 1, i + 1)];
      const l = dist(a, b) || 1, nx = -(b.y - a.y) / l, ny = (b.x - a.x) / l;
      Lp.push(P(R[i].x + nx * w, R[i].y + ny * w));
      Rp.push(P(R[i].x - nx * w, R[i].y - ny * w));
    }
    pl.fill([Lp.concat(Rp.slice().reverse())]);
    for (let i = 0; i < R.length - 1; i++) pl.raw([Lp[i], Rp[i + 1]], 0.5, 0.85);
    pl.path(Lp, false, 0.8, 0.9, 0.1);
    pl.path(Rp, false, 0.9, 0.95, 0.1);
    if (s.weight) { const e = R[R.length - 1]; weight(pl, e.x, e.y, Math.max(6, w * 5)); }
  }

  function pulley(pl, sc, s, r) {
    const { x, y, rad } = s;
    pl.ink(P(x, s.y0), P(x, y), 1.4, 0.95, 0.1, 0);
    const strap = rect(x - rad * 0.3, y - rad * 1.5, rad * 0.6, rad * 1.5);
    pl.fill([strap]);
    pl.shade([strap], 0.6, [{ a: HALF }]);
    pl.path(strap, true, 0.8, 0.9, 0.05);
    rope(pl, sc, { pts: [P(x - rad, y), P(x - rad, s.yl)], w: Math.max(0.8, rad * 0.1) }, r);
    rope(pl, sc, { pts: [P(x + rad, y), P(x + rad, s.yr)], w: Math.max(0.8, rad * 0.1) }, r);
    const wheel = ellipse(x, y, rad, rad, 0, 2 * PI, 28);
    pl.fill([wheel]);
    pl.shade([wheel], 0.3, [{ a: 0.8 }]);
    pl.path(wheel, true, 1.1, 0.95, 0.05);
    pl.path(ellipse(x, y, rad * 0.8, rad * 0.8, 0, 2 * PI, 24), true, 0.6, 0.9, 0.05);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2 + 0.3; pl.ink(P(x, y), P(x + Math.cos(a) * rad * 0.8, y + Math.sin(a) * rad * 0.8), 0.9, 0.95, 0.05, 0); }
    weight(pl, x + rad, s.yr, rad * 1.1);
  }

  return {
    prism, masonry, sag, chainAlong, makeExt, style, beamTop, beamBottom, archPoint, archIntradosY, stairProfile, stairTop,
    pier, beam, arch, stair, spiral, wall, window: windowEl, figure, chain, hang, rope, pulley,
  };
})();
