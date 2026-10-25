import * as THREE from 'three';
import { makeRng } from './seed.js';

// --------------------------------------------------------------------------
// The Basement: an empty, slightly dated finished basement. Beige carpet, off-white
// (or wood-panelled) walls, a carpeted stair going up into the dark, a laundry room
// glowing under a fluorescent tube. Rooms are laid out by splitting the footprint;
// lighting and wall finish vary per seed.
// --------------------------------------------------------------------------

function boxGeo(sx, sy, sz, unit) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    const uv = g.attributes.uv;
    const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
    for (let i = 0; i < uv.count; i++) {
        const [a, b] = dims[Math.floor(i / 4)];
        uv.setXY(i, uv.getX(i) * a / unit, uv.getY(i) * b / unit);
    }
    return g;
}

let louverTex = null;
function getLouverTex() {
    if (louverTex) return louverTex;
    const c = document.createElement('canvas'); c.width = 64; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#f2efe6'; g.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 256; y += 10) {
        const gr = g.createLinearGradient(0, y, 0, y + 10);
        gr.addColorStop(0, '#fbf9f2'); gr.addColorStop(0.7, '#d9d4c6'); gr.addColorStop(1, '#a9a394');
        g.fillStyle = gr; g.fillRect(6, y, 52, 10);
    }
    louverTex = new THREE.CanvasTexture(c);
    louverTex.colorSpace = THREE.SRGBColorSpace;
    return louverTex;
}

