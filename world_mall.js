import * as THREE from 'three';
import { fadePool } from './light_pool.js';
import { makeRng } from './seed.js';

// A completely empty two-storey shopping mall: a long atrium with glass railings, skylights,
// escalators and rows of shut storefronts. Units are metres (eye height 1.7).

/** Lighting of a variation (its own stream) */
export function mallTime(seed) {
    return makeRng(seed, 100).pick(['day', 'day', 'sunset', 'lit', 'dark', 'dark']);
}

const PALETTES = [
    { wall: 0xf1ede4, tile: [0xd8cab0, 0xa69780], bands: [0x1f8f86, 0xe0a040, 0xd9c7a0] },
    { wall: 0xeeeeea, tile: [0xcfcac0, 0x8f8a82], bands: [0x2e6f9e, 0xb84a3a, 0xc8c4b8] },
    { wall: 0xf3e9dc, tile: [0xe2d2bc, 0xb09878], bands: [0x7a3f6e, 0x3e8a5a, 0xe6b880] },
    { wall: 0xe9ece8, tile: [0xc8d0cc, 0x8a9894], bands: [0x2a9a9a, 0xd87a3a, 0xa8b8b0] },
];

function canvasTex(w, h, draw) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
}
const hex = c => '#' + new THREE.Color(c).getHexString();

function tileTexture(base, grout, diagonal) {
    return canvasTex(512, 512, (g, W) => {
        g.fillStyle = hex(grout); g.fillRect(0, 0, W, W);
        const b = new THREE.Color(base), c = new THREE.Color();
        const tileAt = () => { c.copy(b).multiplyScalar(0.94 + Math.random() * 0.1); return hex(c); };
        if (diagonal) {
            // a 45 degree grid whose period divides the canvas, so it repeats seamlessly
            const d = W / (4 * Math.SQRT2);
            g.save(); g.translate(W / 2, W / 2); g.rotate(Math.PI / 4);
            for (let i = -8; i < 8; i++) for (let j = -8; j < 8; j++) { g.fillStyle = tileAt(); g.fillRect(i * d + 2, j * d + 2, d - 4, d - 4); }
            g.restore();
        } else {
            const d = W / 6;
            for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { g.fillStyle = tileAt(); g.fillRect(i * d + 2, j * d + 2, d - 4, d - 4); }
        }
        // a faint polished sheen
        for (let k = 0; k < 2500; k++) { g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(Math.random() * W, Math.random() * W, 3, 3); }
    });
}

function grateTexture() {
    return canvasTex(256, 256, (g, W) => {
        g.fillStyle = '#8c9094'; g.fillRect(0, 0, W, W);
        for (let y = 0; y < W; y += 8) {
            g.fillStyle = '#a9adb1'; g.fillRect(0, y, W, 4);
            g.fillStyle = '#6c7074'; g.fillRect(0, y + 6, W, 2);
        }
        g.fillStyle = '#55595c'; g.fillRect(0, W - 10, W, 10);
    });
}

function exitTexture() {
    return canvasTex(128, 48, (g) => {
        g.fillStyle = '#1a0606'; g.fillRect(0, 0, 128, 48);
        g.fillStyle = '#ff3a2a'; g.font = 'bold 34px Arial, sans-serif'; g.textAlign = 'center';
        g.fillText('EXIT', 64, 37);
    });
}

