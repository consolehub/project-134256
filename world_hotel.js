import * as THREE from 'three';
import { makeRng } from './seed.js';
import { Foliage } from './foliage.js';
import { applyAntiTile } from './antitile.js';

export function createHotel({ scene, roomEnv, loadTex, isMobile }, seed, doorCount = 3) {
    const group = new THREE.Group();
    group.visible = false;
    scene.add(group);
    const rand = makeRng(seed, 2);

    // --- Variation ---
    const W = rand.pick([80, 90, 100, 110, 120, 130]), D = rand.pick([120, 140, 150, 170, 190]);
    const floorH = rand.pick([12, 14, 14, 16]);           // storey height
    const H = floorH * rand.int(5, 12);
    const litChance = rand.range(0.04, 0.4);
    const warm = new THREE.Color().setHSL(rand.range(0.05, 0.12), rand.range(0.7, 1), 0.6);
    const fogColor = new THREE.Color(0x3a2c32).offsetHSL(rand.range(-0.06, 0.06), rand.range(-0.1, 0.1), rand.range(-0.04, 0.05));
    const facadeTint = new THREE.Color(0xb8b0a8).offsetHSL(rand.range(-0.05, 0.05), rand.range(-0.05, 0.08), rand.range(-0.08, 0.05));
    const levels = Math.floor(H / floorH);

    // --- Materials ---
    const tile = rand.pick([5, 6, 8]);
    const floorTex = loadTex('asset_hotel_paving.png', W / tile, D / tile);
    const matFloor = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.75, metalness: 0, envMapIntensity: 0.2, color: 0xd8d2c8 });
    const matFacade = new THREE.MeshStandardMaterial({ color: facadeTint, roughness: 0.9, envMapIntensity: 0.15 });
    const matBand = new THREE.MeshStandardMaterial({ color: 0xcfc6bd, roughness: 0.8 });
    const matFrame = new THREE.MeshStandardMaterial({ color: 0x3a3634, roughness: 0.5, metalness: 0.6 });
    const matGlass = new THREE.MeshStandardMaterial({ color: 0x1a1e26, roughness: 0.05, metalness: 0.9, envMapIntensity: 1.4 });
    const matLitGlass = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: warm, emissiveIntensity: 1.6, roughness: 0.2 });
    const matSky = new THREE.MeshBasicMaterial({ color: 0x9a8a92, fog: false });

    // --- Floor ---
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), matFloor);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    group.add(floor);

    // --- Facades with real window geometry ---
    const sides = [
        { len: D, pos: (u) => new THREE.Vector3(-W / 2, 0, u), rot: Math.PI / 2 },
        { len: D, pos: (u) => new THREE.Vector3(W / 2, 0, u), rot: -Math.PI / 2 },
        { len: W, pos: (u) => new THREE.Vector3(u, 0, -D / 2), rot: 0 },
        { len: W, pos: (u) => new THREE.Vector3(u, 0, D / 2), rot: Math.PI },
    ];
    const winW = 4.6, winH = 6.5, bay = 10;
    const windows = [];
    const bands = [];
    sides.forEach(s => {
        const wall = new THREE.Mesh(new THREE.PlaneGeometry(s.len, H), matFacade);
        wall.position.copy(s.pos(0)).setY(H / 2);
        wall.rotation.y = s.rot;
        wall.receiveShadow = true;
        wall.castShadow = true;
        group.add(wall);
        const bays = Math.floor(s.len / bay);
        for (let lv = 0; lv < levels; lv++) {
            bands.push({ s, y: lv * floorH });
            if (lv === 0) continue; // ground floor gets doors instead
            for (let b = 0; b < bays; b++) {
                const u = -s.len / 2 + bay / 2 + b * bay + (s.len - bays * bay) / 2;
                windows.push({ s, u, y: lv * floorH + 5.5, lit: rand() < litChance });
            }
        }
    });
    const winCount = windows.length;
    const frameGeo = new THREE.BoxGeometry(winW + 0.8, winH + 0.8, 0.5);
    const glassGeo = new THREE.PlaneGeometry(winW, winH);
    const frames = new THREE.InstancedMesh(frameGeo, matFrame, winCount);
    const glassDark = new THREE.InstancedMesh(glassGeo, matGlass, winCount);
    const glassLit = new THREE.InstancedMesh(glassGeo, matLitGlass, winCount);
    const sillGeo = new THREE.BoxGeometry(winW + 1.4, 0.35, 1.0);
    const sills = new THREE.InstancedMesh(sillGeo, matBand, winCount);
    const dummy = new THREE.Object3D();
    let nd = 0, nl = 0;
    const place = (s, u, y, out, sx = 1, sy = 1, sz = 1) => {
        dummy.position.copy(s.pos(u)).setY(y);
        dummy.rotation.set(0, s.rot, 0);
        dummy.translateZ(out);
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        return dummy.matrix;
    };
    windows.forEach((w, k) => {
        frames.setMatrixAt(k, place(w.s, w.u, w.y, 0.05));
        sills.setMatrixAt(k, place(w.s, w.u, w.y - winH / 2 - 0.5, 0.45));
        if (w.lit) glassLit.setMatrixAt(nl++, place(w.s, w.u, w.y, 0.31));
        else glassDark.setMatrixAt(nd++, place(w.s, w.u, w.y, 0.31));
    });
    glassDark.count = nd; glassLit.count = nl;
    frames.castShadow = true;
    group.add(frames, glassDark, glassLit, sills);

    // floor bands
    const bandGeo = new THREE.BoxGeometry(1, 0.9, 0.8);
    const bandMesh = new THREE.InstancedMesh(bandGeo, matBand, bands.length);
    bands.forEach((b, k) => bandMesh.setMatrixAt(k, place(b.s, 0, b.y + (b.y === 0 ? 0.45 : 0), 0.4, b.s.len, 1, 1)));
    bandMesh.castShadow = true;
    group.add(bandMesh);

    // ground floor doors
    const doors = [];
    sides.forEach(s => { for (let u = -s.len / 2 + 15; u < s.len / 2 - 5; u += 20) doors.push({ s, u }); });
    // three of the ground-floor door slots, on three different walls, are real doorways
    const portalDoors = [];
    const sideOrder = sides.map(s => [rand(), s]).sort((a, b) => a[0] - b[0]).map(o => o[1]);
    for (let n = 0; n < doorCount; n++) {
        const s = sideOrder[n % sideOrder.length];
        let slots = doors.filter(d => d.s === s && !portalDoors.includes(d));
        if (!slots.length) continue;
        if (s === sides[3]) slots = slots.filter(d => Math.abs(d.u) > 12).length ? slots.filter(d => Math.abs(d.u) > 12) : slots;
        portalDoors.push(rand.pick(slots));
    }
    for (const d of portalDoors) doors.splice(doors.indexOf(d), 1);
    const doorMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(5, 9, 0.4), matFrame, doors.length);
    const doorGlass = new THREE.InstancedMesh(new THREE.PlaneGeometry(4, 8), matGlass, doors.length);
    doors.forEach((d, k) => {
        doorMesh.setMatrixAt(k, place(d.s, d.u, 4.5, 0.1));
        doorGlass.setMatrixAt(k, place(d.s, d.u, 4.5, 0.32));
    });
    group.add(doorMesh, doorGlass);

    // --- Solid ceiling with a single light fixture ---
    const matCeil = new THREE.MeshStandardMaterial({ color: 0xd8d0c6, roughness: 0.95, envMapIntensity: 0.1 });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), matCeil);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = H;
    group.add(ceil);
    const fixture = new THREE.Mesh(
        new THREE.CylinderGeometry(3.2, 3.2, 0.6, 48),
        new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff2e0, emissiveIntensity: 2.5 }));
    fixture.position.set(0, H - 0.3, 0);
    group.add(fixture);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.4, 48, 1, true), matFrame);
    rim.position.set(0, H - 0.25, 0);
    group.add(rim);

    // --- Courtyard floor: speckled paving, flush turf panels, a wooden circle and band ---
    const solids = [];
    const turfRects = [], woodCircles = [], woodRects = [];
    // flat piece of floor with world-space UVs (so textures line up across pieces)
    const flat = (geo, mat, y, uvSize, x, z) => {
        geo.rotateX(-Math.PI / 2);
        geo.translate(x, 0, z);
        const p = geo.attributes.position, uv = geo.attributes.uv;
        for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / uvSize, -p.getZ(i) / uvSize);
        const m = new THREE.Mesh(geo, mat);
        m.position.y = y; m.receiveShadow = true; group.add(m);
        return m;
    };
    const turfTex = loadTex('visual_grass_seamless.png', 1, 1, true, 'turf');
    const matTurf = new THREE.MeshStandardMaterial({ map: turfTex, color: new THREE.Color(0x7cbf4a).offsetHSL(rand.range(-0.03, 0.03), 0, rand.range(-0.05, 0.03)), roughness: 1, envMapIntensity: 0.1 });
    applyAntiTile(matTurf, 0.6);
    const woodTex = loadTex('asset_hotel_wood_floor.png', 1, 1, true, 'deck');
    const matWood = new THREE.MeshStandardMaterial({ map: woodTex, color: 0xc9a88a, roughness: 0.7, envMapIntensity: 0.15 });

    const margin = rand.range(8, 14), walk = rand.range(4, 8);
    const cols = W > 105 && rand.chance(0.5) ? 3 : 2;
    const bandD = rand.chance(0.7) ? rand.range(9, 15) : 0;
    const z0 = -D / 2 + margin + (bandD ? bandD + walk : 0), z1 = D / 2 - margin - 14;   // keep the entrance end open
    const rows = Math.max(1, Math.min(4, Math.round((z1 - z0) / rand.range(30, 45))));
    const cw = (W - margin * 2 - walk * (cols - 1)) / cols, rd = (z1 - z0 - walk * (rows - 1)) / rows;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
        const x = -W / 2 + margin + cw / 2 + k * (cw + walk), z = z0 + rd / 2 + r * (rd + walk);
        flat(new THREE.PlaneGeometry(cw, rd), matTurf, 0.02, 4, x, z);
        turfRects.push({ minX: x - cw / 2, maxX: x + cw / 2, minZ: z - rd / 2, maxZ: z + rd / 2 });
    }
    // the wooden circle sits where the walkways cross
    const crossings = [];
    for (let r = 1; r < rows; r++) for (let k = 1; k < cols; k++)
        crossings.push([-W / 2 + margin + k * (cw + walk) - walk / 2, z0 + r * (rd + walk) - walk / 2]);
    if (!crossings.length) crossings.push([0, (z0 + z1) / 2]);
    const [ccx, ccz] = rand.pick(crossings), cr = rand.range(5, 8.5);
    flat(new THREE.CircleGeometry(cr, 64), matWood, 0.03, 12, ccx, ccz);
    woodCircles.push([ccx, ccz, cr]);
    // a wooden band across the far end
    if (bandD) {
        const bz = -D / 2 + margin + bandD / 2;
        flat(new THREE.PlaneGeometry(W - margin * 2, bandD), matWood, 0.03, 12, 0, bz);
        woodRects.push({ minX: -W / 2 + margin, maxX: W / 2 - margin, minZ: bz - bandD / 2, maxZ: bz + bandD / 2 });
    }
    // a quarter circle of turf tucked into a corner
    if (rand.chance(0.6)) {
        const sx = rand.chance(0.5) ? -1 : 1, qr = rand.range(7, 12);
        // fan opens out of the corner into the room
        flat(new THREE.CircleGeometry(qr, 32, sx > 0 ? Math.PI : -Math.PI / 2, Math.PI / 2), matTurf, 0.02, 4, sx * W / 2, -D / 2);
        turfRects.push({ minX: sx > 0 ? W / 2 - qr : -W / 2, maxX: sx > 0 ? W / 2 : -W / 2 + qr, minZ: -D / 2, maxZ: -D / 2 + qr });
    }
    // very rarely, a single tree grows out of one of the turf panels
    if (rand.chance(0.06)) {
        const t = rand.pick(turfRects.slice(0, rows * cols));
        const tx = (t.minX + t.maxX) / 2, tz = (t.minZ + t.maxZ) / 2, th = rand.range(18, 28);
        const foliage = new Foliage(loadTex);
        foliage.tree(rand, tx, 0, tz, th);
        foliage.build(group);
        const tr = th * 0.035 + 0.1;
        solids.push({ minX: tx - tr, maxX: tx + tr, minY: 0, maxY: th * 0.5, minZ: tz - tr, maxZ: tz + tr });
    }

    // --- Light ---
    const hemi = new THREE.HemisphereLight(0xd8ccd0, 0x4a4038, 0.5);
    group.add(hemi);
    const reach = Math.hypot(W, D) / 2;
    const lamp = new THREE.SpotLight(0xffeedd, 1.1, 0, Math.min(1.35, Math.atan(reach / H) + 0.15), 0.6, 0);
    lamp.position.set(0, H - 0.8, 0);
    lamp.target.position.set(0, 0, 0);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    lamp.shadow.camera.near = 1;
    lamp.shadow.camera.far = H + 20;
    lamp.shadow.bias = -0.0005;
    lamp.shadow.normalBias = 0.3;
    group.add(lamp, lamp.target);

    return {
        group,
        portals: portalDoors.map(d => ({ pos: d.s.pos(d.u), yaw: d.s.rot })).map(p => ({ ...p, w: 5.25, h: 9.1, kind: 'wall', inset: 0.9, frameColor: 0x3a3634 })),
        name: 'Hotel Atrium',
        fog: new THREE.FogExp2(fogColor, rand.range(0.004, 0.009)),
        background: fogColor.clone(),
        environment: roomEnv,
        exposure: 0.75,
        bloom: 0.45, bloomThreshold: 0.9,
        spawn: new THREE.Vector3(0, 0, D / 2 - 20),
        eye: 7, speed: 20, gravity: 45, jump: 14, stride: 5.5,
        stepType: (p) => {
            const inR = r => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ;
            if (woodRects.some(inR) || woodCircles.some(([x, z, r]) => Math.hypot(p.x - x, p.z - z) < r)) return 'wood';
            return turfRects.some(inR) ? 'grass' : 'tile';
        },
        colliders: [...solids,
            { minX: -W / 2 - 4, maxX: -W / 2, minY: -5, maxY: H, minZ: -D / 2 - 4, maxZ: D / 2 + 4 },
            { minX: W / 2, maxX: W / 2 + 4, minY: -5, maxY: H, minZ: -D / 2 - 4, maxZ: D / 2 + 4 },
            { minX: -W / 2, maxX: W / 2, minY: -5, maxY: H, minZ: -D / 2 - 4, maxZ: -D / 2 },
            { minX: -W / 2, maxX: W / 2, minY: -5, maxY: H, minZ: D / 2, maxZ: D / 2 + 4 }],
        bounds: { minX: -W / 2 - 10, maxX: W / 2 + 10, minZ: -D / 2 - 10, maxZ: D / 2 + 10 },
        update: () => {},
        setVisible: (v) => { group.visible = v; },
    };
}
