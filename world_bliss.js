import * as THREE from 'three';
import { applyAntiTile } from './antitile.js';
import { createSkyDome } from './sky_dome.js';

import { makeRng } from './seed.js';
import { createUltraGrass } from './ultra_grass.js';
import { PATHS_GLSL, makePaths, makeHouse, HOUSE, buildFences } from './bliss_props.js';

// Rolling-hill height field (shared by terrain mesh, grass shader and player).
// h0 = (scale, amp, detail amp, tilt), h1 = (offset x, offset z, ripple, swell)
function makeHeight(h0, h1) {
    const [s, a, d, tilt] = h0, [ox, oz, rip, sw] = h1;
    return (x, z) => {
        const px = x + ox, pz = z + oz;
        let y = Math.sin(px / s) * a + Math.cos(pz / s) * a;
        y += Math.sin(px / (s * 0.375) + pz / (s * 0.5)) * d;
        y += Math.cos(x / 5) * 0.5 * rip;
        y += x * tilt + Math.sin(pz * 0.02) * 5 * sw;
        return y;
    };
}
const HEIGHT_GLSL = `
uniform vec4 uH0; uniform vec4 uH1;
float terrainH(vec2 p){
    vec2 q = p + uH1.xy;
    float y = sin(q.x/uH0.x)*uH0.y + cos(q.y/uH0.x)*uH0.y;
    y += sin(q.x/(uH0.x*0.375) + q.y/(uH0.x*0.5))*uH0.z;
    y += cos(p.x/5.0)*0.5*uH1.z;
    y += p.x*uH0.w + sin(q.y*0.02)*5.0*uH1.w;
    return y;
}`;
let envCache = null;

// grass looks: hue shift, saturation scale, lightness offset (applied to ground and blades)
const GRASS_STYLES = [
    { dh: 0, sm: 1, dl: 0 }, { dh: 0, sm: 1, dl: 0 }, { dh: 0, sm: 1, dl: 0 },   // vibrant
    { dh: 0.005, sm: 0.5, dl: 0.02 },     // muted, dusty
    { dh: -0.045, sm: 0.7, dl: 0.01 },    // olive
    { dh: -0.085, sm: 0.6, dl: 0.07 },    // late-summer straw
    { dh: 0.055, sm: 0.8, dl: -0.01 },    // cool blue-green
];
// mean linear colour of visual_grass_seamless.png
export const GRASS_TEX_MEAN = [0.0158, 0.261, 0.0035];
const styleColor = (rgb, G) => {
    const c = new THREE.Color(...rgb), hsl = {};
    c.getHSL(hsl);
    c.setHSL((hsl.h + G.dh + 1) % 1, Math.min(1, hsl.s * G.sm), Math.max(0, hsl.l + G.dl * 0.3));
    return new THREE.Vector3(c.r, c.g, c.b);
};

