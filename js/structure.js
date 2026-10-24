'use strict';
/*
 * Structural sense. Runs over every spec (the user's and the imagined ones) before anything
 * is drawn, and makes sure the prison could stand:
 *
 *   piers   stand on the floor or on a beam, and rise to the vaults or to the beam they carry
 *   arches  spring from whatever surface lies beneath their legs
 *   stairs  start on a surface (extending the flight down if needed) and arrive on a landing
 *   bridges are anchored at both ends: frame edge, hall wall, a solid they butt into, or a
 *           new pier raised under the free end
 *   windows are cut into a solid; if none is there, a masonry wall is built around them
 *   chains, lanterns, ropes and pulleys hang from something real
 *   figures stand on a floor, bridge, landing, walkway or stair tread
 *
 * "Same plane" means depths within 5%: things only lean on things at their own depth.
 */
const Structure = (() => {
  const { P, clamp } = G;
  const near = (a, b) => Math.abs(a - b) / Math.min(a, b) < 0.05;

  const archLR = s => [s.L ?? s.cx - s.rx - s.pw, s.R ?? s.cx + s.rx + s.pw];
  const intradosY = (s, x) => Build.archIntradosY(s, x);
  const inOpening = (s, p) => Math.abs(p.x - s.cx) < s.rx && p.y > intradosY(s, p.x);

  /* Rough screen box of a spec, used to keep generated work clear of the user's own strokes. */
  function boxOf(s) {
    switch (s.kind) {
      case 'pier': return { x0: s.x - s.w / 2, x1: s.x + s.w / 2, y0: s.y0, y1: s.y1 };
      case 'beam': return { x0: s.x0, x1: s.x1, y0: s.y - (s.arc || 0) - s.h * 1.6, y1: s.y + s.h * 3 };
      case 'arch': { const [L, R] = archLR(s); return { x0: L, x1: R, y0: s.top, y1: s.gy }; }
      case 'stair': return { x0: Math.min(s.S.x, s.E.x), x1: Math.max(s.S.x, s.E.x), y0: s.E.y - 30, y1: s.S.y };
      case 'window': return G.bbox(s.pts);
      case 'wall': return { x0: s.x0, x1: s.x1, y0: s.y0, y1: s.y1 };
      case 'chain': return { x0: s.A.x, x1: s.B.x, y0: Math.min(s.A.y, s.B.y), y1: Math.max(s.A.y, s.B.y) + s.sag };
      case 'hang': return { x0: s.x - 10, x1: s.x + 10, y0: s.y0, y1: s.y1 };
      case 'rope': return G.bbox(s.pts);
    }
    return null;
  }

  function resolve(specs, sc, r = new Rng.Rand(1), amt = 0.7) {
    const pt = sc.plate, vp = sc.vp, H = sc.hall;
    const out = specs.slice();
    const ceilY = z => Math.max(vp.y + H.Yc / z, pt.y - 20);
    const wallL = z => vp.x + H.Xl / z, wallR = z => vp.x + H.Xr / z;
    const add = s => { s.auto = true; out.push(s); return s; };
    const all = k => out.filter(s => s.kind === k);

    /* ----- solid bodies (things you can bolt into or butt against) ----- */
    function bodyOf(s) {
      switch (s.kind) {
        case 'pier': { const hw = s.w * 0.62; return { s, x0: s.x - hw, x1: s.x + hw, y0: s.y0, y1: s.y1 }; }
        case 'wall': return { s, x0: s.x0, x1: s.x1, y0: s.y0, y1: s.y1 };
        case 'beam': return { s, x0: s.x0, x1: s.x1, y0: s.y - (s.arc || 0), y1: s.y + s.h * (s.style === 'arched' ? s.archK || 3 : 1), hole: p => p.y < Build.beamTop(s, p.x) || p.y > Build.beamBottom(s, p.x) };
        case 'spiral': return { s, x0: s.x - s.R, x1: s.x + s.R, y0: s.y0, y1: s.y1 };
        case 'arch': { const [L, R] = archLR(s); return { s, x0: L, x1: R, y0: s.top, y1: Math.max(s.gy, s.by), hole: p => inOpening(s, p) }; }
        case 'stair':
          if (!s.solid) return null;
          return { s, x0: Math.min(s.S.x, s.E.x), x1: Math.max(s.S.x, s.E.x), y0: s.E.y, y1: s.S.y, hole: p => p.y < Build.stairTop(s, p.x) };
      }
      return null;
    }
    const bodies = (z, except) => out.filter(s => s !== except && near(s.z, z)).map(bodyOf).filter(Boolean);
    const contains = (b, p) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1 && !(b.hole && b.hole(p));
    const solidAt = (z, p, except) => bodies(z, except).some(b => contains(b, p));
    function nearestOn(b, p) {
      const q = P(clamp(p.x, b.x0, b.x1), clamp(p.y, b.y0, b.y1));
      if (!b.hole || !b.hole(q)) return q;
      const s = b.s, c = [];
      if (s.kind === 'arch') {
        c.push(P(q.x, intradosY(s, q.x)), P(s.cx - s.rx, Math.max(q.y, s.by)), P(s.cx + s.rx, Math.max(q.y, s.by)));
      } else if (s.kind === 'stair') c.push(P(q.x, Build.stairTop(s, q.x)));
      let best = c[0];
      for (const k of c) if (G.dist(k, p) < G.dist(best, p)) best = k;
      return best;
    }

    /* ----- surfaces (things you can stand on or rest upon) ----- */
    function surfacesOf(s, forPeople) {
      switch (s.kind) {
        case 'beam': return [{ s, x0: s.x0, x1: s.x1, y: x => Build.beamTop(s, x) }];
        case 'spiral': return [{ s, x0: s.x - s.R, x1: s.x + s.R, y: () => s.y0 }];
        case 'pier': return forPeople ? [] : [{ s, x0: s.x - s.w * 0.66, x1: s.x + s.w * 0.66, y: () => s.y0 }];
        case 'wall': return forPeople ? [] : [{ s, x0: s.x0, x1: s.x1, y: () => s.y0 }];
        case 'arch': {
          const [L, R] = archLR(s);
          const top = s.walkway ? s.top - clamp(s.t * 0.5, 8, 26) : s.top;
          return [{ s, x0: L, x1: R, y: () => top }];
        }
        case 'stair': return [{ s, x0: Math.min(s.S.x, s.E.x), x1: Math.max(s.S.x, s.E.x), y: x => Build.stairTop(s, x) }];
      }
      return [];
    }
    const surfaces = (z, except, forPeople) => out.filter(s => s !== except && near(s.z, z)).flatMap(s => surfacesOf(s, forPeople));
    /* The first surface at or below y at screen x (the floor if nothing else). */
    function surfaceBelow(z, x, y, except) {
      let best = sc.floorAt(z), hit = null;
      for (const f of surfaces(z, except)) {
        if (x < f.x0 || x > f.x1) continue;
        const sy = f.y(x);
        if (sy >= y && sy < best) { best = sy; hit = f.s; }
      }
      return { y: best, s: hit };
    }
    /* The nearest thing above (x, y) to hang from: a beam soffit, an arch intrados, or the vault. */
    function anchorAbove(z, x, y, except) {
      let best = ceilY(z);
      for (const s of out) {
        if (s === except || !near(s.z, z)) continue;
        let ay = null;
        if (s.kind === 'beam' && x >= s.x0 && x <= s.x1) ay = Build.beamBottom(s, x);
        else if (s.kind === 'arch' && Math.abs(x - s.cx) < s.rx) ay = intradosY(s, x);
        else if (s.kind === 'wall' && x >= s.x0 && x <= s.x1) ay = s.y1;
        if (ay != null && ay <= y + 12 && ay > best) best = ay;
      }
      return best;
    }
    /* A point is held if it is inside a solid, out of frame, in the vaults, or can be pulled
       onto a nearby solid. Returns the held point, or null if it is floating. */
    function hold(z, p, except) {
      if (p.x <= pt.x || p.x >= pt.x + pt.w || p.y <= ceilY(z) + 2) return p;
      const bs = bodies(z, except);
      if (bs.some(b => contains(b, p))) return p;
      let best = null;
      for (const b of bs) {
        const q = nearestOn(b, p), d = G.dist(p, q);
        if (d < 80 && (!best || d < best.d)) best = { q, d };
      }
      return best ? best.q : null;
    }

    /* ----- 1. piers ----- */
    function fixPier(p) {
      p.y1 = surfaceBelow(p.z, p.x, p.y1 - 25, p).y;
      let carried = null;
      for (const b of all('beam')) {
        if (!near(b.z, p.z) || p.x < b.x0 - 4 || p.x > b.x1 + 4) continue;
        const by = Build.beamBottom(b, p.x);
        if (by >= p.y0 - 90 && by <= p.y0 + 15 && (carried == null || by > carried)) carried = by;
      }
      if (carried != null) p.y0 = carried;
      else if (p.y0 < pt.y + pt.h * 0.1 || p.y0 < ceilY(p.z) + 50) p.y0 = Math.min(p.y0, ceilY(p.z));
      if (p.y1 - p.y0 < 20) p.y0 = p.y1 - 20;
      p.freeTop = carried == null && p.y0 > ceilY(p.z) + 2;
    }
    all('pier').forEach(fixPier);

    /* ----- 1b. stairs wound around great piers: flights alternate in front of and behind
       the shaft, landings are corbelled out of its flanks, and a door waits at the top ----- */
    function entangle(p) {
      const z = p.z, w = p.w, gy = p.y1;
      const hF = clamp(w * r.range(1.1, 1.5), 40 / z, 140 / z);
      const ext = clamp(w * r.range(0.55, 0.8), 18 / z, 90 / z);
      const top = Math.max(p.y0 + w * 1.2, pt.y + 50);
      const k = Math.min(r.int(2, 4), Math.floor((gy - top) / hF));
      if (k < 2) return;
      // keep clear of the user's own drawing
      const reg = { x0: p.x - w / 2 - ext * 1.3, x1: p.x + w / 2 + ext * 1.3, y0: gy - k * hF - 20, y1: gy };
      const clash = out.some(o => {
        if (o === p || !o.user || o.kind === 'figure' || !near(o.z, z)) return false;
        const b = boxOf(o);
        return b && b.x0 < reg.x1 && b.x1 > reg.x0 && b.y0 < reg.y1 && b.y1 > reg.y0;
      });
      if (clash) return;
      let side = r.sign();
      const lh = clamp(hF * 0.12, 6, 16);
      for (let i = 0; i < k; i++) {
        const yS = gy - i * hF, yE = yS - hF;
        const xS = p.x + side * (w / 2 + ext * 0.5), xE = p.x - side * (w / 2 + ext * 0.5);
        const front = i % 2 === 0;
        add({ kind: 'stair', z: front ? z * 0.994 : z * 1.012, S: P(xS, yS), E: P(xE, yE), solid: i === 0, rail: true, depth: w * 0.6, wrap: true });
        // the landing grows out of the pier's flank on the side the flight arrives at
        const inner = p.x - side * (w / 2 - 5), outer = p.x - side * (w / 2 + ext * 1.15);
        add({ kind: 'beam', z, x0: Math.min(inner, outer), x1: Math.max(inner, outer), y: yE, h: lh, rail: true, chains: 0, landing: true, cantilever: true, depth: w * 0.7 });
        side = -side;
      }
      const yTop = gy - k * hF;
      const dh = clamp(hF * 0.7, 16, 90);
      if (yTop - dh > p.y0 + w * 0.5) p.door = { x: p.x + side * w * 0.08, y: yTop, w: clamp(w * 0.38, 8, 40), h: dh };
      if (r.chance(0.6)) add({ kind: 'figure', z: z * 0.99, x: p.x + side * (w / 2 + ext * 0.6), y: yTop, h: 10 });
    }
    for (const p of all('pier')) {
      if (p.y1 - p.y0 < p.w * 3.5 || p.w < 34 / Math.sqrt(p.z)) continue;
      if (p.user ? r.chance(0.3 + amt * 0.45) && p.w >= 50 : p.canWrap) entangle(p);
    }

    /* ----- 2. arches stand on what is under their legs, and spring from neighbouring piers ----- */
    for (const a of all('arch')) {
      for (const p of all('pier')) {
        if (!near(p.z, a.z) || p.y0 > a.by || p.y1 < a.by) continue;
        const [L0, R0] = archLR(a);
        if (p.x < a.cx - a.rx && p.x + p.w / 2 >= L0 - a.rx * 0.6 && p.x < L0) a.L = p.x;
        if (p.x > a.cx + a.rx && p.x - p.w / 2 <= R0 + a.rx * 0.6 && p.x > R0) a.R = p.x;
      }
      const [L, R] = archLR(a);
      const gl = surfaceBelow(a.z, (L + a.cx - a.rx) / 2, a.by, a).y;
      const gr = surfaceBelow(a.z, (R + a.cx + a.rx) / 2, a.by, a).y;
      a.gy = Math.max(gl, gr, a.by + 1);
      a.freeTop = a.top > ceilY(a.z) + 2;
    }

    /* ----- 3. stairs ----- */
    function fixStair(st) {
      const z = st.z, floor = sc.floorAt(z);
      const sb = surfaceBelow(z, st.S.x, st.S.y - 25, st);
      if (sb.y > st.S.y + 0.5) {
        // floating foot: continue the flight down its own slope until it meets the surface
        const k = (sb.y - st.S.y) / Math.max(1, st.S.y - st.E.y);
        if (k <= 2.5) st.S = P(st.S.x - (st.E.x - st.S.x) * k, sb.y);
        else {
          const pw = clamp((st.S.y - st.E.y) * 0.15, 14, 50);
          add({ kind: 'pier', z: z * 1.002, x: st.S.x, w: pw, y0: st.S.y, y1: sb.y, ring: false });
        }
      } else st.S = P(st.S.x, sb.y);
      st.solid = Math.abs(st.S.y - floor) < 2;

      const E = st.E;
      for (const f of surfaces(z, st)) {
        if (f.s.kind === 'stair' || E.x < f.x0 - 30 || E.x > f.x1 + 30) continue;
        const sy = f.y(clamp(E.x, f.x0, f.x1));
        if (Math.abs(sy - E.y) < 40) {
          st.E = P(E.x, sy);
          if (f.s.kind === 'beam') { f.s.x0 = Math.min(f.s.x0, E.x - 6); f.s.x1 = Math.max(f.s.x1, E.x + 6); }
          return;
        }
      }
      if (E.y <= ceilY(z) + 10 || E.x <= pt.x || E.x >= pt.x + pt.w) return; // continues out of view
      // nothing to arrive on: build a landing, reaching for the nearest pier or wall if there is one
      const rise = st.S.y - E.y, h = clamp(rise / 12, 8, 20), depth = clamp(rise * 0.6, 60, 200);
      const reach = clamp(rise * 1.2, 60, 260);
      let best = null;
      for (const d of [1, -1]) {
        for (let k = 6; k <= reach; k += 4) {
          if (solidAt(z, P(E.x + d * k, E.y + h * 0.5), st)) { if (!best || k < best.k) best = { d, k }; break; }
        }
      }
      if (best) {
        const far = E.x + best.d * (best.k + 3);
        add({ kind: 'beam', z, x0: Math.min(E.x - best.d * 4, far), x1: Math.max(E.x - best.d * 4, far), y: E.y, h, rail: true, chains: 0, landing: true, cantilever: true, depth });
        return;
      }
      const dir = Math.sign(E.x - st.S.x) || 1;
      const len = clamp(rise * 0.35, 36, 150);
      add({ kind: 'beam', z, x0: dir > 0 ? E.x - 4 : E.x - len, x1: dir > 0 ? E.x + len : E.x + 4, y: E.y, h, rail: true, chains: 0, landing: true, depth });
    }
    /* keep a curved stringer path in step with the adjusted ends */
    function syncPath(st) {
      if (!st.path) return;
      if (G.dist(st.path[0], st.S) > 3) st.path = [st.S].concat(st.path);
      else st.path[0] = st.S;
      st.path[st.path.length - 1] = st.E;
    }
    all('stair').sort((a, b) => b.S.y - a.S.y).forEach(st => { fixStair(st); syncPath(st); });

    /* ----- 4. bridges and beams: anchor both ends ----- */
    function fixBeam(b) {
      const z = b.z, len = b.x1 - b.x0;
      if (Build.beamBottom(b, (b.x0 + b.x1) / 2) >= sc.floorAt(z) - 3) return;
      const state = {};
      b.corbels = [];
      for (const end of [-1, 1]) {
        const ex = end < 0 ? b.x0 : b.x1;
        const yb = Build.beamBottom(b, ex), ym = (Build.beamTop(b, ex) + yb) / 2;
        if (yb >= sc.floorAt(z) - 3) { state[end] = 'floor'; continue; } // this end already rests on the floor
        const wallX = end < 0 ? wallL(z) + 4 : wallR(z) - 4;
        if (end < 0 ? ex <= pt.x + 2 : ex >= pt.x + pt.w - 2) { state[end] = 'edge'; continue; }
        if (end < 0 ? ex <= wallX : ex >= wallX) {
          // it springs from the hall wall: a corbel carries it there
          state[end] = 'wall';
          b.corbels.push({ end, x: ex });
          continue;
        }
        // carried from below near this end (a pier, wall or arch under it)?
        const tol = Math.max(24, len * 0.15);
        let carried = false;
        for (let k = 0; k <= tol && !carried; k += 3) if (solidAt(z, P(ex - end * k, yb + 3), b)) carried = true;
        if (carried) {
          if (solidAt(z, P(ex, ym), b)) {
            // the end is built into a pier or wall: it grows out of that face, on a corbel
            let k = 0;
            while (k < 80 && solidAt(z, P(ex - end * k, ym), b)) k += 2;
            state[end] = 'butt';
            b.corbels.push({ end, x: ex - end * k });
          } else state[end] = 'carried';
          continue;
        }
        // butting into a solid just beyond the end? grow out of it, on a corbel
        const reach = Math.max(40, len * 0.3);
        let hit = null;
        for (let k = -6; k <= reach; k += 3) if (solidAt(z, P(ex + end * k, ym), b)) { hit = ex + end * (k + 3); break; }
        if (hit != null) {
          if (end < 0) b.x0 = Math.min(b.x0, hit); else b.x1 = Math.max(b.x1, hit);
          state[end] = 'butt';
          b.corbels.push({ end, x: hit - end * 3 });
          continue;
        }
        state[end] = 'free';
      }
      for (const end of [-1, 1]) {
        if (state[end] !== 'free') continue;
        const other = state[-end];
        // a short landing or gallery may cantilever from its anchored end, on consoles
        if (b.cantilever && (other === 'butt' || other === 'wall' || other === 'edge') && b.x1 - b.x0 < 220 / Math.sqrt(b.z)) {
          b.consoleFrom = -end;
          continue;
        }
        const ex = end < 0 ? b.x0 : b.x1, yb = Build.beamBottom(b, ex);
        const pw = clamp(b.h * 2.4, 16, 90);
        const px = ex - end * pw * 0.5;
        const foot = surfaceBelow(z, px, yb + 1, b).y;
        if (foot - yb > 4) add({ kind: 'pier', z: z * 1.002, x: px, w: pw, y0: yb, y1: foot, ring: false });
      }
    }
    all('beam').sort((a, b) => Build.beamBottom(b, b.x0) - Build.beamBottom(a, a.x0)).forEach(fixBeam);

    /* ----- 5. windows need a wall ----- */
    for (const w of all('window')) {
      const bb = G.bbox(w.pts), cx = bb.cx, cy = bb.cy, z = w.z;
      const probes = [P(bb.x0 - 4, cy), P(bb.x1 + 4, cy), P(cx, bb.y0 - 4), P(cx, bb.y1 + 4)];
      const host = bodies(z, w).find(b => b.s.kind !== 'beam' && probes.every(q => contains(b, q)));
      if (host) continue;
      const m = clamp(Math.max(bb.w, bb.h) * 0.45, 22, 90);
      const y0 = anchorAbove(z, cx, bb.y0 - m, w);
      const keep = G.rect(bb.x0 - m * 0.7, bb.y0 - m * 0.7, bb.w + m * 1.4, bb.h + m * 1.6);
      add({ kind: 'wall', z: z * 1.001, x0: bb.x0 - m, x1: bb.x1 + m, y0, y1: surfaceBelow(z, cx, bb.y1 + m, w).y, depth: clamp(m * 1.2, 30, 90), avoid: [keep] });
    }

    /* ----- 6. things that hang ----- */
    for (const h of all('hang')) {
      h.y0 = anchorAbove(h.z, h.x, h.y0, h);
      const below = surfaceBelow(h.z, h.x, h.y0 + 5, h).y;
      h.y1 = Math.min(h.y1, below - 14);
      if (h.y1 < h.y0 + 20) h.y1 = Math.min(h.y0 + 20, below - 4);
      h.sway = clamp(h.sway ?? 0, -0.05 * (h.y1 - h.y0), 0.05 * (h.y1 - h.y0)); // gravity keeps it plumb
    }
    for (const p of all('pulley')) {
      p.y0 = anchorAbove(p.z, p.x, p.y - p.rad, p);
      const below = surfaceBelow(p.z, p.x, p.y + p.rad, p).y;
      p.yl = Math.min(p.yl, below - 8);
      p.yr = Math.min(p.yr, below - 16);
    }
    const suspend = (z, q) => add({ kind: 'rope', z, pts: [P(q.x, anchorAbove(z, q.x, q.y)), q], w: 1.3 });
    for (const c of all('chain')) {
      for (const k of ['A', 'B']) {
        const q = hold(c.z, c[k], c);
        if (q) c[k] = q;
        else suspend(c.z, c[k]);
      }
    }
    for (const r of all('rope')) {
      if (r.auto) continue;
      const first = r.pts[0], last = r.pts[r.pts.length - 1];
      const flip = last.y < first.y;
      if (flip) r.pts = r.pts.slice().reverse();
      const top = r.pts[0], bot = r.pts[r.pts.length - 1];
      const ht = hold(r.z, top, r);
      if (!ht) r.pts = [P(top.x, anchorAbove(r.z, top.x, top.y))].concat(r.pts);
      else r.pts[0] = ht;
      const sb = surfaceBelow(r.z, bot.x, bot.y - 25, r).y;
      const hb = hold(r.z, bot, r);
      if (Math.abs(sb - bot.y) < 25) r.pts.push(P(bot.x, sb));
      else if (hb) r.pts.push(hb);
      else { r.pts.push(P(bot.x, Math.min(bot.y + 18, sb - 10))); r.weight = true; }
    }

    /* ----- 7. people stand on things ----- */
    const peopleSurfaces = () => out.flatMap(s => surfacesOf(s, true));
    for (const f of all('figure')) {
      const x = f.x, y = f.y;
      let best = null;
      for (const sf of peopleSurfaces()) {
        if (x < sf.x0 + 3 || x > sf.x1 - 3) continue;
        const sy = sf.y(x), d = sy - y;
        if (d > -22 && d < 30 && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, sy, z: sf.s.z };
      }
      if (best) { f.y = best.sy; f.z = best.z * 0.998; }
      else if (y > vp.y + 4) {
        const zf = sc.Yf / (y - vp.y);
        f.z = clamp(zf, 1, H.zB - 0.1);
        f.y = sc.floorAt(f.z);
      } else {
        let drop = null;
        for (const sf of peopleSurfaces()) {
          if (x < sf.x0 + 3 || x > sf.x1 - 3) continue;
          const sy = sf.y(x);
          if (sy > y && (!drop || sy < drop.sy)) drop = { sy, z: sf.s.z };
        }
        if (drop) { f.y = drop.sy; f.z = drop.z * 0.998; }
        else { f.z = clamp(sc.Yf / 30, 1, H.zB - 0.1); f.y = sc.floorAt(f.z); }
      }
      f.h = clamp((0.13 * sc.Yf) / f.z, 6, 60);
    }
    return out;
  }

  return { resolve };
})();
