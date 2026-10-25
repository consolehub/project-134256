import * as THREE from 'three';
import { applyAntiTile } from './antitile.js';
import { createSkyDome } from './sky_dome.js';
import { makeRng } from './seed.js';

// --------------------------------------------------------------------------
// The Surface: an empty plain on the Moon or on Mars. Craters, scattered rocks,
// long shadows, low gravity. Each seed picks the body, the light and the terrain.
// --------------------------------------------------------------------------

function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
// a little Earth: oceans, land, cloud bands
function earthTex(rand) {
    return canvasTex(512, 256, (g, W, H) => {
        g.fillStyle = '#1d4f9a'; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 26; i++) {
            g.fillStyle = rand.chance(0.6) ? '#4a7a3a' : '#9a8456';
            g.beginPath(); g.ellipse(rand() * W, H * (0.2 + rand() * 0.6), 20 + rand() * 60, 10 + rand() * 34, rand() * 3, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = '#eef3f8'; g.fillRect(0, 0, W, 16); g.fillRect(0, H - 16, W, 16);
        g.globalAlpha = 0.75;
        for (let i = 0; i < 70; i++) {
            g.fillStyle = '#ffffff';
            g.beginPath(); g.ellipse(rand() * W, rand() * H, 14 + rand() * 50, 3 + rand() * 7, rand() * 0.4 - 0.2, 0, Math.PI * 2); g.fill();
        }
    });
}
function flagTex() {
    return canvasTex(190, 100, (g, W, H) => {
        for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#f4f2ee' : '#b8242c'; g.fillRect(0, i * H / 13, W, H / 13 + 1); }
        g.fillStyle = '#28356e'; g.fillRect(0, 0, W * 0.4, H * 7 / 13);
        g.fillStyle = '#f4f2ee';
        for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) g.fillRect(6 + c * 12, 5 + r * 10, 3, 3);
    });
}

