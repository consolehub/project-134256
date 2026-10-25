// Levels light only the fixtures nearest the player with a small pool of real lights, re-assigned
// as you move. Fading each pooled light by its distance (the farthest ones are dim) makes those
// re-assignments invisible, so lights never pop on or off as you walk.
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** pool: the pooled lights; set a light's userData.base (not intensity) to change its brightness.
 *  all: every fixture already has a light (nothing is ever re-assigned): no fade needed. */
export function fadePool(pool, pos, all = false) {
    let R = 0;
    for (const l of pool) {
        if (l.userData.base === undefined) l.userData.base = l.intensity;
        if (l.visible && l.userData.base > 0) R = Math.max(R, l.position.distanceTo(pos));
    }
    for (const l of pool) {
        const base = l.userData.base;
        l.intensity = all || R === 0 ? base : base * (1 - smooth(R * 0.5, R, l.position.distanceTo(pos)));
    }
}
