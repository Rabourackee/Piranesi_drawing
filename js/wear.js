'use strict';
/*
 * Time and neglect. Piranesi's prisons are old: arrises are chipped, blocks have fallen out,
 * tops are broken, water has streaked the walls and weeds have taken root in the joints.
 *
 *   geometry  roughen() makes straight outlines slightly uneven; chip() bites notches out of
 *             edges and breaks corners before extrusion, so the damage has real depth;
 *             ruinTop() turns a clean top edge into broken, stepped masonry.
 *   surface   vermiculate(), cavity(), streaks(), cracks() add texture inside faces.
 *   life      tuft(), shrub() and vine() grow on ledges; rubble() piles stones on the floor.
 */
const Wear = (() => {
  const { P, dist, lerp, clamp } = G;
  const HALF = Math.PI / 2;

  /*
   * Subdivides a ring and nudges each new point off the line with smooth noise. Every point
   * remembers its parent edge's angle (pa) so shading still follows the original surface.
   */
  function roughen(ring, amp, seg, r, floorY) {
    const out = [], n = ring.length, s = r.next() * 100;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n], L = dist(a, b);
      if (L < 0.01) continue;
      const pa = a.pa ?? Math.atan2(b.y - a.y, b.x - a.x);
      const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
      const m = Math.max(1, Math.round(L / seg));
      const flat = floorY != null && a.y >= floorY - 1.5 && b.y >= floorY - 1.5;
      for (let k = 0; k < m; k++) {
        const t = k / m, p = lerp(a, b, t);
        const off = k === 0 || flat ? 0 : (Rng.noise1(s + (acc + t * L) * 0.035) - 0.5) * 2 * amp;
        const q = P(p.x + nx * off, p.y + ny * off);
        q.pa = pa;
        if (a.chip) q.chip = true;
        out.push(q);
      }
      acc += L;
    }
    return out;
  }

  /* Points just inside the solid next to an edge: which side is "stone". */
  function solidSide(ring, hole, a, b) {
    const L = dist(a, b) || 1;
    const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
    const m = lerp(a, b, 0.5);
    const inRing = G.pointInPoly(P(m.x + nx * 0.8, m.y + ny * 0.8), ring);
    const s = inRing !== hole ? 1 : -1;
    return { nx: nx * s, ny: ny * s };
  }

  /*
   * Bites damage into a ring: broken corners and notches along edges, cut into the solid.
   * amt is 0..1; scale is the size of a typical chip in px.
   */
  function chip(ring, hole, amt, scale, r, floorY) {
    if (amt <= 0.01 || ring.length < 3) return ring;
    const n = ring.length, out = [];
    const isFloor = p => floorY != null && p.y >= floorY - 1.5;
    const solidAt = p => G.pointInPoly(p, ring) !== hole;
    for (let i = 0; i < n; i++) {
      const prev = ring[(i - 1 + n) % n], a = ring[i], b = ring[(i + 1) % n];
      const L = dist(a, b), Lp = dist(prev, a);
      // a broken corner
      const turn = Math.abs(G.angDiff(Math.atan2(b.y - a.y, b.x - a.x), Math.atan2(a.y - prev.y, a.x - prev.x)));
      if (!isFloor(a) && turn > 0.5 && L > 6 && Lp > 6 && r.chance(amt * 0.5)) {
        const c1 = Math.min(Lp * 0.3, r.range(0.6, 1.8) * scale), c2 = Math.min(L * 0.3, r.range(0.6, 1.8) * scale);
        const pA = lerp(a, prev, c1 / Lp), pB = lerp(a, b, c2 / L), mid = lerp(pA, pB, 0.5);
        if (solidAt(mid)) {
          const jag = lerp(mid, a, r.range(-0.6, 0.3));
          pA.chip = jag.chip = true;
          out.push(pA, P(jag.x + r.range(-1, 1), jag.y + r.range(-1, 1)), pB);
        } else out.push(a);
      } else out.push(a);
      // notches along the edge
      if (L < 14 || (isFloor(a) && isFloor(b))) continue;
      const cnt = Math.floor((L / 110) * amt * 1.6 + r.next());
      if (!cnt) continue;
      const { nx, ny } = solidSide(ring, hole, a, b);
      const ts = [];
      for (let k = 0; k < cnt; k++) ts.push(r.range(0.12, 0.88));
      ts.sort((p, q) => p - q);
      let last = 0;
      for (const t of ts) {
        const wd = Math.min(r.range(0.5, 1.6) * scale, L * 0.18) / L;
        if (t - wd < last + 0.02 || t + wd > 0.95) continue;
        // an irregular bite: a ragged little profile, deepest somewhere off-centre
        const d = r.range(0.15, 0.55) * scale * (0.4 + amt * 0.8);
        const p0 = lerp(a, b, t - wd), p1 = lerp(a, b, t + wd);
        p0.chip = true;
        out.push(p0);
        const k = r.int(2, 4);
        for (let j = 1; j <= k; j++) {
          const f = j / (k + 1), q = lerp(a, b, t - wd + 2 * wd * (f + r.range(-0.12, 0.12) / k));
          const dd = d * Math.sin(Math.PI * f) * r.range(0.5, 1.2);
          const c = P(q.x + nx * dd, q.y + ny * dd);
          c.chip = true;
          out.push(c);
        }
        out.push(p1);
        last = t + wd;
      }
    }
    return out;
  }

  /*
   * A broken, stepped top edge from x1 back to x0 (right to left, ready to follow the
   * right side of a polygon). Blocks have fallen away in irregular courses.
   */
  function ruinTop(x0, x1, y, drop, block, r) {
    const pts = [];
    let x = x1, yy = y + r.range(0, drop * 0.5);
    pts.push(P(x1, yy));
    while (x > x0 + block * 0.4) {
      const nx = Math.max(x0, x - block * r.range(0.5, 1.4));
      const ny = clamp(yy + (r.chance(0.5) ? -1 : 1) * r.range(0.2, 1) * block * 0.6, y, y + drop);
      if (r.chance(0.35)) {
        // a sloping, crumbled break instead of a clean step
        pts.push(P(lerp(P(x, yy), P(nx, ny), 0.5).x + r.range(-2, 2), (yy + ny) / 2 + r.range(-2, 2)));
      } else pts.push(P(x, ny));
      pts.push(P(nx, ny));
      x = nx; yy = ny;
    }
    pts.push(P(x0, yy));
    return pts;
  }

  /* Piranesi's worm-eaten rustication: meandering grooves cut inside a block. */
  function vermiculate(pl, x0, y0, x1, y1, r) {
    const w = x1 - x0, h = y1 - y0;
    if (w < 8 || h < 6) return;
    const n = Math.round((w * h) / 260) + 1;
    for (let i = 0; i < n; i++) {
      let p = P(x0 + r.next() * w, y0 + r.next() * h), a = r.next() * Math.PI * 2;
      const pts = [p];
      for (let k = 0; k < r.int(4, 10); k++) {
        a += r.range(-1.4, 1.4);
        p = P(clamp(p.x + Math.cos(a) * 2.2, x0 + 1, x1 - 1), clamp(p.y + Math.sin(a) * 2.2, y0 + 1, y1 - 1));
        pts.push(p);
      }
      pl.path(pts, false, 0.6, 0.85, 0.1);
    }
  }

  /* A block that has fallen out: a dark hollow with a lit lower lip. */
  function cavity(pl, x0, y0, x1, y1, r) {
    // a ragged hole: the outline wanders around the block's edges
    const w = x1 - x0, h = y1 - y0, q = [];
    const per = [[0, 0], [0.35, 0], [0.7, 0], [1, 0], [1, 0.5], [1, 1], [0.6, 1], [0.25, 1], [0, 1], [0, 0.45]];
    for (const [fx, fy] of per) q.push(P(x0 + fx * w + r.range(-0.12, 0.12) * w * (fy === 0 || fy === 1 ? 1 : 0.4), y0 + fy * h + r.range(-0.18, 0.18) * h));
    pl.fill([q]);
    pl.shade([q], 0.9, [{ a: 0.2 }, { a: 1.3 }, { a: -0.7 }]);
    const lip = [P(x0 + 1, y1 - 2.2), P(x1 - 1, y1 - 2.2), P(x1 - 1, y1), P(x0 + 1, y1)];
    pl.fill([lip]);
    pl.path(q, true, 0.8, 0.95, 0.2);
  }

  /* Water stains running down a face from a ledge. */
  function streaks(pl, x, y, len, r) {
    const n = r.int(3, 7);
    for (let i = 0; i < n; i++) {
      const xx = x + r.range(-4, 4), l = len * r.range(0.3, 1);
      pl.ink(P(xx, y), P(xx + r.range(-1.5, 1.5), y + l), 0.4, 0.55, 0.6, 0.3);
    }
  }

  /* A branching crack. */
  function crack(pl, p, len, r, ang = HALF) {
    let a = ang + r.range(-0.7, 0.7), q = p;
    const pts = [q];
    const steps = Math.max(3, Math.round(len / 7));
    for (let i = 0; i < steps; i++) {
      a += r.range(-0.6, 0.6);
      q = P(q.x + Math.cos(a) * r.range(4, 9), q.y + Math.sin(a) * r.range(4, 9));
      pts.push(q);
      if (i > 1 && r.chance(0.18)) crack(pl, q, len * 0.35, r, a + r.sign() * 0.9);
    }
    pl.path(pts, false, 0.75, 0.9, 0.25);
    // the lit lip of the crack
    pl.path(pts.map(t => P(t.x + 0.9, t.y + 0.6)), false, 0.35, 0.4, 0.25);
  }

  /* Grass and weeds sprouting from a ledge at (x, y). */
  function tuft(pl, x, y, size, r) {
    const n = r.int(4, 9);
    for (let i = 0; i < n; i++) {
      const a = -HALF + r.range(-1.1, 1.1), len = size * r.range(0.35, 1), bend = r.range(-0.6, 0.6);
      const m = P(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5);
      const e = P(x + Math.cos(a + bend) * len, y + Math.sin(a + bend) * len);
      pl.path([P(x + r.range(-1, 1), y), m, e], false, 0.55, 0.9, 0.1);
    }
  }
  /* A leafy bush rooted in a crack: a clump of small leaves, darker underneath. */
  function shrub(pl, x, y, size, r) {
    const n = Math.round(clamp(size / 2.2, 6, 26));
    const leaves = [];
    for (let i = 0; i < n; i++) {
      const a = Math.PI + r.next() * Math.PI, d = Math.sqrt(r.next()) * size;
      leaves.push(P(x + Math.cos(a) * d * 1.2, y + Math.sin(a) * d * 0.9));
    }
    leaves.sort((p, q) => p.y - q.y);
    for (let i = 0; i < 3; i++) pl.path([P(x, y), P(x + r.range(-0.5, 0.5) * size, y - r.range(0.3, 0.8) * size)], false, 0.6, 0.9, 0.2);
    for (const c of leaves) {
      const L = size * r.range(0.14, 0.24), a = r.next() * Math.PI;
      const lf = G.ellipse(0, 0, L, L * 0.45, 0, Math.PI * 2, 8).map(p => P(c.x + p.x * Math.cos(a) - p.y * Math.sin(a), c.y + p.x * Math.sin(a) + p.y * Math.cos(a)));
      pl.fill([lf]);
      if (c.y > y - size * 0.4) { pl.clip([lf]); pl.hatch([lf], 0.9, 1.4, { w: 0.4, a: 0.85, brk: 0 }); pl.unclip(); }
      pl.path(lf, true, 0.5, 0.9, 0.05);
    }
  }
  /* A creeper hanging from an edge. */
  function vine(pl, x, y, len, r) {
    const pts = [P(x, y)];
    let p = P(x, y), s = r.next() * 10;
    for (let i = 0; i < len / 4; i++) {
      p = P(x + Math.sin(s + i * 0.35) * len * 0.06 + r.range(-0.6, 0.6), p.y + 4);
      pts.push(p);
    }
    pl.path(pts, false, 0.55, 0.9, 0.15);
    for (let i = 2; i < pts.length; i += r.int(2, 3)) {
      const c = pts[i], side = i % 2 ? 1 : -1, L = r.range(2, 3.6);
      const lf = G.ellipse(c.x + side * L, c.y + L * 0.3, L, L * 0.5, 0, Math.PI * 2, 6);
      pl.fill([lf]);
      pl.path(lf, true, 0.45, 0.9, 0.05);
    }
  }
  /* A heap of fallen stones resting on y. */
  function rubble(pl, x, y, spread, size, r) {
    const n = r.int(3, 8), stones = [];
    for (let i = 0; i < n; i++) {
      const s = size * r.range(0.35, 1);
      stones.push({ x: x + r.range(-spread, spread), y: y - r.range(0, size * 0.5), s });
    }
    stones.sort((p, q) => p.y - q.y);
    for (const st of stones) {
      const k = r.int(5, 7), q = [];
      for (let i = 0; i < k; i++) {
        const a = Math.PI + (i / (k - 1)) * Math.PI;
        const rr = st.s * r.range(0.7, 1.1);
        q.push(P(st.x + Math.cos(a) * rr, Math.min(y, st.y + Math.sin(a) * rr * 0.75)));
      }
      q.push(P(st.x + st.s * 0.8, y), P(st.x - st.s * 0.8, y));
      pl.fill([q]);
      pl.clip([q]);
      pl.hatch([[P(st.x, st.y - st.s), P(st.x + st.s * 1.2, st.y - st.s), P(st.x + st.s * 1.2, y), P(st.x, y)]], 1.1, 1.6, { w: 0.4, a: 0.85, brk: 0 });
      pl.unclip();
      pl.path(q, true, 0.75, 0.95, 0.15);
    }
  }
  /* Vegetation along a top edge from x0 to x1 at height y(x). */
  function overgrow(pl, x0, x1, yAt, scale, amt, r) {
    const n = Math.floor(((x1 - x0) / 90) * amt * 1.5 + r.next() * amt);
    for (let i = 0; i < n; i++) {
      const x = r.range(x0 + 4, x1 - 4), y = yAt(x);
      if (r.chance(0.4)) shrub(pl, x, y, scale * r.range(0.8, 1.6), r);
      else tuft(pl, x, y, scale * r.range(0.5, 1.1), r);
    }
  }

  /* A ragged, broken-edged blob: the outline of a fracture. */
  function blob(cx, cy, rx, ry, r) {
    const n = r.int(9, 15), s = r.next() * 50, out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r.range(-0.2, 0.2);
      let k = 0.65 + 0.55 * Rng.noise1(s + i * 0.9);
      if (r.chance(0.18)) k *= 0.55; // a sharp re-entrant notch
      out.push(P(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k));
    }
    return out;
  }

  /*
   * A spall: the carved surface has broken away. Whatever was drawn there is erased, and
   * in its place a recessed, fractured face: rough facets, a shadowed upper lip (the light
   * comes from the upper left), and a hard broken outline.
   */
  function spall(pl, poly, r, dirs) {
    pl.fill([poly]);
    const bb = G.bbox(poly);
    // the broken face is hatched like the stone around it, only deeper and rougher
    const d = dirs && dirs.length ? dirs : [{ a: 0 }, { a: Math.PI / 2 }];
    pl.shade([poly], r.range(0.42, 0.62), [{ a: (d[0].a ?? 0) + r.range(-0.15, 0.15) }, { a: (d[1] || d[0]).a ?? 1.2 }, { a: r.range(-0.8, 0.8) }]);
    pl.clip([poly]);
    const nf = clamp(Math.round((bb.w * bb.h) / 220), 3, 16);
    for (let i = 0; i < nf; i++) {
      let p = P(bb.x0 + r.next() * bb.w, bb.y0 + r.next() * bb.h), a = r.next() * Math.PI * 2;
      const pts = [p];
      for (let k = 0; k < r.int(2, 4); k++) {
        a += r.range(-1, 1);
        p = P(p.x + Math.cos(a) * r.range(3, 9), p.y + Math.sin(a) * r.range(3, 9));
        pts.push(p);
      }
      pl.path(pts, false, 0.6, 0.85, 0.25);
    }
    pl.unclip();
    // shadow inside the upper-left rim: those faces of the hole are turned away from the light
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n], L = dist(a, b);
      if (L < 2) continue;
      let nx = (b.y - a.y) / L, ny = -(b.x - a.x) / L;
      const m = lerp(a, b, 0.5);
      if (G.pointInPoly(P(m.x + nx, m.y + ny), poly)) { nx = -nx; ny = -ny; }
      if (nx * -0.55 + ny * -0.835 < 0.15) continue; // only the rim facing the light
      for (let k = 1; k <= 3; k++) {
        const o = k * 1.1;
        pl.ink(P(a.x - nx * o, a.y - ny * o), P(b.x - nx * o, b.y - ny * o), 0.5, 0.9 - k * 0.15, 0.2, 0);
      }
    }
    // a broken, uneven rim: heavier where it catches shadow, lost in places
    pl.path(poly.concat([poly[0]]), false, 0.75, 0.85, 0.5, 0.6);
  }

  /* Picks n ragged patches inside the solid of rings, clear of the avoid polygons. */
  function patches(rings, n, size, r, avoid = [], zone = null) {
    const bb = zone || G.bboxRings([rings[0]]), out = [];
    const ok = p => G.pointInRings(p, rings) && !avoid.some(q => G.pointInPoly(p, q)) && !out.some(q => G.pointInPoly(p, q));
    for (let i = 0, tries = 0; out.length < n && tries < n * 14; tries++) {
      const rx = size * r.range(0.7, 1.5), ry = rx * r.range(0.5, 1.0);
      const cx = bb.x0 + rx + r.next() * Math.max(1, bb.w - 2 * rx), cy = bb.y0 + ry + r.next() * Math.max(1, bb.h - 2 * ry);
      const b = blob(cx, cy, rx, ry, r);
      // keep a margin of sound stone around the break
      const halo = b.map(p => P(cx + (p.x - cx) * 1.3, cy + (p.y - cy) * 1.3));
      if (b.every(ok) && halo.every(ok)) out.push(b);
    }
    return out;
  }

  return { blob, spall, patches, roughen, chip, ruinTop, vermiculate, cavity, streaks, crack, tuft, shrub, vine, rubble, overgrow };
})();
