import * as THREE from 'three';
import { fadePool } from './light_pool.js';
import { applyAntiTile } from './antitile.js';
import { makeRng } from './seed.js';
import { createSkyDome } from './sky_dome.js';

// vibrant suburban paint
const HOUSE_COLORS = [0xf0948c, 0xf27a9a, 0xc8e46a, 0x9ad65e, 0xf5dc6a, 0xffc85a, 0x6fb8ea, 0x5ad0c4, 0xb79af0, 0xf5a05a, 0x8ee0a8, 0xe6e070];

export function createNight({ scene, loadTex, isMobile }, seed, doors = 4) {
    const group = new THREE.Group();
    group.visible = false;
    scene.add(group);
    const rand = makeRng(seed, 5);

    // --- Variation ---
    const SIZE = 1200;
    // time of day, paint and street style are picked independently, so night and day suburbs blend:
    // a lone path under the stars, a painted cul-de-sac at golden hour, or anything between
    const time = rand.pick(['night', 'night', 'sunset', 'day']);
    const isNight = time === 'night';
    const colorful = rand.chance(isNight ? 0.3 : 0.92);
    const road = rand.chance(isNight ? 0.35 : 0.85);
    const pathW = rand.pick([6, 8, 8, 10]), pathL = 900;
    const roadW = rand.pick([28, 32, 36]), strip = rand.range(4, 8), walkW = 6.5;
    const streetHalf = road ? roadW / 2 + strip + walkW : pathW / 2;
    const glow = new THREE.Color(rand.pick([0x4f7dff, 0x4f7dff, 0x6a5cff, 0xffa64a, 0x3fd6c8, 0xff5f8a]));
    const spacing = rand.range(75, 105), setback = streetHalf + rand.range(35, 50), emptyLots = rand.range(0.1, 0.5);
    const litChance = rand.range(0.5, 0.95);
    const balloonCount = rand.int(1, 9);
    const fogDensity = rand.range(0.005, 0.011);

    // --- Ground: flat turf + one lone concrete path ---
    const grassTex = loadTex('visual_grass_seamless.png', SIZE / 6, SIZE / 6);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE),
        applyAntiTile(new THREE.MeshStandardMaterial({ map: grassTex, color: 0x5fd04a, roughness: 0.95 }), 0.6));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    group.add(ground);

    const solids = [];
    const pathMat = new THREE.MeshStandardMaterial({ color: 0xa3a39e, roughness: 0.95 });
    const walkMat = new THREE.MeshStandardMaterial({ color: isNight ? 0xa3a39e : 0xd2b8ae, roughness: 0.95 });
    const joint = new THREE.MeshStandardMaterial({ color: 0x77776f, roughness: 1 });
    // a raised slab you can step onto
    const slab = (mat, x, z, w, d, top) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, top, d), mat);
        m.position.set(x, top / 2, z); m.receiveShadow = true; group.add(m);
        solids.push({ minX: x - w / 2, maxX: x + w / 2, minY: 0, maxY: top, minZ: z - d / 2, maxZ: z + d / 2 });
    };
    if (!road) {
        // one lone concrete path
        const path = new THREE.Mesh(new THREE.BoxGeometry(pathW, 0.12, pathL), pathMat);
        path.position.y = 0.06;
        path.receiveShadow = true;
        group.add(path);
        const joints = new THREE.InstancedMesh(new THREE.BoxGeometry(pathW, 0.01, 0.12), joint, Math.floor(pathL / 8));
        for (let k = 0; k < joints.count; k++) joints.setMatrixAt(k, new THREE.Matrix4().makeTranslation(0, 0.125, -pathL / 2 + k * 8));
        group.add(joints);
    } else {
        // asphalt street, grass strips, sidewalks either side
        const asphalt = new THREE.Mesh(new THREE.BoxGeometry(roadW, 0.06, pathL), new THREE.MeshStandardMaterial({ color: 0x4c4e58, roughness: 0.9 }));
        asphalt.position.y = 0.03; asphalt.receiveShadow = true; group.add(asphalt);
        const curbMat = new THREE.MeshStandardMaterial({ color: 0xb8b2ac, roughness: 0.9 });
        for (const sd of [-1, 1]) {
            const curb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, pathL), curbMat);
            curb.position.set(sd * (roadW / 2 + 0.3), 0.25, 0); group.add(curb);
            slab(walkMat, sd * (roadW / 2 + strip + walkW / 2), 0, walkW, pathL, 0.5);
            const sj = new THREE.InstancedMesh(new THREE.BoxGeometry(walkW, 0.01, 0.1), joint, Math.floor(pathL / 6.5));
            for (let k = 0; k < sj.count; k++) sj.setMatrixAt(k, new THREE.Matrix4().makeTranslation(sd * (roadW / 2 + strip + walkW / 2), 0.505, -pathL / 2 + k * 6.5));
            group.add(sj);
        }
    }

    // --- Houses ---
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xcfcdc6, roughness: 0.95 });
    const roofMat = new THREE.MeshStandardMaterial({ color: isNight ? 0x2a2a2e : rand.pick([0x6e5448, 0x7a5e52, 0x5e5450, 0x8a6a58]), roughness: 0.85 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1e2630, roughness: 0.15, metalness: 0.6 });
    const paintMats = new Map();
    const paint = (hex) => paintMats.get(hex) || paintMats.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.92 })).get(hex);
    const garageMat = (hex) => paint(new THREE.Color(hex).lerp(new THREE.Color(0xffffff), 0.45).getHex());
    const driveMat = new THREE.MeshStandardMaterial({ color: isNight ? 0x8e8e88 : 0xc4b4ac, roughness: 0.95 });
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.3 });
    const carMats = [0xb8b4b8, 0x8a2a2a, 0x2a3a5a, 0xd8d4c8].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.5 }));
    const winMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: glow, emissiveIntensity: 3.0 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.85 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.7 });
    const windowLights = [];
    // flat details on house fronts: pulled toward the camera in the depth buffer as well as
    // in space, so they don't flicker against the surface behind them from far away
    const decals = new Map();
    const decal = (mat, level = 1) => {
        const key = mat.uuid + level;
        if (!decals.has(key)) {
            const m = mat.clone();
            m.polygonOffset = true; m.polygonOffsetFactor = -2 * level; m.polygonOffsetUnits = -4 * level;
            decals.set(key, m);
        }
        return decals.get(key);
    };

    function gableGeo(w, d, h) {
        const s = new THREE.Shape();
        s.moveTo(-w / 2 - 0.8, 0); s.lineTo(w / 2 + 0.8, 0); s.lineTo(0, h); s.lineTo(-w / 2 - 0.8, 0);
        const g = new THREE.ExtrudeGeometry(s, { depth: d + 1.6, bevelEnabled: false });
        g.translate(0, 0, -(d + 1.6) / 2);
        return g;
    }
    function gableWall(w, h) {
        const s = new THREE.Shape();
        s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.lineTo(-w / 2, 0);
        const g = new THREE.ShapeGeometry(s);
        return g;
    }

    function house(x, z, faceSign, doorway = false) {
        let garage = false;
        const storeys = rand() < 0.45 ? 2 : 1, floorH = 12.5 + rand();
        const w = 44 + rand() * 18, d = 34 + rand() * 12, h = storeys * floorH, rh = 10 + rand() * 7;
        const hgrp = new THREE.Group();
        const col = colorful ? rand.pick(HOUSE_COLORS) : 0xcfcdc6;
        const wallMat = paint(col);
        const darkMat = isNight ? doorMat : glassMat;
        // body
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
        body.position.y = h / 2;
        body.castShadow = body.receiveShadow = true;
        hgrp.add(body);
        // roof (gable along width or depth)
        const alongX = rand() < 0.6;
        const roof = new THREE.Mesh(alongX ? gableGeo(d, w, rh) : gableGeo(w, d, rh), roofMat);
        if (alongX) roof.rotation.y = Math.PI / 2;
        roof.position.y = h;
        roof.castShadow = true;
        hgrp.add(roof);
        // white gable ends
        [-1, 1].forEach(s => {
            const gw = new THREE.Mesh(gableWall(alongX ? d : w, rh * 0.98), wallMat);
            if (alongX) { gw.rotation.y = s * Math.PI / 2; gw.position.set(s * (w / 2 + 0.01), h, 0); }
            else { gw.rotation.y = s > 0 ? 0 : Math.PI; gw.position.set(0, h, s * (d / 2 + 0.01)); }
            hgrp.add(gw);
        });
        // front windows (facing the path) glowing blue
        const front = d / 2 + 0.05;
        const nWin = 2 + Math.floor(rand() * 2);
        const lit = isNight && rand() < litChance;
        const ww = 5, wh = 5.5;
        for (let st = 0; st < storeys; st++) {
            const wy = st * floorH + 7;
            // ground floor windows sit either side of the door / garage
            const xs = st === 0
                ? (doorway ? [-1, 1].map(sg => sg * w * 0.32) : [w * 0.05, w * 0.3].slice(0, nWin - 1))
                : Array.from({ length: nWin }, (_, k) => -w / 2 + (k + 1) * (w / (nWin + 1)));
            for (const wx of xs) {
                const fr = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.6, wh + 0.6, 0.2), frameMat);
                fr.position.set(wx, wy, front - 0.02);
                hgrp.add(fr);
                [-1, 1].forEach(sg => {
                    const pane = new THREE.Mesh(new THREE.PlaneGeometry(ww / 2 - 0.2, wh - 0.3), decal(lit ? winMat : darkMat));
                    pane.position.set(wx + sg * ww / 4, wy, front + 0.16);
                    hgrp.add(pane);
                });
            }
        }
        // door / garage
        if (doorway) {
            portals.push({ pos: new THREE.Vector3(x + faceSign * d / 2, 0, z), yaw: faceSign > 0 ? Math.PI / 2 : -Math.PI / 2,
                w: 5.25, h: 9.1, kind: 'wall', inset: 0.08, frameColor: 0xe9e6de });
        } else if (rand() < (road ? 0.2 : 0.5)) {
            const door = new THREE.Mesh(new THREE.PlaneGeometry(4, 9), decal(doorMat));
            door.position.set(-w / 2 + 9, 4.5, front + 0.05);
            hgrp.add(door);
        } else {
            const gw = new THREE.Mesh(new THREE.PlaneGeometry(11, 9), decal(isNight && !colorful ? doorMat : garageMat(col)));
            gw.position.set(-w / 2 + 8, 4.5, front + 0.05);
            hgrp.add(gw);
            // garage door panel lines
            for (let k = 1; k < 4; k++) {
                const ln = new THREE.Mesh(new THREE.PlaneGeometry(11, 0.12), decal(doorMat, 2));
                ln.position.set(-w / 2 + 8, k * 2.25, front + 0.12); hgrp.add(ln);
            }
            garage = true;
        }
        hgrp.position.set(x, 0, z);
        hgrp.rotation.y = faceSign > 0 ? Math.PI / 2 : -Math.PI / 2; // front faces the path
        group.add(hgrp);
        // footprint (rotated 90°: swap w/d)
        solids.push({ minX: x - d / 2, maxX: x + d / 2, minY: 0, maxY: h + rh, minZ: z - w / 2, maxZ: z + w / 2 });
        // driveway (garage) or front walk (doorway) out to the street, plus a mailbox
        if (road) {
            const fx = x + faceSign * d / 2;
            const edge = Math.sign(x) * (roadW / 2);
            const len = Math.abs(fx - edge), mx = (fx + edge) / 2;
            if (garage) {
                const gz = z + faceSign * (w / 2 - 8);
                slab(driveMat, mx, gz, len, 13, 0.14);
                if (rand() < 0.35) car(fx - Math.sign(fx) * 11.5, gz);
            }
            if (doorway) slab(walkMat, (fx + Math.sign(x) * (roadW / 2 + strip)) / 2, z, Math.abs(fx) - roadW / 2 - strip, 6, 0.5);
            const mbx = Math.sign(x) * (roadW / 2 + strip * 0.5), mbz = z + faceSign * (w / 2 - 8) + (garage ? 10 : 0) * faceSign;
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.2, 0.25), boxMat);
            post.position.set(mbx, 1.6, mbz); group.add(post);
            const mb = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 1.6), boxMat);
            mb.position.set(mbx, 3.4, mbz); mb.castShadow = true; group.add(mb);
            solids.push({ minX: mbx - 0.3, maxX: mbx + 0.3, minY: 0, maxY: 3.8, minZ: mbz - 0.8, maxZ: mbz + 0.8 });
        }
        if (lit) windowLights.push(new THREE.Vector3(x + (faceSign > 0 ? d / 2 + 4 : -d / 2 - 4), 7, z));
    }

    // a plain old sedan parked in a driveway
    function car(x, z) {
        const cg = new THREE.Group(), mat = rand.pick(carMats);
        const body = new THREE.Mesh(new THREE.BoxGeometry(9, 1.6, 3.6), mat);
        body.position.y = 1.4; body.castShadow = true; cg.add(body);
        const cab = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.3, 3.2), glassMat);
        cab.position.set(-0.4, 2.8, 0); cab.castShadow = true; cg.add(cab);
        const wheel = new THREE.CylinderGeometry(0.7, 0.7, 0.5, 14); wheel.rotateX(Math.PI / 2);
        for (const [wx, wz] of [[-3, -1.6], [3, -1.6], [-3, 1.6], [3, 1.6]]) {
            const wm = new THREE.Mesh(wheel, boxMat); wm.position.set(wx, 0.7, wz); cg.add(wm);
        }
        cg.position.set(x, 0.14, z);
        cg.scale.setScalar(2.25);
        group.add(cg);
        solids.push({ minX: x - 10.1, maxX: x + 10.1, minY: 0, maxY: 7.8, minZ: z - 4.1, maxZ: z + 4.1 });
    }

    const spots = [], portals = [];
    for (const side of [-1, 1]) {
        for (let z = -pathL / 2 + 30; z < pathL / 2 - 30; z += spacing + rand() * spacing * 0.5) {
            if (rand() < emptyLots) continue;
            const off = setback + rand() * 30;
            spots.push([side * off, z + (rand() - 0.5) * 10, -side]);
        }
    }
    // four houses scattered along the whole street get a real front doorway
    const near = [];
    const order = spots.map(sp => [rand(), sp]).sort((a, b) => a[0] - b[0]).map(o => o[1]);
    for (const gap of [220, 140, 70, 0]) for (const sp of order) {
        if (near.length < doors && !near.includes(sp) && near.every(o => Math.abs(o[1] - sp[1]) >= gap)) near.push(sp);
    }
    for (const s of spots) house(s[0], s[1], s[2], near.includes(s));

    // --- The chair with balloons ---
    const plastic = new THREE.MeshStandardMaterial({ color: 0xdcdcd6, roughness: 0.75 });
    const chair = new THREE.Group();
    const add = (geo, x, y, z, rx = 0, rz = 0) => {
        const m = new THREE.Mesh(geo, plastic);
        m.position.set(x, y, z); m.rotation.x = rx; m.rotation.z = rz;
        m.castShadow = true; chair.add(m); return m;
    };
    const seatY = 2.0;
    add(new THREE.BoxGeometry(2.4, 0.18, 2.2), 0, seatY, 0);
    // splayed legs
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
        add(new THREE.BoxGeometry(0.28, seatY + 0.1, 0.32), sx * 1.1, seatY / 2, sz * 1.0, sz * 0.12, -sx * 0.1);
    });
    // back with slats
    const backTilt = -0.18;
    const back = new THREE.Group();
    back.position.set(0, seatY, -1.05); back.rotation.x = backTilt; chair.add(back);
    const bAdd = (geo, x, y) => { const m = new THREE.Mesh(geo, plastic); m.position.set(x, y, 0); m.castShadow = true; back.add(m); };
    bAdd(new THREE.BoxGeometry(2.4, 0.3, 0.16), 0, 2.4);
    bAdd(new THREE.BoxGeometry(2.4, 0.2, 0.16), 0, 0.9);
    for (let k = -2; k <= 2; k++) bAdd(new THREE.BoxGeometry(0.22, 1.5, 0.12), k * 0.48, 1.65);
    bAdd(new THREE.BoxGeometry(0.22, 2.5, 0.18), -1.15, 1.25);
    bAdd(new THREE.BoxGeometry(0.22, 2.5, 0.18), 1.15, 1.25);
    // armrests
    [-1, 1].forEach(sx => {
        add(new THREE.BoxGeometry(0.3, 0.14, 2.2), sx * 1.25, seatY + 1.1, -0.05);
        add(new THREE.BoxGeometry(0.22, 1.1, 0.22), sx * 1.25, seatY + 0.55, 0.9);
    });
    const chairPos = new THREE.Vector3(rand.range(streetHalf + 1.5, streetHalf + 3.5) * (rand() < 0.5 ? -1 : 1), 0, -rand.range(25, 120));
    chair.position.copy(chairPos);
    chair.rotation.y = rand.range(-Math.PI, Math.PI);
    group.add(chair);
    solids.push({ minX: chairPos.x - 1.4, maxX: chairPos.x + 1.4, minY: 0, maxY: 5, minZ: chairPos.z - 1.4, maxZ: chairPos.z + 1.4 });

    const balloonColors = Array.from({ length: balloonCount }, () => rand.pick([0xd81f26, 0xffc21a, 0x1f5fe0, 0x7a3fc4, 0x2fa84a, 0xe0262f, 0xf2f2ee]));
    const knot = new THREE.Vector3(1.25, seatY + 1.2, 0.7).applyAxisAngle(new THREE.Vector3(0, 1, 0), chair.rotation.y).add(chairPos);
    const balloons = [];
    const stringMat = new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.7 });
    balloonColors.forEach((col, k) => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 18), new THREE.MeshPhysicalMaterial({
            color: col, roughness: 0.4, clearcoat: 0.35, clearcoatRoughness: 0.3
        }));
        m.scale.set(1, 1.18, 1);
        const a = (k / balloonColors.length) * Math.PI * 2;
        const base = knot.clone().add(new THREE.Vector3(Math.cos(a) * 1.1, 6.5 + (k % 3) * 0.7, Math.sin(a) * 1.1));
        m.position.copy(base);
        group.add(m);
        const lg = new THREE.BufferGeometry().setFromPoints([knot, base]);
        const line = new THREE.Line(lg, stringMat);
        group.add(line);
        balloons.push({ m, base, line, phase: rand() * 10 });
    });

    // --- Lighting ---
    const winPool = [];
    let flash = null, sun = null, sunDir = null;
    let fogColor, exposure, bloom, bloomThreshold;
    if (isNight) {
        // night + camera flash
        group.add(new THREE.HemisphereLight(0x2a3555, 0x0a120a, 0.35));
        flash = new THREE.SpotLight(0xfff8ee, 16, 140, 0.85, 0.7, 1.0);
        group.add(flash, flash.target);
        for (let k = 0; k < (isMobile ? 3 : 7); k++) {
            const l = new THREE.PointLight(glow, 30, 30, 1.4);
            group.add(l); winPool.push(l);
        }
        fogColor = new THREE.Color(0x040509);
        exposure = 1.0; bloom = 0.5; bloomThreshold = 1.4;
    } else {
        // hazy suburban daylight, or a low warm sunset
        const sunset = time === 'sunset';
        const az = rand.range(0, Math.PI * 2), el = sunset ? rand.range(0.06, 0.2) : rand.range(0.5, 0.95);
        sunDir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
        const zenith = sunset ? 0x5f74b8 : 0x6a8cd0, horizon = sunset ? 0xf2b893 : 0xc8cede;
        fogColor = new THREE.Color(horizon).lerp(new THREE.Color(zenith), 0.15);
        const { mesh } = createSkyDome({ zenith, horizon, ground: fogColor.getHex(), coverage: rand.range(0.0, 0.25),
            sunDir, sunColor: sunset ? 0xffb070 : 0xfff2dc, brightness: sunset ? 1.0 : 1.05 });
        group.add(mesh);
        group.add(new THREE.HemisphereLight(sunset ? 0xd8b0c0 : 0xbccfee, 0x4a6038, sunset ? 0.8 : 1.0));
        sun = new THREE.DirectionalLight(sunset ? 0xffb27a : 0xfff0dc, sunset ? 2.6 : 2.4);
        sun.castShadow = true;
        sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
        Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 1, far: 700 });
        sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.4;
        group.add(sun, sun.target);
        exposure = sunset ? 0.85 : 0.8; bloom = 0.3; bloomThreshold = 0.95;
    }

    const EYE = 7;
    let lastSort = -1e9;
    const dir = new THREE.Vector3();
    return {
        group,
        portals,
        name: isNight ? 'Night Lawn' : 'Suburbia',
        fog: new THREE.FogExp2(fogColor, isNight ? fogDensity : fogDensity * 0.45),
        background: fogColor.clone(),
        environment: null,
        exposure, bloom, bloomThreshold,
        spawn: new THREE.Vector3(0, 0, 0),
        eye: EYE, speed: 16, gravity: 45, jump: 14, stride: 5.5,
        stepType: (p) => ((road ? p.y > 0.1 || Math.abs(p.x) < roadW / 2 : Math.abs(p.x) < pathW / 2) ? 'tile' : 'grass'),
        ground: (x) => (road ? (Math.abs(x) < roadW / 2 ? 0.06 : 0) : (Math.abs(x) < pathW / 2 ? 0.12 : 0)),
        colliders: solids,
        bounds: { minX: -SIZE / 2 + 20, maxX: SIZE / 2 - 20, minZ: -SIZE / 2 + 20, maxZ: SIZE / 2 - 20 },
        update: (pos, t, dt, camera) => {
            if (flash) {
                // flash sits just above the lens and points where you look
                flash.position.set(pos.x, pos.y + 0.6, pos.z);
                if (camera) camera.getWorldDirection(dir); else dir.set(0, 0, -1);
                flash.target.position.copy(pos).addScaledVector(dir, 10);
            }
            if (sun) {
                const sx = Math.round(pos.x / 4) * 4, sz = Math.round(pos.z / 4) * 4;
                sun.target.position.set(sx, 0, sz);
                sun.position.set(sx, 0, sz).addScaledVector(sunDir, 300);
            }
            balloons.forEach(b => {
                b.m.position.set(
                    b.base.x + Math.sin(t * 0.7 + b.phase) * 0.25,
                    b.base.y + Math.sin(t * 1.1 + b.phase) * 0.12,
                    b.base.z + Math.cos(t * 0.6 + b.phase) * 0.25);
                const p = b.line.geometry.attributes.position;
                p.setXYZ(1, b.m.position.x, b.m.position.y - 0.85, b.m.position.z);
                p.needsUpdate = true;
            });
            if (t - lastSort > 0.5) {
                lastSort = t;
                windowLights.sort((a, b) => a.distanceToSquared(pos) - b.distanceToSquared(pos));
                winPool.forEach((l, k) => { const w = windowLights[k]; if (w) l.position.copy(w); l.userData.base = w ? 30 : 0; });
            }
            if (winPool.length) fadePool(winPool, pos, windowLights.length <= winPool.length);
        },
        setVisible: (v) => { group.visible = v; },
    };
}
