import * as THREE from 'three';
import { fadePool } from './light_pool.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from './seed.js';

const TILE = 5; // world size of one texture repeat
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Box with UVs scaled to world size so tiles stay square everywhere
function tiledBox(w, h, d, x, y, z) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * dims[f][0] / TILE, uv.getY(i) * dims[f][1] / TILE);
    }
    g.translate(x, y, z);
    return g;
}
// Vertical plane facing (nx, nz), centred at (x, y, z)
function tiledWall(len, h, x, y, z, nx, nz) {
    const g = new THREE.PlaneGeometry(len, h);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * len / TILE, uv.getY(k) * h / TILE);
    g.rotateY(Math.atan2(nx, nz));
    g.translate(x, y, z);
    return g;
}
function tiledColumn(r, h, x, y0, z) {
    const g = new THREE.CylinderGeometry(r, r, h, 28, 1, true);
    const uv = g.attributes.uv, su = Math.max(4, Math.round(2 * Math.PI * r / TILE)), sv = h / TILE;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
    g.translate(x, y0 + h / 2, z);
    return g;
}
// A thick wall with a round hole through it (tunnel arches)
function ringArch(width, y0, y1, cy, R, t) {
    const s = new THREE.Shape();
    s.moveTo(-width / 2, y0); s.lineTo(width / 2, y0); s.lineTo(width / 2, y1); s.lineTo(-width / 2, y1); s.lineTo(-width / 2, y0);
    const hole = new THREE.Path(); hole.absarc(0, cy, R, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 40 });
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / TILE, uv.getY(k) / TILE);
    g.translate(0, 0, -t / 2);
    return g;
}

const CAUSTIC_GLSL = `
uniform float uTime; uniform float uWaterY; uniform vec3 uPoolTint;
varying vec3 vWPos;
float caustic(vec2 uv, float t){
    vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
    vec2 i = p; float c = 1.0; float inten = 0.005;
    for (int n = 0; n < 4; n++) {
        float tt = t * (1.0 - (3.5 / float(n + 1)));
        i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
        c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
    }
    c /= 4.0; c = 1.17 - pow(c, 1.4);
    return clamp(pow(abs(c), 8.0), 0.0, 2.0);
}`;

