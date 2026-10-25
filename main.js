import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createBliss, blissTime } from './world_bliss.js';
import { createBackrooms } from './world_backrooms.js';
import { createHotel } from './world_hotel.js';
import { createPoolRooms } from './world_poolrooms.js';
import { createBallPit } from './world_ballpit.js';
import { createNight } from './world_night.js';
import { createTruman } from './world_truman.js';
import { createHallway } from './world_hallway.js';
import { createSkyroad } from './world_skyroad.js';
import { createMall } from './world_mall.js';
import { createStairwell } from './world_stairwell.js';
import { createHouse } from './world_house.js';
import { createSurface } from './world_moon.js';
import { createField } from './world_field.js';
import { createPlayground } from './world_playground.js';
import { AudioManager } from './audio_manager.js';
import { InputManager } from './input_manager.js';
import { UI } from './ui.js';
import { Physics } from './physics.js';
import { Portals, doorPlan } from './portals.js';
import { Entities } from './entities.js';
import { randomSeed, makeRng } from './seed.js';
import { Splashes } from './splash.js';
import { Multiplayer } from './multiplayer.js';
import { Chat } from './chat.js';

// touch controls only where touch is the main input (phones, and tablets in "desktop mode");
// a desktop, even one with a touchscreen, keeps mouse + keyboard
const isMobile = /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches);

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('canvas-container').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2000);

const textureLoader = new THREE.TextureLoader();
const maxAniso = renderer.capabilities.getMaxAnisotropy();
let textureQuality = localStorage.getItem('textureQuality');
if (!['low', 'medium', 'high'].includes(textureQuality)) textureQuality = 'low';
let modelQuality = localStorage.getItem('modelQuality');
if (!['low', 'medium', 'high'].includes(modelQuality)) modelQuality = 'low';
let visionDistance = Number(localStorage.getItem('visionDistance')) || 500;
visionDistance = Math.max(500, Math.min(2000, Math.round(visionDistance / 250) * 250));
const textureAnisotropy = () => textureQuality === 'high' ? maxAniso : textureQuality === 'medium' ? Math.min(4, maxAniso) : 1;
// Textures are cached so rebuilding a world for a new variation doesn't reload them.
// Worlds that change a texture's wrapping/offset pass their own tag.
const texCache = new Map(), cachedTex = new Set();
const loadTex = (url, rx = 1, ry = 1, srgb = true, tag = '') => {
    const key = [url, rx, ry, srgb, tag].join('|');
    if (texCache.has(key)) return texCache.get(key);
    const t = textureLoader.load(new URL(url, import.meta.url).href);
    texCache.set(key, t); cachedTex.add(t);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = textureAnisotropy();
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
};

// Image based lighting (soft indoor reflections)
const pmrem = new THREE.PMREMGenerator(renderer);
const roomEnv = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const ctx = { scene, renderer, pmrem, roomEnv, loadTex, isMobile };

const factories = [createBliss, createBackrooms, createHotel, createPoolRooms, createBallPit, createNight, createTruman, createHallway, createSkyroad, createMall, createStairwell, createHouse, createSurface, createField, createPlayground];
const worlds = [];           // the one live variation of each world type
const portals = new Portals(renderer, scene, worlds);

// --- Variations: each world type is generated from a seed; doors lead to seeded neighbours ---
function disposeObject(o) {
    if (o.userData.keep) return;
    for (const c of [...o.children]) disposeObject(c);
    if (o.isLight) o.dispose?.();
    if (o.isInstancedMesh) o.dispose();
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const mat of mats) {
        for (const v of Object.values(mat)) if (v?.isTexture && !cachedTex.has(v)) v.dispose();
        mat.dispose();
    }
}
// Power-cut variation of an indoor level: every light and glowing surface is off, the room
// reflections are gone, and you carry a flashlight. (The Mall has its own dark version.)
const BLACKOUT = [1, 2, 3, 4, 7, 11];
const _fdir = new THREE.Vector3();
function applyModelQuality(root) {
    root.traverse(o => {
        if (!o.isMesh) return;
        const base = (o.userData.qualityShadowBase ??= { cast: o.castShadow, receive: o.receiveShadow });
        o.castShadow = modelQuality === 'high' && base.cast;
        o.receiveShadow = modelQuality !== 'low' && base.receive;
    });
}
function blackout(w) {
    const off = [];
    w.group.traverse(o => {
        if (o.isLight) { o.visible = false; off.push(o); return; }
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
            if (m.emissive) m.emissiveIntensity = 0;
            if (m.isMeshBasicMaterial || m.isPointsMaterial) m.color.multiplyScalar(0.03);
        }
    });
    w.darken?.();
    w.group.add(new THREE.HemisphereLight(0x1c2638, 0x040506, 0.04));
    const flash = new THREE.SpotLight(0xfff8ee, 16 * w.eye / 7, w.eye * 30, 0.85, 0.7, 1.0);
    w.group.add(flash, flash.target);
    w.environment = null;
    if (w.fog) { w.fog.color.set(0x010102); if (w.fog.density !== undefined) w.fog.density *= 1.6; }
    w.background = new THREE.Color(0x010102);
    w.bloom = Math.max(w.bloom ?? 0.3, 0.45);
    const up = w.update;
    w.update = (pos, t, dt, cam, feetPos) => {
        up?.(pos, t, dt, cam, feetPos);
        for (const l of off) l.visible = false;   // some levels move/toggle their light pools
        flash.position.set(pos.x, pos.y + w.eye * 0.08, pos.z);
        if (cam) cam.getWorldDirection(_fdir); else _fdir.set(0, 0, -1);
        flash.target.position.copy(pos).addScaledVector(_fdir, w.eye * 4);
    };
}