export function createMall({ scene, loadTex, isMobile }, seed, doors = 3) {
    const group = new THREE.Group();
    scene.add(group);
    const rand = makeRng(seed, 0);
    const mode = mallTime(seed);
    const dark = mode === 'dark', lit = mode === 'lit', sunny = mode === 'day' || mode === 'sunset';

    // --- Variation ---
    const P = rand.pick(PALETTES);
    const twoFloors = rand.chance(0.8);
    const nb = rand.int(6, 11), bayL = 10;
    const hz = (nb * bayL + 8) / 2;           // half length
    const HW = 12, VW = 6;                    // storefront line, atrium (void) half widths
    const F2 = 5.5, slabT = 0.35;
    const H = twoFloors ? 11 : 8;
    const voidZ = hz - 6;
    const hasFountain = rand.chance(0.35);
    const fountainWet = hasFountain && !dark && rand.chance(0.6);
    const hasKiosks = rand.chance(0.4);
    const pendantColor = rand.pick([0xf4f0e6, 0x7ac86a, 0xe8b860, 0xf4f0e6]);

    // --- Materials ---
    const white = new THREE.MeshStandardMaterial({ color: P.wall, roughness: 0.85 });
    const tileTex = tileTexture(P.tile[0], P.tile[1], rand.chance(0.6));
    const floorMat = new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.32, metalness: 0.05 });
    const storeGlass = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.12, metalness: 0.7 });
    const grateMat = new THREE.MeshStandardMaterial({ map: grateTexture(), roughness: 0.55, metalness: 0.6 });
    const railGlass = new THREE.MeshStandardMaterial({ color: 0xcfe8e2, roughness: 0.05, metalness: 0.1,
        transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
    const metal = new THREE.MeshStandardMaterial({ color: 0xa4a8ac, roughness: 0.3, metalness: 0.85 });
    const blackRubber = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6 });
    const glow = (c, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) });
    const downK = lit ? 3.2 : mode === 'sunset' ? 1.6 : mode === 'day' ? 0.9 : 0.06;
    const downMat = glow(0xfff2dc, downK);
    const skyCol = { day: [0xeaf3ff, 2.4], sunset: [0xffc898, 1.7], lit: [0x0a1222, 1], dark: [0x050912, 1] }[mode];
    const skyMat = glow(skyCol[0], skyCol[1]);

    // --- Helpers ---
    const colliders = [];
    const box = (minX, maxX, minY, maxY, minZ, maxZ, mat, solid = true, cast = true) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ), mat);
        m.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
        m.castShadow = cast; m.receiveShadow = true;
        group.add(m);
        if (solid) colliders.push({ minX, maxX, minY, maxY, minZ, maxZ });
        return m;
    };
    const floor = (minX, maxX, minZ, maxZ, y) => {
        const geo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ);
        geo.rotateX(-Math.PI / 2);
        geo.translate((minX + maxX) / 2, y, (minZ + maxZ) / 2);
        const p = geo.attributes.position, uv = geo.attributes.uv;
        for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 4, p.getZ(i) / 4);
        const m = new THREE.Mesh(geo, floorMat);
        m.receiveShadow = true;
        group.add(m);
    };
    // glass balustrade between two points on the upper floor (or any height y)
    const rail = (x1, z1, x2, z2, y = F2) => {
        const alongX = Math.abs(x2 - x1) > Math.abs(z2 - z1);
        const a = Math.min(alongX ? x1 : z1, alongX ? x2 : z2), b = Math.max(alongX ? x1 : z1, alongX ? x2 : z2);
        if (b - a < 0.05) return;
        const c = alongX ? z1 : x1;
        if (alongX) {
            box(a, b, y, y + 1.05, c - 0.015, c + 0.015, railGlass, false, false);
            box(a, b, y + 1.05, y + 1.11, c - 0.04, c + 0.04, metal, false);
            colliders.push({ minX: a, maxX: b, minY: y, maxY: y + 1.15, minZ: c - 0.1, maxZ: c + 0.1 });
        } else {
            box(c - 0.015, c + 0.015, y, y + 1.05, a, b, railGlass, false, false);
            box(c - 0.04, c + 0.04, y + 1.05, y + 1.11, a, b, metal, false);
            colliders.push({ minX: c - 0.1, maxX: c + 0.1, minY: y, maxY: y + 1.15, minZ: a, maxZ: b });
        }
    };

    // --- Ground floor ---
    floor(-HW, HW, -hz, hz, 0);

    // --- Upper floor: walkways around the atrium, joined by a bridge at the escalators ---
    const zb = twoFloors ? rand.range(-voidZ + 13, voidZ - 6) : 0;
    const run = 22 * 0.4;
    if (twoFloors) {
        const slab = (x0, x1, z0, z1) => { box(x0, x1, F2 - slabT, F2, z0, z1, white); floor(x0, x1, z0, z1, F2 + 0.004); };
        slab(-HW, -VW, -hz, hz); slab(VW, HW, -hz, hz);
        slab(-VW, VW, -hz, -voidZ); slab(-VW, VW, voidZ, hz);
        slab(-VW, VW, zb - 2, zb + 2);
        // deep white parapet under the railing edge, as in old malls
        const beam = (x0, x1, z0, z1) => box(x0, x1, F2 - 1.2, F2 - slabT, z0, z1, white, false);
        beam(-VW, -VW + 0.3, -voidZ, voidZ); beam(VW - 0.3, VW, -voidZ, voidZ);
        beam(-VW, VW, -voidZ, -voidZ + 0.3); beam(-VW, VW, voidZ - 0.3, voidZ);
        beam(-VW, VW, zb - 2, zb - 1.7); beam(-VW, VW, zb + 1.7, zb + 2);
        for (const sx of [-VW, VW]) { rail(sx, -voidZ, sx, zb - 2); rail(sx, zb + 2, sx, voidZ); }
        rail(-VW, -voidZ, VW, -voidZ); rail(-VW, voidZ, VW, voidZ);
        rail(-VW, zb + 2, VW, zb + 2);
        rail(-VW, zb - 2, -2.75, zb - 2); rail(2.75, zb - 2, VW, zb - 2);

        // --- Escalators (one up, one down) rising to the bridge ---
        const z0 = zb - 2 - run;
        const stepMat = new THREE.MeshStandardMaterial({ color: 0x6a6e72, roughness: 0.5, metalness: 0.6 });
        for (const [x0, x1] of [[-2.6, -0.15], [0.15, 2.6]]) {
            const steps = new THREE.InstancedMesh(new THREE.BoxGeometry(x1 - x0, 0.25, 0.4), stepMat, 22);
            for (let k = 0; k < 22; k++) {
                steps.setMatrixAt(k, new THREE.Matrix4().makeTranslation((x0 + x1) / 2, (k + 0.5) * 0.25, z0 + (k + 0.5) * 0.4));
                colliders.push({ minX: x0, maxX: x1, minY: 0, maxY: (k + 1) * 0.25, minZ: z0 + k * 0.4, maxZ: zb - 2 });
            }
            steps.castShadow = steps.receiveShadow = true;
            group.add(steps);
        }
        // side skirts + glass balustrades + handrails
        const skirtShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(run, 0), new THREE.Vector2(run, F2 + 0.15), new THREE.Vector2(0, 0.15)]);
        const glassShape = new THREE.Shape([new THREE.Vector2(0, 0.15), new THREE.Vector2(run, F2 + 0.15), new THREE.Vector2(run, F2 + 1.0), new THREE.Vector2(0, 1.0)]);
        const side = (shape, mat, x, t) => {
            const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
            geo.rotateY(-Math.PI / 2);
            geo.translate(x + t / 2, 0, z0);
            const m = new THREE.Mesh(geo, mat);
            m.castShadow = mat !== railGlass; m.receiveShadow = true;
            group.add(m);
        };
        const slope = Math.atan2(F2, run), hlen = Math.hypot(F2, run);
        for (const x of [-2.75, 0, 2.75]) {
            side(skirtShape, metal, x, x === 0 ? 0.3 : 0.15);
            side(glassShape, railGlass, x, 0.03);
            const hr = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, hlen), blackRubber);
            hr.position.set(x, (F2 + 0.15) / 2 + 1.0 - 0.15, z0 + run / 2);
            hr.rotation.x = -slope;
            group.add(hr);
            const w = x === 0 ? 0.15 : 0.1;
            colliders.push({ minX: x - w, maxX: x + w, minY: 0, maxY: F2 + 1.1, minZ: z0, maxZ: zb - 2 });
        }
    }

    // --- Columns along the atrium edges ---
    const colGeo = new THREE.CylinderGeometry(0.42, 0.42, H, 24);
    const baseGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.35, 24);
    for (let z = -voidZ + 4; z < voidZ - 2; z += 2 * bayL) {
        if (twoFloors && Math.abs(z - zb) < 4) continue;
        for (const sx of [-1, 1]) {
            const x = sx * (VW + 0.75);
            const c = new THREE.Mesh(colGeo, white); c.position.set(x, H / 2, z);
            c.castShadow = c.receiveShadow = true; group.add(c);
            for (const y of twoFloors ? [0.175, F2 + 0.175] : [0.175]) {
                const b = new THREE.Mesh(baseGeo, white); b.position.set(x, y, z); group.add(b);
            }
            colliders.push({ minX: x - 0.45, maxX: x + 0.45, minY: 0, maxY: H, minZ: z - 0.45, maxZ: z + 0.45 });
        }
    }

    // --- Doorway spots: the end walls first, then some shut storefronts ---
    const levels = twoFloors ? [0, F2] : [0];
    const bays = [];
    for (const sd of [-1, 1]) for (const y0 of levels) for (let b = 0; b < nb; b++) bays.push({ sd, y0, b });
    const shuffled = bays.map(v => [rand(), v]).sort((a, b) => a[0] - b[0]).map(o => o[1]);
    const doorSpots = [];
    const endSide = rand.chance(0.5) ? 1 : -1;
    doorSpots.push({ pos: new THREE.Vector3(endSide * 8.5, 0, -hz), yaw: 0 });
    doorSpots.push({ pos: new THREE.Vector3(-endSide * 8.5, 0, hz), yaw: Math.PI });
    for (const v of shuffled) {
        if (doorSpots.length >= doors) break;
        if (doorSpots.some(d => d.bay && d.bay.sd === v.sd && d.bay.y0 === v.y0 && Math.abs(d.bay.b - v.b) < 2)) continue;
        v.door = true;
        doorSpots.push({ bay: v, pos: new THREE.Vector3(v.sd * HW, v.y0, -hz + 4 + (v.b + 0.5) * bayL), yaw: v.sd > 0 ? -Math.PI / 2 : Math.PI / 2 });
    }
    const portals = doorSpots.slice(0, doors).map(d => ({ pos: d.pos, yaw: d.yaw, w: 1.275, h: 2.21, kind: 'wall', inset: 0.05, frameColor: 0x3a3d40 }));

    // --- Storefronts ---
    const ghostMat = c => new THREE.MeshStandardMaterial({ color: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.25), roughness: 0.8 });
    const shopWall = new THREE.MeshStandardMaterial({ color: 0xe6e2da, roughness: 0.9 });
    const shopLit = lit || sunny;
    for (const v of bays) {
        const { sd, y0, b } = v;
        const top = twoFloors ? (y0 === 0 ? F2 - slabT : H) : H;
        const z0 = -hz + 4 + b * bayL, z1 = z0 + bayL;
        const xi = sd * HW, xo = sd * (HW + 0.6);
        const [xa, xb] = [Math.min(xi, xo), Math.max(xi, xo)];
        // wall above the storefront, and the sign band
        box(xa, xb, y0 + 4.5, top, z0, z1, white, false);
        const band = rand.pick(P.bands);
        const bx0 = sd > 0 ? HW - 0.18 : -HW, bx1 = sd > 0 ? HW : -HW + 0.18;
        box(bx0, bx1, y0 + 3.6, y0 + 4.5, z0 + 0.3, z1 - 0.3, new THREE.MeshStandardMaterial({ color: band, roughness: 0.6 }), false);
        if (rand.chance(0.45)) {   // pale outline where the letters used to be
            const gw = rand.range(3, 6);
            box(sd > 0 ? HW - 0.2 : -HW + 0.18, sd > 0 ? HW - 0.18 : -HW + 0.2, y0 + 3.85, y0 + 4.25, (z0 + z1) / 2 - gw / 2, (z0 + z1) / 2 + gw / 2, ghostMat(band), false, false);
        }
        const kind = v.door ? 'glass' : rand.chance(0.6) ? 'glass' : rand.chance(0.6) ? 'grate' : 'open';
        if (kind === 'open') {
            // an empty unit you can walk into
            const D = 8, xd = sd * (HW + D);
            const [ra, rb] = [Math.min(xi, xd), Math.max(xi, xd)];
            box(xa, xb, y0 + 3.6, y0 + 4.5, z0, z1, white, false);
            box(sd > 0 ? xd : xd - 0.4, sd > 0 ? xd + 0.4 : xd, y0, top, z0, z1, shopWall);
            box(ra, rb, y0, top, z0 - 0.2, z0 + 0.2, shopWall);
            box(ra, rb, y0, top, z1 - 0.2, z1 + 0.2, shopWall);
            box(ra, rb, y0 + 3.6, y0 + 3.9, z0, z1, shopWall, false);
            floor(ra, rb, z0, z1, y0 + 0.002);
            if (y0 > 0) box(ra, rb, y0 - slabT, y0, z0, z1, shopWall);
            if (shopLit) {
                const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.3, bayL - 2), glow(0xf4f6ff, lit ? 2.4 : 0.8));
                strip.rotation.x = Math.PI / 2; strip.position.set(sd * (HW + D / 2), y0 + 3.59, (z0 + z1) / 2);
                group.add(strip);
            }
        } else {
            box(xa, xb, y0, y0 + 3.6, z0, z1, kind === 'grate' ? grateMat : storeGlass);
            if (kind === 'glass') for (let z = z0 + 2.5; z < z1 - 1; z += 2.5)
                box(sd > 0 ? HW - 0.06 : -HW, sd > 0 ? HW : -HW + 0.06, y0, y0 + 3.6, z - 0.04, z + 0.04, metal, false, false);
        }
        // pilasters between units
        for (const z of b === nb - 1 ? [z0, z1] : [z0])
            box(sd > 0 ? HW - 0.3 : -HW, sd > 0 ? HW : -HW + 0.3, y0, top, z - 0.3, z + 0.3, white);
    }
    // plain walls between the last units and the ends
    for (const sd of [-1, 1]) {
        const [xa, xb] = [Math.min(sd * HW, sd * (HW + 0.6)), Math.max(sd * HW, sd * (HW + 0.6))];
        box(xa, xb, 0, H, -hz, -hz + 4, white); box(xa, xb, 0, H, hz - 4, hz, white);
    }

    // --- End walls, each with a shut anchor-store entrance ---
    for (const s of [-1, 1]) {
        const z = s * hz;
        box(-HW - 0.6, HW + 0.6, 0, H + 2, s < 0 ? z - 0.6 : z, s < 0 ? z : z + 0.6, white);
        box(-5, 5, 0, 3.6, s < 0 ? z : z - 0.05, s < 0 ? z + 0.05 : z, storeGlass, false, false);
        box(-5.6, 5.6, 3.6, 4.7, s < 0 ? z : z - 0.2, s < 0 ? z + 0.2 : z, new THREE.MeshStandardMaterial({ color: rand.pick(P.bands), roughness: 0.6 }), false);
        // EXIT sign over the side doorway spot
        const exit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.26, 0.08), new THREE.MeshBasicMaterial({ map: exitTexture(), color: new THREE.Color(1, 1, 1).multiplyScalar(2) }));
        exit.position.set((s < 0 ? endSide : -endSide) * 8.5, 2.75, z - s * 0.05);
        group.add(exit);
    }

    // --- Ceiling, with a long skylight over the atrium ---
    box(-HW - 0.6, -VW, H, H + 0.4, -hz, hz, white); box(VW, HW + 0.6, H, H + 0.4, -hz, hz, white);
    box(-VW, VW, H, H + 0.4, -hz, -voidZ, white); box(-VW, VW, H, H + 0.4, voidZ, hz, white);
    const wellH = 1.6;
    box(-VW - 0.2, -VW, H, H + wellH, -voidZ, voidZ, white, false); box(VW, VW + 0.2, H, H + wellH, -voidZ, voidZ, white, false);
    box(-VW, VW, H, H + wellH, -voidZ - 0.2, -voidZ, white, false); box(-VW, VW, H, H + wellH, voidZ, voidZ + 0.2, white, false);
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(VW * 2, voidZ * 2), skyMat);
    sky.rotation.x = Math.PI / 2; sky.position.set(0, H + wellH, 0);
    group.add(sky);
    for (let z = -voidZ + 3; z < voidZ; z += 3) box(-VW, VW, H + wellH - 0.18, H + wellH - 0.02, z - 0.06, z + 0.06, white, false);
    box(-0.1, 0.1, H + wellH - 0.25, H + wellH - 0.02, -voidZ, voidZ, white, false);

    // recessed downlights under every ceiling
    const dl = [];
    for (let z = -hz + 3; z < hz - 1; z += 4) for (const x of [-9, 9]) {
        if (twoFloors) dl.push([x, F2 - slabT - 0.01, z]);
        dl.push([x, H - 0.01, z]);
    }
    const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.16, 16), downMat, dl.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    dl.forEach(([x, y, z], k) => dots.setMatrixAt(k, m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1))));
    group.add(dots);

    // pendant lamps hanging into the atrium
    const shadeMat = new THREE.MeshStandardMaterial({ color: pendantColor, roughness: 0.4, metalness: 0.2,
        emissive: pendantColor, emissiveIntensity: lit ? 0.6 : 0 });
    const bulbMat = glow(0xfff0d0, lit ? 5 : mode === 'sunset' ? 1.5 : 0.2);
    const hang = twoFloors ? H - 3.2 : H - 2.6;
    for (let z = -voidZ + 6; z < voidZ - 3; z += 12) for (const x of [-2.6, 2.6]) {
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, H + wellH - hang), blackRubber);
        cord.position.set(x, (H + wellH + hang) / 2, z); group.add(cord);
        const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.42, 0.45, 20, 1, true), shadeMat);
        shade.position.set(x, hang, z); shade.material.side = THREE.DoubleSide; group.add(shade);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), bulbMat);
        bulb.position.set(x, hang - 0.18, z); group.add(bulb);
    }

    // --- Planters with tall ficus trees, and a few benches ---
    const plantTex = loadTex('asset_mall_plant.png', 1, 1);
    const plantMat = new THREE.MeshStandardMaterial({ map: plantTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
    const potMat = new THREE.MeshStandardMaterial({ color: 0xd6cdbc, roughness: 0.85 });
    const potGeo = new THREE.CylinderGeometry(0.7, 0.55, 0.85, 24);
    const plantGeo = new THREE.PlaneGeometry(1.35, 3.0);
    const avoid = [];
    const planter = (x, y, z) => {
        const pot = new THREE.Mesh(potGeo, potMat); pot.position.set(x, y + 0.425, z);
        pot.castShadow = pot.receiveShadow = true; group.add(pot);
        for (let k = 0; k < 2; k++) {
            const p = new THREE.Mesh(plantGeo, plantMat);
            p.position.set(x, y + 0.75 + 1.5, z); p.rotation.y = k * Math.PI / 2 + rand() * 0.5;
            p.castShadow = true; group.add(p);
        }
        colliders.push({ minX: x - 0.7, maxX: x + 0.7, minY: y, maxY: y + 0.85, minZ: z - 0.7, maxZ: z + 0.7 });
    };
    const benchMat = new THREE.MeshStandardMaterial({ color: rand.pick([0x6a4a32, 0x3a3e44, 0xc8c0b0]), roughness: 0.7 });
    for (let z = -hz + 8; z < hz - 5; z += bayL) for (const sx of [-1, 1]) for (const y of levels) {
        if (twoFloors && Math.abs(z - zb) < 3.5) continue;
        const r = rand();
        if (r < 0.35) planter(sx * 8.6, y, z + rand.range(-2, 2));
        else if (r < 0.5 && y === 0) {
            const bz = z + rand.range(-2, 2);
            box(sx * 8.6 - 0.3, sx * 8.6 + 0.3, 0.42, 0.5, bz - 1.1, bz + 1.1, benchMat);
            box(sx * 8.6 - 0.25, sx * 8.6 + 0.25, 0, 0.42, bz - 0.95, bz - 0.8, metal, false);
            box(sx * 8.6 - 0.25, sx * 8.6 + 0.25, 0, 0.42, bz + 0.8, bz + 0.95, metal, false);
        }
    }

    // --- Atrium floor: fountain and/or kiosks, clear of the escalators ---
    const escZ = twoFloors ? [zb - 2 - run - 2, zb + 2] : [1e9, 1e9];
    const freeZ = () => {
        for (let k = 0; k < 40; k++) {
            const z = rand.range(-voidZ + 8, voidZ - 6);
            if ((z < escZ[0] - 4 || z > escZ[1] + 4) && avoid.every(o => Math.abs(o - z) > 9)) { avoid.push(z); return z; }
        }
        return null;
    };
    if (hasFountain) {
        const fz = freeZ();
        if (fz !== null) {
            const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.9, 0.5, 40), new THREE.MeshStandardMaterial({ color: 0xcfc6b4, roughness: 0.7 }));
            basin.position.set(0, 0.25, fz); basin.castShadow = basin.receiveShadow = true; group.add(basin);
            const inner = new THREE.Mesh(new THREE.CircleGeometry(2.55, 40), fountainWet
                ? new THREE.MeshStandardMaterial({ color: 0x4a7f8f, roughness: 0.04, metalness: 0.4, transparent: true, opacity: 0.9 })
                : new THREE.MeshStandardMaterial({ color: 0x8fa0a4, roughness: 0.9 }));
            inner.rotation.x = -Math.PI / 2; inner.position.set(0, fountainWet ? 0.42 : 0.51, fz); group.add(inner);
            const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 1.4, 20), basin.material);
            ped.position.set(0, 0.7, fz); ped.castShadow = true; group.add(ped);
            colliders.push({ minX: -2.6, maxX: 2.6, minY: 0, maxY: 0.5, minZ: fz - 2.6, maxZ: fz + 2.6 });
            colliders.push({ minX: -0.5, maxX: 0.5, minY: 0, maxY: 1.4, minZ: fz - 0.5, maxZ: fz + 0.5 });
        }
    }
    if (hasKiosks) {
        const kz = freeZ();
        if (kz !== null) {
            const kmat = new THREE.MeshStandardMaterial({ color: rand.pick(P.bands), roughness: 0.6 });
            for (const x of [-2.4, 2.4]) {
                box(x - 1.2, x + 1.2, 0, 1.05, kz - 1.2, kz + 1.2, kmat);
                box(x - 1.3, x + 1.3, 1.05, 1.12, kz - 1.3, kz + 1.3, white, false);
                box(x - 0.05, x + 0.05, 1.12, 2.6, kz - 0.05, kz + 0.05, metal, false);
                box(x - 1.4, x + 1.4, 2.6, 2.75, kz - 1.4, kz + 1.4, kmat, false);
            }
        }
    }

    // --- Light ---
    const hemiSet = { day: [0xfff6ea, 0x9a8f80, 1.25], sunset: [0xffd8b8, 0x6a5a50, 0.75], lit: [0xfff0dc, 0x6a6050, 1.0], dark: [0x1c2638, 0x040506, 0.05] }[mode];
    group.add(new THREE.HemisphereLight(...hemiSet));
    let sun = null, sunDir = null;
    if (mode !== 'lit') {
        const el = mode === 'day' ? rand.range(1.0, 1.35) : mode === 'sunset' ? rand.range(0.55, 0.75) : rand.range(0.9, 1.3);
        const az = rand.range(0, Math.PI * 2);
        sunDir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
        sun = new THREE.DirectionalLight(mode === 'day' ? 0xfff2dc : mode === 'sunset' ? 0xffa868 : 0x9ab0e0,
            mode === 'day' ? 3.0 : mode === 'sunset' ? 2.4 : 0.35);
        sun.castShadow = true;
        sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
        Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 260 });
        sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
        group.add(sun, sun.target);
    }
    // a few warm pools of light that follow the nearest downlights
    const pool = [];
    if (lit || mode === 'sunset') for (let k = 0; k < (isMobile ? 3 : 7); k++) {
        const l = new THREE.PointLight(0xffe6c4, lit ? 10 : 4, 12, 1.5);
        group.add(l); pool.push(l);
    }
    const dlVec = dl.map(([x, y, z]) => new THREE.Vector3(x, y - 0.3, z));
    let lastSort = -1e9;
    // a flashlight when the power is out
    let flash = null;
    if (dark) {
        flash = new THREE.SpotLight(0xfff8ee, 9, 45, 0.85, 0.7, 1.2);
        group.add(flash, flash.target);
    }
    const dir = new THREE.Vector3();

    const fogColor = new THREE.Color({ day: 0xe8e2d6, sunset: 0xd8b8a0, lit: 0x2a2620, dark: 0x010102 }[mode]);
    const fog = new THREE.FogExp2(fogColor, { day: 0.006, sunset: 0.008, lit: 0.01, dark: 0.045 }[mode]);

    const spawnZ = -hz + 7;
    return {
        group, portals,
        name: dark ? 'Mall After Hours' : 'Dead Mall',
        fog, background: fogColor.clone(), environment: null,
        exposure: { day: 0.85, sunset: 0.9, lit: 0.95, dark: 1.0 }[mode],
        bloom: dark ? 0.5 : 0.35, bloomThreshold: 0.9,
        spawn: new THREE.Vector3(0, 0, spawnZ),
        spawnYaw: Math.PI,
        eye: 1.7, speed: 5.5, gravity: 22, jump: 6.5, stride: 1.6,
        stepType: () => 'tile',
        ground: () => 0,
        colliders,
        bounds: { minX: -HW - 9, maxX: HW + 9, minZ: -hz, maxZ: hz },
        radius: 0.35, height: 1.85, stepHeight: 0.5, mantleHeight: 0.9,
        update: (pos, t, dt, camera) => {
            if (flash) {
                flash.position.set(pos.x, pos.y + 0.15, pos.z);
                if (camera) camera.getWorldDirection(dir); else dir.set(0, 0, -1);
                flash.target.position.copy(pos).addScaledVector(dir, 6);
            }
            if (sun) {
                const sx = Math.round(pos.x / 4) * 4, sz = Math.round(pos.z / 4) * 4;
                sun.target.position.set(sx, 0, sz);
                sun.position.set(sx, 0, sz).addScaledVector(sunDir, 120);
            }
            if (pool.length && t - lastSort > 0.5) {
                lastSort = t;
                dlVec.sort((a, b) => a.distanceToSquared(pos) - b.distanceToSquared(pos));
                pool.forEach((l, k) => l.position.copy(dlVec[k]));
            }
            if (pool.length) fadePool(pool, pos, dlVec.length <= pool.length);
        },
        setVisible: v => { group.visible = v; },
    };
}
