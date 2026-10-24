'use strict';
/* A hand-made demo sketch, drawn with deliberately imperfect strokes. */
const Example = (() => {
  const { P } = G;
  function jit(pts, r, a = 1.2) { return pts.map(p => P(p.x + r.range(-a, a), p.y + r.range(-a, a))); }
  function line(a, b, n = 24) { const o = []; for (let i = 0; i <= n; i++) o.push(G.lerp(a, b, i / n)); return o; }
  function steps(x, y, n, w, h) {
    const o = [P(x, y)];
    for (let i = 0; i < n; i++) { y -= h; o.push(P(x, y)); x += w; o.push(P(x, y)); }
    return G.subdivide(o, 5, false);
  }
  function strokes() {
    const r = new Rng.Rand(42);
    const out = [];
    const add = (pts, z = 1, kind) => { const j = jit(pts, r); out.push({ pts: j, z, kind: kind || Interp.classify(j) }); };
    add(line(P(118, 60), P(122, 1000)));
    add(line(P(690, 50), P(686, 1000)));
    add(G.ellipse(415, 800, 150, 340, Math.PI, 0, 40));
    add(line(P(175, 300), P(640, 304)));
    add(steps(176, 988, 6, 24, 20));
    add(Build.sag(P(440, 140), P(660, 150), 70, 30));
    const wav = [];
    for (let i = 0; i <= 30; i++) wav.push(P(530 + Math.sin(i * 0.6) * 8, 318 + i * 5));
    add(wav);
    add(G.subdivide([P(300, 92), P(392, 90), P(394, 186), P(302, 188)], 6, true));
    add(line(P(470, 762), P(568, 652)), 2.2);
    add([P(304, 862), P(305, 864)]);
    add([P(420, 296), P(421, 298)]);
    add([P(468, 756), P(470, 758)]);
    add([P(560, 980), P(561, 982)]);
    out.push({ pts: line(P(60, 70), P(330, 60), 12), z: 1, kind: 'shade', r: 46 });
    out.push({ pts: line(P(760, 380), P(740, 980), 12), z: 1, kind: 'shade', r: 40 });
    return out;
  }
  /* A sparse sketch: lets the imagined hall do most of the work. */
  function minimal() {
    const r = new Rng.Rand(7);
    const out = [];
    const add = (pts, z = 1) => { const j = jit(pts, r); out.push({ pts: j, z, kind: Interp.classify(j) }); };
    add(G.ellipse(400, 560, 230, 380, Math.PI, 0, 40));
    add(steps(470, 988, 7, 26, 22));
    add([P(330, 950), P(331, 951)]);
    return out;
  }
  /* Exercises the curved and varied forms: piers of several heights, a humped bridge, a sweeping stair. */
  function variety() {
    const r = new Rng.Rand(11);
    const out = [];
    const add = (pts, z = 1) => { const j = jit(pts, r, 1); out.push({ pts: j, z, kind: Interp.classify(j) }); };
    add(line(P(105, 60), P(108, 990)));
    add(line(P(700, 60), P(697, 990)));
    add(line(P(250, 560), P(252, 985)));
    add(line(P(585, 470), P(583, 985)));
    add(G.ellipse(415, 330, 230, 34, Math.PI, 0, 40));
    add(Array.from({ length: 31 }, (_, i) => { const t = i / 30; return P(300 + 240 * t, 985 - 360 * t * t); }));
    add(G.ellipse(415, 150, 42, 46, 0, 2 * Math.PI, 40));
    add([P(420, 292), P(421, 293)]);
    add([P(470, 760), P(471, 761)]);
    return out;
  }
  /* Two great pillars: the engine winds stairs around them. */
  function pillars() {
    const r = new Rng.Rand(5);
    const out = [];
    const add = (pts, z = 1) => { const j = jit(pts, r, 1); out.push({ pts: j, z, kind: Interp.classify(j) }); };
    add(line(P(230, 60), P(232, 990)));
    add(line(P(600, 60), P(598, 990)));
    return out;
  }
  return { strokes, minimal, variety, pillars, vp: P(415, 600) };
})();
