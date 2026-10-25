import * as THREE from 'three';
import { fadePool } from './light_pool.js';
import { makeRng } from './seed.js';

// --------------------------------------------------------------------------
// The Stairwell: a square stairwell around an open well that never ends, up or down.
// The geometry repeats every PATTERN revolutions; the player is quietly shifted by one
// pattern whenever they leave the middle stretch, so you can climb (or descend) forever.
// Variations: size of the well, normal / flickering / dead lights, how wet and mouldy it is.
// --------------------------------------------------------------------------

const PATTERN = 2;          // revolutions before the puddles and mould repeat
const PERIODS = 5;          // patterns built (the player always stays in the middle one)
const MID = Math.floor(PERIODS / 2) * PATTERN;   // first revolution of the middle stretch

// per-flight frames: d = climbing direction, o = outward (toward the outer wall)
const D = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const O = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const YAW = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

// box geometry whose UVs are in world units / unit, so textures keep a constant size
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

let puddleTex = null, checkerTex = null;
function getPuddleTex() {
    if (puddleTex) return puddleTex;
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const r = makeRng(77, 1);
    g.filter = 'blur(6px)';
    g.fillStyle = '#fff';
    for (let k = 0; k < 9; k++) {
        const a = r() * Math.PI * 2, d = r() * 55;
        g.beginPath();
        g.ellipse(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 30 + r() * 40, 22 + r() * 30, r() * 3, 0, Math.PI * 2);
        g.fill();
    }
    puddleTex = new THREE.CanvasTexture(c);
    return puddleTex;
}
function getCheckerTex() {
    if (checkerTex) return checkerTex;
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = '#b9b5ab'; g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#141414'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
    checkerTex = new THREE.CanvasTexture(c);
    checkerTex.magFilter = THREE.NearestFilter;
    checkerTex.wrapS = checkerTex.wrapT = THREE.RepeatWrapping;
    checkerTex.colorSpace = THREE.SRGBColorSpace;
    return checkerTex;
}