export function createHouse({ scene, roomEnv, loadTex }, seed, doors = 2) {
    const group = new THREE.Group();
    group.visible = false;
    scene.add(group);
    const rand = makeRng(seed, 12);

    // --- Variation ---
    const H = rand.range(10.5, 12);
    const W = rand.range(52, 88), DP = rand.range(46, 74);
    const X0 = -W / 2, X1 = W / 2, Z0 = -DP / 2, Z1 = DP / 2;
    const T = 0.5, MIN = 14;
    const lighting = rand.pick(['evening', 'evening', 'bright', 'dusk', 'single']);
    const panel = rand.chance(0.3);
    const doorW = 5.25, doorH = 9.1;

    // --- Materials ---
    const paint = new THREE.Color(rand.pick([0xe9e4d6, 0xe6dcc4, 0xe4dcbc, 0xdcd8cc]));
    const matWall = panel
        ? new THREE.MeshStandardMaterial({ map: loadTex('asset_house_paneling.jpg', 1, 1, true, 'house'), color: 0xc8b8a4, roughness: 0.55, envMapIntensity: 0.4 })
        : new THREE.MeshStandardMaterial({ color: paint, roughness: 0.92, envMapIntensity: 0.25 });
    // painted woodwork: kept a touch below the wall paint and mostly matte, so it never blows out white under a nearby fixture
    const matTrim = new THREE.MeshStandardMaterial({ color: panel ? 0x4a2f1e : 0xd8d3c6, roughness: 0.75, envMapIntensity: 0.3 });
    const matCeil = new THREE.MeshStandardMaterial({ color: 0xe8e5dc, roughness: 1, envMapIntensity: 0.2 });
    const matCarpet = new THREE.MeshStandardMaterial({ map: loadTex('asset_house_carpet.jpg', 1, 1, true, 'house'), color: 0xe4dccb, roughness: 1, envMapIntensity: 0.15 });
    const matVinyl = new THREE.MeshStandardMaterial({ map: loadTex('asset_house_vinyl.jpg', 1, 1, true, 'house'), color: 0xf0ece0, roughness: 0.35, envMapIntensity: 0.6 });
    const matConcrete = new THREE.MeshStandardMaterial({ color: 0x8f8c85, roughness: 0.95 });
    const matDoor = new THREE.MeshStandardMaterial({ color: 0xd6d0c2, roughness: 0.75, envMapIntensity: 0.3 });
    const matLouver = new THREE.MeshStandardMaterial({ map: getLouverTex(), color: 0xdcd7ca, roughness: 0.75, envMapIntensity: 0.3 });
    const matOak = new THREE.MeshStandardMaterial({ color: 0xb98243, roughness: 0.45 });
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xf1f1ec, roughness: 0.3, envMapIntensity: 0.6 });
    const matDark = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.25, metalness: 0.2 });
    const matBrass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.3, metalness: 0.9 });
    const matBox = new THREE.MeshStandardMaterial({ color: 0xa57a4c, roughness: 0.9 });
    const matHeater = new THREE.MeshStandardMaterial({ color: 0xd2cfc4, roughness: 0.5, metalness: 0.2 });
    const matRug = new THREE.MeshStandardMaterial({ color: 0x6a5b48, roughness: 1 });
    const matMirror = new THREE.MeshStandardMaterial({ color: 0x222628, roughness: 0.02, metalness: 1, envMapIntensity: 1 });

    const colliders = [];
    const addBox = (minX, maxX, minY, maxY, minZ, maxZ, mat, collide = true, unit = 8) => {
        const m = new THREE.Mesh(boxGeo(maxX - minX, maxY - minY, maxZ - minZ, unit), mat);
        m.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
        m.castShadow = m.receiveShadow = true;
        group.add(m);
        if (collide) colliders.push({ minX, maxX, minY, maxY, minZ, maxZ });
        return m;
    };
    // box in a wall-facing frame: centre (cx, cz), facing inward (ix, iz), w along the wall, d out of it
    const addLocal = (cx, cz, ix, iz, w, h, d, y0, mat, collide = true) => {
        const ax = Math.abs(ix) > 0.5;           // facing along x: depth is along x
        const hx = (ax ? d : w) / 2, hz = (ax ? w : d) / 2;
        return addBox(cx - hx, cx + hx, y0, y0 + h, cz - hz, cz + hz, mat, collide);
    };

    // --- Layout: split the footprint into rooms ---
    const leaves = [], splits = [];
    function split(r, depth) {
        const w = r.x1 - r.x0, d = r.z1 - r.z0;
        const canX = w >= 2 * MIN, canZ = d >= 2 * MIN;
        if ((!canX && !canZ) || depth >= 3 || (depth >= 1 && rand.chance(0.22))) { leaves.push(r); return; }
        const byX = canX && (!canZ || rand.chance(w / (w + d)));
        const len = byX ? w : d, lo = byX ? r.x0 : r.z0;
        // the first cut leaves one big room (the main space)
        let f = depth === 0 ? rand.range(0.55, 0.66) : rand.range(0.35, 0.65);
        if (depth === 0 && rand.chance(0.5)) f = 1 - f;
        const s = Math.max(lo + MIN, Math.min(lo + len - MIN, lo + len * f));
        splits.push(byX ? { axis: 'x', at: s, a: r.z0, b: r.z1 } : { axis: 'z', at: s, a: r.x0, b: r.x1 });
        const A = byX ? { ...r, x1: s } : { ...r, z1: s }, B = byX ? { ...r, x0: s } : { ...r, z0: s };
        if (depth === 0) {
            const bigA = f > 0.5;
            const big = bigA ? A : B, small = bigA ? B : A;
            if (rand.chance(0.7)) leaves.push(big); else split(big, 1);
            split(small, 1);
        } else { split(A, depth + 1); split(B, depth + 1); }
    }
    split({ x0: X0, x1: X1, z0: Z0, z1: Z1 }, 0);
    leaves.forEach(l => { l.area = (l.x1 - l.x0) * (l.z1 - l.z0); });
    const byArea = [...leaves].sort((a, b) => b.area - a.area);
    const main = byArea[0];
    main.type = 'main';
    const pool = ['laundry', 'bedroom', 'storage', 'bedroom', 'bath', 'storage'];
    let hasLaundry = false;
    for (const l of byArea.slice(1)) {
        if (!hasLaundry && rand.chance(0.75)) { l.type = 'laundry'; hasLaundry = true; continue; }
        l.type = l.area < 330 ? rand.pick(['bath', 'storage']) : rand.pick(pool);
        if (l.type === 'laundry') hasLaundry = true;
    }

    // --- Wall lines ---
    const lines = new Map();
    const key = (axis, at) => axis + ':' + at.toFixed(3);
    const mkLine = (axis, at, a, b, boundary, out) => {
        const L = { axis, at, a, b, boundary, out, openings: [], used: [] };
        lines.set(key(axis, at) + (boundary ? 'B' : ''), L);
        return L;
    };
    const outer = [mkLine('x', X0, Z0, Z1, true, -1), mkLine('x', X1, Z0, Z1, true, 1), mkLine('z', Z0, X0, X1, true, -1), mkLine('z', Z1, X0, X1, true, 1)];
    const inner = splits.map(s => mkLine(s.axis, s.at, s.a, s.b, false, 0));
    const lineFor = (axis, at) => lines.get(key(axis, at) + 'B') ?? lines.get(key(axis, at));
    const free = (L, lo, hi) => lo >= L.a && hi <= L.b && !L.used.some(([u0, u1]) => hi > u0 && lo < u1);
    const reserve = (L, lo, hi) => L.used.push([lo, hi]);
    // perpendicular walls meeting a line
    for (const L of [...outer, ...inner]) {
        for (const s of splits) {
            if (s.axis === L.axis) continue;
            if ((Math.abs(s.a - L.at) < 1e-6 || Math.abs(s.b - L.at) < 1e-6) && s.at > L.a && s.at < L.b) reserve(L, s.at - 1.5, s.at + 1.5);
        }
    }
    // a doorway or open archway in every dividing wall
    for (const L of inner) {
        const arch = rand.chance(0.35);
        let w = arch ? rand.range(8, 14) : doorW;
        let placed = false;
        for (let tries = 0; tries < 40 && !placed; tries++) {
            if (tries === 20) w = doorW;
            const c = rand.range(L.a + w / 2 + 1, L.b - w / 2 - 1);
            if (!free(L, c - w / 2 - 0.6, c + w / 2 + 0.6)) continue;
            reserve(L, c - w / 2 - 0.6, c + w / 2 + 0.6);
            L.openings.push({ c, w, h: w > doorW + 0.1 ? H - rand.range(1.2, 2) : doorH, door: w <= doorW + 0.1 });
            placed = true;
        }
    }

    // --- Stairs going up, out through an outer wall of the main room ---
    const sidesOf = (l) => [
        { axis: 'x', at: l.x0, a: l.z0, b: l.z1, in: [1, 0] }, { axis: 'x', at: l.x1, a: l.z0, b: l.z1, in: [-1, 0] },
        { axis: 'z', at: l.z0, a: l.x0, b: l.x1, in: [0, 1] }, { axis: 'z', at: l.z1, a: l.x0, b: l.x1, in: [0, -1] },
    ].map(s => ({ ...s, line: lineFor(s.axis, s.at) }));
    const pt = (axis, at, s) => axis === 'x' ? [at, s] : [s, at];
    const SW = 5.6, tread = 1.15, rise = 0.72, S = Math.ceil((H - 0.8) / rise), LL = 6.5;
    const top = S * rise, Ltot = S * tread + LL;
    let stair = null;
    for (const l of byArea) {
        const opts = sidesOf(l).filter(s => s.line.boundary && s.b - s.a > SW + 8);
        for (const s of opts.sort(() => rand() - 0.5)) {
            const c = rand.range(s.a + SW / 2 + 3, s.b - SW / 2 - 3);
            if (!free(s.line, c - SW / 2 - 1, c + SW / 2 + 1)) continue;
            reserve(s.line, c - SW / 2 - 1, c + SW / 2 + 1);
            s.line.openings.push({ c, w: SW, h: H, door: false });
            stair = { ...s, c, n: [-s.in[0], -s.in[1]], room: l };
            break;
        }
        if (stair) break;
    }

    // --- Build walls ---
    for (const L of lines.values()) {
        const ops = [...L.openings].sort((p, q) => p.c - q.c);
        // thickness range across the line (outer walls sit just outside the footprint)
        const t0 = L.boundary ? (L.out > 0 ? L.at : L.at - T) : L.at - T / 2;
        const t1 = L.boundary ? (L.out > 0 ? L.at + T : L.at) : L.at + T / 2;
        const a = L.boundary ? L.a - T : L.a, b = L.boundary ? L.b + T : L.b;
        const seg = (s0, s1, y0, y1, mat, grow = 0) => {
            if (s1 - s0 < 0.01) return;
            if (L.axis === 'x') addBox(t0 - grow, t1 + grow, y0, y1, s0, s1, mat, mat === matWall);
            else addBox(s0, s1, y0, y1, t0 - grow, t1 + grow, mat, mat === matWall);
        };
        let s = a;
        for (const o of ops) {
            seg(s, o.c - o.w / 2, 0, H, matWall);
            seg(s, o.c - o.w / 2, 0, 0.5, matTrim, 0.08);
            if (o.h < H) seg(o.c - o.w / 2, o.c + o.w / 2, o.h, H, matWall);
            if (o.door) {
                seg(o.c - o.w / 2 - 0.35, o.c - o.w / 2, 0, o.h + 0.35, matTrim, 0.09);
                seg(o.c + o.w / 2, o.c + o.w / 2 + 0.35, 0, o.h + 0.35, matTrim, 0.09);
                seg(o.c - o.w / 2 - 0.35, o.c + o.w / 2 + 0.35, o.h, o.h + 0.35, matTrim, 0.09);
            }
            s = o.c + o.w / 2;
        }
        seg(s, b, 0, H, matWall);
        seg(s, b, 0, 0.5, matTrim, 0.08);
        // interior doors left standing open against the wall
        for (const o of ops) {
            if (!o.door || L.boundary || !rand.chance(0.6)) continue;
            const side = rand.chance(0.5) ? 1 : -1, hinge = rand.chance(0.5) ? 1 : -1;
            const j = o.c + hinge * (o.w / 2 - 0.1);
            const f0 = L.at + side * T / 2, f1 = f0 + side * (o.w - 0.2);
            const [n0, n1] = [Math.min(f0, f1), Math.max(f0, f1)], [s0, s1] = [Math.min(j, j - hinge * 0.18), Math.max(j, j - hinge * 0.18)];
            if (L.axis === 'x') addBox(n0, n1, 0.05, o.h - 0.1, s0, s1, matDoor); else addBox(s0, s1, 0.05, o.h - 0.1, n0, n1, matDoor);
            const kn = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), matBrass);
            const kd = (f0 + f1) / 2 + side * (o.w * 0.4);
            const [kx, kz] = pt(L.axis, kd, j - hinge * 0.09);
            kn.position.set(kx, 4.3, kz);
            kn.position[L.axis === 'x' ? 'z' : 'x'] += -hinge * 0.2;
            group.add(kn);
        }
    }

    // --- Floors and ceiling ---
    const floorMat = (t) => t === 'laundry' || t === 'bath' ? matVinyl : t === 'storage' ? matConcrete : matCarpet;
    for (const l of leaves) {
        const unit = floorMat(l.type) === matVinyl ? 10 : 9;
        const g = boxGeo(l.x1 - l.x0, 0.1, l.z1 - l.z0, unit);
        const m = new THREE.Mesh(g, floorMat(l.type));
        m.position.set((l.x0 + l.x1) / 2, -0.05, (l.z0 + l.z1) / 2);
        m.receiveShadow = true;
        group.add(m);
    }
    addBox(X0 - T, X1 + T, H, H + 0.4, Z0 - T, Z1 + T, matCeil, false);

    // --- The stair shaft ---
    const lights = [];
    let topDoor = null, spawn = new THREE.Vector3(0, 0, 0), spawnYaw = 0;
    if (stair) {
        const [nx, nz] = stair.n, tx = Math.abs(nz), tz = Math.abs(nx);
        const [bx, bz] = pt(stair.axis, stair.at, stair.c);
        const rect = (n0, n1, s0, s1, y0, y1, mat, collide = true) => {
            const xs = [bx + nx * n0 + tx * s0, bx + nx * n1 + tx * s1], zs = [bz + nz * n0 + tz * s0, bz + nz * n1 + tz * s1];
            return addBox(Math.min(...xs), Math.max(...xs), y0, y1, Math.min(...zs), Math.max(...zs), mat, collide);
        };
        for (let i = 1; i <= S; i++) rect((i - 1) * tread, i * tread, -SW / 2, SW / 2, 0, i * rise, matCarpet);
        rect(S * tread, Ltot, -SW / 2, SW / 2, 0, top, matCarpet);
        rect(0, Ltot + T, -SW / 2 - T, -SW / 2, 0, top + H, matWall);
        rect(0, Ltot + T, SW / 2, SW / 2 + T, 0, top + H, matWall);
        rect(Ltot, Ltot + T, -SW / 2, SW / 2, 0, top + H, matWall);
        rect(0, Ltot + T, -SW / 2 - T, SW / 2 + T, top + H, top + H + 0.4, matCeil, false);
        // wall above the stair opening: visual only, so a low ceiling never blocks your head on the first steps
        rect(-0.02, T, -SW / 2, SW / 2, H, top + H, matWall, false);
        // oak newel post and handrail, like every 80s basement stair
        const rs = rand.chance(0.5) ? 1 : -1;
        rect(0.1, 0.75, rs * (SW / 2 - 0.05) - 0.33, rs * (SW / 2 - 0.05) + 0.33, 0, 4.6, matOak, false);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(S * tread, top), 0.28, 0.28), matOak);
        const [hx, hz] = [bx + nx * S * tread / 2 + tx * rs * (SW / 2 - 0.35), bz + nz * S * tread / 2 + tz * rs * (SW / 2 - 0.35)];
        rail.position.set(hx, top / 2 + 3.4, hz);
        rail.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-nz, nx))
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(top, S * tread)));
        group.add(rail);
        // a little round rug at the bottom
        const rug = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.06, 28), matRug);
        rug.scale.set(1.25, 1, 0.8);
        rug.position.set(bx - nx * 2.6, 0.03, bz - nz * 2.6);
        rug.rotation.y = Math.atan2(nx, nz);
        group.add(rug);
        // bare bulb at the top
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe6c0, emissiveIntensity: 2 }));
        bulb.position.set(bx + nx * (Ltot - 3), top + H - 0.9, bz + nz * (Ltot - 3));
        group.add(bulb);
        lights.push({ p: bulb.position.clone(), color: 0xffdcae, on: lighting !== 'dusk' && rand.chance(0.6), power: 5, mesh: bulb });
        topDoor = { pos: new THREE.Vector3(bx + nx * Ltot, top, bz + nz * Ltot), yaw: Math.atan2(-nx, -nz) };
        // arrive in the main room looking across at the stairs
        const depth = Math.abs(nx) ? stair.room.x1 - stair.room.x0 : stair.room.z1 - stair.room.z0;
        const back = Math.min(depth * 0.72, 32);
        spawn.set(bx - nx * back + tx * rand.range(-4, 4), 0, bz - nz * back + tz * rand.range(-4, 4));
        spawnYaw = Math.atan2(-nx, -nz);
    } else {
        spawn.set((main.x0 + main.x1) / 2, 0, (main.z0 + main.z1) / 2);
    }

    // --- Doorways: on outer walls (and maybe at the top of the stairs) ---
    const portals = [];
    const wantTop = topDoor && rand.chance(0.6);
    if (wantTop) portals.push({ ...topDoor });
    const spotsOuter = [];
    for (const l of leaves) for (const s of sidesOf(l)) if (s.line.boundary) spotsOuter.push({ ...s, room: l });
    for (let tries = 0; portals.length < doors && tries < 300; tries++) {
        const s = rand.pick(spotsOuter);
        if (s.b - s.a < doorW + 4) continue;
        const c = rand.range(s.a + doorW / 2 + 2, s.b - doorW / 2 - 2);
        if (!free(s.line, c - doorW / 2 - 1, c + doorW / 2 + 1)) continue;
        reserve(s.line, c - doorW / 2 - 1, c + doorW / 2 + 1);
        const [x, z] = pt(s.axis, s.at, c);
        portals.push({ pos: new THREE.Vector3(x, 0, z), yaw: Math.atan2(s.in[0], s.in[1]) });
    }
    if (topDoor && !wantTop && portals.length < doors) portals.push({ ...topDoor });
    portals.forEach(p => Object.assign(p, { w: doorW, h: doorH, kind: 'wall', frameColor: panel ? 0x4a2f1e : 0xd8d3c6, leafColor: 0xd6d0c2, frameEnv: 0.3 }));
    // the top of the stairs always ends in a door, even if it leads nowhere
    if (topDoor && !portals.some(p => p.pos.equals(topDoor.pos))) {
        const d = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.3), matDoor);
        d.position.copy(topDoor.pos).y += doorH / 2;
        d.position.x -= Math.sin(topDoor.yaw) * 0.1; d.position.z -= Math.cos(topDoor.yaw) * 0.1;
        d.rotation.y = topDoor.yaw;
        group.add(d);
    }

    // --- Things against the walls ---
    // place something w wide, d deep against a wall of room l; build(cx, cz, ix, iz) gets the centre and inward dir
    const against = (l, w, d, build, onlyOuter = false) => {
        const sides = sidesOf(l).filter(s => !onlyOuter || s.line.boundary).sort(() => rand() - 0.5);
        for (const s of sides) for (let k = 0; k < 6; k++) {
            if (s.b - s.a < w + 2) break;
            const c = rand.range(s.a + w / 2 + 0.6, s.b - w / 2 - 0.6);
            if (!free(s.line, c - w / 2 - 0.3, c + w / 2 + 0.3)) continue;
            reserve(s.line, c - w / 2 - 0.3, c + w / 2 + 0.3);
            const face = s.at + (s.line.boundary ? 0 : (s.in[0] + s.in[1]) * T / 2);
            const [x, z] = pt(s.axis, face, c);
            build(x + s.in[0] * d / 2, z + s.in[1] * d / 2, s.in[0], s.in[1]);
            return true;
        }
        return false;
    };
    const facing = (ix, iz) => Math.atan2(ix, iz);
    const closet = (l) => against(l, 5.4, 0.14, (x, z, ix, iz) => {
        const m = addLocal(x, z, ix, iz, 5.2, 8.6, 0.14, 0, matLouver, false);
        m.material = [matDoor, matDoor, matDoor, matDoor, matDoor, matDoor];
        const face = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 8.4), matLouver);
        for (const o of [-1.3, 1.3]) {
            const f = face.clone();
            f.position.set(x + ix * 0.08 + (-iz) * o, 4.3, z + iz * 0.08 + ix * o);
            f.rotation.y = facing(ix, iz);
            group.add(f);
        }
        const kn = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), matBrass);
        kn.position.set(x + ix * 0.2 + (-iz) * 0.25, 4.2, z + iz * 0.2 + ix * 0.25);
        group.add(kn);
    });
    const heaterStrip = (l) => against(l, rand.range(6, 10), 0.5, (x, z, ix, iz) => {
        const len = Math.abs(ix) ? 0 : 0; void len;
        addLocal(x, z, ix, iz, 7, 0.9, 0.5, 0.4, matHeater, false);
    });
    for (const l of leaves) {
        if (l.type === 'laundry') {
            against(l, 6.4, 3, (x, z, ix, iz) => {
                for (const o of [-1.6, 1.6]) {
                    const cx = x + (-iz) * o, cz = z + ix * o;
                    addLocal(cx, cz, ix, iz, 3, 3.6, 3, 0, matWhite);
                    const win = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.08, 24), matDark);
                    win.position.set(cx + ix * 1.52, 2.1, cz + iz * 1.52);
                    win.rotation.set(Math.PI / 2, 0, 0); win.rotation.y = 0;
                    win.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(ix, 0, iz));
                    group.add(win);
                }
            });
            against(l, 5.8, 2.2, (x, z, ix, iz) => {
                addLocal(x, z, ix, iz, 5.6, 8.4, 2.2, 0, matWhite);
                addLocal(x + ix * 1.1, z + iz * 1.1, ix, iz, 0.06, 8.2, 0.04, 0.1, matDark, false);
            });
        } else if (l.type === 'storage') {
            against(l, 3, 3, (x, z) => {
                const wh = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 6.4, 20), matHeater);
                wh.position.set(x, 3.2, z); group.add(wh);
                colliders.push({ minX: x - 1.3, maxX: x + 1.3, minY: 0, maxY: 6.4, minZ: z - 1.3, maxZ: z + 1.3 });
            });
            for (let k = rand.int(0, 3); k > 0; k--) against(l, 2.6, 2.4, (x, z, ix, iz) => {
                const h1 = rand.range(1.4, 2.2);
                addLocal(x, z, ix, iz, 2.4, h1, 2.2, 0, matBox);
                if (rand.chance(0.4)) addLocal(x, z, ix, iz, 1.8, 1.4, 1.8, h1, matBox);
            });
        } else if (l.type === 'bath') {
            against(l, 2.6, 2.8, (x, z, ix, iz) => {
                addLocal(x - ix * 0.95, z - iz * 0.95, ix, iz, 2.2, 3.4, 0.9, 0, matWhite);
                const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.65, 1.7, 18), matWhite);
                bowl.position.set(x + ix * 0.4, 0.85, z + iz * 0.4); group.add(bowl);
                colliders.push({ minX: x - 1.1, maxX: x + 1.1, minY: 0, maxY: 1.7, minZ: z - 1.1, maxZ: z + 1.1 });
            });
            against(l, 4, 2.2, (x, z, ix, iz) => {
                addLocal(x, z, ix, iz, 3.8, 3.4, 2.2, 0, matOak);
                addLocal(x, z, ix, iz, 4, 0.15, 2.3, 3.4, matWhite, false);
                addLocal(x - ix * 1.06, z - iz * 1.06, ix, iz, 3.2, 3, 0.06, 4.8, matMirror, false);
            });
        } else if (l.type === 'bedroom') {
            if (rand.chance(0.7)) closet(l);
            if (rand.chance(0.4)) heaterStrip(l);
        } else if (l.type === 'main') {
            if (rand.chance(0.6)) closet(l);
            if (rand.chance(0.5)) heaterStrip(l);
        }
        // light switch by a wall, outlets low on the walls
        for (let k = 0; k < 3; k++) against(l, 0.5, 0.06, (x, z, ix, iz) => addLocal(x, z, ix, iz, 0.4, 0.6, 0.06, k ? 1.1 : 4.6, matWhite, false));
    }

    // --- Small high basement windows ---
    const winColor = { evening: 0x2c3b5c, dusk: 0x7896c8, bright: 0x0b0e15, single: 0x182133 }[lighting];
    const matPane = new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: winColor, emissiveIntensity: lighting === 'dusk' ? 1.4 : 1, roughness: 0.1 });
    for (const l of leaves) {
        if (!rand.chance(0.55)) continue;
        against(l, 4.6, 0.2, (x, z, ix, iz) => {
            addLocal(x, z, ix, iz, 4.6, 2.2, 0.2, H - 3, matTrim, false);
            addLocal(x + ix * 0.04, z + iz * 0.04, ix, iz, 4.1, 1.7, 0.2, H - 2.75, matPane, false);
        }, true);
    }

    // --- Ceiling fixtures and lighting ---
    const tubeRoom = t => t === 'laundry' || t === 'storage';
    let litRoom = rand.pick(leaves.filter(l => l !== main)) ?? main;
    for (const l of leaves) {
        const cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2;
        let on;
        if (lighting === 'bright') on = true;
        else if (lighting === 'evening') on = l.type === 'laundry' || rand.chance(0.45);
        else if (lighting === 'dusk') on = rand.chance(0.12);
        else on = l === litRoom;
        const cold = tubeRoom(l.type) || (lighting === 'evening' && l.type === 'laundry');
        const glow = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: cold ? 0xe4eeff : 0xffe8c4, emissiveIntensity: on ? 2 : 0, roughness: 0.4 });
        let fix;
        if (cold) fix = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, 4.8), glow);
        else { fix = new THREE.Mesh(new THREE.SphereGeometry(1.15, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), glow); fix.scale.y = 0.45; }
        fix.position.set(cx, H - (cold ? 0.18 : 0), cz);
        group.add(fix);
        // smoke detector
        const sd = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.16, 16), matWhite);
        sd.position.set(cx + 3.5, H - 0.08, cz + 2); group.add(sd);
        const dim = l === main && lighting === 'evening' ? 0.5 : 1;
        lights.push({ p: new THREE.Vector3(cx, H - 1.4, cz), color: cold ? 0xd8e6ff : 0xffdcae, on, power: (cold ? 11 : 9) * dim, mesh: fix });
    }
    for (const L of lights) {
        if (!L.on) continue;
        const pl = new THREE.PointLight(L.color, L.power, 70, 1.15);
        pl.position.copy(L.p);
        group.add(pl);
    }
    const hemi = {
        bright: [0xfff1dc, 0x6e6458, 0.35], evening: [0xdfe2ea, 0x5a5550, 0.2],
        dusk: [0x8ea6cc, 0x3a3c44, 0.42], single: [0xc8ccd8, 0x403c38, 0.1],
    }[lighting];
    group.add(new THREE.HemisphereLight(hemi[0], hemi[1], hemi[2]));
    const fogColor = new THREE.Color({ bright: 0x2a261f, evening: 0x15171c, dusk: 0x1c2433, single: 0x0c0d10 }[lighting]);

    // --- Footsteps ---
    const roomAt = (x, z) => leaves.find(l => x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1);
    const bounds = { minX: X0, maxX: X1, minZ: Z0, maxZ: Z1 };
    if (stair) {
        const [bx, bz] = pt(stair.axis, stair.at, stair.c);
        for (const [x, z] of [[bx + stair.n[0] * (Ltot + T), bz + stair.n[1] * (Ltot + T)]]) {
            bounds.minX = Math.min(bounds.minX, x - SW); bounds.maxX = Math.max(bounds.maxX, x + SW);
            bounds.minZ = Math.min(bounds.minZ, z - SW); bounds.maxZ = Math.max(bounds.maxZ, z + SW);
        }
    }

    return {
        group, portals,
        stairInfo: stair && { n: stair.n, base: pt(stair.axis, stair.at, stair.c), top, Ltot },
        name: 'The Basement',
        fog: new THREE.FogExp2(fogColor, 0.006),
        background: fogColor.clone(),
        environment: roomEnv,
        exposure: lighting === 'bright' ? 1.0 : 1.1,
        bloom: 0.4, bloomThreshold: 0.88,
        spawn, spawnYaw,
        eye: 7, ceiling: undefined, speed: 17, gravity: 45, jump: 13, stride: 5.2,
        stepType: (f) => { const r = roomAt(f.x, f.z); return !r ? 'carpet' : r.type === 'laundry' || r.type === 'bath' || r.type === 'storage' ? 'tile' : 'carpet'; },
        colliders,
        bounds,
        update: () => {},
        setVisible: (v) => { group.visible = v; },
    };
}
