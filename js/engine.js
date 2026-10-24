'use strict';
/*
 * The engine: sketch + parameters + seed -> list of burin operations.
 * Pipeline: imagined hall -> user elements (depth-sorted, fogged with distance)
 *           -> atmospheric tone pass slipped in between background and foreground
 *           -> the user's own shadow brush -> plate number and caption.
 */
const Engine = (() => {
  const PRI = Hall.PRI;

  function roman(n) {
    const t = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let s = '';
    for (const [v, c] of t) while (n >= v) { s += c; n -= v; }
    return s;
  }

  /* How deep an element reaches, as a z value (its front plane plus its extrusion). */
  function depthEnd(s, sc) {
    const m = sc.depthMul / sc.f;
    switch (s.kind) {
      case 'arch': return s.z + (s.depth || 200) * m;
      case 'beam': return s.z + (s.depth || G.clamp((s.x1 - s.x0) * 0.45, 80, 380)) * m;
      case 'pier': return s.z + s.w * 1.6 * m;
      case 'stair': return s.z + (s.depth || G.clamp(Math.hypot(s.S.x - s.E.x, s.S.y - s.E.y) * 0.32, 50, 240)) * m;
      default: return s.z;
    }
  }

  function compose(st) {
    const p = st.params, plate = st.plate, vp = st.vp;
    const rand = new Rng.Rand(st.seed);
    const sc = {
      W: st.W, H: st.H, plate, vp, f: 820,
      Yf: Math.max(40, plate.y + plate.h - vp.y),
      depthMul: p.depth, casts: [], shafts: [], params: p,
      wear: p.wear ?? 0.55, hand: p.hand ?? 0.7,
    };
    const penOpt = { density: p.density, hand: p.hand ?? 0.7, sketch: p.sketch ?? 0.7 };
    sc.floorAt = z => vp.y + sc.Yf / z;

    const pl = new Plate.Plate(rand.fork(7), { ...penOpt, inkFade: 1 - p.age * 0.12 });
    pl.clip([G.rect(plate.x, plate.y, plate.w, plate.h)]);
    // the draughtsman's construction: horizon and rays to the vanishing point, left faintly visible
    const cr = rand.fork(31), cl = new Plate.Plate(cr, penOpt);
    cl.ink(G.P(plate.x - 10, vp.y), G.P(plate.x + plate.w + 10, vp.y), 0.4, 0.16, 0.4, 0.3);
    const targets = [[plate.x, plate.y], [plate.x + plate.w, plate.y], [plate.x, plate.y + plate.h], [plate.x + plate.w, plate.y + plate.h]];
    for (let i = 0; i < 10; i++) {
      const e = cr.int(0, 3), t = cr.next();
      targets.push(e === 0 ? [plate.x + t * plate.w, plate.y] : e === 1 ? [plate.x + t * plate.w, plate.y + plate.h] : e === 2 ? [plate.x, plate.y + t * plate.h] : [plate.x + plate.w, plate.y + t * plate.h]);
    }
    for (const [x, y] of targets) cl.ink(vp, G.P(x, y), 0.35, 0.13, 0.5, 0.4);
    pl.ops.push(...cl.ops);

    // 1. read the user's strokes
    const userSpecs = [];
    st.strokes.forEach((s, i) => {
      if (s.kind === 'shade' || s.kind === 'light') return;
      const spec = Interp.toSpec(s, sc, new Rng.Rand((st.seed * 31 + i * 977) >>> 0));
      if (!spec || !Build[spec.kind]) return;
      spec.order = 1000 + i;
      spec.user = true;
      userSpecs.push(spec);
    });
    // 2. imagine the hall behind the user's near architecture, never inside it
    const zMin = G.clamp(Math.max(1.25, ...userSpecs.filter(s => s.z <= 1.2).map(s => depthEnd(s, sc) * 1.04)), 1.25, 3.4);
    const items = [];
    const imagined = Hall.build(sc, rand.fork(11), items, p.imagination, zMin);
    imagined.forEach((s, i) => { s.order = 20 + i; });
    // 3. make everything structurally sound, then queue it for drawing
    // every element gets its own style (square or round pier, flat or arched bridge, ...)
    for (const s of userSpecs.concat(imagined)) Build.style(s, rand.fork(700 + s.order));
    const specs = Structure.resolve(userSpecs.concat(imagined), sc, rand.fork(55), p.imagination);
    specs.forEach((s, i) => {
      if (!s.style) Build.style(s, rand.fork(900 + i));
      if (s.order == null) s.order = 5000 + i;
      items.push({ z: s.z, pri: PRI[s.kind] ?? 3, order: s.order, draw: (pl2, r) => Build[s.kind](pl2, sc, s, r) });
    });
    items.sort((a, b) => b.z - a.z || a.pri - b.pri || a.order - b.order);

    const fogDist = G.mix(12, 2.2, p.fog);
    let envAt = -1;
    for (const it of items) {
      if (envAt < 0 && it.z <= 1.25) envAt = pl.ops.length;
      pl.setFog(G.clamp((it.z - 1) / fogDist, 0, 0.9));
      it.draw(pl, rand.fork(300 + it.order));
    }
    if (envAt < 0) envAt = pl.ops.length;
    pl.setFog(0);

    const env = Tone.envField(sc, rand.fork(3), p.darkness, st.strokes);
    const ep = new Plate.Plate(rand.fork(4), penOpt);
    Tone.hatchField(ep, env, plate, p.density, 5);

    const tail = new Plate.Plate(rand.fork(9), penOpt);
    const fg = Tone.envField(sc, rand.fork(3), p.darkness, st.strokes, true);
    Tone.hatchField(tail, fg, plate, p.density, 11);
    const uf = Tone.userField(sc, st.strokes);
    if (uf) Tone.hatchField(tail, uf, plate, p.density, 17);
    const sr = rand.fork(21);
    for (let i = 0; i < 9; i++) {
      const a = G.P(plate.x + sr.next() * plate.w, plate.y + sr.next() * plate.h);
      const ang = sr.range(-0.6, 0.6) + (sr.chance(0.5) ? Math.PI / 2 : 0), L = sr.range(60, 300);
      tail.ink(a, G.P(a.x + Math.cos(ang) * L, a.y + Math.sin(ang) * L), 0.35, 0.14, 0.4, 0);
    }
    const numeral = roman(1 + (st.seed % 16));
    tail.text(numeral, plate.x + plate.w - 14, plate.y + 30, 'italic 22px "IM Fell English", Georgia, serif', 0.9, 'right');
    tail.unclip();
    tail.text(`Carceri d’invenzione · Tav. ${numeral}`, plate.x + plate.w / 2, plate.y + plate.h + 42, 'italic 17px "IM Fell English", Georgia, serif', 0.75);

    const ops = pl.ops.slice(0, envAt).concat(ep.ops, pl.ops.slice(envAt), tail.ops);
    return { ops, numeral };
  }

  return { compose, roman };
})();
