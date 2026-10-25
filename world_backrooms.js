import * as THREE from 'three';
import { fadePool } from './light_pool.js';
import { makeRng, mulberry32 } from './seed.js';
export { mulberry32 };

export function createBackrooms({ scene, roomEnv, loadTex, isMobile }, seed, doors = 3) {
    const group = new THREE.Group();
    group.visible = false;
    scene.add(group);

    const rand = makeRng(seed, 1);
    // --- Variation ---
    const N = 36;            // grid cells per side
    const cell = rand.pick([9, 10, 10, 12]);
    const H = rand.range(10.5, 15);          // ceiling height
    const T = 0.7;           // wall thickness
    const half = (N * cell) / 2;
    const wallChance = rand.range(0.16, 0.42);
    const pillarCount = Math.floor(N * rand.range(0.3, 4));
    const deadChance = rand.range(0.02, 0.16);
    const panelPattern = rand.int(0, 2);     // checker, every cell, rows
    const tint = new THREE.Color(0xd6cc9a).offsetHSL(rand.range(-0.025, 0.02), rand.range(-0.12, 0.08), rand.range(-0.06, 0.04));
    const fogColor = new THREE.Color(0xa89a62).offsetHSL(rand.range(-0.02, 0.015), rand.range(-0.1, 0.05), rand.range(-0.06, 0.04));
    const fogDensity = rand.range(0.012, 0.024);

    // --- Materials ---
    const floorTex = loadTex('asset_backrooms_floor.png', N * cell / 6, N * cell / 6);
    const ceilTex = loadTex('asset_backrooms_ceiling.png', N * cell / 5, N * cell / 5);
    const wallTex = loadTex('asset_backrooms_wall.png', 1, 1.15);

    const matFloor = new THREE.MeshStandardMaterial({ map: floorTex, color: 0xc9b98a, roughness: 1, envMapIntensity: 0.2 });
    const matCeil = new THREE.MeshStandardMaterial({ map: ceilTex, color: 0xe9e2c8, roughness: 0.95, envMapIntensity: 0.3 });
    const matWall = new THREE.MeshStandardMaterial({ map: wallTex, color: tint, roughness: 0.85, envMapIntensity: 0.35 });
    const matBase = new THREE.MeshStandardMaterial({ color: 0x8a7a52, roughness: 0.6 });
    const matPanel = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d2, emissiveIntensity: 2.4, roughness: 0.4 });
    const matPanelFrame = new THREE.MeshStandardMaterial({ color: 0xbdb7a2, roughness: 0.6, metalness: 0.3 });

    // --- Floor / ceiling ---
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(N * cell, N * cell), matFloor);
    floor.rotation.x = -Math.PI / 2;
    group.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(N * cell, N * cell), matCeil);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = H;
    group.add(ceil);

    // --- Thin walls on cell edges (office-partition maze) ---
    const walls = []; // {minX,maxX,minZ,maxZ}
    const addWall = (x0, z0, x1, z1) => walls.push({ minX: Math.min(x0, x1) - T / 2, maxX: Math.max(x0, x1) + T / 2, minZ: Math.min(z0, z1) - T / 2, maxZ: Math.max(z0, z1) + T / 2 });
    const safe = (i, j) => Math.abs(i - N / 2) < 2 && Math.abs(j - N / 2) < 2;
    for (let i = 0; i <= N; i++) {
        for (let j = 0; j < N; j++) {
            // edge along z at x = i
            const border = i === 0 || i === N;
            if (border || (!safe(i, j) && rand() < wallChance)) addWall(i * cell - half, j * cell - half, i * cell - half, (j + 1) * cell - half);
            // edge along x at z = i
            if (border || (!safe(j, i) && rand() < wallChance)) addWall(j * cell - half, i * cell - half, (j + 1) * cell - half, i * cell - half);
        }
    }
    // a few chunky pillars
    for (let k = 0; k < pillarCount; k++) {
        const i = 1 + Math.floor(rand() * (N - 1)), j = 1 + Math.floor(rand() * (N - 1));
        if (safe(i, j)) continue;
        const x = i * cell - half, z = j * cell - half, s = 1.4;
        walls.push({ minX: x - s, maxX: x + s, minZ: z - s, maxZ: z + s });
    }
    // doorways set into maze walls, scattered across the whole level
    const doorW = 5.25, doorH = 9.1;
    const portals = [];
    const spots = [];
    for (let tries = 0; spots.length < doors && tries < 500; tries++) {
        const i = rand.int(2, N - 3), j = rand.int(2, N - 3);
        const minD = tries < 300 ? 9 : 4;
        if (Math.hypot(i - N / 2, j - N / 2) < 5) continue;
        if (spots.some(o => Math.hypot(o[0] - i, o[1] - j) < minD)) continue;
        spots.push([i, j]);
    }
    for (const [i, j] of spots) {
        const x0 = i * cell - half, z0 = j * cell - half;
        const dir = rand.int(0, 3);
        if (dir < 2) {   // wall along x at z = z0, door faces +z or -z
            addWall(x0, z0, x0 + cell, z0);
            portals.push({ pos: new THREE.Vector3(x0 + cell / 2, 0, z0 + (dir ? -T / 2 : T / 2)), yaw: dir ? Math.PI : 0 });
        } else {         // wall along z at x = x0, door faces +x or -x
            addWall(x0, z0, x0, z0 + cell);
            portals.push({ pos: new THREE.Vector3(x0 + (dir === 3 ? -T / 2 : T / 2), 0, z0 + cell / 2), yaw: dir === 3 ? -Math.PI / 2 : Math.PI / 2 });
        }
    }
    portals.forEach(p => Object.assign(p, { w: doorW, h: doorH, kind: 'wall', frameColor: 0xcfc497 }));

    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    // wall box UVs: scale per-face so the wallpaper keeps a constant size
    const wallMesh = new THREE.InstancedMesh(unitBox, matWall, walls.length);
    const baseMesh = new THREE.InstancedMesh(unitBox, matBase, walls.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    walls.forEach((w, k) => {
        const sx = w.maxX - w.minX, sz = w.maxZ - w.minZ;
        p.set((w.minX + w.maxX) / 2, H / 2, (w.minZ + w.maxZ) / 2);
        m.compose(p, q, s.set(sx, H, sz));
        wallMesh.setMatrixAt(k, m);
        p.y = 0.35;
        m.compose(p, q, s.set(sx + 0.12, 0.7, sz + 0.12));
        baseMesh.setMatrixAt(k, m);
    });
    wallMesh.castShadow = false;
    group.add(wallMesh, baseMesh);

    // --- Fluorescent ceiling panels ---
    const panels = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const on = panelPattern === 0 ? (i + j) % 2 === 0 : panelPattern === 1 ? true : j % 2 === 0;
        if (on) panels.push(new THREE.Vector3(i * cell - half + cell / 2, H, j * cell - half + cell / 2));
    }
    const panelMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.08, 4.8), matPanel, panels.length);
    const frameMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.8, 0.12, 5.2), matPanelFrame, panels.length);
    const dead = new Set();
    panels.forEach((pp, k) => {
        if (rand() < deadChance) dead.add(k);
        m.makeTranslation(pp.x, H - 0.07, pp.z);
        panelMesh.setMatrixAt(k, m);
        m.makeTranslation(pp.x, H - 0.04, pp.z);
        frameMesh.setMatrixAt(k, m);
        if (dead.has(k)) panelMesh.setColorAt(k, new THREE.Color(0.08, 0.08, 0.07));
        else panelMesh.setColorAt(k, new THREE.Color(1, 1, 1));
    });
    group.add(frameMesh, panelMesh);

    // --- Lighting ---
    const ambient = new THREE.HemisphereLight(0xfff0c0, 0x7a6a3a, 0.4);
    group.add(ambient);
    const lightCount = isMobile ? 6 : 14;
    const pool = [];
    for (let k = 0; k < lightCount; k++) {
        const l = new THREE.PointLight(0xffefc4, 6, 34, 1);
        group.add(l);
        pool.push(l);
    }
    const lit = panels.map((pp, k) => ({ p: pp, k })).filter(o => !dead.has(o.k));
    const flickerIdx = lit[Math.floor(rand() * lit.length)]?.k;

    // --- Colliders: walls/pillars as full-height boxes ---
    const colliders = walls.map(w => ({ minX: w.minX, maxX: w.maxX, minY: 0, maxY: H, minZ: w.minZ, maxZ: w.maxZ }));

    let lastCell = '';
    return {
        group,
        portals,
        name: 'The Backrooms',
        fog: new THREE.FogExp2(fogColor, fogDensity),
        background: fogColor.clone(),
        environment: roomEnv,
        exposure: 1.0,
        bloom: 0.55, bloomThreshold: 0.9,
        spawn: new THREE.Vector3(cell / 2, 0, cell / 2),
        eye: 7, ceiling: H, speed: 20, gravity: 45, jump: 14, stride: 5.5,
        stepType: () => 'carpet',
        colliders,
        bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half },
        update: (pos, t) => {
            const c = Math.floor(pos.x / cell) + ',' + Math.floor(pos.z / cell);
            if (c !== lastCell) {
                lastCell = c;
                lit.sort((a, b) => a.p.distanceToSquared(pos) - b.p.distanceToSquared(pos));
                pool.forEach((l, k) => { const o = lit[k]; l.position.set(o.p.x, H - 0.6, o.p.z); l.userData.k = o.k; });
            }
            // one tube is dying
            const on = Math.sin(t * 13) + Math.sin(t * 31.7) + Math.sin(t * 5.3) > -0.6;
            pool.forEach(l => { l.userData.base = (l.userData.k === flickerIdx && !on) ? 0.4 : 6; });
            fadePool(pool, pos, lit.length <= pool.length);
            if (flickerIdx !== undefined) {
                panelMesh.setColorAt(flickerIdx, on ? new THREE.Color(1, 1, 1) : new THREE.Color(0.15, 0.15, 0.13));
                panelMesh.instanceColor.needsUpdate = true;
            }
        },
        setVisible: (v) => { group.visible = v; },
    };
}

export function pushOut(pos, w, r) {
    const cx = Math.max(w.minX, Math.min(pos.x, w.maxX));
    const cz = Math.max(w.minZ, Math.min(pos.z, w.maxZ));
    let dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return;
    if (d2 > 1e-8) {
        const d = Math.sqrt(d2), push = r - d;
        pos.x += (dx / d) * push; pos.z += (dz / d) * push;
    } else {
        // inside the box: push out along the shortest axis
        const l = pos.x - w.minX, rr = w.maxX - pos.x, b = pos.z - w.minZ, f = w.maxZ - pos.z;
        const mn = Math.min(l, rr, b, f);
        if (mn === l) pos.x = w.minX - r; else if (mn === rr) pos.x = w.maxX + r;
        else if (mn === b) pos.z = w.minZ - r; else pos.z = w.maxZ + r;
    }
}

