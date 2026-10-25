import * as THREE from 'three';
import { createSkyDome } from './sky_dome.js';
import { makeRng } from './seed.js';

// --------------------------------------------------------------------------
// The Field: dead-flat farmland under a clear, cloudless sky. Crop rows run
// straight to the horizon, toward one small farmhouse far away. No fog.
// Seeds vary the crop, the light, the row spacing and how far the house is.
// --------------------------------------------------------------------------

const CROPS = {
    // crop / furrow colours, crop share of each row, near-field plant size (x, y, z)
    greens:   { crop: 0x7fae3e, furrow: 0x2f4a1a, fill: 0.78 },
    wheat:    { crop: 0xd2b45a, furrow: 0x7a6230, fill: 0.86 },
    sprouts:  { crop: 0x6f9a34, furrow: 0x5a4430, fill: 0.32 },
    lavender: { crop: 0x8c74b8, furrow: 0x4a5a2a, fill: 0.62 },
    plowed:   { crop: 0x7a5a3c, furrow: 0x4a3424, fill: 0.55 },
};
const SKIES = {
    day:       { zenith: 0x163c9c, horizon: 0x8cb6de, sun: 0xffffff, light: 3.0, hemi: [0xbcd4ff, 0x56703a, 1.0], el: [0.6, 1.1] },
    afternoon: { zenith: 0x2652ae, horizon: 0xd6cba6, sun: 0xffe2b0, light: 2.8, hemi: [0xd8d0c0, 0x5a5a32, 0.8], el: [0.18, 0.32] },
    dusk:      { zenith: 0x23245e, horizon: 0xe69a78, sun: 0xff9a5a, light: 1.8, hemi: [0xb8a0b8, 0x3a3020, 0.55], el: [0.03, 0.08] },
};

const NOISE_GLSL = `
float fHash(vec2 p) { p = mod(p, 289.0); p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float fNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(fHash(i), fHash(i + vec2(1, 0)), f.x), mix(fHash(i + vec2(0, 1)), fHash(i + vec2(1, 1)), f.x), f.y);
}`;

function farmhouse(roofColor) {
    const g = new THREE.Group();
    const W = 6, D = 9, H = 3.2, P = 5.4;
    const white = new THREE.MeshStandardMaterial({ color: 0xf3f2ec, roughness: 0.85 });
    const roof = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.7 });
    const dark = new THREE.MeshBasicMaterial({ color: 0x0c0c0e });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    add(new THREE.BoxGeometry(W, H, D), white, 0, H / 2, 0);
    const gable = new THREE.Shape([[-W / 2, 0], [W / 2, 0], [0, P - H]].map(([x, y]) => new THREE.Vector2(x, y)));
    const gg = new THREE.ShapeGeometry(gable);
    for (const s of [1, -1]) { const m = add(gg, white, 0, H, s * D / 2); m.rotation.y = s > 0 ? 0 : Math.PI; }
    const a = Math.atan2(P - H, W / 2), run = W / 2 + 0.35, L = run / Math.cos(a);
    for (const s of [1, -1]) {
        const r = add(new THREE.BoxGeometry(L, 0.18, D + 0.5), roof, s * run / 2 + Math.sin(a) * s * 0.09, P - (run / 2) * Math.tan(a) + Math.cos(a) * 0.09, 0);
        r.rotation.z = -s * a;
    }
    // the open doorway and a small window on the gable end facing the fields, windows down the side
    add(new THREE.PlaneGeometry(1.2, 2.1), dark, -0.9, 1.05, D / 2 + 0.01);
    add(new THREE.PlaneGeometry(0.7, 0.7), dark, 1.5, 1.9, D / 2 + 0.01);
    for (const z of [-2, 1.5]) { const w = add(new THREE.PlaneGeometry(0.8, 0.8), dark, W / 2 + 0.01, 1.9, z); w.rotation.y = Math.PI / 2; }
    return { group: g, W, D, P, door: { x: -0.9, w: 1.2, h: 2.1 } };
}

