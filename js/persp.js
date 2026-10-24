'use strict';
/*
 * Two-point perspective as a turned camera. A one-point picture with its centre of vision at
 * c becomes a two-point picture when the camera turns about its vertical axis (yaw): vertical
 * lines stay vertical, lines across the hall run to a far vanishing point on one side, and the
 * depth of the hall runs to a second one on the other side. The turn is a plane homography,
 * so straight lines stay straight; the prison is built in the one-point space and every mark
 * is carried over.
 *
 *   to(p)    one-point space -> the two-point picture
 *   from(q)  the two-point picture -> one-point space
 */
const Persp = (() => {
  const { P } = G;
  const F = 820, YAW = 0.5;

  function make(c, f = F, yaw = YAW) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const to = p => {
      const dx = p.x - c.x, dy = p.y - c.y;
      const X = dx * cs + f * sn, Z = Math.max(20, -dx * sn + f * cs);
      return P(c.x + (f * X) / Z, c.y + (f * dy) / Z);
    };
    const from = q => {
      const dx = q.x - c.x, dy = q.y - c.y;
      const X = dx * cs - f * sn, Z = Math.max(20, dx * sn + f * cs);
      return P(c.x + (f * X) / Z, c.y + (f * dy) / Z);
    };
    // where the depth of the hall and the lines across it vanish, on the horizon through c
    return { c, to, from, vpDepth: P(c.x + f * Math.tan(yaw), c.y), vpSide: P(c.x - f / Math.tan(yaw), c.y) };
  }

  /* The same op list, every point carried through fn (new arrays; shared points are not mutated). */
  function mapOps(ops, fn) {
    const m = pts => pts.map(fn);
    return ops.map(o => {
      switch (o.t) {
        case 'line': return { ...o, pts: m(o.pts) };
        case 'lines': return { ...o, segs: o.segs.map(m) };
        case 'fill': case 'clip': return { ...o, rings: o.rings.map(m) };
        case 'text': { const q = fn(P(o.x, o.y)); return { ...o, x: q.x, y: q.y }; }
      }
      return o;
    });
  }

  return { make, mapOps, F, YAW };
})();
