'use strict';
/*
 * Atmosphere. A low-resolution darkness field is assembled from a vignette that weighs
 * on the vaults above, smoky noise, cast shadows of near elements, shafts of light from
 * barred windows and the user's own shadow/light brush. It is then translated into
 * continuous cross-hatching: lines march across the plate at several angles and are only
 * "bitten" where the field exceeds each layer's threshold.
 */
const Tone = (() => {
  const CELL = 4;
  class Field {
    constructor(W, H) { this.w = Math.ceil(W / CELL) + 1; this.h = Math.ceil(H / CELL) + 1; this.d = new Float32Array(this.w * this.h); }
    get(x, y) {
      let fx = x / CELL, fy = y / CELL;
      if (fx < 0) fx = 0;
      if (fy < 0) fy = 0;
      if (fx > this.w - 1.001) fx = this.w - 1.001;
      if (fy > this.h - 1.001) fy = this.h - 1.001;
      const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, i = iy * this.w + ix, d = this.d;
      return (d[i] * (1 - tx) + d[i + 1] * tx) * (1 - ty) + (d[i + this.w] * (1 - tx) + d[i + this.w + 1] * tx) * ty;
    }
  }
  function blur(F, rad, passes) {
    const { w, h } = F;
    let a = F.d, b = new Float32Array(a.length);
    for (let p = 0; p < passes; p++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let s = 0, n = 0;
          for (let k = -rad; k <= rad; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += a[y * w + xx]; n++; } }
          b[y * w + x] = s / n;
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let s = 0, n = 0;
          for (let k = -rad; k <= rad; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += b[yy * w + x]; n++; } }
          a[y * w + x] = s / n;
        }
      }
    }
    F.d = a;
  }
  /* Rasterise shapes into a coverage array the size of a Field. */
  function raster(F, draw) {
    const c = document.createElement('canvas');
    c.width = F.w; c.height = F.h;
    const ctx = c.getContext('2d');
    ctx.scale(1 / CELL, 1 / CELL);
    draw(ctx);
    const data = ctx.getImageData(0, 0, F.w, F.h).data;
    const out = new Float32Array(F.w * F.h);
    for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3] / 255;
    return out;
  }
  function polyPath(ctx, poly) {
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
  }
  function brush(ctx, strokes, alpha) {
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    for (const s of strokes) {
      const rad = s.r || 30;
      for (const p of G.resample(s.pts, Math.max(3, rad * 0.35))) { ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  /* fg=true gives the gentler vignette-only field laid over the foreground architecture. */
  function envField(sc, r, dark, strokes, fg = false) {
    const F = new Field(sc.W, sc.H), pt = sc.plate;
    const casts = raster(F, ctx => { if (fg) return; for (const c of sc.casts) { ctx.fillStyle = `rgba(0,0,0,${c.k})`; polyPath(ctx, c.poly); ctx.fill(); } });
    const lights = raster(F, ctx => {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      for (const s of sc.shafts) { polyPath(ctx, s.poly); ctx.fill(); }
      brush(ctx, strokes.filter(s => s.kind === 'light'), 0.3);
    });
    const s = r.next() * 100;
    for (let j = 0; j < F.h; j++) {
      for (let i = 0; i < F.w; i++) {
        const idx = j * F.w + i;
        const u = (i * CELL - pt.x) / pt.w, v = (j * CELL - pt.y) / pt.h;
        let t = 0.75 * G.smoothstep(0.5, -0.05, v) + 0.38 * G.smoothstep(0.26, -0.02, u) + 0.45 * G.smoothstep(0.72, 1.02, u) + 0.25 * G.smoothstep(0.82, 1.0, v);
        t += (Rng.fbm(u * 2.2, v * 2.2, s) - 0.5) * 0.45;
        t *= dark * (fg ? 0.75 : 1.3);
        if (fg) t -= 0.12;
        t += casts[idx] * 0.75 * (0.4 + dark * 0.6);
        t -= lights[idx] * 0.9;
        F.d[idx] = G.clamp(t, 0, 1);
      }
    }
    blur(F, 4, 3);
    return F;
  }

  function userField(sc, strokes) {
    const shade = strokes.filter(s => s.kind === 'shade'), light = strokes.filter(s => s.kind === 'light');
    if (!shade.length) return null;
    const F = new Field(sc.W, sc.H);
    const A = raster(F, ctx => brush(ctx, shade, 0.22));
    const B = raster(F, ctx => brush(ctx, light, 0.3));
    for (let i = 0; i < F.d.length; i++) F.d[i] = G.clamp(A[i] * 1.15 - B[i], 0, 1);
    blur(F, 2, 2);
    return F;
  }

  /* Steep strokes first, then a shallow cross, then densifying passes and a final diagonal. */
  const LAYERS = [
    { a: 1.3, thr: 0.12, sp: 4.8 },
    { a: 0.22, thr: 0.3, sp: 5.0 },
    { a: 1.3, thr: 0.46, sp: 4.8, ph: 0.5 },
    { a: -0.62, thr: 0.6, sp: 4.6 },
    { a: 0.22, thr: 0.74, sp: 5.0, ph: 0.5 },
    { a: 0.9, thr: 0.86, sp: 4.4 },
  ];
  function hatchField(pl, F, b, density, seed) {
    const r = pl.r, step = 2.4;
    LAYERS.forEach((L, li) => {
      const sp = L.sp / density;
      const dx = Math.cos(L.a), dy = Math.sin(L.a), nx = -dy, ny = dx;
      let n0 = Infinity, n1 = -Infinity, d0 = Infinity, d1 = -Infinity;
      for (const [x, y] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) {
        const pn = x * nx + y * ny, pd = x * dx + y * dy;
        n0 = Math.min(n0, pn); n1 = Math.max(n1, pn); d0 = Math.min(d0, pd); d1 = Math.max(d1, pd);
      }
      for (let k = Math.floor(n0 / sp); k * sp <= n1; k++) {
        const off = k * sp + (L.ph || 0) * sp + (r.next() - 0.5) * sp * 0.25;
        const ws = r.next() * 500;
        const thr = L.thr + (r.next() - 0.5) * 0.1; // per-line jitter feathers the edges of each tone zone
        let run = null, cnt = 0;
        const flush = () => {
          if (run && run.length >= 2 && G.dist(run[0], run[run.length - 1]) > 3) pl.emit(run, 0.5 * (0.85 + r.next() * 0.3), 0.8);
          run = null;
        };
        for (let t = d0; t <= d1; t += step) {
          const wob = (Rng.noise1(ws + t * 0.03) - 0.5) * (0.5 + 0.8 * pl.hand) + (Rng.noise1(ws + 77 + t * 0.15) - 0.5) * 0.4 * pl.hand;
          const x = nx * (off + wob) + dx * t, y = ny * (off + wob) + dy * t;
          if (x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) { flush(); continue; }
          const v = F.get(x, y) + (Rng.noise2(x * 0.03, y * 0.03, li * 13 + seed) - 0.5) * 0.1;
          if (v > thr) {
            if (!run) { run = [{ x, y }]; cnt = 0; } else if (++cnt % 3 === 0) { run.push({ x, y }); run.last = null; } else run.last = { x, y };
          } else {
            if (run && run.last) run.push(run.last);
            flush();
          }
        }
        if (run && run.last) run.push(run.last);
        flush();
      }
    });
  }

  return { envField, userField, hatchField };
})();