export function createField({ scene, isMobile }, seed, doors = 3) {
    const group = new THREE.Group();
    scene.add(group);
    const rand = makeRng(seed, 1400);

    // --- Variation ---
    const cropName = rand.pick(['greens', 'greens', 'greens', 'wheat', 'wheat', 'sprouts', 'lavender', 'plowed']);
    const C = CROPS[cropName];
    const skyName = rand.pick(['day', 'day', 'day', 'day', 'afternoon', 'afternoon', 'dusk']);
    const S = SKIES[skyName];
    const spacing = rand.range(0.7, 1.15);
    const houseDist = rand.range(150, 330), houseX = rand.range(-14, 14);
    const roofColor = rand.pick([0xc8261c, 0xc8261c, 0xc8261c, 0xb03a22, 0x3a5a3a, 0x50565e]);
    const sunAz = rand.range(0, Math.PI * 2), sunEl = rand.range(...S.el);
    const sunDir = new THREE.Vector3(Math.cos(sunAz) * Math.cos(sunEl), Math.sin(sunEl), Math.sin(sunAz) * Math.cos(sunEl));

    const cropCol = new THREE.Color(C.crop).offsetHSL(rand.range(-0.02, 0.02), rand.range(-0.08, 0.05), rand.range(-0.04, 0.03));
    const furrowCol = new THREE.Color(C.furrow);
    // what the rows average out to far away (also the sky's colour below the horizon)
    const farCol = furrowCol.clone().lerp(cropCol, C.fill);

    // --- Sky: a clean gradient, no clouds ---
    const { mesh: sky } = createSkyDome({ zenith: S.zenith, horizon: S.horizon, ground: farCol.clone().multiplyScalar(0.7).getHex(), coverage: 0, sunDir, sunColor: S.sun });
    group.add(sky);

    // --- Lights ---
    group.add(new THREE.HemisphereLight(...S.hemi));
    const sun = new THREE.DirectionalLight(S.sun, S.light);
    sun.castShadow = true;
    sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 600 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.4;
    group.add(sun, sun.target);

    // --- Ground: one huge flat plane that travels with you, plus a fine patch around you whose
    // rows are raised into leafy ridges (displaced in the shader, fading flat at its edge) ---
    const H = { greens: 0.32, wheat: 0.7, sprouts: 0.07, lavender: 0.45, plowed: 0.16 }[cropName];
    const area = isMobile ? 36 : 56;
    const camU = { value: new THREE.Vector3() };
    const makeMat = (disp) => {
        const uniforms = { uSpacing: { value: spacing }, uFill: { value: C.fill }, uCrop: { value: cropCol }, uFurrow: { value: furrowCol },
            uH: { value: disp ? H : 0 }, uCam: camU, uArea: { value: area } };
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
        mat.customProgramCacheKey = () => 'field-rows';
        mat.onBeforeCompile = sh => {
            Object.assign(sh.uniforms, uniforms);
            sh.vertexShader = sh.vertexShader
                .replace('#include <common>', '#include <common>\n' + NOISE_GLSL + `
                    uniform float uSpacing, uFill, uH, uArea; uniform vec3 uCam; varying vec2 vW;
                    float ridge(vec2 w) {
                        float f = abs(fract(w.x / uSpacing) - 0.5) * 2.0;           // 0 at a row's centre, 1 in the furrow
                        float r = clamp(1.0 - f / max(uFill, 0.05), 0.0, 1.0);
                        float leaf = fNoise(w * vec2(3.0, 2.2)) * 0.6 + fNoise(w * 9.0) * 0.4;
                        return sqrt(r) * (0.6 + leaf * 0.7);
                    }
                    float fieldH(vec2 w) {
                        float fade = 1.0 - smoothstep(uArea * 0.32, uArea * 0.48, length(w - uCam.xz));
                        return uH * ridge(w) * fade;
                    }`)
                .replace('#include <beginnormal_vertex>', `
                    vec2 w0 = (modelMatrix * vec4(position, 1.0)).xz;
                    float e = 0.04;
                    float h0 = fieldH(w0);
                    vec3 objectNormal = uH > 0.0 ? normalize(vec3(h0 - fieldH(w0 + vec2(e, 0.0)), e, h0 - fieldH(w0 + vec2(0.0, e)))) : vec3(normal);
                    #ifdef USE_TANGENT
                    vec3 objectTangent = vec3(tangent.xyz);
                    #endif`)
                .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += h0;')
                .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xz;');
            sh.fragmentShader = sh.fragmentShader
                .replace('#include <common>', '#include <common>\n' + NOISE_GLSL + '\nuniform float uSpacing, uFill; uniform vec3 uCrop, uFurrow; varying vec2 vW;')
                .replace('#include <color_fragment>', `#include <color_fragment>
                    float u = vW.x / uSpacing;
                    float fw = fwidth(u);
                    // each row: crop in the middle, a dark furrow between; wobbly leafy edges up close
                    float leaf = fNoise(vW * 4.0) * 0.6 + fNoise(vW * 11.0) * 0.4;
                    float edge = (1.0 - uFill) * 0.5 + (leaf - 0.5) * 0.12 * (1.0 - smoothstep(0.05, 0.3, fw));
                    float f = abs(fract(u) - 0.5);
                    float crop = 1.0 - smoothstep(0.5 - edge - fw, 0.5 - edge + fw, f);
                    crop = mix(crop, uFill, smoothstep(0.25, 0.7, fw));       // average out where rows get thinner than a pixel
                    float detail = mix(0.72 + leaf * 0.56, 1.0, smoothstep(0.05, 0.5, fwidth(vW.x * 4.0)));
                    vec3 c = mix(uFurrow * (0.85 + fNoise(vW * 2.0) * 0.3), uCrop * detail, crop);
                    diffuseColor.rgb *= c;`);
        };
        return mat;
    };
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(3800, 3800, 1, 1).rotateX(-Math.PI / 2), makeMat(false));
    plane.position.y = -0.03;
    plane.receiveShadow = true;
    group.add(plane);
    const rowsN = Math.round(area / spacing), across = rowsN * (isMobile ? 6 : 9), alongN = Math.round(area / (isMobile ? 0.16 : 0.11));
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(rowsN * spacing, area, across, alongN).rotateX(-Math.PI / 2), makeMat(true));
    patch.receiveShadow = true;
    patch.frustumCulled = false;
    group.add(patch);

    // --- The farmhouse, far off at the end of the rows, facing you ---
    const house = farmhouse(roofColor);
    house.group.position.set(houseX, 0, -houseDist);
    group.add(house.group);
    const hx0 = houseX - house.W / 2, hz0 = -houseDist - house.D / 2;
    const colliders = [{ minX: hx0, maxX: hx0 + house.W, minY: 0, maxY: house.P, minZ: hz0, maxZ: hz0 + house.D }];

    // --- Doors: its open doorway is the first, the rest stand out in the field ---
    const portals = [{ pos: new THREE.Vector3(houseX + house.door.x, 0, -houseDist + house.D / 2 + 0.02), yaw: 0, w: house.door.w, h: house.door.h, kind: 'builtIn' }];
    for (let k = 1; k < doors; k++) {
        const ang = rand.range(0, Math.PI * 2), d = k === 1 ? rand.range(16, 40) : rand.range(50, 220);
        const x = Math.sin(ang) * d, z = Math.cos(ang) * d;
        portals.push({ pos: new THREE.Vector3(x, 0, z), yaw: Math.round(Math.atan2(-x, -z) / (Math.PI / 2)) * (Math.PI / 2), w: 1.275, h: 2.21, kind: 'standing' });
    }

    return {
        group, portals,
        name: 'The Field',
        fog: null,
        background: new THREE.Color(S.horizon),
        environment: null,
        exposure: 0.95,
        bloom: 0.2, bloomThreshold: 0.95,
        spawn: new THREE.Vector3(0, 0, 0),   // standing in a furrow, looking down the rows at the house
        spawnYaw: 0,
        eye: 1.7, speed: 6, gravity: 22, jump: 7.5, stride: 1.7,
        stepType: () => cropName === 'plowed' || cropName === 'sprouts' ? 'carpet' : 'grass',
        ground: () => 0,   // the crops are soft: you wade through them
        colliders,
        bounds: { minX: -1500, maxX: 1500, minZ: -1500, maxZ: 1500 },
        radius: 0.4, height: 1.85, stepHeight: 0.5, mantleHeight: 1.0,
        update: (p) => {
            plane.position.set(Math.round(p.x / 100) * 100, -0.03, Math.round(p.z / 100) * 100);
            // the patch snaps by whole rows (and its own grid along them) so its vertices never swim
            patch.position.set(Math.round(p.x / spacing) * spacing, 0, Math.round(p.z / (area / alongN)) * (area / alongN));
            camU.value.copy(p);
            const snap = 4, cx = Math.round(p.x / snap) * snap, cz = Math.round(p.z / snap) * snap;
            sun.target.position.set(cx, 0, cz);
            sun.position.copy(sun.target.position).addScaledVector(sunDir, 300);
        },
        setVisible: (v) => { group.visible = v; },
    };
}