export function createStairwell({ scene, roomEnv, loadTex, isMobile }, seed, doors = 2) {
    const group = new THREE.Group();
    group.visible = false;
    scene.add(group);
    const rand = makeRng(seed, 11);

    // --- Variation ---
    const size = rand.pick(['narrow', 'standard', 'standard', 'grand']);
    const n = size === 'narrow' ? rand.int(6, 8) : size === 'standard' ? rand.int(9, 12) : rand.int(14, 19);   // risers per flight
    const wF = size === 'narrow' ? rand.range(6.4, 7) : size === 'standard' ? rand.range(7.2, 8.6) : rand.range(9, 11.5);
    const lights = rand.chance(0.24) ? 'dark' : rand.chance(0.4) ? 'flicker' : 'normal';
    const wetness = rand.range(0.2, 1);
    const mould = rand.range(0.25, 1);
    const tread = 1.15, rise = 0.72;
    const R = (n - 1) * tread;          // open well, and length of each flight
    const L = R + 2 * wF;               // inner size of the shaft
    const c = R / 2 + wF / 2;           // lateral centre of the flights
    const P = 4 * n * rise;             // height of one revolution
    const REVS = PATTERN * PERIODS;
    const totalH = REVS * P;
    const T = 1.2;                      // outer wall thickness
    const railH = 3.6;
    const RAIL_TOP = 2.2;       // railing collider height above its step: jump at it to climb over
    const fogColor = new THREE.Color(0x2b2f2b).offsetHSL(rand.range(-0.03, 0.03), rand.range(-0.05, 0.05), rand.range(-0.03, 0.03));
    const fogDensity = rand.range(0.014, 0.022) * (size === 'grand' ? 0.85 : 1);

    // --- Materials ---
    const terrazzo = loadTex('asset_stair_terrazzo.jpg', 1, 1, true, 'stair');
    const tiles = loadTex('asset_stair_tiles.jpg', 1, 1, true, 'stair');
    const moldTex = loadTex('asset_stair_mold.png', 1, 1, true, 'stair');
    const matStep = new THREE.MeshStandardMaterial({ map: terrazzo, color: 0xb8b4aa, roughness: 0.6, envMapIntensity: 0.3 });
    const matWall = new THREE.MeshStandardMaterial({ map: tiles, color: new THREE.Color(0xe6dfc8).offsetHSL(rand.range(-0.02, 0.02), 0, rand.range(-0.08, 0)), roughness: 0.35, envMapIntensity: 0.45 });
    const matIron = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5, metalness: 0.6 });
    const matWood = new THREE.MeshStandardMaterial({ color: 0x3a2116, roughness: 0.45 });
    const matNose = new THREE.MeshStandardMaterial({ map: getCheckerTex(), roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1 });
    const matLamp = new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0xffe2b0, emissiveIntensity: 2.2, roughness: 0.4 });
    const matPuddle = new THREE.MeshStandardMaterial({ color: 0x0a0c0b, roughness: 0.03, metalness: 0.1, envMapIntensity: 1.6,
        alphaMap: getPuddleTex(), transparent: true, depthWrite: false, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2 });
    const matMold = new THREE.MeshStandardMaterial({ map: moldTex, transparent: true, depthWrite: false, roughness: 1,
        polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });

    const colliders = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qp = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
    const at = (k, a, l) => [D[k][0] * a + O[k][0] * l, D[k][1] * a + O[k][1] * l];

    // --- Steps, landings, nosings, railings ---
    const steps = 4 * (n - 1) * REVS, landings = 4 * REVS;
    const stepMesh = new THREE.InstancedMesh(boxGeo(tread, rise * 2, wF, 8), matStep, steps);
    const noseMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(tread * 0.34, 0.03, wF * 0.84), matNose, steps);
    noseMesh.geometry.attributes.uv.array.forEach((_, i, arr) => { if (i % 2) arr[i] *= wF * 0.84 / (tread * 0.34); });
    const balMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, railH, 0.14), matIron, steps);
    const landMesh = new THREE.InstancedMesh(boxGeo(wF, rise * 3, wF, 8), matStep, landings);
    const railMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.32, 0.5), matWood, 4 * REVS);
    const pitch = Math.atan2(rise, tread);
    let si = 0, li = 0, ri = 0;
    const landTops = [];   // [rev][corner] -> y
    for (let r = 0; r < REVS; r++) {
        landTops.push([]);
        for (let k = 0; k < 4; k++) {
            const y0 = r * P + k * n * rise;
            landTops[r].push(y0);
            q.setFromAxisAngle(Y, YAW[k]);
            // landing at the start of flight k
            const [lx, lz] = at(k, -c, c);
            m4.compose(v.set(lx, y0 - rise * 1.5, lz), q, s.set(1, 1, 1));
            landMesh.setMatrixAt(li++, m4);
            colliders.push({ minX: lx - wF / 2, maxX: lx + wF / 2, minY: y0 - rise * 3, maxY: y0, minZ: lz - wF / 2, maxZ: lz + wF / 2 });
            for (let i = 1; i < n; i++) {
                const a = -R / 2 + (i - 0.5) * tread, top = y0 + i * rise;
                const [x, z] = at(k, a, c);
                m4.compose(v.set(x, top - rise, z), q, s.set(1, 1, 1));
                stepMesh.setMatrixAt(si, m4);
                const [nx, nz] = at(k, a - tread * 0.3, c);
                m4.compose(v.set(nx, top + 0.015, nz), q, s.set(1, 1, 1));
                noseMesh.setMatrixAt(si, m4);
                const [bx, bz] = at(k, a, R / 2 + 0.3);
                m4.compose(v.set(bx, top + railH / 2, bz), q, s.set(1, 1, 1));
                balMesh.setMatrixAt(si, m4);
                si++;
                const hw = (D[k][0] ? tread : wF) / 2, hd = (D[k][0] ? wF : tread) / 2;
                colliders.push({ minX: x - hw, maxX: x + hw, minY: top - rise * 2, maxY: top, minZ: z - hd, maxZ: z + hd });
            }
            // handrail, and the invisible barrier keeping you out of the well
            const [hx, hz] = at(k, 0, R / 2 + 0.3);
            qp.setFromAxisAngle(Z, pitch);
            m4.compose(v.set(hx, y0 + (n - 1) / 2 * rise + rise * 0.5 + railH, hz), q.clone().multiply(qp), s.set(R / Math.cos(pitch) + 0.4, 1, 1));
            railMesh.setMatrixAt(ri++, m4);
            // the railing: too tall to walk over, low enough to jump over into the well
            for (let i = 1; i < n; i++) {
                const top = y0 + i * rise;
                const [ax, az] = at(k, -R / 2 + (i - 1) * tread, R / 2), [bx2, bz2] = at(k, -R / 2 + i * tread, R / 2 + 0.5);
                colliders.push({ minX: Math.min(ax, bx2), maxX: Math.max(ax, bx2), minY: top - rise * 2, maxY: top + RAIL_TOP,
                    minZ: Math.min(az, bz2), maxZ: Math.max(az, bz2), noStep: true });
            }
        }
    }
    stepMesh.receiveShadow = landMesh.receiveShadow = true;
    group.add(stepMesh, noseMesh, balMesh, landMesh, railMesh);

    // --- Outer walls ---
    const H0 = -P, H1 = totalH + P;
    const wallGeoX = boxGeo(L + 2 * T, H1 - H0, T, 4), wallGeoZ = boxGeo(T, H1 - H0, L + 2 * T, 4);
    for (const [gx, gz, geo] of [[0, -(L + T) / 2, wallGeoX], [0, (L + T) / 2, wallGeoX], [-(L + T) / 2, 0, wallGeoZ], [(L + T) / 2, 0, wallGeoZ]]) {
        const w = new THREE.Mesh(geo, matWall);
        w.position.set(gx, (H0 + H1) / 2, gz);
        w.receiveShadow = true;
        group.add(w);
        const hx = geo === wallGeoX ? (L + 2 * T) / 2 : T / 2, hz = geo === wallGeoX ? T / 2 : (L + 2 * T) / 2;
        colliders.push({ minX: gx - hx, maxX: gx + hx, minY: H0, maxY: H1, minZ: gz - hz, maxZ: gz + hz });
    }

    const slots = [];
    for (let r = 0; r < PATTERN; r++) for (let k = 0; k < 4; k++) for (const side of [0, 1]) slots.push([r, k, side]);
    for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
    // never right where you arrive
    const chosen = slots.filter(([r, k]) => !(r === 0 && k === 0)).slice(0, doors);
    const doorW = 5.25, doorH = 9.1;
    const hasDoor = (pr, k, side) => chosen.some(([r, kk, sd]) => r === pr && kk === k && sd === side);
    // wall u of corner landing k: side 1 = outward wall, side 0 = the wall behind the arriving flight
    const wallDir = (k, side) => side ? O[k] : [-D[k][0], -D[k][1]];

    // --- Wall lamps above every landing (never on a wall with a doorway) ---
    const lamps = [];
    const lampMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.7, 0.35), matLamp, landings);
    for (let r = 0; r < REVS; r++) for (let k = 0; k < 4; k++) {
        const pr0 = r % PATTERN;
        const side = !hasDoor(pr0, k, 1) ? 1 : !hasDoor(pr0, k, 0) ? 0 : 1;
        const u = wallDir(k, side);
        const [cx, cz] = at(k, -c, c);
        // both walls have doors: mount it above the doorway instead
        const lampY = hasDoor(pr0, k, side) ? doorH + 1.6 : 8.2;
        const p = new THREE.Vector3(cx + u[0] * (wF / 2 - 0.18), landTops[r][k] + lampY, cz + u[1] * (wF / 2 - 0.18));
        q.setFromAxisAngle(Y, side ? YAW[k] : YAW[(k + 3) % 4]);
        m4.compose(p, q, s.set(1, 1, 1));
        lampMesh.setMatrixAt(lamps.length, m4);
        const pr = makeRng(seed, 500 + (r % PATTERN) * 4 + k);   // lamp state repeats with the pattern
        lamps.push({ p, i: lamps.length, phase: pr() * 100, rate: pr.range(0.6, 1.6),
            dead: pr.chance(lights === 'flicker' ? 0.15 : 0.06), flick: lights === 'flicker' ? pr.chance(0.65) : pr.chance(0.06) });
        lampMesh.setColorAt(lamps.length - 1, new THREE.Color(lamps[lamps.length - 1].dead ? 0.1 : 1, lamps[lamps.length - 1].dead ? 0.1 : 1, lamps[lamps.length - 1].dead ? 0.1 : 1));
    }
    group.add(lampMesh);
    const ambient = new THREE.HemisphereLight(0xe8e4d0, 0x30332c, lights === 'flicker' ? 0.18 : 0.3);
    group.add(ambient);
    const pool = [];
    for (let k = 0; k < (isMobile ? 4 : 9); k++) {
        const l = new THREE.PointLight(0xffe2b0, 10, 46, 1);
        group.add(l); pool.push(l);
    }

    // --- Puddles and mould (one pattern, repeated) ---
    const puddles = [], molds = [];
    for (let pr = 0; pr < PATTERN; pr++) {
        const rr = makeRng(seed, 900 + pr);
        for (let k = 0; k < 4; k++) {
            const y0 = pr * P + k * n * rise;
            // on the landing
            const count = rr.int(0, Math.round(2.5 * wetness));
            for (let j = 0; j < count; j++) {
                const [x, z] = at(k, -c + rr.range(-wF / 3, wF / 3), c + rr.range(-wF / 3, wF / 3));
                const sz = rr.range(2.5, wF * 0.7);
                puddles.push({ x, z, y: y0, sx: sz, sz: sz * rr.range(0.6, 1), rot: rr() * 6.3 });
            }
            // the odd step holding water, where it drips down the flight
            for (let i = 1; i < n; i++) if (rr.chance(0.12 * wetness)) {
                const [x, z] = at(k, -R / 2 + (i - 0.5) * tread + 0.1, c + rr.range(-wF / 4, wF / 4));
                const w = rr.range(1.5, wF * 0.6);
                const along = D[k][0] !== 0;
                puddles.push({ x, z, y: y0 + i * rise, sx: along ? tread * 0.75 : w, sz: along ? w : tread * 0.75, rot: 0 });
            }
            // mould creeping up from the corners and the edges of the landings
            const mc = rr.int(1, Math.round(1 + 6 * mould));
            for (let j = 0; j < mc; j++) {
                const wall = rr.chance(0.5) ? 'o' : 'b';
                const u = wall === 'o' ? O[k] : [-D[k][0], -D[k][1]];
                const along = rr.chance(0.6) ? rr.range(-wF / 2, -wF / 2 + 2.5) : rr.range(-wF / 2, wF / 2 + R * 0.3);
                const [lx, lz] = at(k, -c, c);
                const tx = -u[1], tz = u[0];     // along the wall
                const x = lx + u[0] * (wF / 2 - 0.03) + tx * along, z = lz + u[1] * (wF / 2 - 0.03) + tz * along;
                const big = rr.range(2, 4 + 7 * mould);
                const y = y0 + rr.range(-1, 6) * (rr.chance(0.7) ? 0.4 : 1.6);
                molds.push({ x, z, y, s: big, yaw: Math.atan2(-u[0], -u[1]), roll: rr() * 6.3, floor: false });
                for (let t = 0; t < 2; t++) if (rr.chance(0.6)) molds.push({ x: x + tx * rr.range(-3, 3), z: z + tz * rr.range(-3, 3),
                    y: y + rr.range(-2, 3), s: big * rr.range(0.25, 0.5), yaw: Math.atan2(-u[0], -u[1]), roll: rr() * 6.3, floor: false });
            }
            // under the landing above: damp ceiling blooms
            if (rr.chance(0.5 * mould)) {
                const [x, z] = at(k, -c + rr.range(-2, 2), c + rr.range(-2, 2));
                molds.push({ x, z, y: y0 + P - rise * 3 - 0.03, s: rr.range(3, 7), yaw: 0, roll: rr() * 6.3, floor: 'ceil' });
            }
        }
    }
    // keep doorways clear of mould
    const clear = (o) => {
        if (o.floor) return true;
        for (const [r, k, side] of chosen) {
            const u = wallDir(k, side);
            const [cx, cz] = at(k, -c, c);
            const wx = cx + u[0] * wF / 2, wz = cz + u[1] * wF / 2;
            const onWall = Math.abs((o.x - wx) * u[0] + (o.z - wz) * u[1]) < 0.3;
            const along = Math.abs((o.x - wx) * -u[1] + (o.z - wz) * u[0]);
            const y0 = landTops[r][k];
            if (onWall && along < doorW / 2 + o.s * 0.45 + 0.5 && o.y > y0 - o.s * 0.45 - 0.5 && o.y < y0 + doorH + o.s * 0.45 + 0.6) return false;
        }
        return true;
    };
    molds.splice(0, molds.length, ...molds.filter(clear));
    const reps = REVS / PATTERN;
    const puddleMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), matPuddle, Math.max(1, puddles.length * reps));
    const moldMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), matMold, Math.max(1, molds.length * reps));
    puddleMesh.count = puddles.length * reps; moldMesh.count = molds.length * reps;
    let pi = 0, mi = 0;
    const e = new THREE.Euler();
    for (let rep = 0; rep < reps; rep++) {
        const dy = rep * PATTERN * P;
        for (const p of puddles) {
            q.setFromAxisAngle(Y, p.rot);
            m4.compose(v.set(p.x, p.y + dy + 0.02, p.z), q, s.set(p.sx, 1, p.sz));
            puddleMesh.setMatrixAt(pi++, m4);
        }
        for (const o of molds) {
            if (o.floor === 'ceil') e.set(Math.PI / 2, 0, o.roll, 'YXZ'); else e.set(0, o.yaw, o.roll, 'YXZ');
            q.setFromEuler(e);
            m4.compose(v.set(o.x, o.y + dy, o.z), q, s.set(o.s, o.s, 1));
            moldMesh.setMatrixAt(mi++, m4);
        }
    }
    puddleMesh.renderOrder = 1; moldMesh.renderOrder = 1;
    group.add(puddleMesh, moldMesh);

    // --- Doorways: on landing walls in the middle stretch; the same spots elsewhere hold shut doors ---
    const portals = [];
    const matDoor = new THREE.MeshStandardMaterial({ color: 0x4a2c1c, roughness: 0.6 });
    const matFrame = new THREE.MeshStandardMaterial({ color: 0xcfc8b4, roughness: 0.7 });
    const doorGeo = new THREE.BoxGeometry(doorW, doorH, 0.3), frameGeo = new THREE.BoxGeometry(doorW + 0.8, doorH + 0.4, 0.2);
    for (const [r, k, side] of chosen) {
        const u = side ? O[k] : [-D[k][0], -D[k][1]];
        const [lx, lz] = at(k, -c, c);
        const x = lx + u[0] * wF / 2, z = lz + u[1] * wF / 2;
        const yaw = Math.atan2(-u[0], -u[1]);
        portals.push({ pos: new THREE.Vector3(x, landTops[MID + r][k], z), yaw, w: doorW, h: doorH, kind: 'wall', frameColor: 0xcfc8b4 });
        // shut doors at the same spot on every other repeat
        for (let rep = 0; rep < reps; rep++) {
            const rv = rep * PATTERN + r;
            if (rv === MID + r) continue;
            const yb = landTops[rv][k];
            const fr = new THREE.Mesh(frameGeo, matFrame), dr = new THREE.Mesh(doorGeo, matDoor);
            fr.position.set(x - u[0] * 0.08, yb + doorH / 2, z - u[1] * 0.08);
            dr.position.set(x - u[0] * 0.12, yb + doorH / 2, z - u[1] * 0.12);
            fr.rotation.y = dr.rotation.y = yaw;
            group.add(fr, dr);
        }
    }

    // --- Endless: stay within the middle stretch ---
    const bandLo = MID * P - rise * 0.5, bandH = PATTERN * P;
    const puddleAt = (f) => puddles.some(p => {
        const ly = ((f.y - bandLo) % bandH + bandH) % bandH + bandLo - MID * P;
        return Math.abs(ly - p.y) < 0.3 && Math.hypot((f.x - p.x) / p.sx, (f.z - p.z) / p.sz) < 0.4;
    });

    let lastKey = '';
    const lit = lamps.filter(l => !l.dead);
    const lampColor = new THREE.Color();
    return {
        group, portals,
        name: lights === 'dark' ? 'Dead Stairwell' : 'The Stairwell',
        blackout: lights === 'dark',
        fog: new THREE.FogExp2(fogColor, fogDensity),
        background: fogColor.clone(),
        environment: roomEnv,
        exposure: 1.0,
        bloom: 0.45, bloomThreshold: 0.85,
        spawn: new THREE.Vector3(-c, landTops[MID][0], -c),
        spawnYaw: -Math.PI / 2,
        eye: 7, speed: 18, gravity: 45, jump: 14, stride: 5,
        stepType: (f) => puddleAt(f) ? 'water' : 'tile',
        colliders,
        bounds: { minX: -L / 2 - 3, maxX: L / 2 + 3, minZ: -L / 2 - 3, maxZ: L / 2 + 3 },
        wrapY: (f) => f.y < bandLo || f.y >= bandLo + bandH ? -Math.floor((f.y - bandLo) / bandH) * bandH : 0,
        terminal: 70,
        update: (pos, t) => {
            const key = Math.round(pos.x / 4) + ',' + Math.round(pos.y / 4) + ',' + Math.round(pos.z / 4);
            if (key !== lastKey) {
                lastKey = key;
                lit.sort((a, b) => a.p.distanceToSquared(pos) - b.p.distanceToSquared(pos));
                pool.forEach((l, k) => { const o = lit[k]; if (!o) return; l.position.set(o.p.x, o.p.y - 0.8, o.p.z).addScaledVector(v.set(o.p.x, 0, o.p.z).normalize(), -0.8); l.userData.o = o; });
            }
            let dirty = false;
            for (const L of lit) {
                if (!L.flick) continue;
                const x = t * L.rate + L.phase;
                const on = lights === 'flicker'
                    ? Math.sin(x * 9) + Math.sin(x * 23.1) + Math.sin(x * 3.7) > (Math.sin(x * 0.4) > 0.3 ? 0.9 : -1.2)
                    : Math.sin(x * 13) + Math.sin(x * 31.7) + Math.sin(x * 5.3) > -0.6;
                if (L.on !== on) { L.on = on; dirty = true; lampMesh.setColorAt(L.i, lampColor.setScalar(on ? 1 : 0.12)); }
            }
            if (dirty) lampMesh.instanceColor.needsUpdate = true;
            pool.forEach(l => { const o = l.userData.o; l.userData.base = !o ? 0 : o.flick && !o.on ? 0.3 : 10; });
            fadePool(pool, pos, lit.length <= pool.length);
        },
        setVisible: (vis) => { group.visible = vis; },
    };
}