export function createPoolRooms({ scene, roomEnv, loadTex, isMobile }, seed, doors = 3) {
    const rand = makeRng(seed, 3);
    const group = new THREE.Group();
    group.visible = false;
    scene.add(group);

    // --- Variation ---
    const cell = rand.pick([16, 18, 20, 22]), N = rand.pick([14, 16, 16, 18]);
    const bottom = -rand.range(4.5, 8), waterY = -0.45, shallowY = -1.5, raisedY = 1.5;
    const half = (N * cell) / 2;
    const tileTint = new THREE.Color(0xf2ecdc).offsetHSL(rand.range(-0.03, 0.03), rand.range(-0.08, 0.06), rand.range(-0.04, 0.02));
    const poolTint = new THREE.Color(0x8fd6c8).offsetHSL(rand.range(-0.04, 0.04), rand.range(-0.1, 0.05), rand.range(-0.05, 0.04));
    const waterTint = new THREE.Color(0x2fb8a6).offsetHSL(rand.range(-0.04, 0.05), rand.range(-0.12, 0.05), rand.range(-0.05, 0.05));
    const fogColor = new THREE.Color(0xd8cdb2).offsetHSL(rand.range(-0.02, 0.02), rand.range(-0.06, 0.04), rand.range(-0.06, 0.02));
    const fogDensity = rand.range(0.0016, 0.0032);

    // --- Layout: rooms joined by corridors ---
    // cell: { room, style, type: 0 dry | 1 deep | 2 shallow | 3 raised, H }
    const grid = Array.from({ length: N }, () => Array(N).fill(null));
    const at = (i, j) => (i >= 0 && j >= 0 && i < N && j < N ? grid[i][j] : null);
    const STYLES = ['hall', 'flooded', 'colonnade', 'terrace'];
    const rooms = [];
    const addRoom = (i0, j0, w, h, style) => {
        const r = { i0, j0, w, h, style, id: rooms.length, H: rand.range(16, 34), axis: rand.int(0, 1),
            colR: rand.range(1.6, style === 'flooded' ? 4.2 : 3), colStep: rand.pick([1, 2, 2]), skyA: rand.int(1, 3), skyB: rand.int(1, 3),
            freq: rand.range(0.6, 1.5), off: rand() * 100, bias: rand.range(-0.2, 0.6) };
        if (style === 'colonnade') r.H = rand.range(22, 36);
        if (style === 'flooded') r.H = rand.range(14, 24);
        rooms.push(r);
        for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + h; j++) grid[i][j] = { room: r.id, style, H: r.H, type: 0 };
        return r;
    };
    const overlaps = (i0, j0, w, h) => rooms.some(r => i0 < r.i0 + r.w + 1 && i0 + w + 1 > r.i0 && j0 < r.j0 + r.h + 1 && j0 + h + 1 > r.j0);
    {
        const w = rand.int(4, 6), h = rand.int(4, 6);
        addRoom(Math.floor(N / 2 - w / 2), Math.floor(N / 2 - h / 2), w, h, rand.pick(STYLES));
    }
    const nRooms = rand.int(3, 6);
    const corridors = [];
    for (let tries = 0; rooms.length < nRooms && tries < 300; tries++) {
        const w = rand.int(3, 7), h = rand.int(3, 7);
        const i0 = rand.int(0, N - w), j0 = rand.int(0, N - h);
        if (overlaps(i0, j0, w, h)) continue;
        const prev = rand.pick(rooms);
        const r = addRoom(i0, j0, w, h, rand.pick(STYLES));
        corridors.push([prev, r]);
    }
    // corridors: L-shaped, 1 cell wide (arched tunnels) or 2 cells wide
    for (const [a, b] of corridors) {
        const wide = rand.chance(0.35);
        const style = wide ? 'gallery' : 'arches';
        const H = wide ? rand.range(14, 20) : rand.range(13, 16);
        const ai = a.i0 + Math.floor(a.w / 2), aj = a.j0 + Math.floor(a.h / 2);
        const bi = b.i0 + Math.floor(b.w / 2), bj = b.j0 + Math.floor(b.h / 2);
        const mark = (i, j) => {
            for (let k = 0; k <= (wide ? 1 : 0); k++) for (let l = 0; l <= (wide ? 1 : 0); l++) {
                const ii = Math.min(N - 1, i + k), jj = Math.min(N - 1, j + l);
                if (!grid[ii][jj]) grid[ii][jj] = { room: -1, style, H, type: 2 };
            }
        };
        const iFirst = rand.chance(0.5);
        if (iFirst) {
            for (let i = Math.min(ai, bi); i <= Math.max(ai, bi); i++) mark(i, aj);
            for (let j = Math.min(aj, bj); j <= Math.max(aj, bj); j++) mark(bi, j);
        } else {
            for (let j = Math.min(aj, bj); j <= Math.max(aj, bj); j++) mark(ai, j);
            for (let i = Math.min(ai, bi); i <= Math.max(ai, bi); i++) mark(i, bj);
        }
    }
    const cx = i => i * cell - half + cell / 2;
    const inside = (i, j) => !!at(i, j);

    // --- Floor types per room style ---
    for (const r of rooms) {
        for (let i = r.i0; i < r.i0 + r.w; i++) for (let j = r.j0; j < r.j0 + r.h; j++) {
            const c = grid[i][j];
            const li = i - r.i0, lj = j - r.j0;
            const n = Math.sin(i * 0.9 * r.freq + r.off) * Math.cos(j * 0.8 * r.freq - r.off * 0.7) + Math.sin((i + j) * 0.45 * r.freq + r.off * 1.3) * 0.6;
            if (r.style === 'hall') c.type = n > r.bias ? 1 : (n < r.bias - 1.1 ? 3 : 0);
            else if (r.style === 'flooded') c.type = n > r.bias + 0.7 ? 1 : 2;
            else if (r.style === 'colonnade') c.type = ((r.axis ? li : lj) === Math.floor((r.axis ? r.w : r.h) / 2)) ? 1 : 2;
            else {   // terrace: a rectangular deep pool ringed by raised decks
                const pi = li > 0 && li < r.w - 1 && lj > 0 && lj < r.h - 1;
                const rim = li === 0 || lj === 0 || li === r.w - 1 || lj === r.h - 1;
                c.type = pi ? 1 : rim && (li + lj) % 3 === 0 ? 3 : 0;
            }
        }
    }
    // the spawn (origin) and its surroundings are always dry
    for (let i = N / 2 - 1; i <= N / 2; i++) for (let j = N / 2 - 1; j <= N / 2; j++) if (grid[i][j]) grid[i][j].type = 0;
    const topOf = c => [0, bottom, shallowY, raisedY][c.type];

    const geoTile = [], geoWater = [], geoMetal = [];
    const solids = [];
    const skylights = [];
    const wallT = 2;
    let maxH = 0;

    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const c = grid[i][j];
        if (!c) continue;
        const x = cx(i), z = cx(j), top = topOf(c), H = c.H;
        maxH = Math.max(maxH, H);
        if (c.type === 1) geoTile.push(tiledBox(cell, 1, cell, x, bottom - 0.5, z));
        else {
            geoTile.push(tiledBox(cell, top - bottom, cell, x, (top + bottom) / 2, z));
            solids.push({ minX: x - cell / 2, maxX: x + cell / 2, minY: bottom, maxY: top, minZ: z - cell / 2, maxZ: z + cell / 2 });
        }
        if (c.type === 1 || c.type === 2) {
            const wg = new THREE.PlaneGeometry(cell, cell); wg.rotateX(-Math.PI / 2); wg.translate(x, waterY, z);
            geoWater.push(wg);
        }
        for (const [di, dj] of DIRS) {
            const n = at(i + di, j + dj);
            const ex = x + di * cell / 2, ez = z + dj * cell / 2;
            if (!n) {
                // outer wall: a visible face + a solid box behind it
                geoTile.push(tiledWall(cell, H - bottom, ex, (H + bottom) / 2, ez, -di, -dj));
                solids.push({ minX: Math.min(ex, ex + di * wallT) - (di ? 0 : cell / 2), maxX: Math.max(ex, ex + di * wallT) + (di ? 0 : cell / 2),
                    minY: bottom, maxY: H + 1, minZ: Math.min(ez, ez + dj * wallT) - (dj ? 0 : cell / 2), maxZ: Math.max(ez, ez + dj * wallT) + (dj ? 0 : cell / 2) });
            } else if (n.H > H + 0.01) {
                // soffit where the neighbour's ceiling is higher
                geoTile.push(tiledWall(cell, n.H - H, ex, (H + n.H) / 2, ez, -di, -dj));
            }
        }
        // ceiling, with skylight shafts in a per-room rhythm
        const r = rooms[c.room];
        const sky = r ? (i % r.skyA === 0 && j % r.skyB === 0) : c.style === 'gallery' ? (i + j) % 3 === 0 : (i + j) % 4 === 0;
        if (sky) {
            const s = cell * (r ? 0.55 : 0.4), rim = (cell - s) / 2;
            geoTile.push(tiledBox(cell, 1, rim, x, H + 0.5, z - cell / 2 + rim / 2));
            geoTile.push(tiledBox(cell, 1, rim, x, H + 0.5, z + cell / 2 - rim / 2));
            geoTile.push(tiledBox(rim, 1, s, x - cell / 2 + rim / 2, H + 0.5, z));
            geoTile.push(tiledBox(rim, 1, s, x + cell / 2 - rim / 2, H + 0.5, z));
            geoTile.push(tiledBox(s, 6, 0.4, x, H + 3, z - s / 2 - 0.2));
            geoTile.push(tiledBox(s, 6, 0.4, x, H + 3, z + s / 2 + 0.2));
            geoTile.push(tiledBox(0.4, 6, s + 0.8, x - s / 2 - 0.2, H + 3, z));
            geoTile.push(tiledBox(0.4, 6, s + 0.8, x + s / 2 + 0.2, H + 3, z));
            skylights.push({ p: new THREE.Vector3(x, H, z), s });
        } else geoTile.push(tiledBox(cell, 1, cell, x, H + 0.5, z));
    }

    // --- Columns (round), fins and arches ---
    const nearSpawn = (x, z) => Math.abs(x) < 12 && Math.abs(z) < 12;
    for (const r of rooms) {
        if (r.style === 'hall' || r.style === 'flooded') {
            for (let i = r.i0 + 1; i < r.i0 + r.w; i++) for (let j = r.j0 + 1; j < r.j0 + r.h; j++) {
                if ((i - r.i0) % r.colStep || (j - r.j0) % r.colStep) continue;
                const x = i * cell - half, z = j * cell - half;
                if (nearSpawn(x, z)) continue;
                const H = Math.min(at(i, j).H, at(i - 1, j - 1).H, at(i - 1, j).H, at(i, j - 1).H);
                geoTile.push(tiledColumn(r.colR, H - bottom, x, bottom, z));
                const k = r.colR * 0.82;
                solids.push({ minX: x - k, maxX: x + k, minY: bottom, maxY: H, minZ: z - k, maxZ: z + k });
            }
        } else if (r.style === 'colonnade') {
            // tall slab fins in rows, like a forest of tiled walls
            const finT = rand.range(1, 2.2), finL = cell * rand.range(0.35, 0.6);
            for (let i = r.i0; i < r.i0 + r.w; i++) for (let j = r.j0; j < r.j0 + r.h; j++) {
                const c = grid[i][j];
                if (c.type === 1) continue;
                const x = cx(i), z = cx(j);
                if (nearSpawn(x, z)) continue;
                const fx = r.axis ? x : x - cell / 2, fz = r.axis ? z - cell / 2 : z;
                if ((r.axis ? j === r.j0 : i === r.i0)) continue;
                const w = r.axis ? finL : finT, d = r.axis ? finT : finL;
                geoTile.push(tiledBox(w, c.H - bottom, d, fx, (c.H + bottom) / 2, fz));
                solids.push({ minX: fx - w / 2, maxX: fx + w / 2, minY: bottom, maxY: c.H, minZ: fz - d / 2, maxZ: fz + d / 2 });
            }
        } else if (r.style === 'terrace') {
            // square pillars at the pool's corners
            const pw = rand.range(2.5, 4.5);
            for (const [i, j] of [[r.i0 + 1, r.j0 + 1], [r.i0 + r.w - 1, r.j0 + 1], [r.i0 + 1, r.j0 + r.h - 1], [r.i0 + r.w - 1, r.j0 + r.h - 1]]) {
                const x = i * cell - half, z = j * cell - half;
                if (nearSpawn(x, z)) continue;
                const H = grid[i][j].H;
                geoTile.push(tiledBox(pw, H - bottom, pw, x, (H + bottom) / 2, z));
                solids.push({ minX: x - pw / 2, maxX: x + pw / 2, minY: bottom, maxY: H, minZ: z - pw / 2, maxZ: z + pw / 2 });
            }
        }
    }
    // Arched tunnels through 1-wide corridors
    const archT = 1.6;
    const addArch = (x, z, alongX, H) => {
        const R = cell * 0.42, cy = shallowY + R * 0.3;
        const g = ringArch(cell, Math.min(bottom, cy - R - 1), H, cy, R, archT);
        if (alongX) g.rotateY(Math.PI / 2);
        g.translate(x, 0, z);
        geoTile.push(g);
        const k = R * 0.85, t = archT / 2;
        if (alongX) {
            solids.push({ minX: x - t, maxX: x + t, minY: bottom, maxY: H, minZ: z - cell / 2, maxZ: z - k });
            solids.push({ minX: x - t, maxX: x + t, minY: bottom, maxY: H, minZ: z + k, maxZ: z + cell / 2 });
            solids.push({ minX: x - t, maxX: x + t, minY: cy + k, maxY: H, minZ: z - cell / 2, maxZ: z + cell / 2 });
        } else {
            solids.push({ minX: x - cell / 2, maxX: x - k, minY: bottom, maxY: H, minZ: z - t, maxZ: z + t });
            solids.push({ minX: x + k, maxX: x + cell / 2, minY: bottom, maxY: H, minZ: z - t, maxZ: z + t });
            solids.push({ minX: x - cell / 2, maxX: x + cell / 2, minY: cy + k, maxY: H, minZ: z - t, maxZ: z + t });
        }
    };
    const tunnelX = (i, j) => { const c = at(i, j); return c && c.style === 'arches' && !inside(i, j - 1) && !inside(i, j + 1) && inside(i - 1, j) && inside(i + 1, j); };
    const tunnelZ = (i, j) => { const c = at(i, j); return c && c.style === 'arches' && !inside(i - 1, j) && !inside(i + 1, j) && inside(i, j - 1) && inside(i, j + 1); };
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const H = grid[i][j]?.H;
        if (tunnelX(i, j)) { addArch(cx(i), cx(j), true, H); if (tunnelX(i + 1, j)) addArch(cx(i) + cell / 2, cx(j), true, H); }
        if (tunnelZ(i, j)) { addArch(cx(i), cx(j), false, H); if (tunnelZ(i, j + 1)) addArch(cx(i), cx(j) + cell / 2, false, H); }
    }

    // Steps out of deep pools: one staircase per connected pool, against a dry edge
    const depth = -bottom, jumpH = 14 * 14 / (2 * 45);
    const isDeep = (i, j) => at(i, j)?.type === 1;
    const seen = new Set();
    const edgesAll = [];
    for (let i0 = 0; i0 < N; i0++) for (let j0 = 0; j0 < N; j0++) {
        if (!isDeep(i0, j0) || seen.has(i0 * N + j0)) continue;
        const edges = [], stack = [[i0, j0]]; seen.add(i0 * N + j0);
        while (stack.length) {
            const [i, j] = stack.pop();
            for (const [di, dj] of DIRS) {
                const a = i + di, b = j + dj;
                if (isDeep(a, b)) { if (!seen.has(a * N + b)) { seen.add(a * N + b); stack.push([a, b]); } }
                else if (at(a, b) && at(a, b).type !== 1) edges.push([i, j, di, dj, topOf(at(a, b))]);
            }
        }
        edgesAll.push(...edges);
        if (!edges.length || depth + Math.max(...edges.map(e => e[4])) <= jumpH + 7 * 0.55 - 0.5) continue;
        const dryish = edges.filter(e => e[4] <= 0.01);
        const [i, j, di, dj, tgt] = rand.pick(dryish.length ? dryish : edges);
        const rise0 = tgt - bottom, n = Math.ceil(rise0 / 1.1), rise = rise0 / n, tread = Math.min(2.4, (cell - 2) / (n - 1)), sw = cell * 0.45;
        const wx = cx(i) + di * cell / 2, wz = cx(j) + dj * cell / 2;
        for (let k = 0; k < n - 1; k++) {
            const top = bottom + (k + 1) * rise, run = (n - 1 - k) * tread;
            const mx = wx - di * run / 2, mz = wz - dj * run / 2;
            const bw = di ? run : sw, bd = di ? sw : run;
            geoTile.push(tiledBox(bw, rise, bd, mx, top - rise / 2, mz));
            solids.push({ minX: mx - bw / 2, maxX: mx + bw / 2, minY: bottom, maxY: top, minZ: mz - bd / 2, maxZ: mz + bd / 2 });
        }
    }
    // Stainless pool ladders on some deep edges
    const ladderSpots = edgesAll.filter(e => Math.abs(e[4]) < 0.01 && rand.chance(0.25)).slice(0, 10);
    for (const [i, j, di, dj] of ladderSpots) {
        const along = rand.range(-cell * 0.3, cell * 0.3);
        const wx = cx(i) + di * cell / 2, wz = cx(j) + dj * cell / 2;
        const px = -di, pz = -dj;        // pointing into the pool
        const tx = dj ? 1 : 0, tz = di ? 1 : 0;   // along the edge
        for (const side of [-0.85, 0.85]) {
            const o = along + side;
            const P = (d, y) => new THREE.Vector3(wx + px * d + tx * o, y, wz + pz * d + tz * o);
            const curve = new THREE.CatmullRomCurve3([P(0.55, waterY - 2.6), P(0.55, 0.4), P(0.35, 1.7), P(-0.35, 1.8), P(-0.8, 1.0), P(-0.9, 0)]);
            geoMetal.push(new THREE.TubeGeometry(curve, 24, 0.09, 8, false));
        }
        for (const y of [waterY - 0.8, waterY - 2.1]) {
            const g = new THREE.BoxGeometry(tx ? 1.7 : 0.35, 0.08, tz ? 1.7 : 0.35);
            g.translate(wx + px * 0.45 + tx * along, y, wz + pz * 0.45 + tz * along);
            geoMetal.push(g);
        }
    }

    // Doorways: tiled partitions on dry floor
    const spots = [];
    for (let tries = 0; spots.length < doors && tries < 1500; tries++) {
        const i = rand.int(0, N - 1), j = rand.int(0, N - 1), c = at(i, j);
        if (!c || c.type !== 0 || c.room < 0) continue;
        const x = cx(i), z = cx(j);
        if (Math.hypot(x, z) < cell * 1.5) continue;
        if (spots.some(o => Math.hypot(o[0] - x, o[1] - z) < cell * (tries < 900 ? 3 : 1.5))) continue;
        const dir = rand.int(0, 3), [di, dj] = [[0, 1], [0, -1], [1, 0], [-1, 0]][dir];
        const nb = at(i + di, j + dj);
        if (!nb || nb.type !== 0) continue;
        spots.push([x, z, dir, c.H]);
    }
    const H0 = grid[N / 2][N / 2].H;
    for (const [x, z, dir] of [[0, -cell, 1], [-cell, 0, 3], [cell, 0, 2], [0, cell, 0], [-cell, -cell, 1]]) if (spots.length < doors) spots.push([x, z, dir, H0]);
    const portals = [];
    const pLen = cell * 0.8, pT = 1;
    for (const [x, z, dir, H] of spots) {
        const alongX = dir < 2;
        const w = alongX ? pLen : pT, d = alongX ? pT : pLen;
        geoTile.push(tiledBox(w, H - bottom, d, x, (H + bottom) / 2, z));
        solids.push({ minX: x - w / 2, maxX: x + w / 2, minY: 0, maxY: H, minZ: z - d / 2, maxZ: z + d / 2 });
        const yaw = [0, Math.PI, Math.PI / 2, -Math.PI / 2][dir];
        const n = [[0, 1], [0, -1], [1, 0], [-1, 0]][dir];
        portals.push({ pos: new THREE.Vector3(x + n[0] * pT / 2, 0, z + n[1] * pT / 2), yaw, w: 5.25, h: 9.1, kind: 'wall', frameColor: 0xf4efe2 });
    }

    // --- Materials ---
    const tileTex = loadTex('asset_pool_tile.png');
    const waterTex = loadTex('asset_water_surface.png', 1, 1, false);
    const causticUniforms = { uTime: { value: 0 }, uWaterY: { value: waterY }, uPoolTint: { value: poolTint } };
    const matTile = new THREE.MeshStandardMaterial({ map: tileTex, color: tileTint, roughness: 0.22, metalness: 0, envMapIntensity: 0.3, side: THREE.FrontSide, shadowSide: THREE.DoubleSide });
    matTile.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, causticUniforms);
        sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <worldpos_vertex>',
            '#include <worldpos_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = CAUSTIC_GLSL + '\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
             float under = step(vWPos.y, uWaterY);
             float cst = caustic(vWPos.xz * 0.045 + vec2(vWPos.y * 0.02), uTime * 0.5) * under;
             diffuseColor.rgb *= mix(vec3(1.0), uPoolTint, under);
             totalEmissiveRadiance += vec3(0.75, 0.92, 0.8) * cst * 0.28;`);
    };
    const matWater = new THREE.MeshStandardMaterial({
        color: waterTint, transparent: true, opacity: 0.55, roughness: 0.04, metalness: 0.1,
        bumpMap: waterTex, bumpScale: 0.6, envMapIntensity: 0.8, depthWrite: false
    });
    const matMetal = new THREE.MeshStandardMaterial({ color: 0xdcdcd6, roughness: 0.18, metalness: 1, envMapIntensity: 1 });
    const matSkylight = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.9, 2.6, 2.1), fog: false });

    const mk = (geos, mat, cast = true) => {
        const mesh = new THREE.Mesh(mergeGeometries(geos.map(g => g.index ? g.toNonIndexed() : g)), mat);
        mesh.castShadow = cast; mesh.receiveShadow = true;
        group.add(mesh);
        return mesh;
    };
    geoTile.forEach(g => { if (g.attributes.uv1) g.deleteAttribute('uv1'); });
    mk(geoTile, matTile);
    if (geoMetal.length) mk(geoMetal, matMetal, false);
    let water = null;
    if (geoWater.length) { water = mk(geoWater, matWater, false); water.renderOrder = 2; water.receiveShadow = false; }

    const skyMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2), matSkylight, Math.max(1, skylights.length));
    skyMesh.count = skylights.length;
    skylights.forEach((k, n) => skyMesh.setMatrixAt(n, new THREE.Matrix4().makeTranslation(k.p.x, k.p.y + 5.8, k.p.z).scale(new THREE.Vector3(k.s, 1, k.s))));
    group.add(skyMesh);

    // --- Lighting: warm daylight falling through the skylights ---
    const hemi = new THREE.HemisphereLight(0xfff1dc, 0x7f9c8c, 0.65);
    group.add(hemi);
    const sun = new THREE.DirectionalLight(0xffdcaa, 3.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 260 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.3;
    group.add(sun, sun.target);
    const sa = rand() * Math.PI * 2, tilt = rand.range(0.35, 0.8);
    const sunDir = new THREE.Vector3(Math.cos(sa) * tilt, 1, Math.sin(sa) * tilt).normalize();
    const pool = [];
    for (let k = 0; k < (isMobile ? 5 : 12); k++) {
        const l = new THREE.PointLight(0xffe4c0, 10, 50, 1.4);
        group.add(l); pool.push(l);
    }

    const EYE = 7;
    let lastCell = '';
    const cellAt = (x, z) => at(Math.floor((x + half) / cell), Math.floor((z + half) / cell));

    return {
        group,
        portals,
        name: 'Poolrooms',
        fog: new THREE.FogExp2(fogColor, fogDensity),
        background: fogColor.clone(),
        environment: roomEnv,
        darken: () => { causticUniforms.uWaterY.value = -1e9; },
        exposure: 0.75,
        bloom: 0.5, bloomThreshold: 0.92,
        spawn: new THREE.Vector3(0, 0, 4),
        eye: EYE, speed: 18, gravity: 45, jump: 14, stride: 5.5, ceiling: maxH,
        stepType: (p) => (p.y < waterY ? 'water' : 'tile'),
        waterLevel: waterY,
        ground: (x, z) => { const c = cellAt(x, z); return c ? topOf(c) : 0; },
        colliders: solids,
        bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half },
        update: (pos, t) => {
            causticUniforms.uTime.value = t;
            waterTex.offset.set(t * 0.012, t * 0.008);
            const c = Math.floor(pos.x / cell) + ',' + Math.floor(pos.z / cell);
            if (c !== lastCell) {
                lastCell = c;
                skylights.sort((a, b) => a.p.distanceToSquared(pos) - b.p.distanceToSquared(pos));
                pool.forEach((l, k) => { const s = skylights[k]; if (s) l.position.set(s.p.x, s.p.y - 2, s.p.z); l.userData.base = s ? 10 : 0; });
                const sx = Math.round(pos.x / 10) * 10, sz = Math.round(pos.z / 10) * 10;
                sun.target.position.set(sx, 0, sz);
                sun.position.set(sx, 0, sz).addScaledVector(sunDir, maxH + 60);
            }
            fadePool(pool, pos, skylights.length <= pool.length);
        },
        setVisible: (v) => { group.visible = v; },
    };
}
