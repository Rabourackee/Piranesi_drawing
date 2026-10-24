'use strict';
/*
 * The Plate records "burin" operations: ink strokes, white fills used for occlusion, and
 * clip regions. Recording first lets us replay the etching progressively, the way an
 * engraver works the copper, and keeps the generators independent of any canvas.
 *
 * Everything here is about making geometry look *drawn*, not rendered:
 *   - a stroke bows, trembles, overshoots or stops short, and changes pressure;
 *   - long lines are built from many short, slightly misaligned strokes (sketchiness);
 *   - contours are redrawn edge by edge, crossing at the corners, sometimes twice;
 *   - hatching is not clipped to the face: each line finds its own way in and out,
 *     stopping short or spilling over the edge by a hair, as a hand does.
 */
const Plate = (() => {
  const INK = '28,20,15';

  /* Where the line o + d*t is inside the rings (even-odd), as [t0, t1] pairs. */
  function intervals(rings, ox, oy, dx, dy) {
    const ts = [];
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[j], b = r[i];
        const ex = b.x - a.x, ey = b.y - a.y;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const wx = a.x - ox, wy = a.y - oy;
        const u = (wx * dy - wy * dx) / den;
        if (u >= 0 && u < 1) ts.push((wx * ey - wy * ex) / den);
      }
    }
    ts.sort((p, q) => p - q);
    const out = [];
    for (let i = 0; i + 1 < ts.length; i += 2) out.push([ts[i], ts[i + 1]]);
    return out;
  }

  /* Corners of a ring (indices where the outline turns sharply). */
  function corners(ring, closed, thr = 0.55) {
    const n = ring.length, out = [];
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
      const p = ring[(i - 1 + n) % n], a = ring[i], b = ring[(i + 1) % n];
      const d = Math.abs(G.angDiff(Math.atan2(b.y - a.y, b.x - a.x), Math.atan2(a.y - p.y, a.x - p.x)));
      if (d > thr) out.push(i);
    }
    return out;
  }

  class Plate {
    constructor(rand, opt = {}) {
      this.ops = [];
      this.r = rand;
      this.fog = 0;
      this.density = opt.density || 1;
      this.inkFade = opt.inkFade || 1;
      this.hand = opt.hand ?? 0.6;     // tremor: 0 = ruler-straight
      this.sketch = opt.sketch ?? 0.7; // how broken-up long strokes are
    }
    setFog(f) { this.fog = G.clamp(f, 0, 0.92); }
    A(a) { return a * (1 - this.fog * 0.78) * this.inkFade; }
    Wd(w) { return w * (1 - this.fog * 0.45); }
    /* Hatch spacing for a tone in [0,1]: darker tone means tighter lines. */
    spacing(t) { return (2.3 + (1 - t) * 7.2) / this.density; }

    fill(rings, color) { this.ops.push({ t: 'fill', rings, color: color || '#fff' }); }
    clip(rings) { this.ops.push({ t: 'clip', rings }); }
    unclip() { this.ops.push({ t: 'unclip' }); }
    text(text, x, y, font, a = 0.85, align = 'center') { this.ops.push({ t: 'text', text, x, y, font, a, align }); }
    raw(pts, w, a) { if (pts.length >= 2) this.ops.push({ t: 'line', pts, w: this.Wd(w), a: this.A(a) }); }

    /*
     * Emits a polyline as a hand would. Nobody can draw a long straight line, so:
     *  1. the whole path wanders off true with slow noise (more the longer it is);
     *  2. it is then laid down as a chain of short strokes, each tilted a little off the
     *     last, mostly overlapping, now and then leaving a hair of paper, sometimes
     *     gone over twice;
     *  3. every stroke has its own pressure.
     * Strokes of similar weight are batched into one op, which keeps playback fast.
     */
    emit(pts, w, al) {
      const n = pts.length;
      if (n < 2) return;
      const cum = [0];
      for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      const len = cum[n - 1], sk = this.sketch, r = this.r;
      if (sk < 0.05 || len < 5) { this.raw(pts, w, al); return; }
      // 1. slow wander, perpendicular to the path
      const thin = w < 0.75;
      const wamp = sk * Math.min(thin ? 0.9 : 2.8, 0.25 + len * (thin ? 0.0018 : 0.005));
      const s0n = r.next() * 500, P2 = new Array(n);
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const o = (Rng.noise1(s0n + cum[i] * 0.011) - 0.5) * 2 * wamp + (Rng.noise1(s0n + 99 + cum[i] * 0.045) - 0.5) * 0.7 * wamp;
        P2[i] = { x: pts[i].x - ((b.y - a.y) / l) * o, y: pts[i].y + ((b.x - a.x) / l) * o };
      }
      // 2. short tilted strokes
      const base = (thin ? 15 : 8) * (0.65 + 0.9 * (1 - sk));
      const amp = sk * (0.3 + 0.75 * w);
      const at = d => {
        let i = 1;
        while (i < n - 1 && cum[i] < d) i++;
        const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
        return { x: P2[i - 1].x + (P2[i].x - P2[i - 1].x) * t, y: P2[i - 1].y + (P2[i].y - P2[i - 1].y) * t, i };
      };
      const buckets = new Map();
      const put = (seg, ww, aa) => {
        const kw = Math.round(this.Wd(ww) / 0.12), ka = Math.round(this.A(aa) / 0.08);
        const key = kw * 100 + ka;
        let b = buckets.get(key);
        if (!b) { b = { t: 'lines', segs: [], w: kw * 0.12, a: ka * 0.08 }; buckets.set(key, b); }
        b.segs.push(seg);
      };
      let d0 = 0;
      while (d0 < len - 0.5) {
        const dl = base * (0.5 + r.next() * 1.1);
        let d1 = Math.min(len, d0 + dl);
        if (len - d1 < dl * 0.35) d1 = len;
        const a = at(d0), b = at(d1);
        const piece = [a];
        for (let k = a.i; k < b.i; k++) if (cum[k] > d0 && cum[k] < d1) piece.push(P2[k]);
        piece.push(b);
        const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
        const passes = r.next() < 0.14 * sk ? 2 : 1;
        for (let pss = 0; pss < passes; pss++) {
          const o0 = (r.next() - 0.5) * 2 * amp, o1 = (r.next() - 0.5) * 2 * amp;
          const seg = piece.map((p, k) => {
            const t = k / (piece.length - 1), o = o0 + (o1 - o0) * t;
            return { x: p.x + nx * o, y: p.y + ny * o };
          });
          put(seg, w * (0.65 + 0.6 * r.next()) * (pss ? 0.7 : 1), al * (0.72 + 0.28 * r.next()) * (pss ? 0.6 : 1));
        }
        if (d1 >= len) break;
        // mostly overlap the previous stroke, sometimes leave a hair of paper
        d0 = Math.max(d0 + dl * 0.35, d1 + r.range(-0.45, 0.22) * dl * sk);
      }
      for (const b of buckets.values()) if (b.a > 0.005) this.ops.push(b);
    }

    /*
     * One bitten line from a to b. It bows a little, trembles at two frequencies, overshoots
     * or stops short at its ends, and now and then the burin lifts off the plate.
     */
    ink(a, b, w = 0.8, al = 0.85, wob = 0.5, brk = 0.1, bowMax = 4) {
      let L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 0.4) return;
      const h = this.hand, dx = (b.x - a.x) / L, dy = (b.y - a.y) / L;
      const e0 = L > 6 ? (this.r.next() - 0.35) * 1.8 * h : 0, e1 = L > 6 ? (this.r.next() - 0.35) * 1.8 * h : 0;
      const ax = a.x - dx * e0, ay = a.y - dy * e0;
      L += e0 + e1;
      const nx = -dy, ny = dx;
      const n = Math.max(1, Math.ceil(L / 4.5));
      const s = this.r.next() * 997;
      const wo = wob * (0.55 + 0.75 * h) * (1 + this.fog * 0.3);
      const bow = (this.r.next() * 2 - 1) * Math.min(L * 0.012, bowMax) * h;
      const pts = new Array(n + 1);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        let o = bow * Math.sin(Math.PI * t);
        if (wo) o += (Rng.noise1(s + t * L * 0.025) - 0.5) * 2 * wo + (Rng.noise1(s + 431 + t * L * 0.16) - 0.5) * 0.6 * wo * h;
        pts[i] = { x: ax + dx * L * t + nx * o, y: ay + dy * L * t + ny * o };
      }
      const ww = w * (0.8 + this.r.next() * 0.4);
      if (brk && n >= 4 && this.r.next() < brk) {
        const c = 1 + Math.floor(this.r.next() * (n - 3));
        this.emit(pts.slice(0, c + 1), ww, al);
        this.emit(pts.slice(c + 2), ww, al);
      } else this.emit(pts, ww, al);
    }

    /* A straight line a->b drawn only where it lies inside rings, with loose, hand-placed ends. */
    loose(rings, a, b, w = 0.55, al = 0.8, wob = 0.35, brk = 0.12, bowMax = 4) {
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      if (L < 0.5) return;
      const sk = this.sketch;
      for (const [t0, t1] of intervals(rings, a.x, a.y, dx, dy)) {
        const u0 = Math.max(0, t0) + (this.r.range(-1.6, 2.6) * sk) / L;
        const u1 = Math.min(1, t1) - (this.r.range(-1.6, 2.6) * sk) / L;
        if ((u1 - u0) * L < 1.2) continue;
        this.ink({ x: a.x + dx * u0, y: a.y + dy * u0 }, { x: a.x + dx * u1, y: a.y + dy * u1 }, w, al, wob, brk, bowMax);
      }
    }

    /* Hand-drawn polyline following a path, with tremor and the odd lift of the burin. */
    path(pts, closed, w = 1, al = 0.9, wob = 0.45, brk = 0) {
      if (!pts || pts.length < 2) return;
      const R = G.subdivide(pts, 4, closed);
      const s = this.r.next() * 997, h = this.hand;
      const wo = wob * (0.55 + 0.75 * h);
      let acc = 0;
      const out = [];
      for (let i = 0; i < R.length; i++) {
        const p = R[i], q = R[Math.min(i + 1, R.length - 1)], o = R[Math.max(i - 1, 0)];
        const tx = q.x - o.x, ty = q.y - o.y, l = Math.hypot(tx, ty) || 1;
        if (i) acc += G.dist(R[i - 1], p);
        const off = (Rng.noise1(s + acc * 0.03) - 0.5) * 2 * wo + (Rng.noise1(s + 431 + acc * 0.16) - 0.5) * 0.6 * wo * h;
        out.push({ x: p.x - (ty / l) * off, y: p.y + (tx / l) * off });
      }
      if (closed) out[out.length - 1] = out[0];
      const ww = w * (0.85 + this.r.next() * 0.3);
      if (brk && out.length > 12 && this.r.next() < brk) {
        const c = 3 + Math.floor(this.r.next() * (out.length - 8));
        this.emit(out.slice(0, c + 1), ww, al);
        this.emit(out.slice(c + 2 + Math.floor(this.r.next() * 2)), ww, al);
      } else this.emit(out, ww, al);
    }

    /*
     * Contours, drawn the way a draughtsman does: one stroke per edge (or per smooth run of
     * a curve), each overshooting the corner a little so lines cross there; a second, lighter
     * pass on top; and once in a while a faint pentimento, a first attempt slightly off.
     */
    outline(ring, closed = true, w = 1.1, al = 0.92) {
      if (!ring || ring.length < 2) return;
      const n = ring.length, cs = corners(ring, closed);
      const runs = [];
      if (!cs.length) {
        // smooth curve: break it into a few arcs that overlap
        const k = closed ? 3 : 1, step = Math.ceil(n / k);
        for (let i = 0; i < n; i += step) {
          const run = [];
          for (let j = i; j <= Math.min(i + step + 1, closed ? i + step + 1 : n - 1); j++) run.push(ring[j % n]);
          if (run.length > 1) runs.push(run);
        }
      } else {
        const idx = closed ? cs.concat([cs[0] + n]) : [0, ...cs, n - 1];
        for (let k = 0; k < idx.length - 1; k++) {
          const run = [];
          for (let j = idx[k]; j <= idx[k + 1]; j++) run.push(ring[j % n]);
          if (run.length > 1) runs.push(run);
        }
      }
      const sk = this.sketch;
      for (const run of runs) {
        // overshoot at both ends, along the local tangent
        const a = run[0], a1 = run[1], b = run[run.length - 1], b1 = run[run.length - 2];
        const la = G.dist(a, a1) || 1, lb = G.dist(b, b1) || 1;
        const oa = this.r.range(-0.5, 3.5) * sk, ob = this.r.range(-0.5, 3.5) * sk;
        const ext = [{ x: a.x + ((a.x - a1.x) / la) * oa, y: a.y + ((a.y - a1.y) / la) * oa }, ...run.slice(1, -1), { x: b.x + ((b.x - b1.x) / lb) * ob, y: b.y + ((b.y - b1.y) / lb) * ob }];
        this.path(ext, false, w * 0.8, al, 0.35, 0.12);
        if (w > 0.9 && this.r.chance(0.75)) this.path(ext, false, w * 0.5, al * 0.65, 0.65, 0.3);
        if (w > 0.9 && this.r.chance(0.12 * sk)) {
          const dx = this.r.range(-3, 3), dy = this.r.range(-3, 3);
          this.path(ext.map(p => ({ x: p.x + dx, y: p.y + dy })), false, 0.4, 0.22, 0.8, 0.4);
        }
      }
    }

    /* Parallel hatching on a global grid, so neighbouring faces line up. */
    hatch(rings, ang, sp, o = {}) {
      const bb = G.bboxRings(rings);
      const dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
      let n0 = Infinity, n1 = -Infinity, d0 = Infinity, d1 = -Infinity;
      for (const [x, y] of [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x0, bb.y1], [bb.x1, bb.y1]]) {
        const pn = x * nx + y * ny, pd = x * dx + y * dy;
        if (pn < n0) n0 = pn;
        if (pn > n1) n1 = pn;
        if (pd < d0) d0 = pd;
        if (pd > d1) d1 = pd;
      }
      const ph = (o.phase || 0) * sp;
      const w = o.w || 0.55, a = o.a || 0.8, wob = o.wob ?? 0.35, brk = o.brk ?? 0.12;
      for (let k = Math.floor((n0 - ph) / sp); k * sp + ph <= n1 + sp; k++) {
        // a hand does not space lines evenly, and sometimes skips one
        if (this.r.next() < 0.04 * this.sketch) continue;
        const off = k * sp + ph + (this.r.next() - 0.5) * sp * (0.22 + 0.25 * this.sketch);
        const e0 = d0 - 3, e1 = d1 + 3;
        this.loose(rings, { x: nx * off + dx * e0, y: ny * off + dy * e0 }, { x: nx * off + dx * e1, y: ny * off + dy * e1 }, w, a, wob, brk, sp * 0.4);
      }
    }
    /* Hatching that radiates from the vanishing point: lines that recede into depth. */
    hatchVP(rings, vp, sp, o = {}) {
      const pts = rings.flat();
      const bb = G.bbox(pts);
      let c, a0, a1, r0, r1, rref;
      const inside = vp.x >= bb.x0 && vp.x <= bb.x1 && vp.y >= bb.y0 && vp.y <= bb.y1;
      if (inside) {
        c = 0; a0 = -Math.PI; a1 = Math.PI; r0 = 0;
        r1 = Math.hypot(bb.w, bb.h) + G.dist(vp, { x: bb.cx, y: bb.cy });
        rref = Math.max(bb.w, bb.h) * 0.5;
      } else {
        const cen = { x: bb.cx, y: bb.cy };
        c = Math.atan2(cen.y - vp.y, cen.x - vp.x);
        a0 = Infinity; a1 = -Infinity; r0 = Infinity; r1 = 0;
        for (const p of pts) {
          const ra = G.angDiff(Math.atan2(p.y - vp.y, p.x - vp.x), c);
          if (ra < a0) a0 = ra;
          if (ra > a1) a1 = ra;
          const d = G.dist(p, vp);
          if (d < r0) r0 = d;
          if (d > r1) r1 = d;
        }
        r0 *= 0.6;
        rref = G.dist(cen, vp);
      }
      const dth = sp / Math.max(rref, 12);
      const ph = (o.phase || 0) * dth;
      const w = o.w || 0.55, a = o.a || 0.8;
      for (let k = Math.floor((c + a0 - ph) / dth); k * dth + ph <= c + a1 + dth; k++) {
        if (this.r.next() < 0.04 * this.sketch) continue;
        const th = k * dth + ph + (this.r.next() - 0.5) * dth * 0.3 * this.sketch, ux = Math.cos(th), uy = Math.sin(th);
        this.loose(rings, { x: vp.x + ux * r0, y: vp.y + uy * r0 }, { x: vp.x + ux * r1 * 1.02, y: vp.y + uy * r1 * 1.02 }, w, a, o.wob ?? 0.3, o.brk ?? 0.1, sp * 0.4);
      }
    }
    /*
     * Tone to layered cross-hatching. dirs is a list of {a: angle} or {vp: point}.
     * Each extra layer only starts at a darker threshold, the way etchers build value.
     * Lines are not clipped: they find the edges themselves, loosely.
     */
    shade(rings, tone, dirs, o = {}) {
      const t = tone * (1 - this.fog * 0.5);
      if (t < 0.07 || !dirs || !dirs.length) return;
      const sp = this.spacing(t);
      const th = [0, 0.4, 0.62, 0.8, 0.9];
      for (let i = 0; i < th.length; i++) {
        if (t < th[i]) break;
        const d = dirs[i % dirs.length];
        const extra = i >= dirs.length;
        const s = sp * (i ? 1.1 : 1) * (extra ? 1.3 : 1);
        // later layers wander a few degrees off their nominal direction
        const opt = { w: (o.w || 0.55) * (i ? 0.9 : 1), a: o.a || 0.82, phase: extra ? 0.5 : 0 };
        if (d.vp) this.hatchVP(rings, d.vp, s, opt);
        else this.hatch(rings, d.a + (i ? this.r.range(-0.08, 0.08) * this.sketch : 0), s, opt);
      }
    }
  }

  const styles = new Map();
  function strokeStyle(a) {
    const q = Math.round(a * 40) / 40;
    let s = styles.get(q);
    if (!s) { s = `rgba(${INK},${q})`; styles.set(q, s); }
    return s;
  }
  function trace(ctx, rings) {
    ctx.beginPath();
    for (const r of rings) {
      if (!r.length) continue;
      ctx.moveTo(r[0].x, r[0].y);
      for (let i = 1; i < r.length; i++) ctx.lineTo(r[i].x, r[i].y);
      ctx.closePath();
    }
  }
  /* Replays ops [i0, i1) onto a 2D context. Canvas state (clips) carries across calls. */
  function play(ctx, ops, i0, i1) {
    for (let i = i0; i < i1; i++) {
      const o = ops[i];
      switch (o.t) {
        case 'line': {
          const p = o.pts;
          ctx.beginPath();
          ctx.moveTo(p[0].x, p[0].y);
          for (let k = 1; k < p.length; k++) ctx.lineTo(p[k].x, p[k].y);
          ctx.lineWidth = o.w;
          ctx.strokeStyle = strokeStyle(o.a);
          ctx.stroke();
          break;
        }
        case 'lines': {
          ctx.beginPath();
          for (const p of o.segs) {
            ctx.moveTo(p[0].x, p[0].y);
            for (let k = 1; k < p.length; k++) ctx.lineTo(p[k].x, p[k].y);
          }
          ctx.lineWidth = o.w;
          ctx.strokeStyle = strokeStyle(o.a);
          ctx.stroke();
          break;
        }
        case 'fill':
          trace(ctx, o.rings);
          ctx.fillStyle = o.color;
          ctx.fill('evenodd');
          break;
        case 'clip':
          ctx.save();
          trace(ctx, o.rings);
          ctx.clip('evenodd');
          break;
        case 'unclip':
          ctx.restore();
          break;
        case 'text':
          ctx.save();
          ctx.font = o.font;
          ctx.fillStyle = `rgba(${INK},${o.a})`;
          ctx.textAlign = o.align;
          ctx.fillText(o.text, o.x, o.y);
          ctx.restore();
          break;
      }
    }
  }
  return { Plate, play, intervals };
})();