function canvasTex(w, h, draw) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
// fine speckled snow surface
const snowTexture = () => {
    const t = canvasTex(256, 256, (g, W) => {
        g.fillStyle = '#f4f6fa'; g.fillRect(0, 0, W, W);
        for (let i = 0; i < 5000; i++) {
            const v = 205 + Math.random() * 50 | 0;
            g.fillStyle = 'rgba(' + (v - 6) + ',' + (v - 2) + ',' + v + ',0.35)';
            g.fillRect(Math.random() * W, Math.random() * W, 2, 2);
        }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(320, 320);
    t.anisotropy = 8;
    return t;
};
// a soft boot print (sole + heel), toe toward the top of the texture
const footprintTexture = () => canvasTex(64, 128, (g) => {
    g.filter = 'blur(3px)';
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(32, 42, 20, 32, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(32, 102, 16, 18, 0, 0, Math.PI * 2); g.fill();
});

/** Time of day of a Bliss variation (its own stream, so it can be checked without building the world) */
export function blissTime(seed) {
    return makeRng(seed, 100).pick(['day', 'day', 'sunset', 'night']);
}
const TIMES = {
    day: { zenith: 0x0f4fd8, horizon: 0x9fd0ff, ground: 0x8cbcec, sky: 0x7ec0ee, fog: 0xb9d3ea, sunColor: 0xfff4dc, bright: 1.15,
        hemi: [0xcfe6ff, 0x4a6a2a, 1.1], sun: [0xfff1d6, 3.2], el: [0.45, 1.1], light: [1, 1, 1], env: 0.6, exposure: 0.95, cover: [0.3, 0.72] },
    sunset: { zenith: 0x34489a, horizon: 0xf6a46c, ground: 0xc88a78, sky: 0xe8a888, fog: 0xe6a88c, sunColor: 0xff9850, bright: 1.0,
        hemi: [0xf0b8a8, 0x3a3020, 0.6], sun: [0xffa060, 2.8], el: [0.04, 0.16], light: [1.25, 0.88, 0.62], env: 0.3, exposure: 0.9, cover: [0.2, 0.6] },
    night: { zenith: 0x02040c, horizon: 0x101a34, ground: 0x0a1020, sky: 0x0a1020, fog: 0x0a1020, sunColor: 0x9aa8d8, bright: 1.0,
        hemi: [0x34446e, 0x0a100a, 0.4], sun: [0xa8b8ff, 0.55], el: [0.5, 1.0], light: [0.2, 0.26, 0.42], env: 0.06, exposure: 1.0, cover: [0.05, 0.35] },
};   // the sky environment is the same for every variation

export function createBliss({ scene, renderer, pmrem, loadTex, isMobile }, seed, doors = 5) {
    const group = new THREE.Group();
    scene.add(group);
    const rand = makeRng(seed, 0);

    // --- Variation: hill shape, sky, sun, grass colour ---
    const h0 = [rand.range(28, 70), rand.range(3, 13), rand.range(0.5, 5), rand.range(-0.06, 0.08)];
    const h1 = [rand.range(-400, 400), rand.range(-400, 400), rand.range(0, 1.4), rand.range(0, 1.6)];
    const blissHeight = makeHeight(h0, h1);
    const time = blissTime(seed), T = TIMES[time];
    const coverage = rand.range(...T.cover);
    const sunAz = rand.range(0, Math.PI * 2), sunEl = rand.range(...T.el);   // the moon, at night
    const sunDir = new THREE.Vector3(Math.cos(sunAz) * Math.cos(sunEl), Math.sin(sunEl), Math.sin(sunAz) * Math.cos(sunEl)).normalize();
    const hueShift = rand.range(-0.035, 0.03), dryness = rand.range(-0.08, 0.1);
    // ground cover: grass of varying vibrance/hue, or a layer of snow (own streams)
    const look = makeRng(seed, 300);
    const snow = look.chance(0.05);
    const G = look.pick(GRASS_STYLES);
    const pathRand = makeRng(seed, 201);
    const hasPath = pathRand.chance(0.35) && !snow;
    const path1 = new THREE.Vector4(pathRand.range(8, 19), pathRand.range(0.006, 0.014), pathRand.range(0, 6.28), pathRand.range(3, 9));
    const path2 = new THREE.Vector4(pathRand.range(0.02, 0.04), pathRand.range(0, 6.28), 0, 2.2);
    path2.z = path1.x * Math.sin(20 * path1.y + path1.z) + path1.w * Math.sin(20 * path2.x + path2.y) - 1;

    // --- Variation: extra paths, picket fences, farmhouses (own stream) ---
    const vr = makeRng(seed, 400);
    const pathList = hasPath ? [{ A: path1, B: path2, angle: 0, wobble: 0 }] : [];
    const dirt = vr.chance(0.55);
    if (!snow) {
        let extra = vr.chance(0.3) ? (vr.chance(0.4) ? 2 : 1) : 0;
        if (!hasPath && vr.chance(0.18)) extra = Math.max(extra, 1);
        for (let i = 0; i < extra; i++) {
            const p = {
                A: new THREE.Vector4(vr.range(8, 22), vr.range(0.005, 0.014), vr.range(0, 6.28), vr.range(3, 10)),
                B: new THREE.Vector4(vr.range(0.02, 0.04), vr.range(0, 6.28), 0, dirt ? vr.range(1.5, 2.6) : 2.2),
                angle: vr.range(0, Math.PI), wobble: dirt ? 0.22 : 0,
            };
            const a = vr.range(0, Math.PI * 2), r = vr.range(6, 60);
            pathsThrough(p, Math.sin(a) * r, 20 + Math.cos(a) * r);
            pathList.push(p);
        }
    }
    if (dirt) pathList.forEach(p => { p.wobble = 0.22; });
    const paths = makePaths(pathList);
    function pathsThrough(p, x, z) { makePaths([p]).through(p, x, z); }
    const anyPath = pathList.length > 0;

    const fog = new THREE.FogExp2(T.fog, rand.range(0.0011, 0.0022) * (time === 'night' ? 1.4 : 1) * (snow ? 1.35 : 1));
    const background = new THREE.Color(T.sky);

    // --- Sky dome ---
    const skyTex = loadTex('visual_sky.png', 1, 1, true, 'bliss');
    skyTex.wrapS = THREE.ClampToEdgeWrapping;
    const { mesh: skyMesh } = createSkyDome({ zenith: T.zenith, horizon: T.horizon, ground: T.ground, coverage, brightness: T.bright, sunDir,
        sunColor: T.sunColor, cloud: time === 'night' ? 0x1a2238 : time === 'sunset' ? 0xffc8a8 : 0xffffff });
    group.add(skyMesh);

    // stars, pinned to whichever camera is looking (like the sky dome)
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

    // Environment from the sky (gives realistic ambient + specular on the grass)
    const out = { environment: null };
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, map: skyTex }));
    const envGround = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: 0x4f7a2a }));
    envGround.rotation.x = -Math.PI / 2; envGround.position.y = -1;
    envScene.add(envSky, envGround);
    const makeEnv = () => { envCache ||= pmrem.fromScene(envScene, 0.02).texture; api.environment = envCache; };
    const disposeEnvScene = () => envScene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });

    // --- Lights ---
    const hemi = new THREE.HemisphereLight(...T.hemi);
    if (snow) hemi.groundColor.set(0xb8c4d4).multiplyScalar(T.light[2]);   // light bouncing off the snow
    group.add(hemi);

    const sun = new THREE.DirectionalLight(...T.sun);
    sun.castShadow = true;
    sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    const d = 90;
    Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 600 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    group.add(sun, sun.target);

    // --- Terrain ---
    const grassTex = loadTex('visual_grass_seamless.png', 320, 320);
    const size = 1600, segs = isMobile ? 280 : 400;
    const geometry = new THREE.PlaneGeometry(size, size, segs, segs);
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        pos.setY(i, blissHeight(x, z));
        // large scale colour patches: lush -> dry
        const n = Math.sin(x * 0.013 + Math.cos(z * 0.011) * 2) * 0.5 + Math.sin(z * 0.021 - x * 0.007) * 0.5;
        if (snow) c.setRGB(0.9 + n * 0.03, 0.92 + n * 0.03, 0.97);
        else c.setHSL((0.24 + hueShift + n * 0.025 - dryness * 0.15 + G.dh + 1) % 1, Math.min(1, (0.55 + n * 0.1 - dryness * 0.5) * G.sm),
            0.42 + n * 0.05 + dryness * 0.2 + G.dl);
        colors.set([c.r, c.g, c.b], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const terrainMat = new THREE.MeshStandardMaterial({
        map: snow ? snowTexture() : grassTex, vertexColors: true, roughness: snow ? 0.85 : 0.95, metalness: 0, envMapIntensity: T.env
    });
    applyAntiTile(terrainMat, 0.6);
    if (!snow) {
        // recolour the grass texture itself with this variation's style (hue rotate, desaturate, lighten)
        const antiTile = terrainMat.onBeforeCompile;
        terrainMat.customProgramCacheKey = () => 'antitile0.6-bliss';
        terrainMat.onBeforeCompile = sh => {
            antiTile(sh);
            // (YIQ hue angle runs opposite to HSL hue)
            sh.uniforms.uStyle = { value: new THREE.Vector3(-G.dh * Math.PI * 2, G.sm, G.dl) };
            sh.fragmentShader = sh.fragmentShader
                .replace('#include <common>', '#include <common>\nuniform vec3 uStyle;')
                .replace('diffuseColor *= sampledDiffuseColor;', `
                    vec3 yiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * sampledDiffuseColor.rgb;
                    float ch = cos(uStyle.x), sh2 = sin(uStyle.x);
                    yiq.yz = mat2(ch, sh2, -sh2, ch) * yiq.yz * uStyle.y;
                    yiq.x *= 1.0 + uStyle.z * 2.0;
                    sampledDiffuseColor.rgb = max(mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * yiq, 0.0);
                    diffuseColor *= sampledDiffuseColor;`);
        };
    }
    if (anyPath) {
        const antiTileCompile = terrainMat.onBeforeCompile;
        terrainMat.customProgramCacheKey = () => 'antitile0.6-bliss-paths';
        terrainMat.onBeforeCompile = sh => {
            antiTileCompile(sh);
            Object.assign(sh.uniforms, paths.uniforms, { uDirt: { value: dirt ? 1 : 0 } });
            sh.vertexShader = sh.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec2 vPathPos;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPathPos = position.xz;');
            sh.fragmentShader = sh.fragmentShader
                .replace('#include <common>', '#include <common>\n' + PATHS_GLSL + '\nuniform float uDirt;\nvarying vec2 vPathPos;')
                .replace('#include <color_fragment>', `#include <color_fragment>
                    float pd = pathDist(vPathPos);
                    float grit = fract(sin(dot(floor(vPathPos * 16.0), vec2(127.1, 311.7))) * 43758.5453);
                    float seams = 1.0 - smoothstep(0.025, 0.055, abs(mod(vPathPos.y + 2.5, 5.0) - 2.5));
                    vec3 concrete = vec3(0.43, 0.43, 0.40) * (0.94 + grit * 0.12 - seams * 0.12);
                    // packed dirt: soft ragged edges, blotchy tan with darker wheel ruts
                    float blotch = sin(vPathPos.x * 0.9 + sin(vPathPos.y * 0.7)) * sin(vPathPos.y * 1.3 - vPathPos.x * 0.4);
                    vec3 soil = vec3(0.50, 0.37, 0.21) * (0.86 + grit * 0.2 + blotch * 0.07);
                    float pathBlend = uDirt > 0.5
                        ? 1.0 - smoothstep(-0.45, 0.25, pd + (grit - 0.5) * 0.25 + blotch * 0.12)
                        : 1.0 - smoothstep(-0.10, 0.12, pd);
                    diffuseColor.rgb = mix(diffuseColor.rgb, uDirt > 0.5 ? soil : concrete, pathBlend);`);
        };
    }
    const terrain = new THREE.Mesh(geometry, terrainMat);
    terrain.receiveShadow = true;
    group.add(terrain);

    // --- Instanced grass blades around the player ---
    // blade colour = the ground's own albedo (texture average x this variation's vertex tint), so blades match the texture
    const g0 = new THREE.Color().setHSL((0.24 + hueShift - dryness * 0.15 + G.dh + 1) % 1, Math.min(1, (0.55 - dryness * 0.5) * G.sm), 0.42 + dryness * 0.2 + G.dl);
    const bladeAlbedo = styleColor(GRASS_TEX_MEAN, G).multiply(new THREE.Vector3(g0.r, g0.g, g0.b));
    const side = isMobile ? 174 : 300;
    const blades = side * side;
    const area = isMobile ? 50 : 70;
    const bladeGeo = new THREE.BufferGeometry();
    // tapered blade with 4 segments
    const bp = [], bi = [];
    const segN = 4;
    for (let s = 0; s <= segN; s++) {
        const t = s / segN, w = 0.05 * (1 - t * 0.9);
        bp.push(-w, t, 0, w, t, 0);
    }
    for (let s = 0; s < segN; s++) { const a = s * 2; bi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    bladeGeo.setIndex(bi);
    const igeo = new THREE.InstancedBufferGeometry().copy(bladeGeo);
    igeo.instanceCount = blades;
    const offs = new Float32Array(blades * 4);
    const tall = rand.range(0.3, 0.7);
    for (let i = 0; i < blades; i++) {
        // jittered grid: every patch of ground gets the same amount of grass
        const gx = i % side, gz = (i / side) | 0;
        offs[i * 4] = ((gx + rand()) / side - 0.5) * area;
        offs[i * 4 + 1] = ((gz + rand()) / side - 0.5) * area;
        offs[i * 4 + 2] = rand() * Math.PI * 2;
        offs[i * 4 + 3] = 0.25 + rand() * tall;
    }
    igeo.setAttribute('offset', new THREE.InstancedBufferAttribute(offs, 4));
    const grassMat = new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: {
            camPos: { value: new THREE.Vector3() },
            uH0: { value: new THREE.Vector4(...h0) },
            uH1: { value: new THREE.Vector4(...h1) },
            ...(anyPath ? paths.uniforms : {}),
            time: { value: 0 },
            area: { value: area },
            sunDir: { value: sunDir },
            uLight: { value: new THREE.Vector3(...T.light) },
            uBase: { value: bladeAlbedo.clone().multiplyScalar(0.3) },
            uTip: { value: bladeAlbedo.clone().multiplyScalar(1.3) },
            fogColor: { value: fog.color },
            fogDensity: { value: fog.density },
        },
        vertexShader: HEIGHT_GLSL + (anyPath ? PATHS_GLSL : '') + `
            attribute vec4 offset;
            uniform vec3 camPos; uniform float time; uniform float area;
            varying float vT; varying float vFog; varying float vShade;
            void main(){
                vec2 o = offset.xy;
                vec2 wp = o + floor((camPos.xz - o) / area + 0.5) * area;
                float dist = length(wp - camPos.xz);
                float fade = 1.0 - smoothstep(area * 0.3, area * 0.5, dist);
                ${anyPath ? (dirt ? 'fade *= smoothstep(-0.5, 0.3, pathDist(wp));' : 'fade *= smoothstep(-0.18, 0.12, pathDist(wp));') : ''}
                float h = offset.w * fade;
                float c = cos(offset.z), s = sin(offset.z);
                vec3 p = position;
                p.x *= (0.8 + offset.w * 0.4);
                vec3 local = vec3(p.x * c, p.y * h, p.x * s);
                float wind = sin(time * 1.7 + wp.x * 0.15 + wp.y * 0.1) * 0.5 + sin(time * 3.1 + wp.x * 0.6) * 0.15;
                local.x += wind * 0.18 * p.y * p.y * h;
                local.z += wind * 0.08 * p.y * p.y * h;
                vec3 world = vec3(wp.x, terrainH(wp) - 0.05, wp.y) + local;
                vT = p.y;
                vShade = 0.85 + 0.15 * sin(offset.z * 3.0);
                vec4 mv = viewMatrix * vec4(world, 1.0);
                float fd = -mv.z * 0.0016;
                vFog = 1.0 - exp(-fd * fd);
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: `
            uniform vec3 fogColor; uniform vec3 sunDir; uniform vec3 uLight; uniform vec3 uBase; uniform vec3 uTip;
            varying float vT; varying float vFog; varying float vShade;
            void main(){
                vec3 base = uBase;
                vec3 tip = uTip;
                vec3 col = mix(base, tip, smoothstep(0.0, 1.0, vT)) * vShade;
                col *= 1.0 + 0.5 * vT; // sun + translucency toward tips
                col *= uLight;
                col = mix(col, fogColor, vFog);
                gl_FragColor = vec4(col, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`
    });
    const grass = new THREE.Mesh(igeo, grassMat);
    grass.frustumCulled = false;
    if (!snow) group.add(grass);   // buried under the snow

    // Ultra quality swaps in dense, fully lit grass (built the first time it's needed)
    let ultraGrass = null;
    const setUltra = (on) => {
        if (snow) return;
        if (on && !ultraGrass) {
            const mask = anyPath ? (dirt ? 'smoothstep(-0.5, 0.3, pathDist(p))' : 'smoothstep(-0.18, 0.12, pathDist(p))') : '1.0';
            ultraGrass = createUltraGrass({
                rand: makeRng(seed, 991),
                groundGLSL: HEIGHT_GLSL + (anyPath ? PATHS_GLSL : '') + `
                    float grassGround(vec2 p){ return terrainH(p); }
                    float grassMask(vec2 p){ return ${mask}; }`,
                uniforms: { uH0: grassMat.uniforms.uH0, uH1: grassMat.uniforms.uH1, ...(anyPath ? paths.uniforms : {}) },
                albedo: bladeAlbedo, hMin: 0.22, hRand: tall + 0.15, area: isMobile ? 55 : 80, side: isMobile ? 300 : 470,
                sunDir, sunColor: sun.color.clone().multiplyScalar(sun.intensity / Math.PI),
            });
            group.add(ultraGrass.mesh);
        }
        if (ultraGrass) ultraGrass.mesh.visible = on;
        grass.visible = !on;
    };

    // --- Footprints left in the snow (ring buffer of flat decals hugging the slope) ---
    let footprints = null, printCursor = 0;
    if (snow) {
        const fgeo = new THREE.PlaneGeometry(0.14, 0.32);
        fgeo.rotateX(-Math.PI / 2);
        footprints = new THREE.InstancedMesh(fgeo, new THREE.MeshStandardMaterial({
            map: footprintTexture(), color: 0x8c9ab2, roughness: 1, transparent: true, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), 700);
        footprints.count = 0;
        footprints.frustumCulled = false;
        footprints.receiveShadow = true;
        group.add(footprints);
    }
    const _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _m = new THREE.Matrix4();
    const _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
    const placePrint = (x, z, yaw) => {
        const e = 0.3, y = blissHeight(x, z);
        _n.set(blissHeight(x - e, z) - blissHeight(x + e, z), 2 * e, blissHeight(x, z - e) - blissHeight(x, z + e)).normalize();
        _q.setFromUnitVectors(_up, _n).multiply(_qy.setFromAxisAngle(_up, yaw));
        _m.compose(_p.set(x, y + 0.04, z), _q, _one);
        footprints.setMatrixAt(printCursor % footprints.instanceMatrix.count, _m);
        printCursor++;
        footprints.count = Math.min(printCursor, footprints.instanceMatrix.count);
        footprints.instanceMatrix.needsUpdate = true;
    };

    // four lone doors scattered over the hills, each turned roughly toward the start
    const doorSpots = [];
    const a0 = rand() * Math.PI * 2;
    for (let k = 0; k < doors; k++) {
        const ang = a0 + k * Math.PI * 2 / doors + rand.range(-0.5, 0.5);
        const dist = k === 0 ? rand.range(14, 40) : rand.range(45, 260);
        const x = Math.sin(ang) * dist, z = 20 + Math.cos(ang) * dist;
        doorSpots.push([x, z, Math.round((Math.atan2(-x, 20 - z) + rand.range(-0.6, 0.6)) / (Math.PI / 2)) * (Math.PI / 2)]);
    }

    // --- Farmhouses: every one the same cream house, a few settled crooked ---
    const propColliders = [];
    const houses = [];
    const nHouses = vr.chance(0.4) ? vr.int(1, 7) : 0;
    const nearDoor = (x, z, r) => doorSpots.some(([dx, dz]) => Math.hypot(dx - x, dz - z) < r);
    const hw = HOUSE.W / 2 + 0.2, hd = HOUSE.D / 2 + 0.2;
    for (let tries = 0; houses.length < nHouses && tries < 300; tries++) {
        let x, z;
        if (houses.length && vr.chance(0.5)) {
            const h = vr.pick(houses), a = vr.range(0, Math.PI * 2), r = vr.range(16, 45);
            x = h.x + Math.sin(a) * r; z = h.z + Math.cos(a) * r;
        } else {
            const a = vr.range(0, Math.PI * 2), r = vr.range(20, 200);
            x = Math.sin(a) * r; z = 20 + Math.cos(a) * r;
        }
        if (Math.hypot(x, z - 20) < 16 || nearDoor(x, z, 12) || houses.some(h => Math.hypot(h.x - x, h.z - z) < 15)) continue;
        if (anyPath && paths.dist(x, z) < 7) continue;
        const yaw = Math.atan2(-x, 20 - z) + vr.range(-0.6, 0.6);
        const c = Math.cos(yaw), sn = Math.sin(yaw);
        const toW = (lx, lz) => [x + c * lx + sn * lz, z - sn * lx + c * lz];
        // houses lean with the hill they stand on (like the painting), plus the odd extra-crooked one
        const hAt = (lx, lz) => blissHeight(...toW(lx, lz));
        const slopeX = (hAt(hw, 0) - hAt(-hw, 0)) / (2 * hw), slopeZ = (hAt(0, hd) - hAt(0, -hd)) / (2 * hd);
        if (Math.hypot(slopeX, slopeZ) > 0.6) continue;
        // the base plane through the centre misses the ground where the hill curves: sink to the lowest gap
        const yc = hAt(0, 0);
        let sink = 0.08;
        for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, -hd], [0, hd], [-hw, 0], [hw, 0]])
            sink = Math.max(sink, yc + lx * slopeX + lz * slopeZ - hAt(lx, lz) + 0.08);
        const crooked = vr.chance(0.2);
        houses.push({ x, z, yaw, toW, y: yc - sink,
            tx: -Math.atan(slopeZ) + (crooked ? vr.range(-0.12, 0.12) : 0), tz: Math.atan(slopeX) + (crooked ? vr.range(-0.12, 0.12) : 0) });
    }
    for (const h of houses) {
        const g = makeHouse(T.env * 0.6);
        g.position.set(h.x, h.y, h.z);
        g.rotation.set(h.tx, h.yaw, h.tz, 'YXZ');
        group.add(g);
        // the footprint as a 4x4 grid of boxes, so a turned house doesn't get a fat invisible margin
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
            const cs = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]].map(([a, b]) => h.toW(-hw + a * hw / 2, -hd + b * hd / 2));
            propColliders.push({ minX: Math.min(...cs.map(q => q[0])), maxX: Math.max(...cs.map(q => q[0])), minY: h.y - 3, maxY: h.y + HOUSE.Hp,
                minZ: Math.min(...cs.map(q => q[1])), maxZ: Math.max(...cs.map(q => q[1])) });
        }
    }

    // --- White picket fences: beside the paths, across the hills, in front of the houses ---
    const runs = [];
    const nRuns = vr.chance(0.45) ? vr.int(1, 4) : 0;
    for (let k = 0; k < nRuns; k++) {
        const run = [];
        if (anyPath && vr.chance(0.6)) {
            const p = vr.pick(pathList), side = vr.chance(0.5) ? 1 : -1;
            const v0 = paths.vOf(p, 0, 20) + vr.range(-120, 100), len = vr.range(30, 110);
            for (let v = v0; v <= v0 + len; v += 0.5) run.push(paths.beside(p, v, side, dirt ? 1.4 : 1.1));
        } else {
            const a = vr.range(0, Math.PI * 2), r = vr.range(8, 150);
            let x = Math.sin(a) * r, z = 20 + Math.cos(a) * r, head = vr.range(0, Math.PI * 2);
            const bend = vr.range(-0.02, 0.02), len = vr.range(20, 90);
            for (let d = 0; d <= len; d += 1) { run.push([x, z]); x += Math.sin(head); z += Math.cos(head); head += bend; }
        }
        runs.push(run);
    }
    for (const h of houses) {
        if (!vr.chance(0.5)) continue;
        const fd = HOUSE.D / 2 + vr.range(3.5, 6), half = vr.range(6, 10);
        const yard = vr.chance(0.5) ? [[-half, -hd + 1], [-half, fd], [half, fd], [half, -hd + 1]] : [[-half, fd], [half, fd]];
        runs.push(yard.map(([lx, lz]) => h.toW(lx, lz)));
    }
    if (runs.length) {
        const keep = (x, z) => Math.hypot(x, z - 20) > 4 && !nearDoor(x, z, 2.5)
            && (!anyPath || paths.dist(x, z) > (dirt ? 0.7 : 0.4))
            && !houses.some(h => Math.hypot(h.x - x, h.z - z) < 5.6);
        const fence = buildFences(runs, blissHeight, keep, T.env * 0.6);
        group.add(fence.group);
        propColliders.push(...fence.colliders);
    }

    const api = {
        group,
        portals: doorSpots.map(([x, z, yaw]) => ({
            pos: new THREE.Vector3(x, blissHeight(x, z) - 0.05, z), yaw, w: 1.275, h: 2.21, kind: 'standing' })),
        name: houses.length ? 'Motion' : 'Bliss',
        fog, background,
        environment: null,
        exposure: T.exposure,
        bloom: 0.25, bloomThreshold: 0.95,
        spawn: new THREE.Vector3(0, blissHeight(0, 20) + 1.7, 20),
        eye: 1.7, speed: 6, gravity: 22, jump: 7.5, stride: 1.7,
        stepType: p => snow ? 'carpet' : anyPath && !dirt && paths.dist(p.x, p.z) < 0 ? 'tile' : 'grass',
        // each stride presses a left and a right boot print into the snow
        onStep: snow ? (p, v) => {
            const len = Math.hypot(v.x, v.z);
            if (len < 0.1) return;
            const dx = v.x / len, dz = v.z / len, yaw = Math.atan2(-dx, -dz);
            for (const side of [-1, 1]) {
                const x = p.x + dx * side * 0.42 - dz * side * 0.12, z = p.z + dz * side * 0.42 + dx * side * 0.12;
                placePrint(x, z, yaw);
            }
        } : undefined,
        ground: (x, z) => blissHeight(x, z),
        colliders: propColliders,
        bounds: { minX: -700, maxX: 700, minZ: -700, maxZ: 700 },
        radius: 0.4, height: 1.85, stepHeight: 0.5, mantleHeight: 1.0,
        update: (p, t) => {
            const snap = 4;
            const cx = Math.round(p.x / snap) * snap, cz = Math.round(p.z / snap) * snap;
            sun.target.position.set(cx, blissHeight(cx, cz), cz);
            sun.position.copy(sun.target.position).addScaledVector(sunDir, 300);
            grassMat.uniforms.camPos.value.copy(p);
            grassMat.uniforms.time.value = t;
            ultraGrass?.update(p, t);
        },
        setUltra,
        setVisible: (v) => { group.visible = v; },
        dispose: disposeEnvScene,
    };
    // (the sky texture may already be cached and loaded, so this can run immediately)
    textureLoader_onLoad(skyTex, makeEnv);
    return api;
}

function textureLoader_onLoad(tex, cb) {
    const check = () => (tex.image && tex.image.width) ? cb() : setTimeout(check, 100);
    check();
}
