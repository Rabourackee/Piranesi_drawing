'use strict';
/* Laid paper: mottled tone, grain, fibres, foxing, a plate mark and an inked plate tone. */
const Paper = (() => {
  function make(W, H, S, plate, seed, age) {
    const c = document.createElement('canvas');
    c.width = W * S; c.height = H * S;
    const ctx = c.getContext('2d');
    const r = new Rng.Rand(seed ^ 0xa5a5);
    const base = [G.mix(244, 228, age), G.mix(238, 211, age), G.mix(224, 172, age)];

    const sw = 90, sh = Math.round((90 * H) / W);
    const sm = document.createElement('canvas');
    sm.width = sw; sm.height = sh;
    const sctx = sm.getContext('2d');
    const id = sctx.createImageData(sw, sh);
    const so = r.next() * 50;
    for (let j = 0; j < sh; j++) {
      for (let i = 0; i < sw; i++) {
        const n = Rng.fbm(i / 14, j / 14, so, 4);
        const stain = Rng.fbm(i / 7, j / 7, so + 3, 3);
        const m = 0.955 + n * 0.07 - age * 0.05 * Math.max(0, stain - 0.55);
        const k = (j * sw + i) * 4;
        id.data[k] = base[0] * m;
        id.data[k + 1] = base[1] * m * 0.995;
        id.data[k + 2] = base[2] * m * (0.99 - age * 0.02 * stain);
        id.data[k + 3] = 255;
      }
    }
    sctx.putImageData(id, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sm, 0, 0, c.width, c.height);

    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    let sv = (seed * 2654435761) >>> 0;
    for (let i = 0; i < d.length; i += 4) {
      sv = (Math.imul(sv, 1664525) + 1013904223) >>> 0;
      const g = ((sv >>> 24) - 128) * 0.045;
      d[i] += g; d[i + 1] += g; d[i + 2] += g * 0.9;
    }
    ctx.putImageData(img, 0, 0);

    ctx.save();
    ctx.scale(S, S);
    for (let i = 0; i < 320; i++) {
      const x = r.next() * W, y = r.next() * H, a = r.next() * Math.PI, L = r.range(5, 22);
      ctx.strokeStyle = r.chance(0.5) ? 'rgba(120,95,60,0.07)' : 'rgba(255,255,248,0.12)';
      ctx.lineWidth = r.range(0.3, 0.8);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a) * L * 0.5 + r.range(-3, 3), y + Math.sin(a) * L * 0.5 + r.range(-3, 3), x + Math.cos(a) * L, y + Math.sin(a) * L);
      ctx.stroke();
    }
    const p = plate;
    // plate tone: the thin film of ink a printer leaves on a wiped plate
    ctx.fillStyle = `rgba(110,85,55,${0.04 + age * 0.03})`;
    ctx.fillRect(p.x - 5, p.y - 5, p.w + 10, p.h + 10);
    // plate mark, pressed into the paper
    ctx.strokeStyle = 'rgba(90,70,45,0.4)';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(p.x - 6, p.y - 6, p.w + 12, p.h + 12);
    ctx.strokeStyle = 'rgba(255,252,240,0.55)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(p.x - 4.4, p.y - 4.4, p.w + 8.8, p.h + 8.8);

    const nf = Math.round(5 + age * 50);
    for (let i = 0; i < nf; i++) {
      const x = r.next() * W, y = r.next() * H;
      const rad = r.range(0.6, 3.5) * (r.chance(0.15) ? 3 : 1);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(140,90,40,${r.range(0.12, 0.35) * age + 0.05})`);
      g.addColorStop(1, 'rgba(140,90,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < Math.round(age * 4); i++) {
      const x = r.next() * W, y = r.next() * H, rad = r.range(40, 140);
      const g = ctx.createRadialGradient(x, y, rad * 0.7, x, y, rad);
      g.addColorStop(0, 'rgba(150,110,60,0.02)');
      g.addColorStop(0.92, `rgba(150,105,55,${0.05 + age * 0.04})`);
      g.addColorStop(1, 'rgba(150,105,55,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.56);
    vg.addColorStop(0, 'rgba(120,85,40,0)');
    vg.addColorStop(1, `rgba(120,85,40,${0.08 + age * 0.25})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    return c;
  }
  return { make };
})();
