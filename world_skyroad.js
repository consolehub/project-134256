import * as THREE from 'three';
import { applyAntiTile } from './antitile.js';
import { createSkyDome } from './sky_dome.js';
import { makeRng, hash32 } from './seed.js';
import { createUltraGrass } from './ultra_grass.js';

// A grassy strip of land floating far above a sea of clouds, with a road running along it.
// The island is a band around a wandering centre line: x = c(z), half-width W(z).

const ISLAND_GLSL = `
uniform vec4 uI0; uniform vec4 uI1; uniform vec4 uI2; uniform vec4 uR;
float islC(float z) { return uI0.x * sin(z * uI0.y + uI0.z) + uI0.w * sin(z * uI1.x + uI1.y); }
float islDC(float z) { return uI0.x * uI0.y * cos(z * uI0.y + uI0.z) + uI0.w * uI1.x * cos(z * uI1.x + uI1.y); }
float islW(float z) {
    float t = z / uI2.z, tp = t * t; tp *= tp; tp *= tp; tp *= tp;
    return (uI1.z + uI1.w * sin(z * uI2.x + uI2.y)) * sqrt(max(0.0, 1.0 - tp));
}
float islH(vec2 p) {
    float e = abs(p.x - islC(p.y)) / max(islW(p.y), 0.001);
    float l = smoothstep(0.9, 1.0, e);
    return 1.2 * sin(p.y * 0.011 + uI2.w) + 0.4 * sin(p.y * 0.03 + p.x * 0.02) - l * l * 1.6;
}
float roadDist(vec2 p) {
    if (uR.y < 0.5 || abs(p.y) > uR.z) return 1e4;
    float d = islDC(p.y);
    return abs(p.x - islC(p.y) - uR.x) / sqrt(1.0 + d * d);
}`;

/** Time of day of a variation (its own stream) */
export function skyroadTime(seed) {
    return makeRng(seed, 100).pick(['day', 'day', 'day', 'sunset', 'night']);
}
const TIMES = {
    day: { zenith: 0x0a2c9c, horizon: 0xaccbee, ground: 0xdfe8f4, fog: 0xc8dcf2, sunColor: 0xfff4dc, bright: 1.05,
        hemi: [0xd8e8ff, 0x5a7a3a, 1.05], sun: [0xfff3dc, 3.0], el: [0.6, 1.1], light: [1, 1, 1], exposure: 0.95,
        cloud: 0xffffff, cloudLow: 0xa8bcdc, cover: [0, 0.18] },
    sunset: { zenith: 0x2a3c8e, horizon: 0xf6a86c, ground: 0xe8b090, fog: 0xeab090, sunColor: 0xff9850, bright: 1.0,
        hemi: [0xf0b8a8, 0x3a3020, 0.65], sun: [0xffa262, 2.7], el: [0.05, 0.15], light: [1.25, 0.88, 0.62], exposure: 0.9,
        cloud: 0xffd8bc, cloudLow: 0x8c6c90, cover: [0.05, 0.3] },
    night: { zenith: 0x02040c, horizon: 0x101c3a, ground: 0x1a2440, fog: 0x0e1832, sunColor: 0x9aa8d8, bright: 1.0,
        hemi: [0x34446e, 0x0a100a, 0.4], sun: [0xb0c0ff, 0.6], el: [0.5, 1.0], light: [0.2, 0.26, 0.42], exposure: 1.0,
        cloud: 0x9aa8cc, cloudLow: 0x2a3456, cover: [0, 0.15] },
};

// smooth 2D value noise, 0..1
function makeNoise(seed) {
    const h = (i, j) => hash32((Math.imul(i, 374761393) + Math.imul(j, 668265263) + seed) >>> 0) / 4294967296;
    return (x, y) => {
        const xi = Math.floor(x), yi = Math.floor(y);
        let fx = x - xi, fy = y - yi;
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
        const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
}

function roadTexture() {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 512;
    const g = cv.getContext('2d');
    g.fillStyle = '#6d6d6b'; g.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 9000; i++) {
        const v = 90 + Math.random() * 40 | 0;
        g.fillStyle = 'rgba(' + v + ',' + v + ',' + (v - 2) + ',0.5)';
        g.fillRect(Math.random() * 256, Math.random() * 512, 2, 2);
    }
    g.fillStyle = '#eceae2';
    g.fillRect(8, 0, 7, 512); g.fillRect(241, 0, 7, 512);
    g.fillStyle = '#e2b52e';
    g.fillRect(122, 0, 5, 512); g.fillRect(131, 0, 5, 512);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
}

