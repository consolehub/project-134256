// Kinematic player controller: axis-separated sweep against axis-aligned boxes,
// with step-up limit, ledge mantling, ground snapping and ceiling hits.
// Box = { minX, maxX, minY, maxY, minZ, maxZ }

const CELL = 12;

export class Physics {
    constructor() { this.setWorld(null); }

    setWorld(w) {
        this.world = w;
        this.grid = new Map();
        this.big = null;
        if (!w) return;
        // the broadphase is static per world: build it once and reuse it
        if (w._grid) { this.grid = w._grid; this.big = w._big; return; }
        for (const b of (w.colliders || [])) {
            const i0 = Math.floor(b.minX / CELL), i1 = Math.floor(b.maxX / CELL);
            const j0 = Math.floor(b.minZ / CELL), j1 = Math.floor(b.maxZ / CELL);
            // huge boxes (outer walls) go into a shared list instead of thousands of cells
            if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) { (this.big ||= []).push(b); continue; }
            for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
                const k = i * 73856093 ^ j * 19349663;
                let list = this.grid.get(k);
                if (!list) this.grid.set(k, list = []);
                list.push(b);
            }
        }
        w._grid = this.grid; w._big = this.big;
    }

    // boxes whose XZ footprint might touch the given rectangle
    query(minX, maxX, minZ, maxZ) {
        const out = new Set(this.big || []);
        for (let i = Math.floor(minX / CELL); i <= Math.floor(maxX / CELL); i++)
            for (let j = Math.floor(minZ / CELL); j <= Math.floor(maxZ / CELL); j++) {
                const list = this.grid.get(i * 73856093 ^ j * 19349663);
                if (list) for (const b of list) out.add(b);
            }
        return out;
    }

    ground(x, z) { return this.world.ground ? this.world.ground(x, z) : 0; }

    // Highest walkable surface under the player's footprint that is not above maxTop
    supportAt(p, r, maxTop) {
        let g = Math.max(this.ground(p.x, p.z), this.world.supportAt?.(p, r, maxTop) ?? -Infinity);
        const rr = r * 0.7;
        for (const b of this.query(p.x - rr, p.x + rr, p.z - rr, p.z + rr)) {
            if (p.x + rr <= b.minX || p.x - rr >= b.maxX || p.z + rr <= b.minZ || p.z - rr >= b.maxZ) continue;
            if (b.maxY <= maxTop && b.maxY > g) g = b.maxY;
        }
        return g;
    }

    /**
     * p: player feet position (Vector3, mutated), v: velocity (mutated)
     * state: { grounded }, returns { stepUp } (height climbed this frame, for camera smoothing)
     */
    move(p, v, state, dt, opts) {
        const { radius: r, height: h, stepHeight: step, mantleHeight: mantle } = opts;
        let stepUp = 0;

        // --- horizontal, one axis at a time so we slide along walls ---
        for (const axis of ['x', 'z']) {
            const d = v[axis] * dt;
            if (d === 0) continue;
            p[axis] += d;
            const boxes = this.query(p.x - r, p.x + r, p.z - r, p.z + r);
            for (const b of boxes) {
                if (p.x + r <= b.minX || p.x - r >= b.maxX || p.z + r <= b.minZ || p.z - r >= b.maxZ) continue;
                if (b.maxY <= p.y + 0.001 || b.minY >= p.y + h) continue;     // fully below feet / above head
                const rise = b.maxY - p.y;
                const canStep = state.grounded && rise <= step && !b.noStep;   // noStep: railings you must jump onto
                const canMantle = !state.grounded && rise <= mantle && v.y > -25 && this.headroom(p, b.maxY, r, h);
                if ((canStep || canMantle) && this.headroom(p, b.maxY, r, h)) {
                    p.y = b.maxY; stepUp += rise;
                    if (canMantle) { v.y = Math.max(v.y, 0); }
                    continue;
                }
                // Only resolve along this axis if this axis' motion caused the overlap. If we were
                // already inside the box on this axis, pushing to its "far" face would teleport us
                // across the whole box (e.g. sideways off a stair flight).
                const lo = axis === 'x' ? b.minX : b.minZ, hi = axis === 'x' ? b.maxX : b.maxZ;
                const prev = p[axis] - d;
                if (prev + r > lo && prev - r < hi) {
                    // already embedded: climb onto it if it's low, else take the shortest way out
                    if (rise <= mantle && !b.noStep && this.headroom(p, b.maxY, r, h)) { p.y = b.maxY; stepUp += rise; continue; }
                    const pen = [[p.x + r - b.minX, 'x', b.minX - r], [b.maxX - (p.x - r), 'x', b.maxX + r],
                                 [p.z + r - b.minZ, 'z', b.minZ - r], [b.maxZ - (p.z - r), 'z', b.maxZ + r]];
                    pen.sort((a, c) => a[0] - c[0]);
                    p[pen[0][1]] = pen[0][2];
                    continue;
                }
                // push back out along this axis
                p[axis] = d > 0 ? lo - r : hi + r;
                v[axis] = 0;
            }
        }

        // --- vertical ---
        const prevY = p.y;
        v.y -= opts.gravity * dt;
        p.y += v.y * dt;

        // ceiling
        if (v.y > 0) {
            for (const b of this.query(p.x - r, p.x + r, p.z - r, p.z + r)) {
                if (p.x + r <= b.minX || p.x - r >= b.maxX || p.z + r <= b.minZ || p.z - r >= b.maxZ) continue;
                if (b.minY >= prevY + h - 0.001 && p.y + h > b.minY) { p.y = b.minY - h; v.y = 0; }
            }
            if (opts.ceiling !== undefined && p.y + h > opts.ceiling) { p.y = opts.ceiling - h; v.y = 0; }
        }

        // floor: anything we were above last frame (or can step onto)
        const floor = this.supportAt(p, r, Math.max(prevY, p.y) + 0.001);
        if (p.y <= floor) {
            p.y = floor; v.y = Math.max(v.y, 0); state.grounded = true;
        } else if (state.grounded && v.y <= 0 && prevY - floor <= step + 0.05) {
            // stick to the ground when walking down steps
            p.y = floor; v.y = 0;
        } else {
            state.grounded = false;
        }

        if (opts.bounds) {
            const B = opts.bounds;
            p.x = Math.max(B.minX + r, Math.min(B.maxX - r, p.x));
            p.z = Math.max(B.minZ + r, Math.min(B.maxZ - r, p.z));
        }
        return { stepUp };
    }

    // is there room to stand on top of a surface at height y?
    headroom(p, y, r, h) {
        for (const b of this.query(p.x - r, p.x + r, p.z - r, p.z + r)) {
            if (p.x + r <= b.minX || p.x - r >= b.maxX || p.z + r <= b.minZ || p.z - r >= b.maxZ) continue;
            if (b.minY < y + h && b.maxY > y + 0.001) return false;
        }
        return true;
    }
}
