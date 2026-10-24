'use strict';
/*
 * The engine: sketch + parameters + seed -> list of burin operations.
 * Pipeline: imagined hall -> user elements (depth-sorted, fogged with distance)
 *           -> atmospheric tone pass slipped in between background and foreground
 *           -> the user's own shadow brush -> plate number and caption.
 * In two-point perspective the scene is built in one-point space over the region the turned
 * camera sees, then every mark is carried into the picture (js/persp.js); construction lines,
 * atmosphere and caption are laid directly on the picture.
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
    const pz = st.persp === 2 ? Persp.make(st.vp) : null;
    let sst = st;
    if (pz) {
      // the stretch of one-point space that the turned camera sees through the plate
      const q = st.plate, ring = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        ring.push(G.P(q.x + t * q.w, q.y), G.P(q.x + t * q.w, q.y + q.h), G.P(q.x, q.y + t * q.h), G.P(q.x + q.w, q.y + t * q.h));
      }
      const bb = G.bbox(ring.map(pz.from));
      sst = { ...st, plate: { x: bb.x0, y: bb.y0, w: bb.w, h: bb.h }, strokes: st.strokes.map(k => ({ ...k, pts: k.pts.map(pz.from) })) };
    }
    const S = scene(sst);
    return st.planOnly ? S : finish(st, S, pz);
  }

  /* The architecture, drawn in one-point space. */
  function scene(st) {
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
    sc.plants = p.plants !== 0;
    sc.people = p.people !== 0;
    Wear.setPlants(sc.plants);

    const pl = new Plate.Plate(rand.fork(7), { ...penOpt, inkFade: 1 - p.age * 0.12 });
    pl.clip([G.rect(plate.x, plate.y, plate.w, plate.h)]);

    // 1. read the user's strokes
    // a part that stops short of the near floor stands further back, on the distant floor
    const depths = Interp.placeDepth(st.strokes, sc);
    const userSpecs = [];
    st.strokes.forEach((s, i) => {
      if (s.kind === 'shade' || s.kind === 'light') return;
      const spec = Interp.toSpec({ ...s, z: depths[i] }, sc, new Rng.Rand((st.seed * 31 + i * 977) >>> 0));
      if (!spec || !Build[spec.kind]) return;
      spec.order = 1000 + i;
      spec.user = true;
      userSpecs.push(spec);
    });
    // 2. imagine the hall behind the user's near architecture, never inside it
    const zMin = G.clamp(Math.max(1.25, ...userSpecs.filter(s => s.z <= 1.2).map(s => depthEnd(s, sc) * 1.04)), 1.25, 3.4);
    const items = [];
    const zFar = Math.max(1, ...userSpecs.map(s => depthEnd(s, sc)));
    // nothing imagined may stand in front of the user's distant architecture and hide it
    const userBoxes = userSpecs.map(s => ({ z: s.z, b: Structure.boxOf(s) })).filter(u => u.b);
    const hides = s => {
      const b = Structure.boxOf(s);
      return b && userBoxes.some(u => s.z < u.z * 0.97 && b.x0 < u.b.x1 + 20 && u.b.x0 - 20 < b.x1 && b.y0 < u.b.y1 + 20 && u.b.y0 - 20 < b.y1);
    };
    const imagined = Hall.build(sc, rand.fork(11), items, p.imagination, zMin, zFar, userSpecs).filter(s => !hides(s));
    imagined.forEach((s, i) => { s.order = 20 + i; });
    // 3. make everything structurally sound, then queue it for drawing
    // every element gets its own style (square or round pier, flat or arched bridge, ...)
    for (const s of userSpecs.concat(imagined)) Build.style(s, rand.fork(700 + s.order));
    const specs = Structure.resolve(userSpecs.concat(imagined), sc, rand.fork(55), p.imagination);
    if (st.planOnly) return { specs, sc, items };
    specs.forEach((s, i) => {
      if (!s.style) Build.style(s, rand.fork(900 + i));
      if (s.order == null) s.order = 5000 + i;
      items.push({ z: s.z, pri: PRI[s.kind] ?? 3, order: s.order, draw: (pl2, r) => {
        Build[s.kind](pl2, sc, s, r);
        // plants root in the corners of what was just drawn
        if (sc.plants) Flora.grow(pl2, sc, s, r.fork(77));
      } });
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
    return { ops: pl.ops, envAt, sc, rand, penOpt };
  }

  /* Construction lines, atmosphere, the user's shadow brush, plate number and caption, laid on
     the picture itself; in two-point perspective the scene's marks are carried over first. */
  function finish(st, S, pz) {
    const p = st.params, plate = st.plate, { sc, rand, penOpt } = S;
    const geo = pz ? Persp.mapOps(S.ops, pz.to) : S.ops;
    const head = pz ? [{ t: 'clip', rings: [G.rect(plate.x, plate.y, plate.w, plate.h)] }] : [geo[0]];
    const body = pz ? geo : geo.slice(1), envAt = pz ? S.envAt : S.envAt - 1;

    // the draughtsman's construction: horizon and rays to the vanishing points, left faintly visible
    const cr = rand.fork(31), cl = new Plate.Plate(cr, penOpt);
    const hy = pz ? pz.c.y : sc.vp.y;
    cl.ink(G.P(plate.x - 10, hy), G.P(plate.x + plate.w + 10, hy), 0.4, 0.16, 0.4, 0.3);
    const edge = () => {
      const e = cr.int(0, 3), t = cr.next();
      return e === 0 ? G.P(plate.x + t * plate.w, plate.y) : e === 1 ? G.P(plate.x + t * plate.w, plate.y + plate.h) : e === 2 ? G.P(plate.x, plate.y + t * plate.h) : G.P(plate.x + plate.w, plate.y + t * plate.h);
    };
    const corners = [G.P(plate.x, plate.y), G.P(plate.x + plate.w, plate.y), G.P(plate.x, plate.y + plate.h), G.P(plate.x + plate.w, plate.y + plate.h)];
    for (const v of pz ? [pz.vpDepth, pz.vpSide] : [sc.vp]) {
      const targets = corners.slice();
      for (let i = 0; i < (pz ? 7 : 10); i++) targets.push(edge());
      for (const q of targets) cl.ink(v, q, 0.35, 0.13, 0.5, 0.4);
    }

    // atmosphere is laid in the picture, so its hatching keeps its true direction
    const tsc = pz ? { ...sc, W: st.W, H: st.H, plate, vp: pz.vpDepth, casts: sc.casts.map(c => ({ ...c, poly: c.poly.map(pz.to) })), shafts: sc.shafts.map(c => ({ ...c, poly: c.poly.map(pz.to) })) } : sc;
    const env = Tone.envField(tsc, rand.fork(3), p.darkness, st.strokes);
    const ep = new Plate.Plate(rand.fork(4), penOpt);
    Tone.hatchField(ep, env, plate, p.density, 5);

    const tail = new Plate.Plate(rand.fork(9), penOpt);
    const fg = Tone.envField(tsc, rand.fork(3), p.darkness, st.strokes, true);
    Tone.hatchField(tail, fg, plate, p.density, 11);
    const uf = Tone.userField(tsc, st.strokes);
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

    const ops = head.concat(cl.ops, body.slice(0, envAt), ep.ops, body.slice(envAt), pz ? [{ t: 'unclip' }] : [], tail.ops);
    return { ops, numeral };
  }

  return { compose, roman };
})();
