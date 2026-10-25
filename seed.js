// Seeded randomness shared by every world, so a (world, seed) pair always builds
// the same variation.
export function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// 32-bit integer hash (lowbias32)
export function hash32(x) {
    x = (x >>> 0) ^ (x >>> 16); x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
}

/** A seeded generator with a few helpers. salt keeps independent streams apart. */
export function makeRng(seed, salt = 0) {
    const r = mulberry32(hash32((seed >>> 0) ^ hash32(salt + 0x9e3779b9)));
    r.range = (a, b) => a + r() * (b - a);
    r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.chance = (p) => r() < p;
    return r;
}

export const randomSeed = () => (Math.random() * 4294967296) >>> 0;
export const seedLabel = (s) => (s >>> 0).toString(16).toUpperCase().padStart(8, '0');