function signTexture() {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 220;
    const g = cv.getContext('2d');
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 256, 220);
    g.strokeStyle = '#222'; g.lineWidth = 8; g.strokeRect(10, 10, 236, 200);
    g.fillStyle = '#1a1a1a'; g.textAlign = 'center';
    g.font = 'bold 62px Arial, sans-serif'; g.fillText('DROP', 128, 82);
    g.font = 'bold 36px Arial, sans-serif'; g.fillText('LIMIT', 128, 128);
    g.font = 'bold 42px Arial, sans-serif'; g.fillText('?????', 128, 182);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

export function createSkyroad({ scene, loadTex, isMobile }, seed, doors = 2) {
    const group = new THREE.Group();
    scene.add(group);
    const rand = makeRng(seed, 0);
    const time = skyroadTime(seed), T = TIMES[time];

    // --- Variation ---
    const hasRoad = rand.chance(0.75);
    const hasHouse = rand.chance(0.35);
    const hasSign = hasRoad && rand.chance(0.55);
    const L = rand.range(160, 260);
    const I0 = [rand.range(8, 25), rand.range(0.006, 0.012), rand.range(0, 6.28), rand.range(2, 6)];
    const I1 = [rand.range(0.02, 0.04), rand.range(0, 6.28), rand.range(hasHouse ? 19 : 14, 24), rand.range(1, 3)];
    const I2 = [rand.range(0.01, 0.03), rand.range(0, 6.28), L, rand.range(0, 6.28)];
    const roadSide = rand.chance(0.5) ? 1 : -1;
    const roadOff = roadSide * (I1[2] - I1[3] - 3.5 - rand.range(2, 4));
    const roadZ = L * 0.78;
    const cloudY = -rand.range(18, 40);

    const islC = z => I0[0] * Math.sin(z * I0[1] + I0[2]) + I0[3] * Math.sin(z * I1[0] + I1[1]);
    const islDC = z => I0[0] * I0[1] * Math.cos(z * I0[1] + I0[2]) + I0[3] * I1[0] * Math.cos(z * I1[0] + I1[1]);
    const islW = z => {
        const t = z / L, tp = t ** 16;
        return (I1[2] + I1[3] * Math.sin(z * I2[0] + I2[1])) * Math.sqrt(Math.max(0, 1 - tp));
    };
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const islH = (x, z) => {
        const e = Math.abs(x - islC(z)) / Math.max(islW(z), 0.001), l = smooth(0.9, 1.0, e);
        return 1.2 * Math.sin(z * 0.011 + I2[3]) + 0.4 * Math.sin(z * 0.03 + x * 0.02) - l * l * 1.6;
    };
    const roadDist = (x, z) => {
        if (!hasRoad || Math.abs(z) > roadZ) return 1e4;
        const d = islDC(z);
        return Math.abs(x - islC(z) - roadOff) / Math.sqrt(1 + d * d);
    };
    const ground = (x, z) => {
        if (Math.abs(z) >= L) return -1e4;
        const W = islW(z);
        if (W < 0.05 || Math.abs(x - islC(z)) > W) return -1e4;
        return islH(x, z);
    };

    // --- Sky ---
    const sunAz = rand.range(0, Math.PI * 2), sunEl = rand.range(...T.el);
    const sunDir = new THREE.Vector3(Math.cos(sunAz) * Math.cos(sunEl), Math.sin(sunEl), Math.sin(sunAz) * Math.cos(sunEl)).normalize();
    const fog = new THREE.FogExp2(T.fog, rand.range(0.0005, 0.0009) * (time === 'night' ? 1.4 : 1));
    const background = new THREE.Color(T.horizon);
    const { mesh: skyMesh } = createSkyDome({ zenith: T.zenith, horizon: T.horizon, ground: T.ground, coverage: rand.range(...T.cover),
        brightness: T.bright, sunDir, sunColor: T.sunColor, cloud: time === 'night' ? 0x1a2238 : time === 'sunset' ? 0xffc8a8 : 0xffffff });
    group.add(skyMesh);
    if (time === 'night') {
        const n = 1800, sp = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const u = rand(), v = rand() * 0.92 + 0.08, a = u * Math.PI * 2, r = Math.sqrt(1 - v * v);
            sp.set([Math.cos(a) * r * 90, v * 90, Math.sin(a) * r * 90], i * 3);
        }
        const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
        const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false }));
        stars.frustumCulled = false; stars.renderOrder = -999;
        stars.onBeforeRender = (r, sc, cam) => { stars.matrixWorld.makeTranslation(cam.position.x, cam.position.y, cam.position.z); };
        group.add(stars);
    }

    // --- Lights ---
    group.add(new THREE.HemisphereLight(...T.hemi));
    const sun = new THREE.DirectionalLight(...T.sun);
    sun.castShadow = true;
    sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 700 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
    group.add(sun, sun.target);

    // --- Island top ---
    const NZ = Math.round(L * 2 / 1.5), NS = 60;
    const top = new THREE.BufferGeometry();
    const tp = [], tu = [], ti = [];
    for (let i = 0; i <= NZ; i++) {
        const z = -L + (i / NZ) * 2 * L, c = islC(z), W = islW(z);
        for (let j = 0; j <= NS; j++) {
            const s = j / NS * 2 - 1, x = c + s * W;
            tp.push(x, islH(x, z), z); tu.push(x / 5, z / 5);
        }
    }
    for (let i = 0; i < NZ; i++) for (let j = 0; j < NS; j++) {
        const a = i * (NS + 1) + j, b = a + NS + 1;
        ti.push(a, a + 1, b, a + 1, b + 1, b);
    }
    top.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    top.setAttribute('uv', new THREE.Float32BufferAttribute(tu, 2));
    top.setIndex(ti);
    top.computeVertexNormals();
    const grassTex = loadTex('visual_grass_seamless.png', 1, 1);
    const topMat = new THREE.MeshStandardMaterial({ map: grassTex, color: 0x9cc070, roughness: 0.95, side: THREE.DoubleSide });
    applyAntiTile(topMat, 0.6);
    const topMesh = new THREE.Mesh(top, topMat);
    topMesh.receiveShadow = true;
    group.add(topMesh);

    // --- Cliff: the island's rim extruded down into the clouds, tapering inward ---
    const ring = [];
    for (let i = 0; i <= NZ; i++) ring.push(i * (NS + 1) + NS);
    for (let i = NZ; i >= 0; i--) ring.push(i * (NS + 1));
    const K = 36, D = -cloudY + 45;
    const cp = [], cc = [], ci = [];
    const rockN = makeNoise(seed ^ 0x51a7);
    const col = new THREE.Color();
    ring.forEach((vi, r) => {
        const xe = tp[vi * 3], ye = tp[vi * 3 + 1], ze = tp[vi * 3 + 2], c = islC(ze);
        for (let k = 0; k <= K; k++) {
            const t = k / K;
            const f = 0.12 * t + 0.6 * t * t;
            const jit = k === 0 ? 0 : ((rockN(r * 0.12, t * 5) - 0.5) * 3.2 + (rockN(r * 0.45 + 9, t * 16) - 0.5) * 0.9) * Math.min(1, t * 4);
            const x = c + (xe - c) * (1 - f) + jit * Math.sign(xe - c || 1);
            const z = ze * (1 - 0.3 * t * t) + (k === 0 ? 0 : (rockN(t * 6 + 30, r * 0.1) - 0.5) * 1.5 * Math.min(1, t * 4));
            const y = ye - D * Math.pow(t, 1.5) - 0.6 * Math.min(1, t * K);
            cp.push(x, y, z);
            const n = rockN(r * 0.25 + 40, t * 8);
            if (k <= 2) col.setRGB(0.32, 0.42, 0.2);
            else col.setRGB(0.42 + n * 0.16, 0.4 + n * 0.14, 0.36 + n * 0.12);
            cc.push(col.r, col.g, col.b);
        }
    });
    for (let r = 0; r < ring.length - 1; r++) for (let k = 0; k < K; k++) {
        const a = r * (K + 1) + k, b = a + K + 1;
        ci.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const cliff = new THREE.BufferGeometry();
    cliff.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    cliff.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    cliff.setIndex(ci);
    cliff.computeVertexNormals();
    const cliffMesh = new THREE.Mesh(cliff, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    cliffMesh.castShadow = cliffMesh.receiveShadow = true;
    group.add(cliffMesh);

    // --- Road ---
    if (hasRoad) {
        const rp = [], ru = [], ri = [];
        const n = Math.round(roadZ * 2);
        let s = 0, px = 0, pz = 0;
        for (let i = 0; i <= n; i++) {
            const z = -roadZ + (i / n) * 2 * roadZ, x = islC(z) + roadOff;
            const d = islDC(z), len = Math.sqrt(1 + d * d), nx = 1 / len, nz = -d / len;
            if (i) s += Math.hypot(x - px, z - pz);
            px = x; pz = z;
            for (const side of [-1, 1]) {
                const vx = x + side * nx * 3.5, vz = z + side * nz * 3.5;
                rp.push(vx, islH(vx, vz) + 0.04, vz); ru.push(side < 0 ? 0 : 1, s / 8);
            }
            if (i < n) { const a = i * 2; ri.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        }
        const rg = new THREE.BufferGeometry();
        rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
        rg.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2));
        rg.setIndex(ri);
        rg.computeVertexNormals();
        const road = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.9,
            polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }));
        road.receiveShadow = true;
        group.add(road);
    }

    // --- Cloud sea: a radial mesh (dense near the island, coarse toward the horizon) ---
    const cn = makeNoise(seed ^ 0xc10d);
    const radii = [0];
    while (radii[radii.length - 1] < 4200) { const r = radii[radii.length - 1]; radii.push(r + Math.max(1.6, r * 0.022)); }
    const NA = isMobile ? 220 : 320;
    const kp = [], kc = [], ki = [];
    const lo = new THREE.Color(T.cloudLow), hi = new THREE.Color(1, 1, 1);
    radii.forEach((r, ri) => {
        const count = ri === 0 ? 1 : NA;
        const far = Math.min(1, Math.max(0, (r - 250) / 900));
        for (let a = 0; a < count; a++) {
            const ang = a / NA * Math.PI * 2;
            const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
            const base = cn(x / 110, z / 110) * 0.6 + cn(x / 45 + 7, z / 45 - 3) * 0.4;
            let puff = 0, amp = 1, f = 1 / 18, tot = 0;
            for (let o = 0; o < 4; o++) {
                const w = o >= 2 ? amp * (1 - far) : amp;
                puff += w * cn(x * f + o * 13.1, z * f - o * 7.7); tot += amp; amp *= 0.5; f *= 2.2;
            }
            puff /= tot;
            const bump = Math.pow(Math.max(0, puff - 0.15) / 0.85, 0.8);
            const y = cloudY + base * 9 + bump * 7 - 6;
            kp.push(x, y, z);
            col.copy(lo).lerp(hi, Math.min(1, Math.max(0, bump * 0.9 + base * 0.4)));
            kc.push(col.r, col.g, col.b);
        }
    });
    for (let a = 0; a < NA; a++) ki.push(0, 1 + (a + 1) % NA, 1 + a);
    for (let ri = 1; ri < radii.length - 1; ri++) {
        const r0 = 1 + (ri - 1) * NA, r1 = r0 + NA;
        for (let a = 0; a < NA; a++) {
            const a1 = (a + 1) % NA;
            ki.push(r0 + a, r0 + a1, r1 + a, r0 + a1, r1 + a1, r1 + a);
        }
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(kp, 3));
    cg.setAttribute('color', new THREE.Float32BufferAttribute(kc, 3));
    cg.setIndex(ki);
    cg.computeVertexNormals();
    const cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: T.cloud, side: THREE.DoubleSide,
        emissive: new THREE.Color(T.cloud).multiplyScalar(time === 'night' ? 0.04 : 0.18) });
    const clouds = new THREE.Mesh(cg, cloudMat);
    clouds.receiveShadow = true;
    group.add(clouds);

    const colliders = [];

    // --- House ---
    if (hasHouse) {
        const zH = rand.range(-0.2, 0.3) * L;
        const xH = islC(zH) + (hasRoad ? roadSide * (Math.abs(roadOff) - 13.5) : 0);
        const wid = 10, dep = 8, wallH = 3.2;
        let fy = -1e4;
        for (const [dx, dz] of [[-4, -5], [4, -5], [-4, 5], [4, 5], [0, 0]]) fy = Math.max(fy, islH(xH + dx, zH + dz));
        const house = new THREE.Group();
        house.position.set(xH, fy, zH);
        house.rotation.y = (hasRoad ? roadSide : 1) > 0 ? Math.PI / 2 : -Math.PI / 2;
        const wallColor = rand.pick([0xe8dcc4, 0xd6e0e4, 0xf0e6d0, 0xd8c8b8, 0xc8d4c0]);
        const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.9 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(wid, wallH + 2, dep), wallMat);
        body.position.y = wallH / 2 - 1;
        const roofShape = new THREE.Shape();
        roofShape.moveTo(-dep / 2 - 0.6, 0); roofShape.lineTo(0, 2.6); roofShape.lineTo(dep / 2 + 0.6, 0); roofShape.lineTo(-dep / 2 - 0.6, 0);
        const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: wid + 0.8, bevelEnabled: false });
        roofGeo.translate(0, 0, -(wid + 0.8) / 2); roofGeo.rotateY(Math.PI / 2);
        const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: rand.pick([0x5a3a30, 0x3a3e48, 0x6a4a3a]), roughness: 0.85 }));
        roof.position.y = wallH;
        const lit = time === 'night' || (time === 'sunset' && rand.chance(0.6));
        const winMat = new THREE.MeshStandardMaterial({ color: lit ? 0xffd890 : 0x3a4656, roughness: 0.2,
            emissive: lit ? 0xffc870 : 0x000000, emissiveIntensity: lit ? 1.6 : 0 });
        const doorMat = new THREE.MeshStandardMaterial({ color: rand.pick([0x7a3a2a, 0x2a4a6a, 0xf0f0ea]), roughness: 0.7 });
        const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); house.add(m); return m; };
        add(new THREE.PlaneGeometry(1.1, 2.1), doorMat, 0, 1.05, dep / 2 + 0.01);
        for (const x of [-3, 3]) add(new THREE.PlaneGeometry(1.5, 1.2), winMat, x, 1.6, dep / 2 + 0.01);
        for (const x of [-3, 3]) add(new THREE.PlaneGeometry(1.5, 1.2), winMat, x, 1.6, -dep / 2 - 0.01).rotation.y = Math.PI;
        for (const s of [-1, 1]) add(new THREE.PlaneGeometry(1.4, 1.2), winMat, s * (wid / 2 + 0.01), 1.6, 0).rotation.y = s * Math.PI / 2;
        house.add(body, roof);
        house.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
        group.add(house);
        colliders.push({ minX: xH - dep / 2, maxX: xH + dep / 2, minY: fy - 3, maxY: fy + wallH + 2.6, minZ: zH - wid / 2, maxZ: zH + wid / 2 });
        if (lit) {
            const glow = new THREE.PointLight(0xffc070, 18, 14, 2);
            glow.position.set(xH + Math.sign(Math.sin(house.rotation.y)) * (dep / 2 + 1.5), fy + 1.8, zH);
            group.add(glow);
        }
    }

    const spawnZ = -L * 0.55;
    const spawnX = hasRoad ? islC(spawnZ) + roadOff : islC(spawnZ);

    // --- "DROP LIMIT ?????" sign on the cliff side of the road ---
    if (hasSign) {
        const zS = spawnZ + rand.range(14, 26);
        const xS = islC(zS) + roadOff + roadSide * 4.6;
        const yS = islH(xS, zS);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 8), new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.6, roughness: 0.4 }));
        post.position.set(xS, yS + 1.6, zS);
        const metal = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.5, roughness: 0.5 });
        // BoxGeometry face order: +x, -x, +y, -y, +z, -z (the face looks back toward the start)
        const plate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.95, 0.04),
            [metal, metal, metal, metal, metal, new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.6 })]);
        plate.position.set(xS, yS + 2.75, zS - 0.05);
        post.castShadow = plate.castShadow = true;
        group.add(post, plate);
        colliders.push({ minX: xS - 0.1, maxX: xS + 0.1, minY: yS - 1, maxY: yS + 3.3, minZ: zS - 0.1, maxZ: zS + 0.1 });
    }

    // --- Grass blades around the player (same idea as Bliss, masked to the island and off the road) ---
    const side = isMobile ? 174 : 300, blades = side * side, area = isMobile ? 50 : 70;
    const bp = [], bi = [];
    for (let s = 0; s <= 4; s++) { const t = s / 4, w = 0.05 * (1 - t * 0.9); bp.push(-w, t, 0, w, t, 0); }
    for (let s = 0; s < 4; s++) { const a = s * 2; bi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const bladeGeo = new THREE.BufferGeometry();
    bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    bladeGeo.setIndex(bi);
    const igeo = new THREE.InstancedBufferGeometry().copy(bladeGeo);
    igeo.instanceCount = blades;
    const offs = new Float32Array(blades * 4);
    for (let i = 0; i < blades; i++) {
        const gx = i % side, gz = (i / side) | 0;
        offs[i * 4] = ((gx + rand()) / side - 0.5) * area;
        offs[i * 4 + 1] = ((gz + rand()) / side - 0.5) * area;
        offs[i * 4 + 2] = rand() * Math.PI * 2;
        offs[i * 4 + 3] = 0.25 + rand() * 0.5;
    }
    igeo.setAttribute('offset', new THREE.InstancedBufferAttribute(offs, 4));
    const grassMat = new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: {
            camPos: { value: new THREE.Vector3() }, time: { value: 0 }, area: { value: area },
            uI0: { value: new THREE.Vector4(...I0) }, uI1: { value: new THREE.Vector4(...I1) },
            uI2: { value: new THREE.Vector4(...I2) }, uR: { value: new THREE.Vector4(roadOff, hasRoad ? 1 : 0, roadZ, 0) },
            uLight: { value: new THREE.Vector3(...T.light) }, fogColor: { value: fog.color },
        },
        vertexShader: ISLAND_GLSL + `
            attribute vec4 offset;
            uniform vec3 camPos; uniform float time; uniform float area;
            varying float vT; varying float vFog; varying float vShade;
            void main(){
                vec2 o = offset.xy;
                vec2 wp = o + floor((camPos.xz - o) / area + 0.5) * area;
                float fade = 1.0 - smoothstep(area * 0.3, area * 0.5, length(wp - camPos.xz));
                float edge = islW(wp.y) - abs(wp.x - islC(wp.y));
                fade *= smoothstep(0.0, 0.3, edge) * step(abs(wp.y), uI2.z);
                fade *= smoothstep(3.45, 3.75, roadDist(wp));
                float h = offset.w * fade;
                float c = cos(offset.z), s = sin(offset.z);
                vec3 p = position;
                p.x *= (0.8 + offset.w * 0.4);
                vec3 local = vec3(p.x * c, p.y * h, p.x * s);
                float wind = sin(time * 1.9 + wp.x * 0.15 + wp.y * 0.1) * 0.6 + sin(time * 3.3 + wp.x * 0.6) * 0.2;
                local.x += wind * 0.2 * p.y * p.y * h;
                local.z += wind * 0.09 * p.y * p.y * h;
                vec3 world = vec3(wp.x, islH(wp) - 0.05, wp.y) + local;
                vT = p.y;
                vShade = 0.85 + 0.15 * sin(offset.z * 3.0);
                vec4 mv = viewMatrix * vec4(world, 1.0);
                float fd = -mv.z * 0.0008;
                vFog = 1.0 - exp(-fd * fd);
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: `
            uniform vec3 fogColor; uniform vec3 uLight;
            varying float vT; varying float vFog; varying float vShade;
            void main(){
                // ground albedo = grass texture mean x 0x9cc070 tint
                vec3 alb = vec3(0.0052, 0.138, 0.00057);
                vec3 col = mix(alb * 0.3, alb * 1.3, smoothstep(0.0, 1.0, vT)) * vShade;
                col *= (1.0 + 0.5 * vT) * uLight;
                gl_FragColor = vec4(mix(col, fogColor, vFog), 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
    });
    const grass = new THREE.Mesh(igeo, grassMat);
    grass.frustumCulled = false;
    group.add(grass);

    // Ultra quality swaps in dense, fully lit grass (built the first time it's needed)
    let ultraGrass = null;
    const setUltra = (on) => {
        if (on && !ultraGrass) {
            ultraGrass = createUltraGrass({
                rand: makeRng(seed, 992),
                groundGLSL: ISLAND_GLSL + `
                    float grassGround(vec2 p){ return islH(p); }
                    float grassMask(vec2 p){
                        float edge = islW(p.y) - abs(p.x - islC(p.y));
                        return smoothstep(0.0, 0.3, edge) * step(abs(p.y), uI2.z) * smoothstep(3.45, 3.75, roadDist(p));
                    }`,
                uniforms: { uI0: grassMat.uniforms.uI0, uI1: grassMat.uniforms.uI1, uI2: grassMat.uniforms.uI2, uR: grassMat.uniforms.uR },
                albedo: new THREE.Vector3(0.0052, 0.138, 0.00057), hMin: 0.22, hRand: 0.6, area: isMobile ? 55 : 80, side: isMobile ? 300 : 470,
                sunDir, sunColor: sun.color.clone().multiplyScalar(sun.intensity / Math.PI),
            });
            group.add(ultraGrass.mesh);
        }
        if (ultraGrass) ultraGrass.mesh.visible = on;
        grass.visible = !on;
    };

    // --- Two lone doors: one far down the strip, one near the tail end behind the start ---
    const zA = L * 0.5, xA = islC(zA) - (hasRoad ? roadSide * 3 : 0);
    const zB = -L * 0.78, xB = islC(zB) - (hasRoad ? roadSide * 3 : 0);
    const zC = -L * 0.3, xC = islC(zC) - (hasRoad ? roadSide * 3 : 0);
    const portals = [
        { pos: new THREE.Vector3(xA, islH(xA, zA) - 0.05, zA), yaw: Math.PI, w: 1.275, h: 2.21, kind: 'standing' },
        { pos: new THREE.Vector3(xB, islH(xB, zB) - 0.05, zB), yaw: 0, w: 1.275, h: 2.21, kind: 'standing' },
        { pos: new THREE.Vector3(xC, islH(xC, zC) - 0.05, zC), yaw: Math.PI, w: 1.275, h: 2.21, kind: 'standing' },
    ].slice(0, doors);

    return {
        group, portals,
        name: 'Sky Road',
        fog, background, environment: null,
        exposure: T.exposure,
        bloom: 0.25, bloomThreshold: 0.95,
        spawn: new THREE.Vector3(spawnX, islH(spawnX, spawnZ) + 1.7, spawnZ),
        spawnYaw: Math.PI,
        eye: 1.7, speed: 6, gravity: 22, jump: 7.5, stride: 1.7,
        fallY: cloudY + 4,           // sinking into the clouds drops you out into another outdoor level
        stepType: p => roadDist(p.x, p.z) < 3.5 ? 'tile' : 'grass',
        ground, colliders,
        bounds: { minX: -3000, maxX: 3000, minZ: -3000, maxZ: 3000 },
        radius: 0.4, height: 1.85, stepHeight: 0.5, mantleHeight: 1.0,
        update: (p, t) => {
            const snap = 4, cx = Math.round(p.x / snap) * snap, cz = Math.round(p.z / snap) * snap;
            sun.target.position.set(cx, Math.max(cloudY, p.y - 1.7), cz);
            sun.position.copy(sun.target.position).addScaledVector(sunDir, 300);
            grassMat.uniforms.camPos.value.copy(p);
            grassMat.uniforms.time.value = t;
            ultraGrass?.update(p, t);
        },
        setUltra,
        setVisible: v => { group.visible = v; },
    };
}