function buildWorld(type, seed, from = null) {
    const old = worlds[type];
    if (old && old.seed === seed) return old;
    const plan = doorPlan(type, seed, from);
    let w;
    try { w = factories[type](ctx, seed, plan.length); }
    catch (e) { console.error('Failed to build world', type, seed, e); return old; }
    applyModelQuality(w.group);
    if (old) { old.dispose?.(); disposeObject(old.group); scene.remove(old.group); }
    w.seed = seed;
    w.from = from;
    w.plan = plan;
    if (w.blackout || (BLACKOUT.includes(type) && makeRng(seed, 4242).chance(0.22))) blackout(w);
    if (INDOOR.includes(type) && w.bounds) {
        // Indoors there are no invisible walls: the floor ends a little past the building's
        // walls, and anyone who clips outside falls out of the world into the Backrooms.
        const B = w.bounds, m = w.eye * 1.5, g = w.ground;
        const F = { minX: B.minX - m, maxX: B.maxX + m, minZ: B.minZ - m, maxZ: B.maxZ + m };
        w.ground = (x, z) => (x < F.minX || x > F.maxX || z < F.minZ || z > F.maxZ) ? -1e4 : (g ? g(x, z) : 0);
        w.bounds = undefined;
        w.fallY = -w.eye * 6;
        w.fallTo = 1;
    }
    worlds[type] = w;
    try { scaleShadows(w.group, QUALITY[quality]?.shadowScale || 1); w.setUltra?.(!!QUALITY[quality]?.ao); widenSunShadows(w, !!QUALITY[quality]?.ao); } catch { /* quality not set up yet: setQuality applies it */ }
    portals.attach(type);
    w.setVisible(type === currentWorld);
    ui.renameLevel(type, w.name);
    return w;
}
let pending = [];            // neighbour variations still to generate, one per frame
function refreshNeighbours(index, now = false) {
    pending = portals.needed(index).filter(d => worlds[d.world]?.seed !== d.seed);
    if (now) { pending.forEach(d => buildWorld(d.world, d.seed, d.from)); pending = []; }
    portals.link(index);
}

