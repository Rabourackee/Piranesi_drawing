'use strict';
/* Seeded randomness + value noise. Every etching is fully reproducible from its seed. */
const Rng = (() => {
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  class Rand {
    constructor(seed) { this.seed = seed >>> 0; this.f = mulberry32(this.seed); }
    next() { return this.f(); }
    range(a, b) { return a + (b - a) * this.f(); }
    int(a, b) { return a + Math.floor(this.f() * (b - a + 1)); }
    chance(p) { return this.f() < p; }
    pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
    sign() { return this.f() < 0.5 ? -1 : 1; }
    fork(salt) {
      return new Rand((Math.imul(this.seed ^ 0x5bd1e995, 31) + Math.imul((salt | 0) + 7, 0x9E3779B1)) >>> 0);
    }
  }
  function hash(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((s | 0) + 1013, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function noise2(x, y, s = 0) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const noise1 = (x, s = 0) => noise2(x, 0.37, s);
  function fbm(x, y, s = 0, oct = 4) {
    let amp = 0.5, fr = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += amp * noise2(x * fr, y * fr, s + i * 17); norm += amp; amp *= 0.5; fr *= 2; }
    return sum / norm;
  }
  return { Rand, hash, noise1, noise2, fbm };
})();
