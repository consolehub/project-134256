import * as THREE from 'three';
import { fadePool } from './light_pool.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from './seed.js';

// One very long hotel corridor on a grid of square cells: long straight runs,
// right-angle turns, and very rarely a side branch. Every surface is merged per
// material, so even thousands of units of corridor stay a handful of draw calls.

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const DOOR_COLORS = [0x5a3826, 0x3e2a1e, 0x7a5236, 0xe9e4da, 0x2f3b33, 0x48282a, 0x8b6a4a];
const WALL_TINTS = [0xf1e6cf, 0xe8dcc0, 0xd9c7a4, 0xc9d1c4, 0xe6d3c9, 0xb8a58a, 0xd4c9b3];
const WAINSCOT = [0x6e4a32, 0x4f3324, 0xe6ddd0, 0x5b2f2f, 0x3c4a44, 0x8c7656];

export function createHallway({ scene, roomEnv, loadTex, isMobile }, seed, doors = 4) {
    const group = new THREE.Group();
    group.visible = false;
    scene.add(group);

    const rand = makeRng(seed, 7);
    // --- Variation ---
    const C = rand.range(9, 12);                 // corridor width (= cell size)
    const H = rand.range(10.6, 13);              // ceiling height
    const carpet = rand.int(1, 3);
    const carpetTint = new THREE.Color(0xffffff).offsetHSL(rand.range(-0.05, 0.05), rand.range(-0.15, 0.05), rand.range(-0.12, 0.02));
    const carpetSize = rand.range(7, 12);
    const wallTint = new THREE.Color(rand.pick(WALL_TINTS)).offsetHSL(rand.range(-0.02, 0.02), rand.range(-0.05, 0.05), rand.range(-0.04, 0.03));
    const wallpaper = rand.chance(0.7);
    const wainscot = rand.chance(0.55) ? new THREE.Color(rand.pick(WAINSCOT)) : null;
    const wainH = rand.range(3.2, 4.2);
    const doorCol = new THREE.Color(rand.pick(DOOR_COLORS)).offsetHSL(0, 0, rand.range(-0.04, 0.04));
    const frameCol = rand.chance(0.5) ? new THREE.Color(0xf2ede4) : doorCol.clone().multiplyScalar(0.8);
    const doorEvery = rand.int(1, 3), doorBoth = rand.chance(0.7);
    const lightStyle = rand.pick(['dome', 'dome', 'sconce', 'recessed']);
    const lightEvery = lightStyle === 'recessed' ? 1 : rand.int(1, 2);
    const lightCol = new THREE.Color().setHSL(rand.range(0.08, 0.13), rand.range(0.4, 0.8), 0.75);
    const deadChance = rand.range(0, 0.08);
    const pictures = rand.chance(0.45);
    const fogColor = new THREE.Color(0x2a2016).offsetHSL(rand.range(-0.03, 0.03), rand.range(-0.1, 0.1), rand.range(-0.03, 0.05));
    const fogDensity = rand.range(0.01, 0.022);

    // --- Layout: a self-avoiding walk of long straight runs ---
    const occ = new Map(), key = (i, j) => i + ',' + j;
    const path = [];                              // {i, j, d (heading), branch}
    const free = (i, j, fi, fj) => {
        if (occ.has(key(i, j))) return false;
        // stay a cell clear of every other corridor (except the one we came from)
        for (const [a, b] of DIRS) if ((i + a !== fi || j + b !== fj) && occ.has(key(i + a, j + b))) return false;
        return true;
    };
    const walk = (i, j, d, segs, minLen, maxLen, branch, out) => {
        for (let s = 0; s < segs; s++) {
            const len = rand.int(minLen, maxLen);
            let n = 0;
            for (; n < len; n++) {
                const ni = i + DIRS[d][0], nj = j + DIRS[d][1];
                if (!free(ni, nj, i, j)) break;
                i = ni; j = nj; occ.set(key(i, j), out.length); out.push({ i, j, d, branch });
            }
            if (n === 0 && s > 0) break;
            const turn = rand.chance(0.5) ? 1 : 3;
            // prefer a turn that has room
            const d1 = (d + turn) % 4, d2 = (d + 4 - turn) % 4;
            d = free(i + DIRS[d1][0], j + DIRS[d1][1], i, j) ? d1 : d2;
        }
        return out;
    };
    const d0 = rand.int(0, 3);
    occ.set(key(0, 0), 0); path.push({ i: 0, j: 0, d: d0, branch: 0 });
    if (rand.chance(0.18)) walk(0, 0, d0, 1, 120, 260, 0, path);          // one endless straight
    else walk(0, 0, d0, rand.int(3, 9), 8, 38, 0, path);
    const mainLen = path.length;
    // very rarely, a side branch
    const branchEnds = [];
    if (rand.chance(0.15) && mainLen > 30) {
        const nb = rand.chance(0.3) ? 2 : 1;
        for (let b = 0; b < nb; b++) {
            for (let tries = 0; tries < 30; tries++) {
                const k = rand.int(10, mainLen - 10), c = path[k];
                if (path[k - 1].d !== c.d || path[k + 1].d !== c.d) continue;     // only off a straight bit
                const bd = (c.d + (rand.chance(0.5) ? 1 : 3)) % 4;
                const start = path.length;
                walk(c.i, c.j, bd, rand.int(1, 3), 6, 22, b + 1, path);
                if (path.length - start >= 4) { branchEnds.push(path.length - 1); break; }
                for (let q = start; q < path.length; q++) occ.delete(key(path[q].i, path[q].j));
                path.length = start;
            }
        }
    }
    const at = (i, j) => occ.has(key(i, j));
    const cx = (c) => c.i * C, cz = (c) => c.j * C;

    // --- Materials ---
    const carpetTex = loadTex('asset_hall_carpet_' + carpet + '.jpg');
    const paperTex = loadTex('asset_hall_wallpaper.jpg');
    const matCarpet = new THREE.MeshStandardMaterial({ map: carpetTex, color: carpetTint, roughness: 1, envMapIntensity: 0.15 });
    const matWall = new THREE.MeshStandardMaterial({ map: wallpaper ? paperTex : null, color: wallTint, roughness: 0.9, envMapIntensity: 0.25 });
    const matLower = new THREE.MeshStandardMaterial({ color: wainscot ?? wallTint.clone().multiplyScalar(0.92), roughness: wainscot ? 0.55 : 0.9, envMapIntensity: 0.3, map: wainscot || !wallpaper ? null : paperTex });
    const matTrim = new THREE.MeshStandardMaterial({ color: frameCol, roughness: 0.5, envMapIntensity: 0.3 });
    const matCeil = new THREE.MeshStandardMaterial({ color: 0xece6da, roughness: 0.95, envMapIntensity: 0.2 });
    const matDoor = new THREE.MeshStandardMaterial({ color: doorCol, roughness: 0.45, envMapIntensity: 0.35 });
    const matBrass = new THREE.MeshStandardMaterial({ color: 0xc9a25a, roughness: 0.3, metalness: 0.9, envMapIntensity: 0.8 });
    const matLamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: lightCol, emissiveIntensity: 2.6, roughness: 0.4 });
    const matDead = new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.5 });
    const matArt = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });

    const geos = new Map();   // material -> [geometry]
    const put = (mat, g) => { if (!geos.has(mat)) geos.set(mat, []); geos.get(mat).push(g); };
    const box = (mat, w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); put(mat, g); return g; };
    // a vertical wall face: from (x0,z0) to (x1,z1), facing normal (nx,nz), y from y0 to y1, world-space uvs
    const face = (mat, x0, z0, x1, z1, y0, y1, uw, uh) => {
        const g = new THREE.BufferGeometry();
        const len = Math.hypot(x1 - x0, z1 - z0), u0 = (x0 + z0) / uw;
        g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0], 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, y0 / uh, u0 + len / uw, y0 / uh, u0 + len / uw, y1 / uh, u0, y1 / uh], 2));
        g.setIndex([0, 1, 2, 0, 2, 3]);
        g.computeVertexNormals();
        put(mat, g);
    };
    const flat = (mat, x, z, y, up, uv) => {
        const g = new THREE.PlaneGeometry(C, C); g.rotateX(up ? -Math.PI / 2 : Math.PI / 2); g.translate(x, y, z);
        const p = g.attributes.position, u = g.attributes.uv;
        for (let k = 0; k < p.count; k++) u.setXY(k, p.getX(k) / uv, -p.getZ(k) / uv);
        put(mat, g);
    };

    // --- Doorways that lead somewhere: the far end, two side doors, a branch end ---
    const sideEdge = (k) => {
        // a wall edge beside cell k (perpendicular to its heading), searched outward from k
        for (let o = 0; o < 40; o++) for (const kk of [k + o, k - o]) {
            const c = path[kk]; if (!c || kk < 3 || kk >= mainLen - 2) continue;
            const prev = path[kk - 1], next = path[kk + 1];
            if (prev?.d !== c.d || next?.d !== c.d) continue;
            for (const s of rand.chance(0.5) ? [1, 3] : [3, 1]) {
                const e = (c.d + s) % 4;
                if (!at(c.i + DIRS[e][0], c.j + DIRS[e][1])) return [kk, e];
            }
        }
        return null;
    };
    const endEdge = (k) => {
        const c = path[k];
        for (const e of [c.d, (c.d + 1) % 4, (c.d + 3) % 4]) if (!at(c.i + DIRS[e][0], c.j + DIRS[e][1])) return [k, e];
        return null;
    };
    const special = [endEdge(mainLen - 1), sideEdge(Math.floor(mainLen * 0.3)), sideEdge(Math.floor(mainLen * 0.62))];
    special.push(branchEnds.length ? endEdge(branchEnds[0]) : sideEdge(Math.floor(mainLen * 0.86)));
    special.push(sideEdge(Math.floor(mainLen * 0.45)), sideEdge(Math.floor(mainLen * 0.15)));
    special.length = Math.min(special.length, doors);
    const portalEdges = new Set(special.filter(Boolean).map(([k, e]) => k + ':' + e));
    const portals = [];
    const doorW = 5.25, doorH = 9.1;
    special.forEach((s, n) => {
        // a layout too short for a side door falls back to any free stretch of wall
        if (!s) {
            const back = (d0 + 2) % 4;
            for (let k = path.length - 1; k > 0 && !s; k--) for (let e = 0; e < 4 && !s; e++) {
                const c = path[k];
                if (!at(c.i + DIRS[e][0], c.j + DIRS[e][1]) && !portalEdges.has(k + ':' + e) && !(k === 0 && e === back)) s = [k, e];
            }
            portalEdges.add(s[0] + ':' + s[1]);
        }
        const [k, e] = s, c = path[k];
        const [nx, nz] = DIRS[e];
        portals.push({ pos: new THREE.Vector3(cx(c) + nx * C / 2, 0, cz(c) + nz * C / 2), yaw: Math.atan2(-nx, -nz),
            w: doorW, h: doorH, kind: 'wall', frameColor: frameCol.getHex() });
    });

    // --- Build every cell ---
    const colliders = [];
    const lamps = [];                  // light positions
    const dW = 4.3, dH = 8.6, artCols = [];
    path.forEach((c, k) => {
        const x = cx(c), z = cz(c);
        flat(matCarpet, x, z, 0, true, carpetSize);
        flat(matCeil, x, z, H, false, C);
        for (let e = 0; e < 4; e++) {
            const [nx, nz] = DIRS[e];
            if (at(c.i + nx, c.j + nz)) continue;
            // wall edge: endpoints seen from inside (counter-clockwise so the face points in)
            const ex = x + nx * C / 2, ez = z + nz * C / 2, tx = nz * C / 2, tz = -nx * C / 2;
            const ax = ex + tx, az = ez + tz, bx = ex - tx, bz = ez - tz;
            const lo = wainscot ? wainH : 0.9;
            face(matLower, ax, az, bx, bz, 0, lo, 6, 6);
            face(matWall, ax, az, bx, bz, lo, H, 4.5, 4.5);
            colliders.push({ minX: Math.min(ex, ex + nx) - (nx ? 0 : C / 2), maxX: Math.max(ex, ex + nx) + (nx ? 0 : C / 2), minY: 0, maxY: H,
                minZ: Math.min(ez, ez + nz) - (nz ? 0 : C / 2), maxZ: Math.max(ez, ez + nz) + (nz ? 0 : C / 2) });
            const along = nx === 0;
            const wx = along ? 1 : 0, wz = along ? 0 : 1;           // unit along the wall
            const ox = -nx * 0.15, oz = -nz * 0.15;
            const fx = (s) => ex + ox * s, fz = (s) => ez + oz * s;
            const bw = (w, d) => [wx ? w : d, wz ? w : d];
            const isPortal = portalEdges.has(k + ':' + e);
            // side walls get guest room doors: facing pairs, or alternating sides
            const side = e === (c.d + 1) % 4 || e === (c.d + 3) % 4, left = e === (c.d + 3) % 4;
            const hasDoor = !isPortal && side && k > 0 && (doorBoth ? k % doorEvery === 0 : k % (doorEvery * 2) === (left ? doorEvery : 0));
            // a trim running along the wall, broken around a door or doorway
            const rail = (th, y, depth, gap) => {
                if (!gap) { const [sx, sz] = bw(C, depth); box(matTrim, sx, th, sz, fx(1), y, fz(1)); return; }
                const l = (C - gap) / 2, off = gap / 2 + l / 2;
                const [sx, sz] = bw(l, depth);
                box(matTrim, sx, th, sz, fx(1) - wx * off, y, fz(1) - wz * off);
                box(matTrim, sx, th, sz, fx(1) + wx * off, y, fz(1) + wz * off);
            };
            const gap = isPortal ? doorW + 0.9 : hasDoor ? dW + 0.9 : 0;
            rail(0.9, 0.45, 0.3, gap);                                                   // skirting
            if (wainscot) rail(0.22, wainH, 0.3, gap);                                   // chair rail
            { const [sx, sz] = bw(C, 0.42); box(matTrim, sx, 0.5, sz, fx(1.4), H - 0.25, fz(1.4)); }   // crown
            if (isPortal) continue;
            if (hasDoor) {
                // frame, slab, raised panels, handle, brass number plate
                let [sx, sz] = bw(dW + 0.9, 0.35);
                box(matTrim, sx, 0.45, sz, fx(1), dH + 0.22, fz(1));
                [sx, sz] = bw(0.45, 0.35);
                box(matTrim, sx, dH, sz, fx(1) - wx * (dW / 2 + 0.22), dH / 2, fz(1) - wz * (dW / 2 + 0.22));
                box(matTrim, sx, dH, sz, fx(1) + wx * (dW / 2 + 0.22), dH / 2, fz(1) + wz * (dW / 2 + 0.22));
                [sx, sz] = bw(dW, 0.22);
                box(matDoor, sx, dH, sz, fx(0.6), dH / 2, fz(0.6));
                [sx, sz] = bw(dW * 0.7, 0.08);
                box(matDoor, sx, dH * 0.3, sz, fx(1.5), dH * 0.72, fz(1.5));
                box(matDoor, sx, dH * 0.4, sz, fx(1.5), dH * 0.27, fz(1.5));
                const hs = rand.chance(0.5) ? 1 : -1;
                [sx, sz] = bw(0.5, 0.4);
                box(matBrass, sx, 0.9, sz, fx(2) + wx * hs * dW * 0.36, 4.1, fz(2) + wz * hs * dW * 0.36);
                [sx, sz] = bw(0.9, 0.1);
                box(matBrass, sx, 0.5, sz, fx(1.6), dH * 0.9, fz(1.6));
            } else if (side && pictures && rand.chance(0.35)) {
                const pw = rand.range(2.4, 4), ph = rand.range(2, 3.2);
                box(matTrim, wx ? pw + 0.4 : 0.2, ph + 0.4, wz ? pw + 0.4 : 0.2, ex + ox, 6.6, ez + oz);
                const g = box(matArt, wx ? pw : 0.24, ph, wz ? pw : 0.24, ex + ox, 6.6, ez + oz);
                const col = new THREE.Color().setHSL(rand(), rand.range(0.1, 0.4), rand.range(0.25, 0.55));
                g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.attributes.position.count }, () => [col.r, col.g, col.b]).flat(), 3));
            }
        }
        // lights
        if (k % lightEvery === 0) {
            const dead = rand.chance(deadChance);
            const m = dead ? matDead : matLamp;
            if (lightStyle === 'sconce') {
                // a pair on the side walls, if they are walls here
                for (const s of [1, 3]) {
                    const e = (c.d + s) % 4, [nx, nz] = DIRS[e];
                    if (at(c.i + nx, c.j + nz) || portalEdges.has(k + ':' + e)) continue;
                    const px = x + nx * (C / 2 - 0.45), pz = z + nz * (C / 2 - 0.45);
                    const g = new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6); g.scale(1, 1.4, 1); g.rotateX(Math.PI); g.translate(px, 8.2, pz); put(m, g);
                    box(matBrass, 0.5, 0.3, 0.5, x + nx * (C / 2 - 0.2), 7.9, z + nz * (C / 2 - 0.2));
                    if (!dead) lamps.push(new THREE.Vector3(px, 8.1, pz));
                }
            } else {
                const r = lightStyle === 'dome' ? 1.1 : 0.55;
                const g = lightStyle === 'dome' ? new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2) : new THREE.CylinderGeometry(r, r, 0.1, 16);
                if (lightStyle === 'dome') { g.scale(1, 0.45, 1); g.rotateX(Math.PI); }
                g.translate(x, H - 0.05, z); put(m, g);
                if (lightStyle === 'dome') box(matBrass, 0.3, 0.1, 0.3, x, H - 0.55, z);
                if (!dead) lamps.push(new THREE.Vector3(x, H - 0.8, z));
            }
        }
    });
    for (const [mat, list] of geos) {
        // boxes carry uv+normal like the faces; strip extras so everything merges
        list.forEach(g => { if (mat !== matArt) g.deleteAttribute('color'); });
        const mesh = new THREE.Mesh(mergeGeometries(list), mat);
        mesh.receiveShadow = true;
        group.add(mesh);
        list.forEach(g => g.dispose());
    }

    // --- Lighting: a pool of point lights follows you along the corridor ---
    group.add(new THREE.HemisphereLight(lightCol, 0x3a2a1c, 0.32));
    const pool = [];
    for (let k = 0; k < (isMobile ? 6 : 14); k++) {
        const l = new THREE.PointLight(lightCol, lightStyle === 'sconce' ? 4 : 6, C * 3.2, 1.2);
        group.add(l); pool.push(l);
    }

    // bounds around the whole walk
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const c of path) { minX = Math.min(minX, cx(c)); maxX = Math.max(maxX, cx(c)); minZ = Math.min(minZ, cz(c)); maxZ = Math.max(maxZ, cz(c)); }

    const [hx, hz] = DIRS[d0];
    let lastCell = '';
    return {
        group,
        portals,
        name: 'The Hallway',
        fog: new THREE.FogExp2(fogColor, fogDensity),
        background: fogColor.clone(),
        environment: roomEnv,
        exposure: 1.0,
        bloom: 0.45, bloomThreshold: 0.9,
        spawn: new THREE.Vector3(0, 0, 0),
        spawnYaw: Math.atan2(-hx, -hz),
        eye: 7, ceiling: H, speed: 18, gravity: 45, jump: 14, stride: 5.5,
        stepType: () => 'carpet',
        colliders,
        bounds: { minX: minX - C, maxX: maxX + C, minZ: minZ - C, maxZ: maxZ + C },
        update: (pos) => {
            fadePool(pool, pos, lamps.length <= pool.length);
            const c = Math.round(pos.x / C) + ',' + Math.round(pos.z / C);
            if (c === lastCell) return;
            lastCell = c;
            // nearest lamps (only a few hundred, sorting on cell change is cheap)
            const near = lamps.filter(p => Math.abs(p.x - pos.x) + Math.abs(p.z - pos.z) < C * 14)
                .sort((a, b) => a.distanceToSquared(pos) - b.distanceToSquared(pos));
            pool.forEach((l, k) => { const p = near[k]; l.visible = !!p; if (p) l.position.copy(p); });
        },
        setVisible: (v) => { group.visible = v; },
    };
}