// --- Post processing ---
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// Ultra: ground-truth ambient occlusion — soft contact shadows in every corner, crease and under every object
const gtao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight, undefined,
    { radius: 3.2, distanceExponent: 1.4, thickness: 4, scale: 1.25, samples: 16, distanceFallOff: 1, screenSpaceRadius: false },
    { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
gtao.enabled = false;
// The AO pass draws the whole scene with one plain normal material. Objects whose shape is made
// in their own vertex shader can't be drawn that way (they'd land in the wrong place with broken
// normals, which turns into black flashes): they supply an aoMaterial, or are left out.
{
    const baseOverride = gtao.renderOverride.bind(gtao);
    const AO_LAYER = 30, hidden = [], special = [];
    gtao.renderOverride = (r, mat, target, clearColor, clearAlpha) => {
        hidden.length = special.length = 0;
        scene.traverseVisible(o => {
            if (!o.isMesh) return;
            if (o.userData.aoMaterial) special.push(o);
            else if (o.material?.isShaderMaterial || o.geometry?.isInstancedBufferGeometry) hidden.push(o);
        });
        for (const o of hidden) o.visible = false;
        for (const o of special) o.visible = false;
        // the shadow maps were already drawn by this frame's main render
        const shadowAuto = r.shadowMap.autoUpdate;
        r.shadowMap.autoUpdate = false;
        baseOverride(r, mat, target, clearColor, clearAlpha);
        for (const o of hidden) o.visible = true;
        if (!special.length) { r.shadowMap.autoUpdate = shadowAuto; return; }
        const mask = camera.layers.mask, bg = scene.background, auto = r.autoClear;
        for (const o of special) { o.visible = true; o.layers.enable(AO_LAYER); o.userData.mat = o.material; o.material = o.userData.aoMaterial; }
        camera.layers.set(AO_LAYER);
        scene.background = null; r.autoClear = false;
        r.setRenderTarget(target);
        r.render(scene, camera);
        r.autoClear = auto; scene.background = bg; camera.layers.mask = mask;
        r.shadowMap.autoUpdate = shadowAuto;
        for (const o of special) { o.material = o.userData.mat; o.layers.disable(AO_LAYER); }
    };
}
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.5, 0.6, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// Old, cheap digital camera / camcorder look
const filmPass = new ShaderPass({
    uniforms: {
        tDiffuse: { value: null }, time: { value: 0 },
        res: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
        uniform sampler2D tDiffuse; uniform float time; uniform vec2 res;
        varying vec2 vUv;
        float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
        void main(){
            // low sensor resolution: snap to a ~480p grid
            vec2 grid = vec2(res.x / res.y * 480.0, 480.0);
            vec2 uv = vUv;
            // tape wobble + an occasional tracking band rolling down the frame
            float band = smoothstep(0.0, 0.02, abs(fract(uv.y * 0.5 - time * 0.07) - 0.5) - 0.48);
            uv.x += sin(uv.y * 40.0 + time * 3.0) * 0.0006 + band * (rand(vec2(floor(uv.y * 240.0), time)) - 0.5) * 0.01;
            vec2 puv = (floor(uv * grid) + 0.5) / grid;
            vec2 d = puv - 0.5;
            // smeared colour channels (cheap lens + chroma bleed)
            float ca = 0.0025 + dot(d, d) * 0.012;
            vec3 col;
            col.r = texture2D(tDiffuse, puv + vec2(ca, 0.0)).r;
            col.g = texture2D(tDiffuse, puv).g;
            col.b = texture2D(tDiffuse, puv - vec2(ca, 0.0)).b;
            // soft plastic lens
            vec2 px = 1.5 / grid;
            vec3 blur = (texture2D(tDiffuse, puv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, puv - vec2(px.x, 0.0)).rgb
                       + texture2D(tDiffuse, puv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, puv - vec2(0.0, px.y)).rgb) * 0.25;
            col = mix(col, blur, 0.35);
            // poor dynamic range: lifted blacks, clipped highlights, washed colour, warm cast
            float luma = dot(col, vec3(0.299, 0.587, 0.114));
            col = mix(vec3(luma), col, 0.8);
            col = col * vec3(1.03, 1.02, 0.92) + vec3(0.03, 0.035, 0.04);
            col = clamp((col - 0.5) * 1.12 + 0.5, 0.0, 0.97);
            // blocky sensor noise, stronger in shadows
            vec2 ng = floor(vUv * grid);
            float n = rand(ng + fract(time * 13.0) * 100.0) - 0.5;
            col += n * mix(0.11, 0.04, luma);
            // faint scanlines
            col *= 0.94 + 0.06 * sin(vUv.y * grid.y * 3.14159);
            // heavy cheap-lens vignette
            col *= 1.0 - 0.55 * smoothstep(0.25, 0.85, length((vUv - 0.5) * vec2(1.1, 1.0)) * 1.25);
            // auto-exposure flicker
            col *= 0.98 + 0.02 * sin(time * 7.0) * sin(time * 2.3);
            gl_FragColor = vec4(col, 1.0);
        }`
});
composer.addPass(filmPass);
// camcorder filter setting (on unless turned off)
const filterBtn = document.getElementById('filters-toggle');
const setFilters = on => {
    filmPass.enabled = on;
    localStorage.setItem('filters', on ? '1' : '0');
    filterBtn.setAttribute('aria-pressed', String(on));
    filterBtn.textContent = 'Filters · ' + (on ? 'On' : 'Off');
};
setFilters(localStorage.getItem('filters') !== '0');
filterBtn.addEventListener('click', () => setFilters(!filmPass.enabled));

// --- Quality: render resolution, shadows and bloom ---
const QUALITY = {
    low:    { ratio: () => Math.min(window.devicePixelRatio, 1) * 0.6, shadows: false, bloom: false },
    medium: { ratio: () => Math.min(window.devicePixelRatio, 1), shadows: true, soft: false, bloom: true },
    high:   { ratio: () => Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2), shadows: true, soft: true, bloom: true },
    ultra:  { ratio: () => Math.min(window.devicePixelRatio, 2), shadows: true, soft: true, bloom: true, ao: true, shadowScale: 2 },
};
// Sharper shadow maps (Ultra doubles each light's own resolution, up to 4096)
function scaleShadows(root, scale) {
    root.traverse(o => {
        if (!o.isLight || !o.shadow?.mapSize) return;
        const base = (o.userData.baseShadow ??= o.shadow.mapSize.x);
        const size = Math.min(4096, base * scale);
        if (o.shadow.mapSize.x === size) return;
        o.shadow.mapSize.set(size, size);
        o.shadow.map?.dispose(); o.shadow.map = null;
    });
}
// Ultra: the sun's shadows reach 2.5x further, so distant shade (trees, columns, skylight patches)
// is already there instead of appearing as you approach. The light is pulled back along its
// direction so the wider shadow box still contains everything.
function widenSunShadows(w, on) {
    w._suns = [];
    w.group.traverse(o => {
        if (!o.isDirectionalLight || !o.castShadow) return;
        const c = o.shadow.camera;
        const b = (o.userData.baseCam ??= { l: c.left, r: c.right, t: c.top, b: c.bottom, far: c.far });
        const k = on ? 2.5 : 1;
        Object.assign(c, { left: b.l * k, right: b.r * k, top: b.t * k, bottom: b.b * k });
        const push = on ? Math.max(b.r - b.l, b.t - b.b) * k * 0.5 : 0;
        c.far = b.far + push * 2;
        c.updateProjectionMatrix();
        if (o.userData.push && o.userData.pushed?.equals(o.position)) {
            // undo the previous pull-back before applying the new one
            _sunDir.subVectors(o.position, o.target.position);
            o.position.copy(o.target.position).addScaledVector(_sunDir.normalize(), Math.max(1, _sunDir.length() - o.userData.push));
        }
        o.userData.push = push; o.userData.pushed = null;
        if (push) w._suns.push(o);
    });
}
const _sunDir = new THREE.Vector3();
function pushSuns(w) {
    for (const s of w._suns || []) {
        if (s.userData.pushed?.equals(s.position)) continue;   // the level didn't move it since
        const d = _sunDir.subVectors(s.position, s.target.position), len = d.length();
        s.position.copy(s.target.position).addScaledVector(d.normalize(), len + s.userData.push);
        (s.userData.pushed ??= new THREE.Vector3()).copy(s.position);
    }
}
let quality = localStorage.getItem('quality');
if (!QUALITY[quality]) quality = 'low';
let activePreset = localStorage.getItem('qualityCustom') === '1' ? 'custom' : quality;
function updateShadowMode() {
    const Q = QUALITY[quality];
    const enabled = Q.shadows || modelQuality !== 'low';
    const type = Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (renderer.shadowMap.enabled === enabled && renderer.shadowMap.type === type) return;
    renderer.shadowMap.enabled = enabled;
    renderer.shadowMap.type = type;
    renderer.shadowMap.needsUpdate = true;
    scene.traverse(o => {
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach(mat => { mat.needsUpdate = true; });
    });
}
function setQuality(q) {
    quality = q;
    localStorage.setItem('quality', q);
    const Q = QUALITY[q];
    renderer.setPixelRatio(Q.ratio());
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setPixelRatio(Q.ratio());
    composer.setSize(window.innerWidth, window.innerHeight);
    portals.setSize();       // doorway views sample by screen pixel, so they must match the new resolution
    bloom.enabled = Q.bloom;
    gtao.enabled = !!Q.ao;
    worlds.forEach(w => { if (!w) return; w.setUltra?.(!!Q.ao); widenSunShadows(w, !!Q.ao); });
    scaleShadows(scene, Q.shadowScale || 1);
    updateShadowMode();
    ui?.syncQualitySettings({ general: activePreset, texture: textureQuality, model: modelQuality, distance: visionDistance });
}

// --- Managers ---
const audioManager = new AudioManager();
const inputManager = new InputManager(camera, document.body, isMobile);
const ui = new UI(isMobile);
const splashes = new Splashes(scene);
const entities = new Entities(audioManager);
ui.setEntityLog(() => entities.encountered);
const entBtn = document.getElementById('entities-toggle');
const markEntities = () => { entBtn.setAttribute('aria-pressed', String(entities.enabled)); entBtn.textContent = 'Entities · ' + (entities.enabled ? 'On' : 'Off'); };
entBtn.addEventListener('click', () => { entities.setEnabled(!entities.enabled); markEntities(); });
markEntities();
// caught: their face fills the screen, then you wake up somewhere new on the same level
const scareEl = document.getElementById('scare');
async function die(kind) {
    entities.dead = true;
    velocity.set(0, 0, 0);
    scareEl.querySelector('img').src = entities.faceURL(kind);
    scareEl.classList.add('on');
    entities.playScare();
    await new Promise(r => setTimeout(r, 1300));
    entities.clear();
    await goTo(currentWorld);
    scareEl.classList.remove('on');
    entities.dead = false;
}
const qualityPresets = {
    low: { general: 'low', texture: 'low', model: 'low', distance: 500 },
    medium: { general: 'medium', texture: 'medium', model: 'medium', distance: 1000 },
    high: { general: 'high', texture: 'high', model: 'high', distance: 1500 },
    ultra: { general: 'ultra', texture: 'high', model: 'high', distance: 2000 },
};
function setVisionDistance(value) {
    visionDistance = Number(value);
    camera.far = visionDistance;
    camera.updateProjectionMatrix();
    localStorage.setItem('visionDistance', String(visionDistance));
}
function setTextureQuality(value) {
    textureQuality = value;
    localStorage.setItem('textureQuality', value);
    for (const texture of cachedTex) {
        texture.anisotropy = textureAnisotropy();
        if (texture.image?.naturalWidth > 0) texture.needsUpdate = true;
    }
}
function setModelQuality(value) {
    modelQuality = value;
    localStorage.setItem('modelQuality', value);
    worlds.forEach(w => { if (w) applyModelQuality(w.group); });
    updateShadowMode();
}
function applyQualityPreset(preset) {
    const settings = qualityPresets[preset];
    if (!settings) return;
    activePreset = preset;
    localStorage.setItem('qualityCustom', '0');
    setTextureQuality(settings.texture);
    setModelQuality(settings.model);
    setVisionDistance(settings.distance);
    setQuality(settings.general);
    ui.syncQualitySettings(settings);
}
function changeQualitySetting(setting, value) {
    if (setting === 'general') { applyQualityPreset(value); return; }
    activePreset = 'custom';
    localStorage.setItem('qualityCustom', '1');
    if (setting === 'texture') setTextureQuality(value);
    else if (setting === 'model') setModelQuality(value);
    else if (setting === 'distance') setVisionDistance(value);
    ui.syncQualitySettings({ general: activePreset, texture: textureQuality, model: modelQuality, distance: visionDistance });
}
ui.onQuality(changeQualitySetting);
ui.syncQualitySettings({ general: activePreset, texture: textureQuality, model: modelQuality, distance: visionDistance });
setVisionDistance(visionDistance);
const mp = new Multiplayer(scene, worlds);
const refreshPlayers = () => ui.setPlayers(mp.enabled, mp.list().map(p => ({
    ...p, level: worlds[p.world]?.seed === p.seed ? worlds[p.world].name : (ui.levelName(p.world) ?? ''),
    here: p.world === currentWorld && worlds[currentWorld]?.seed === p.seed,
})));
mp.onChange(refreshPlayers);
const chat = new Chat(isMobile);
chat.onSend(text => mp.sendChat(text));
// typing must not keep you walking or jumping
chat.onOpen(() => { const ms = inputManager.moveState; for (const k in ms) ms[k] = typeof ms[k] === 'number' ? 0 : false; });
mp.onChat(m => chat.add(m));
const setMultiplayer = on => { localStorage.setItem('multiplayer', on ? '1' : '0'); chat.setEnabled(on); mp.setEnabled(on); };
ui.onMultiplayer(setMultiplayer);
ui.onPlayer(id => {
    const o = mp.get(id);
    if (!o) return;
    audioManager.init().then(() => audioManager.setAmbience(currentWorld));
    if (!isMobile) inputManager.lock();
    ui.started = true;
    if (isMobile) ui.hideMenu();
    goToPlayer(o);
});

// --- State ---
let currentWorld = 0;
const physics = new Physics();
const feet = new THREE.Vector3();          // player feet position (physics body)
const velocity = new THREE.Vector3();
const body = { grounded: false };
let prevTime = performance.now();
let stepDist = 0;
let bobPhase = 0;
let stepSmooth = 0;                        // camera lag after climbing a step
let switching = false;

inputManager.onJump(() => {
    if (body.grounded) { velocity.y = worlds[currentWorld].jump; body.grounded = false; }
});

function enterWorld(index) {
    splashes?.clear();
    worlds.forEach((w, i) => w.setVisible(i === index));
    refreshNeighbours(index);
    const w = worlds[index];
    scene.fog = w.fog;
    scene.background = w.background;
    scene.environment = w.environment;
    renderer.toneMappingExposure = w.exposure;
    bloom.strength = w.bloom;
    bloom.threshold = w.bloomThreshold ?? 0.85;
    physics.setWorld(w);
    ui.setWorld(w.name, index, w.seed);
    refreshPlayers?.();
}

function applyWorld(index) {
    enterWorld(index);
    const w = worlds[index];
    feet.copy(w.spawn);
    feet.y = physics.supportAt(feet, w.radius ?? 1.6, feet.y + 50) ;
    velocity.set(0, 0, 0);
    body.grounded = true;
    stepSmooth = 0;
    camera.position.set(feet.x, feet.y + w.eye, feet.z);
    if (w.spawnYaw !== undefined) camera.quaternion.setFromEuler(new THREE.Euler(0, w.spawnYaw, 0, 'YXZ'));
}

// Walked into a doorway: carry body, velocity and view through to the paired doorway
const _tmpV = new THREE.Vector3(), _tmpQ = new THREE.Quaternion();
function teleport(A) {
    const s = portals.scale(A);
    feet.copy(portals.mapPoint(A, feet, _tmpV));
    velocity.copy(portals.mapDir(A, velocity, _tmpV));
    camera.quaternion.copy(portals.mapQuat(A, camera.quaternion, _tmpQ));
    stepSmooth *= s;
    currentWorld = A.link.world;
    enterWorld(currentWorld);
    audioManager.setAmbience(currentWorld);
}

// Dropped through the clouds: tumble out of the sky into one of the outdoor levels
const OUTDOOR = [0, 5, 6, 12, 13];   // Bliss, Night lawn, The Edge, The Surface, The Field
const INDOOR = [1, 2, 3, 4, 7, 9, 11, 14];   // Backrooms, Hotel, Poolrooms, Ball Pit, Hallway, Mall
async function fallOut(to) {
    // falling out of an indoor level lands you in the Backrooms; out of the sky, somewhere outdoors
    // where you land comes from the seed of the level you fell out of, so the same
    // variation always drops you into the same variation of the same level
    const r = makeRng(worlds[currentWorld].seed, 5150);
    const dest = to ?? r.pick(OUTDOOR);
    await goTo(dest, to === undefined, (r() * 4294967296) >>> 0);
}

// Jump to another explorer: build their exact variation and stand where they stand
async function goToPlayer(o) {
    if (switching || !factories[o.w]) return;
    switching = true;
    audioManager.playGlitch();
    await ui.glitchIn();
    currentWorld = o.w;
    buildWorld(o.w, o.s, o.f ?? null);
    refreshNeighbours(currentWorld, true);
    enterWorld(currentWorld);
    const w = worlds[currentWorld];
    feet.set(o.x, o.y, o.z);
    velocity.set(0, 0, 0);
    body.grounded = false;
    stepSmooth = 0;
    camera.position.set(feet.x, feet.y + w.eye, feet.z);
    camera.quaternion.setFromEuler(new THREE.Euler(0, o.r, 0, 'YXZ'));
    audioManager.setAmbience(currentWorld);
    composer.render();
    await ui.glitchOut();
    switching = false;
}

async function goTo(index, drop = false, seed = randomSeed()) {
    if (switching) return;
    switching = true;
    audioManager.playGlitch();
    await ui.glitchIn();
    currentWorld = ((index % worlds.length) + worlds.length) % worlds.length;
    // picking an area always rolls a fresh variation
    buildWorld(currentWorld, seed);
    refreshNeighbours(currentWorld, true);
    applyWorld(currentWorld);
    if (drop) {
        const w = worlds[currentWorld];
        feet.y += w.eye * 18;
        velocity.y = -w.eye * 4;
        body.grounded = false;
        camera.position.set(feet.x, feet.y + w.eye, feet.z);
    }
    audioManager.setAmbience(currentWorld);
    // render one frame behind the overlay so the reveal is clean
    composer.render();
    await ui.glitchOut();
    switching = false;
}

const fwdVec = new THREE.Vector3();
const rightVec = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const wish = new THREE.Vector3();
const _prevFeet = new THREE.Vector3();

function animate() {
    requestAnimationFrame(animate);
    const time = performance.now();
    const delta = Math.min((time - prevTime) / 1000, 0.05);
    prevTime = time;
    if (!ui.inGame || ui.paused) return;

    // generate one pending neighbour variation per frame
    if (pending.length && !switching) {
        // walking up to a door that isn't ready yet: finish all of them now
        const urgent = portals.nearUnlinked(currentWorld, feet, worlds[currentWorld].eye * 6);
        for (const d of urgent ? pending.splice(0) : [pending.shift()]) buildWorld(d.world, d.seed, d.from);
        portals.link(currentWorld);
    }

    let w = worlds[currentWorld];
    const ms = inputManager.moveState;
    const active = ((inputManager.controls && inputManager.controls.isLocked) || (isMobile && ui.started)) && !entities.dead;

    // --- Desired horizontal velocity (camera-relative) ---
    camera.getWorldDirection(fwdVec);
    fwdVec.y = 0; fwdVec.normalize();
    rightVec.crossVectors(fwdVec, up).normalize();
    const ix = active ? (Number(ms.right) - Number(ms.left)) + ms.ax : 0;
    const iz = active ? (Number(ms.forward) - Number(ms.backward)) + ms.ay : 0;
    wish.set(0, 0, 0).addScaledVector(fwdVec, iz).addScaledVector(rightVec, ix);
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(w.speed * (ms.sprint ? 1.6 : 1));
    const accel = body.grounded ? 12 : 2.5;
    velocity.x += (wish.x - velocity.x) * Math.min(1, accel * delta);
    velocity.z += (wish.z - velocity.z) * Math.min(1, accel * delta);

    w.beforeMove?.(feet, velocity, body, delta, active && !switching);

    // --- Collide & move (substeps keep fast movement from tunnelling through thin walls) ---
    const opts = {
        radius: w.radius ?? 1.6, height: w.height ?? w.eye + 0.8,
        stepHeight: w.stepHeight ?? w.eye * 0.24, mantleHeight: w.mantleHeight ?? w.eye * 0.55,
        gravity: w.gravity, ceiling: w.ceiling, bounds: w.bounds,
    };
    const sub = Math.max(1, Math.ceil(Math.hypot(velocity.x, velocity.z) * delta / 0.5));
    const prevFeetY = feet.y, vyBefore = velocity.y;
    const prevFeet = _prevFeet.copy(feet);
    for (let i = 0; i < sub; i++) physics.move(feet, velocity, body, delta / sub, opts);
    if (w.terminal && velocity.y < -w.terminal) velocity.y = -w.terminal;
    portals.blockBackside(currentWorld, prevFeet, feet, velocity, opts.radius, opts.height);
    portals.blockUnlinked(currentWorld, prevFeet, feet, velocity, opts.radius);
    const doorway = portals.crossing(currentWorld, prevFeet, feet);
    // splash: feet dropped through the water surface while falling
    const wl = w.waterLevel;
    if (!doorway && wl !== undefined && prevFeetY > wl + 0.02 && feet.y <= wl && vyBefore < 0) {
        const sc = w.eye / 7;
        const strength = Math.min(1, Math.max(0, (-vyBefore / sc - 5) / 22));
        splashes.spawn(_tmpV.set(feet.x, wl, feet.z), strength, sc);
        audioManager.playSplash(strength);
    }
    if (!doorway && !switching && w.fallY !== undefined && feet.y < w.fallY) fallOut(w.fallTo);
    if (doorway) {
        const s = portals.scale(doorway);
        teleport(doorway);
        w = worlds[currentWorld];
        // keep the step-smoothing reference in the new world's frame
        stepDist *= s;
    }
    // Smooth the camera over step changes (up or down) while walking, so a flight of
    // stairs reads as a smooth ramp. The lag is capped so the view never sinks into a step.
    if (body.grounded && !doorway) stepSmooth -= feet.y - prevFeetY;
    else stepSmooth = 0;
    const maxLag = w.eye * 0.12;
    stepSmooth = Math.max(-maxLag, Math.min(maxLag, stepSmooth));
    stepSmooth *= Math.exp(-delta * 10);

    // --- Head bob + footsteps ---
    const hSpeed = Math.hypot(velocity.x, velocity.z);
    if (body.grounded && hSpeed > 0.5) {
        stepDist += hSpeed * delta;
        bobPhase += hSpeed * delta * (Math.PI / w.stride);
        if (stepDist > w.stride) {
            stepDist = 0;
            audioManager.playStep(w.stepType(feet));
            w.onStep?.(feet, velocity);
        }
    } else {
        bobPhase += (Math.round(bobPhase / Math.PI) * Math.PI - bobPhase) * Math.min(1, delta * 6);
    }
    const bob = Math.abs(Math.sin(bobPhase)) * w.eye * 0.035 * Math.min(1, hSpeed / w.speed);
    camera.position.set(feet.x, feet.y + w.eye + bob + stepSmooth, feet.z);
    // endless levels quietly shift you back by one repeat of their geometry
    const wrap = w.wrapY?.(feet);
    if (wrap) { feet.y += wrap; camera.position.y += wrap; }

    if (scene.environment !== w.environment) scene.environment = w.environment;
    w.update(camera.position, time / 1000, delta, camera, feet);
    pushSuns(w);
    if (!switching) {
        const caught = entities.update(delta, { w: worlds[currentWorld], index: currentWorld, feet, camera, active });
        if (caught) die(caught);
    }
    splashes.update(delta);
    mp.update(delta, { world: currentWorld, seed: w.seed, from: w.from, feet, quat: camera.quaternion });
    camera.updateProjectionMatrix(); // undo last frame's doorway clip before culling
    portals.render(currentWorld, camera, time / 1000, delta);
    portals.prepareMain(currentWorld, camera, opts.radius);
    filmPass.uniforms.time.value = (time / 1000) % 100;
    composer.render();
}

// --- Start / UI wiring ---
ui.setLevels(factories.map((_, i) => worlds[i]?.name ?? ''));
ui.onPick((i) => {
    audioManager.init().then(() => audioManager.setAmbience(currentWorld));
    ui.hideMenu();
    if (!isMobile) {
        inputManager.lock();
        setTimeout(() => { if (!inputManager.controls?.isLocked) inputManager.lock(); }, 1200);
    }
    goTo(i);
});
ui.onResume(() => { if (isMobile) ui.hideMenu(); else inputManager.lock(); });
ui.onExit(() => { ui.returnToTitle(); audioManager.setAmbience(null); entities.setChase(0); });
const volumeControl = document.getElementById('audio-volume');
const volumeValue = document.getElementById('audio-volume-value');
volumeControl.value = Math.round(audioManager.volume * 100);
volumeValue.textContent = volumeControl.value + '%';
volumeControl.addEventListener('input', () => {
    audioManager.setVolume(Number(volumeControl.value) / 100);
    volumeValue.textContent = volumeControl.value + '%';
});
ui.onStart(async () => {
    const audioReady = audioManager.init();
    if (!isMobile) inputManager.lock();
    await audioReady;
    if (!gameInitialized) await initializeGame();
    await audioManager.context?.resume();
    audioManager.setAmbience(currentWorld);
});
// menu closed but the mouse isn't captured (a refused lock): clicking the view captures it
document.getElementById('canvas-container').addEventListener('click', () => {
    if (!isMobile && ui.inGame && inputManager.controls && !inputManager.controls.isLocked) inputManager.lock();
});
if (inputManager.controls) {
    inputManager.controls.addEventListener('lock', () => { if (!ui.loading && ui.started) ui.hideMenu(); });
    inputManager.controls.addEventListener('unlock', () => { if (!ui.loading && ui.inGame) ui.showPauseMenu(); });
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    bloom.resolution.set(window.innerWidth / 2, window.innerHeight / 2);
    filmPass.uniforms.res.value.set(window.innerWidth, window.innerHeight);
    portals.setSize();
});

// camcorder date stamp
const stamp = document.getElementById('datestamp');
const tickStamp = () => {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const mo = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getMonth()];
    stamp.innerHTML = '<span class="rec">● REC</span><br>' + mo + ' ' + p(d.getDate()) + ' 2004<br>' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
};
tickStamp(); setInterval(tickStamp, 1000);

let gameInitialized = false;
let resolveInitialAssets;
const initialAssetsReady = new Promise(resolve => { resolveInitialAssets = resolve; });
async function initializeGame() {
    if (gameInitialized) return;
    let firstSeed = randomSeed();
    while (blissTime(firstSeed) !== 'day') firstSeed = randomSeed();
    factories.forEach((_, i) => buildWorld(i, i === 0 ? firstSeed : randomSeed()));
    setQuality(quality);
    refreshNeighbours(0, true);
    portals.warmup(camera);
    applyWorld(0);
    if (typeof WebsimSocket !== 'undefined' && localStorage.getItem('multiplayer') === '1') setMultiplayer(true);
    gameInitialized = true;
    animate();
    if (THREE.DefaultLoadingManager.itemsLoaded < THREE.DefaultLoadingManager.itemsTotal) {
        await Promise.race([initialAssetsReady, new Promise(resolve => setTimeout(resolve, 15000))]);
    }
}
// Warm doorway materials once all textures have loaded; the first-start screen waits for this too.
THREE.DefaultLoadingManager.onLoad = () => {
    if (gameInitialized) portals.warmup(camera, currentWorld);
    resolveInitialAssets?.();
    resolveInitialAssets = null;
};