export function createSurface({ scene, loadTex, isMobile }, seed, doors = 3) {
    const group = new THREE.Group();
    scene.add(group);
    const rand = makeRng(seed, 1300);

    // --- Variation ---
    const mars = rand.chance(0.45);
    const dusk = mars && rand.chance(0.3);            // Martian sunsets are blue
    const mare = !mars && rand.chance(0.45);           // dark basalt plain vs bright highlands
    const roll = [rand.range(40, 120), rand.range(1, mars ? 9 : 5), rand.range(-400, 400), rand.range(-400, 400)];
    const dunes = mars && rand.chance(0.5) ? rand.range(0.15, 0.45) : 0;
    const duneDir = rand.range(0, Math.PI);
    const craterCount = mars ? rand.int(10, 45) : rand.int(50, 170);
    const rockAmount = rand.range(0.4, 1.4);
    const sunAz = rand.range(0, Math.PI * 2);
    const sunEl = dusk ? rand.range(0.04, 0.12) : mars ? rand.range(0.3, 1.0) : rand.range(0.07, 0.55);
    const sunDir = new THREE.Vector3(Math.cos(sunAz) * Math.cos(sunEl), Math.sin(sunEl), Math.sin(sunAz) * Math.cos(sunEl));

    // --- Craters (power law: many small, a few huge), bucketed for fast height lookups ---
    const CELL = 48, buckets = new Map();
    const craters = [];
    for (let i = 0; i < craterCount; i++) {
        const R = 2 + 70 * Math.pow(rand(), mars ? 2.2 : 3.2);
        const c = { x: rand.range(-560, 560), z: rand.range(-560, 560), R, depth: R * rand.range(0.14, 0.24), rim: R * rand.range(0.04, 0.08) };
        // keep the landing spot walkable
        if (Math.hypot(c.x, c.z) < R * 1.2 + 6) continue;
        craters.push(c);
        const reach = R * 1.8;
        for (let i0 = Math.floor((c.x - reach) / CELL); i0 <= Math.floor((c.x + reach) / CELL); i0++)
            for (let j0 = Math.floor((c.z - reach) / CELL); j0 <= Math.floor((c.z + reach) / CELL); j0++) {
                const k = i0 * 7919 + j0;
                (buckets.get(k) || buckets.set(k, []).get(k)).push(c);
            }
    }
    const [rs, ra, ox, oz] = roll;
    const ca = Math.cos(duneDir), sa = Math.sin(duneDir);
    const height = (x, z) => {
        const px = x + ox, pz = z + oz;
        let y = Math.sin(px / rs) * ra + Math.cos(pz / (rs * 1.3)) * ra * 0.8 + Math.sin((px + pz) / (rs * 0.37)) * ra * 0.15;
        if (dunes) {
            const u = ca * x + sa * z;
            y += Math.pow(Math.abs(Math.sin(u / 7 + Math.sin((sa * x - ca * z) / 23) * 1.5)), 1.5) * dunes * 2.4;
        }
        const list = buckets.get(Math.floor(x / CELL) * 7919 + Math.floor(z / CELL));
        if (list) for (const c of list) {
            const d = Math.hypot(x - c.x, z - c.z) / c.R;
            if (d > 1.8) continue;
            if (d < 1) y -= c.depth * (1 - d * d);
            y += c.rim * Math.exp(-(((d - 1) / 0.28) ** 2));
        }
        return y;
    };

    // --- Sky ---
    let fog, background;
    if (mars) {
        const P = dusk
            ? { zenith: 0x1e1a24, horizon: 0x6a5450, ground: 0x4a3a34, sun: 0x8ab8f0, fog: 0x4c3e3c, bright: 1.0 }
            : { zenith: 0x8c6448, horizon: 0xd6a678, ground: 0xb88a62, sun: 0xfff2e0, fog: 0xc8996c, bright: 1.0 };
        const { mesh } = createSkyDome({ zenith: P.zenith, horizon: P.horizon, ground: P.ground, coverage: 0, sunDir, sunColor: P.sun, brightness: P.bright });
        group.add(mesh);
        fog = new THREE.FogExp2(P.fog, rand.range(0.0035, 0.007));
        background = new THREE.Color(P.fog);
    } else {
        fog = new THREE.FogExp2(0x000000, 0.0012);
        background = new THREE.Color(0x000000);
    }
    // stars, pinned to whichever camera looks (moon, and a few at Martian dusk)
    if (!mars || dusk) {
        const n = mars ? 300 : 2600, sp = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const u = rand(), v = rand() * 0.95 + 0.05, a = u * Math.PI * 2, r = Math.sqrt(1 - v * v);
            sp.set([Math.cos(a) * r * 90, v * 90, Math.sin(a) * r * 90], i * 3);
        }
        const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
        const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe6ff, size: mars ? 1.2 : 1.5, sizeAttenuation: false, fog: false, depthWrite: false }));
        stars.frustumCulled = false; stars.renderOrder = -999;
        stars.onBeforeRender = (r, sc, cam) => { stars.matrixWorld.makeTranslation(cam.position.x, cam.position.y, cam.position.z); };
        group.add(stars);
    }
    // the Earth hanging in the black sky, lit by the same sun (so it shows a phase)
    let earth = null, earthDir = null;
    if (!mars) {
        const ea = rand.range(0, Math.PI * 2), ee = rand.range(0.25, 0.75);
        earthDir = new THREE.Vector3(Math.cos(ea) * Math.cos(ee), Math.sin(ee), Math.sin(ea) * Math.cos(ee));
        earth = new THREE.Mesh(new THREE.SphereGeometry(24, 48, 24), new THREE.MeshStandardMaterial({ map: earthTex(rand), roughness: 0.6, fog: false }));
        earth.rotation.set(0.4, rand.range(0, 6), 0.2);
        group.add(earth);
    }
    // a small pale sun disc on the Moon (no sky to glow in)
    let sunDisc = null;
    if (!mars) {
        sunDisc = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 8), new THREE.MeshBasicMaterial({ color: 0xfffaf0, fog: false, toneMapped: false }));
        group.add(sunDisc);
    }

    // --- Lights ---
    const hemi = mars
        ? new THREE.HemisphereLight(dusk ? 0x6a7898 : 0xe8b48a, dusk ? 0x2a1c18 : 0x6a3a22, dusk ? 0.35 : 0.85)
        : new THREE.HemisphereLight(0x3a3e48, 0x2a2a2a, 0.22);   // earthshine and bounce off the dust
    group.add(hemi);
    const sun = new THREE.DirectionalLight(mars ? (dusk ? 0xc8d4f0 : 0xfff0e0) : 0xffffff, mars ? (dusk ? 1.3 : 2.6) : 4.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    const sd = 90;
    Object.assign(sun.shadow.camera, { left: -sd, right: sd, top: sd, bottom: -sd, near: 1, far: 700 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
    group.add(sun, sun.target);

    // --- Terrain ---
    const size = 1200, segs = isMobile ? 260 : 380;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3), col = new THREE.Color();
    const tint = mars ? [0.03, 0.62, 0.5] : mare ? [0.1, 0.03, 0.42] : [0.1, 0.02, 0.62];
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        pos.setY(i, height(x, z));
        const n = Math.sin(x * 0.011 + Math.cos(z * 0.008) * 2) * 0.5 + Math.sin(z * 0.017 - x * 0.006) * 0.5;
        // darker basalt patches on Mars, mare blotches on the Moon
        col.setHSL(tint[0] + n * 0.01, tint[1], Math.max(0.1, tint[2] + n * (mars ? 0.07 : 0.09)));
        colors.set(mars ? [col.r * 1.6, col.g * 1.6, col.b * 1.6] : [col.r * 1.4, col.g * 1.4, col.b * 1.4], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const groundMap = loadTex(mars ? 'asset_mars_soil.png' : 'asset_moon_regolith.png', size / 5, size / 5);
    const terrainMat = new THREE.MeshStandardMaterial({ map: groundMap, vertexColors: true, roughness: 1, metalness: 0 });
    applyAntiTile(terrainMat, 0.6);
    const terrain = new THREE.Mesh(geo, terrainMat);
    terrain.receiveShadow = true;
    group.add(terrain);

    // --- Rocks: a few lumpy shapes, instanced at many sizes ---
    const colliders = [];
    const rockMat = new THREE.MeshStandardMaterial({ color: mars ? 0x6a4232 : 0x77777a, roughness: 0.95, flatShading: true });
    const shapes = [0, 1, 2].map(k => {
        const g = new THREE.IcosahedronGeometry(1, 1);
        const p = g.attributes.position, r2 = makeRng(seed, 1310 + k);
        const bump = Array.from({ length: 4 }, () => [r2.range(-1, 1), r2.range(-1, 1), r2.range(-1, 1), r2.range(1, 3)]);
        for (let i = 0; i < p.count; i++) {
            const v = new THREE.Vector3().fromBufferAttribute(p, i).normalize();
            let s = 1;
            for (const [a, b, c, f] of bump) s += Math.sin((v.x * a + v.y * b + v.z * c) * f * 2.5) * 0.12;
            v.multiplyScalar(s); v.y *= 0.62;
            p.setXYZ(i, v.x, v.y, v.z);
        }
        g.computeVertexNormals();
        return g;
    });
    const rockSets = shapes.map(() => []);
    const nRocks = Math.round((mars ? 1600 : 1100) * rockAmount * (isMobile ? 0.6 : 1));
    for (let i = 0; i < nRocks; i++) {
        const big = rand.chance(0.05);
        const sc = big ? rand.range(0.9, 3.2) : 0.08 + Math.pow(rand(), 2.5) * 0.7;
        const r = Math.sqrt(rand()) * 480, a = rand() * Math.PI * 2;
        const x = Math.sin(a) * r, z = Math.cos(a) * r;
        if (Math.hypot(x, z) < 5 + sc * 2) continue;
        rockSets[i % 3].push({ x, z, sc, y: height(x, z) - sc * 0.25, rot: rand() * 6.3, tilt: rand.range(-0.3, 0.3) });
        if (sc > 0.7) colliders.push({ minX: x - sc * 0.8, maxX: x + sc * 0.8, minY: height(x, z) - 1, maxY: height(x, z) + sc * 0.4, minZ: z - sc * 0.8, maxZ: z + sc * 0.8 });
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
    rockSets.forEach((list, k) => {
        if (!list.length) return;
        const im = new THREE.InstancedMesh(shapes[k], rockMat, list.length);
        list.forEach((r, i) => {
            q.setFromEuler(e.set(r.tilt, r.rot, r.tilt * 0.5));
            im.setMatrixAt(i, m4.compose(v3.set(r.x, r.y, r.z), q, s3.set(r.sc, r.sc, r.sc * 1.1)));
        });
        im.castShadow = im.receiveShadow = true;
        group.add(im);
    });

    // --- Sometimes, on the Moon: a planted flag and a lander's abandoned descent stage ---
    if (!mars && rand.chance(0.3)) {
        const a = rand.range(0, Math.PI * 2), d = rand.range(18, 40);
        const lx = Math.sin(a) * d, lz = Math.cos(a) * d, ly = height(lx, lz);
        const lander = new THREE.Group();
        const foil = new THREE.MeshStandardMaterial({ color: 0xc8a040, roughness: 0.35, metalness: 0.8 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.6, metalness: 0.4 });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 1.7, 8), foil);
        body.position.y = 2.2; lander.add(body);
        const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.15, 0.12, 8), dark);
        deck.position.y = 3.1; lander.add(deck);
        for (let k = 0; k < 4; k++) {
            const ang = k * Math.PI / 2 + Math.PI / 4, fx = Math.sin(ang) * 3.3, fz = Math.cos(ang) * 3.3;
            // strut from the side of the stage out to its foot pad
            const top = new THREE.Vector3(fx * 0.55, 2.6, fz * 0.55), foot = new THREE.Vector3(fx, 0.1, fz);
            const dir = foot.clone().sub(top);
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, dir.length(), 6), dark);
            leg.position.copy(top).add(foot).multiplyScalar(0.5);
            leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
            lander.add(leg);
            const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.12, 12), foil);
            pad.position.set(fx, 0.06, fz); lander.add(pad);
        }
        const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 0.9, 12, 1, true), dark);
        bell.position.y = 1.0; lander.add(bell);
        lander.position.set(lx, ly - 0.1, lz); lander.rotation.y = rand() * 6.3;
        lander.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
        group.add(lander);
        colliders.push({ minX: lx - 2.3, maxX: lx + 2.3, minY: ly - 1, maxY: ly + 3.2, minZ: lz - 2.3, maxZ: lz + 2.3 });
        const fx = lx + rand.range(5, 8), fz = lz + rand.range(-3, 3), fy = height(fx, fz);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.5, 6), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.7, roughness: 0.3 }));
        pole.position.set(fx, fy + 1.15, fz); pole.castShadow = true; group.add(pole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.66), new THREE.MeshStandardMaterial({ map: flagTex(), side: THREE.DoubleSide, roughness: 0.8 }));
        flag.position.set(fx + 0.63, fy + 2.0, fz); flag.castShadow = true; group.add(flag);
    }

    // --- Doors standing out on the plain ---
    const doorSpots = [];
    const a0 = rand() * Math.PI * 2;
    for (let k = 0; k < doors; k++) {
        const ang = a0 + k * Math.PI * 2 / doors + rand.range(-0.5, 0.5);
        const dist = k === 0 ? rand.range(14, 35) : rand.range(45, 240);
        const x = Math.sin(ang) * dist, z = Math.cos(ang) * dist;
        doorSpots.push([x, z, Math.round((Math.atan2(-x, -z) + rand.range(-0.6, 0.6)) / (Math.PI / 2)) * (Math.PI / 2)]);
    }

    const _c = new THREE.Vector3();
    return {
        group,
        portals: doorSpots.map(([x, z, yaw]) => ({ pos: new THREE.Vector3(x, height(x, z) - 0.05, z), yaw, w: 1.275, h: 2.21, kind: 'standing' })),
        name: mars ? 'Mars' : 'The Moon',
        fog, background,
        environment: null,
        exposure: mars ? 1.0 : 0.95,
        bloom: 0.25, bloomThreshold: 0.95,
        spawn: new THREE.Vector3(0, height(0, 0) + 1.7, 0),
        spawnYaw: Math.atan2(-doorSpots[0][0], -doorSpots[0][1]),
        // low gravity: long, floaty bounds (Moon ~1/6 g, Mars ~3/8 g)
        eye: 1.7, speed: mars ? 5.2 : 4.6, gravity: mars ? 8.5 : 3.8, jump: mars ? 5.4 : 4.4, stride: mars ? 1.9 : 2.4,
        stepType: () => 'carpet',
        ground: height,
        colliders,
        bounds: { minX: -560, maxX: 560, minZ: -560, maxZ: 560 },
        radius: 0.4, height: 1.85, stepHeight: 0.5, mantleHeight: 1.0,
        update: (p) => {
            const snap = 4, cx = Math.round(p.x / snap) * snap, cz = Math.round(p.z / snap) * snap;
            sun.target.position.set(cx, height(cx, cz), cz);
            sun.position.copy(sun.target.position).addScaledVector(sunDir, 300);
            if (earth) earth.position.copy(_c.copy(p).addScaledVector(earthDir, 900));
            if (sunDisc) sunDisc.position.copy(_c.copy(p).addScaledVector(sunDir, 900));
        },
        setVisible: (v) => { group.visible = v; },
    };
}
