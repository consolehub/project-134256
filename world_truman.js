import * as THREE from 'three';
import { createSkyDome } from './sky_dome.js';
import { Water } from 'three/addons/objects/Water.js';
import { makeRng } from './seed.js';

// the reflective water owns a render target, so one is shared by every variation
let sharedWater = null;

// tileable procedural ripple normal map for calm, shallow water
function rippleNormals() {
    const S = 256, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S);
    const waves = [];
    for (let k = 0; k < 9; k++) waves.push({ fx: Math.round(Math.random() * 6 - 3), fy: Math.round(1 + Math.random() * 5), a: 0.6 / (k + 1), p: Math.random() * 6.28 });
    const h = (x, y) => waves.reduce((s, w) => s + w.a * Math.sin(6.2832 * (w.fx * x + w.fy * y) / S + w.p), 0);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
        const n = new THREE.Vector3(-dx * 2, -dy * 2, 1).normalize();
        const i = (y * S + x) * 4;
        img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

export function createTruman({ scene, loadTex, isMobile }, seed, doors = 3) {
    const group = new THREE.Group();
    group.visible = false;
    scene.add(group);

    const rand = makeRng(seed, 6);
    // --- Variation ---
    const wallZ = -rand.range(45, 110), waterY = 1.2;
    const skyCol = new THREE.Color(0xb4cde4).offsetHSL(rand.range(-0.04, 0.03), rand.range(-0.12, 0.08), rand.range(-0.08, 0.05));
    const zenith = new THREE.Color(0x4f86c8).offsetHSL(rand.range(-0.04, 0.03), rand.range(-0.15, 0.1), rand.range(-0.08, 0.06));
    const wallTint = new THREE.Color(0xdde9f5).offsetHSL(rand.range(-0.04, 0.03), rand.range(-0.1, 0.1), rand.range(-0.05, 0.02));
    const coverage = rand.range(0.25, 0.7);
    const sunDir = new THREE.Vector3(rand.range(-0.6, 0.6), rand.range(0.5, 0.9), rand.range(0.3, 0.7)).normalize();
    const steps = rand.int(8, 26), rise = rand.range(1.1, 1.7), run = rand.range(2.0, 3.0);
    const startX = rand.range(-40, 10), sideDoor = rand.range(35, 80);
    // own stream, so day variations keep their layout
    const nrand = makeRng(seed, 106);
    const night = nrand.chance(0.35);
    const nightSky = new THREE.Color(0x0b1224).offsetHSL(nrand.range(-0.03, 0.03), 0, nrand.range(-0.02, 0.02));
    const fog = new THREE.FogExp2(night ? nightSky.clone().multiplyScalar(0.8) : skyCol, rand.range(0.0008, 0.0016));

    // --- Painted sky wall (practically endless) ---
    const skyTex = loadTex('visual_sky.png', 1, 1, true, 'truman');
    skyTex.wrapS = skyTex.wrapT = THREE.MirroredRepeatWrapping;
    const wallW = 8000, wallH = 2400;
    skyTex.repeat.set(wallW / 260, wallH / 150);
    const glow = night ? { color: wallTint.clone().multiplyScalar(0.25), emissive: wallTint, emissiveIntensity: 1.05 } : { color: wallTint, emissive: 0xffffff, emissiveIntensity: 0.55 };
    const wallMat = new THREE.MeshStandardMaterial({ map: skyTex, emissiveMap: skyTex, roughness: 0.95, ...glow });
    wallMat.customProgramCacheKey = () => 'edgewall' + doorX + '|' + landTop;
    wallMat.onBeforeCompile = (sh) => {
        sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = 'varying vec3 vWP;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
            if (abs(vWP.x - ${doorX.toFixed(2)}) < ${(doorW / 2).toFixed(2)} && vWP.y > ${landTop.toFixed(2)} && vWP.y < ${(landTop + doorH).toFixed(2)}) discard;`).replace('#include <dithering_fragment>', `
            // panel seams of the dome
            vec2 q = abs(fract(vWP.xy / 24.0 + 0.5) - 0.5) * 24.0;
            float seam = 1.0 - smoothstep(0.0, 0.09, min(q.x, q.y));
            gl_FragColor.rgb *= 1.0 - seam * 0.22;
            #include <dithering_fragment>`);
    };
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(wallW, wallH), wallMat);
    wall.position.set(0, wallH / 2 - 20, wallZ);
    wall.receiveShadow = true;
    group.add(wall);

    // real sky behind and above you, matching the wall
    const moonDir = new THREE.Vector3(nrand.range(-0.7, 0.7), nrand.range(0.25, 0.55), nrand.range(0.4, 0.9)).normalize();
    const { mesh: dome } = night
        ? createSkyDome({ zenith: nightSky.clone().multiplyScalar(0.45), horizon: nightSky.clone().offsetHSL(0, 0, 0.05), ground: fog.color, coverage: nrand.range(0, 0.3),
            cloud: 0x1a2238, sunDir: moonDir, sunColor: 0xc8d4ff, brightness: 1 })
        : createSkyDome({ zenith, horizon: skyCol.clone().offsetHSL(0, 0, 0.04), ground: skyCol, coverage, sunDir });
    group.add(dome);
    if (night) {
        // stars, pinned to whichever camera is looking (like the sky dome)
        const n = 1800, sp = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const u = nrand(), v = nrand() * 0.92 + 0.08, a = u * Math.PI * 2, r = Math.sqrt(1 - v * v);
            sp.set([Math.cos(a) * r * 90, v * 90, Math.sin(a) * r * 90], i * 3);
        }
        const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
        const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false }));
        stars.frustumCulled = false; stars.renderOrder = -999;
        stars.onBeforeRender = (r, sc, cam) => { stars.matrixWorld.makeTranslation(cam.position.x, cam.position.y, cam.position.z); };
        group.add(stars);
    }

    // --- Shallow water ---
    const water = sharedWater ||= new Water(new THREE.PlaneGeometry(6000, 6000), {
        textureWidth: isMobile ? 256 : 512, textureHeight: isMobile ? 256 : 512,
        waterNormals: rippleNormals(),
        sunDirection: new THREE.Vector3(0.3, 0.8, 0.5).normalize(),
        sunColor: 0xffffff, waterColor: 0x2e5f6c,
        distortionScale: 0.9, fog: true, alpha: 1.0,
    });
    water.userData.keep = true;
    water.material.uniforms.size.value = 6;
    water.material.uniforms.sunDirection.value.copy(sunDir);
    water.material.uniforms.waterColor.value.set(0x2e5f6c).offsetHSL(rand.range(-0.05, 0.05), rand.range(-0.1, 0.1), rand.range(-0.05, 0.05));
    if (night) { water.material.uniforms.waterColor.value.multiplyScalar(0.25); water.material.uniforms.sunDirection.value.copy(moonDir); }
    water.material.uniforms.sunColor.value.set(night ? 0x6a7898 : 0xffffff);
    water.rotation.x = -Math.PI / 2;
    water.position.y = waterY;
    group.add(water);

    // --- Stairs jutting out of the wall up to a door ---
    // stairs painted with the same sky, projected in world space so they line up with the wall
    const stairMat = new THREE.MeshStandardMaterial({ map: skyTex, emissiveMap: skyTex, roughness: 0.95, ...(night ? { color: 0x3a3e44, emissive: 0xe6eef6, emissiveIntensity: 0.85 } : { color: 0xe6eef6, emissive: 0xffffff, emissiveIntensity: 0.32 }) });
    stairMat.onBeforeCompile = (sh) => {
        sh.uniforms.uOff = { value: new THREE.Vector3(wallW / 2, 20, wallZ) };
        sh.vertexShader = 'varying vec3 vWP; varying vec3 vWN;\n' + sh.vertexShader.replace('#include <worldpos_vertex>',
            '#include <worldpos_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
        const skyUv = `
            vec2 suv;
            vec3 wp = vWP + uOff;
            if (abs(vWN.y) > 0.5) suv = vec2(wp.x, wp.y + (vWP.z - uOff.z)) ;
            else if (abs(vWN.x) > 0.5) suv = vec2(wp.x + (vWP.z - uOff.z), wp.y);
            else suv = wp.xy;
            suv /= vec2(260.0, 150.0);`;
        sh.fragmentShader = 'uniform vec3 uOff; varying vec3 vWP; varying vec3 vWN;\n' + sh.fragmentShader
            .replace('#include <map_fragment>', skyUv + '\n diffuseColor *= texture2D(map, suv);')
            .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= texture2D(emissiveMap, suv).rgb;');
    };
    const depth = 6;
    const stepBoxes = [];
    for (let k = 0; k < steps; k++) {
        const top = waterY + 0.3 + k * rise;
        const x0 = startX + k * run;
        const box = new THREE.Mesh(new THREE.BoxGeometry(run, top + 2, depth), stairMat);
        box.position.set(x0 + run / 2, (top - 2) / 2, wallZ + depth / 2);
        box.castShadow = box.receiveShadow = true;
        group.add(box);
        stepBoxes.push({ minX: x0, maxX: x0 + run, minY: -2, maxY: top, minZ: wallZ, maxZ: wallZ + depth });
    }
    const landX0 = startX + steps * run, landW = 9;
    const landTop = waterY + 0.3 + (steps - 1) * rise;
    const landing = new THREE.Mesh(new THREE.BoxGeometry(landW, landTop + 2, depth), stairMat);
    landing.position.set(landX0 + landW / 2, (landTop - 2) / 2, wallZ + depth / 2);
    landing.castShadow = landing.receiveShadow = true;
    group.add(landing);
    stepBoxes.push({ minX: landX0, maxX: landX0 + landW, minY: -2, maxY: landTop, minZ: wallZ, maxZ: wallZ + depth });

    // doorway: a dim service corridor behind the painted sky, fading into darkness
    const doorW = 4.2, doorH = 8.5, doorX = landX0 + landW / 2;
    const inLen = 22, wallT = 0.8;
    const insideMat = (color) => {
        const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false });
        m.customProgramCacheKey = () => 'edgeinside' + wallZ + '|' + landTop;
        m.onBeforeCompile = (sh) => {
            sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>',
                '#include <worldpos_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            sh.fragmentShader = 'varying vec3 vWP;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `
                float d = clamp((${wallZ.toFixed(2)} - vWP.z) / ${inLen.toFixed(1)}, 0.0, 1.0);
                // daylight spilling in through the door, falling off quickly
                float spill = pow(1.0 - d, 3.0);
                // a little brighter on the floor near the threshold
                outgoingLight *= spill * (0.85 + 0.3 * step(vWP.y, ${(landTop + 0.05).toFixed(2)}));
                #include <opaque_fragment>`);
        };
        return m;
    };
    const inWall = insideMat(0x8d949a), inFloor = insideMat(0x6e7378), inCeil = insideMat(0x5d6368);
    const midZ = wallZ - inLen / 2;
    const iw1 = new THREE.Mesh(new THREE.PlaneGeometry(inLen, doorH + 0.6), inWall);
    iw1.rotation.y = Math.PI / 2; iw1.position.set(doorX - doorW / 2, landTop + (doorH + 0.6) / 2, midZ); group.add(iw1);
    const iw2 = iw1.clone(); iw2.position.x = doorX + doorW / 2; group.add(iw2);
    const ifl = new THREE.Mesh(new THREE.PlaneGeometry(doorW, inLen), inFloor);
    ifl.rotation.x = -Math.PI / 2; ifl.position.set(doorX, landTop, midZ); group.add(ifl);
    const ice = new THREE.Mesh(new THREE.PlaneGeometry(doorW, inLen), inCeil);
    ice.rotation.x = Math.PI / 2; ice.position.set(doorX, landTop + doorH + 0.6, midZ); group.add(ice);
    // a lintel above the door opening on the inside, and a black end
    const lint = new THREE.Mesh(new THREE.PlaneGeometry(doorW, 0.6), inWall);
    lint.position.set(doorX, landTop + doorH + 0.3, wallZ - 0.01); lint.rotation.y = Math.PI; group.add(lint);
    const end = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH + 0.6), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
    end.position.set(doorX, landTop + (doorH + 0.6) / 2, wallZ - inLen); group.add(end);
    // door frame trim (painted to match the wall)
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xc9d6e2, roughness: 0.9, ...(night ? { emissive: 0xc9d6e2, emissiveIntensity: 0.6 } : {}) });
    [[0.25, doorH + 0.25, -doorW / 2 - 0.12, doorH / 2], [0.25, doorH + 0.25, doorW / 2 + 0.12, doorH / 2], [doorW + 0.5, 0.25, 0, doorH + 0.12]].forEach(([w, h, ox, oy]) => {
        const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, wallT), frameMat);
        t.position.set(doorX + ox, landTop + oy, wallZ - wallT / 2 + 0.06); group.add(t);
    });
    const doorTex = skyTex.clone();
    doorTex.repeat.set(doorW / 260, doorH / 150);
    doorTex.offset.set((doorX - doorW / 2 + wallW / 2) / 260, (landTop + 20) / 150);
    const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.25), new THREE.MeshStandardMaterial({ map: doorTex, emissiveMap: doorTex, roughness: 0.95, ...glow }));
    door.castShadow = true;
    const hinge = new THREE.Group();
    hinge.position.set(doorX - doorW / 2, landTop + doorH / 2, wallZ + 0.15);
    door.position.x = doorW / 2;
    hinge.add(door);
    hinge.rotation.y = 1.25; // swung open outwards
    group.add(hinge);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshStandardMaterial({ color: 0xc8c8c8, metalness: 0.9, roughness: 0.3 }));
    knob.position.set(doorW - 0.4, -0.4, 0.2);
    door.add(knob);

    // --- Light: soft studio daylight ---
    group.add(night ? new THREE.HemisphereLight(0x34446a, 0x0a1014, 0.35) : new THREE.HemisphereLight(0xd6e6f6, 0x40606a, 1.0));
    const sun = night ? new THREE.DirectionalLight(0xaebcff, 0.45) : new THREE.DirectionalLight(0xfff6ea, 2.0);
    sun.position.copy(night ? moonDir : sunDir).multiplyScalar(150).add(new THREE.Vector3(10, 0, wallZ));
    sun.target.position.set(10, 0, wallZ);
    sun.castShadow = true;
    sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -90, right: 110, top: 90, bottom: -70, near: 10, far: 400 });
    sun.shadow.bias = -0.0005;
    group.add(sun, sun.target);

    const EYE = 7;
    // the wall itself is solid, including the doorway: you can look in but not enter
    const wb = (x0, x1, y0, y1) => ({ minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: wallZ - 60, maxZ: wallZ });
    const dl = doorX - doorW / 2, dr = doorX + doorW / 2;
    const colliders = [...stepBoxes,
        wb(-wallW / 2, dl, -50, wallH), wb(dr, wallW / 2, -50, wallH),
        wb(dl, dr, landTop + doorH, wallH), wb(dl, dr, -50, landTop)];
    return {
        group,
        portals: [
            { pos: new THREE.Vector3(doorX, landTop, wallZ), yaw: 0, w: doorW, h: doorH, kind: 'builtIn', inset: 0.03 },
            // side doors always sit clear of the staircase (which runs from startX to the landing's end)
            { pos: new THREE.Vector3(Math.min(doorX - sideDoor, startX - 8), 0, wallZ), yaw: 0, w: 5.25, h: 9.1, kind: 'wall', frameColor: wallTint.getHex() },
            { pos: new THREE.Vector3(Math.max(doorX + sideDoor, landX0 + landW + 8), 0, wallZ), yaw: 0, w: 5.25, h: 9.1, kind: 'wall', frameColor: wallTint.getHex() },
        ].slice(0, Math.max(1, doors)),
        name: 'The Edge',
        fog, background: night ? fog.color.clone() : skyCol.clone(),
        environment: null,
        exposure: 0.9,
        bloom: 0.25, bloomThreshold: 1.0,
        spawn: new THREE.Vector3(10, 0, 30),
        eye: EYE, speed: 14, gravity: 45, jump: 14, stride: 5.5,
        stepType: (p) => (p.y > waterY ? 'tile' : 'water'),
        waterLevel: waterY,
        ground: () => 0,
        colliders,
        bounds: { minX: -2500, maxX: 2500, minZ: wallZ - 60, maxZ: 1500 },
        update: (pos, t) => {
            water.material.uniforms.time.value = t * 0.35;
        },
        setVisible: (v) => { group.visible = v; },
    };
}
