import * as THREE from 'three';

// Ultra-quality grass: dense, curved, individually varied blades lit by the scene's real lights
// (sun + sky + shadows + fog), with translucency when the sun is behind them and darker roots
// where blades crowd each other.
//
// groundGLSL must define: float grassGround(vec2 wp) (terrain height) and
// float grassMask(vec2 wp) (0 where no grass grows), using the given uniforms.
export function createUltraGrass({ rand, groundGLSL, uniforms = {}, albedo, area = 80, side = 470, hMin = 0.25, hRand = 0.5, sunDir, sunColor }) {
    // tapered blade, 7 segments, pointed tip
    const segN = 7, bp = [], bi = [];
    for (let s = 0; s <= segN; s++) {
        const t = s / segN, w = 0.045 * Math.pow(1 - t, 0.75);
        bp.push(-w / 0.045, t, 0, w / 0.045, t, 0);
    }
    for (let s = 0; s < segN; s++) { const a = s * 2; bi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(bp.map((_, k) => (k % 3 === 2 ? 1 : 0)), 3));
    geo.setIndex(bi);
    const n = side * side;
    geo.instanceCount = n;
    const offs = new Float32Array(n * 4), rnd = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
        const gx = i % side, gz = (i / side) | 0;
        offs[i * 4] = ((gx + rand()) / side - 0.5) * area;
        offs[i * 4 + 1] = ((gz + rand()) / side - 0.5) * area;
        offs[i * 4 + 2] = rand() * Math.PI * 2;
        offs[i * 4 + 3] = hMin + Math.pow(rand(), 1.4) * hRand;
        rnd[i * 4] = rand();                         // wind phase
        rnd[i * 4 + 1] = 0.15 + rand() * 0.85;       // curvature
        rnd[i * 4 + 2] = rand();                     // colour variation
        rnd[i * 4 + 3] = 0.03 + rand() * 0.035;      // half width
    }
    geo.setAttribute('offset', new THREE.InstancedBufferAttribute(offs, 4));
    geo.setAttribute('rnd', new THREE.InstancedBufferAttribute(rnd, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const u = {
        camPos: { value: new THREE.Vector3() }, time: { value: 0 }, area: { value: area },
        uAlb: { value: new THREE.Color(albedo.x ?? albedo.r, albedo.y ?? albedo.g, albedo.z ?? albedo.b) },
        uSunDir: { value: sunDir }, uSunCol: { value: sunColor },
        ...uniforms,
    };
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.5, metalness: 0, envMapIntensity: 0.9 });
    const injectVertex = (sh) => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = groundGLSL + `
            attribute vec4 offset; attribute vec4 rnd;
            uniform vec3 camPos; uniform float time; uniform float area;
            uniform vec3 uAlb; uniform vec3 uSunDir;
            varying vec3 vGCol; varying float vGT; varying float vTrans;
        ` + sh.vertexShader
            .replace('#include <beginnormal_vertex>', `
            vec2 o = offset.xy;
            vec2 wp = o + floor((camPos.xz - o) / area + 0.5) * area;
            float dist = length(wp - camPos.xz);
            float fade = (1.0 - smoothstep(area * 0.32, area * 0.5, dist)) * grassMask(wp);
            // meadow patches: taller / drier in places
            float patchN = sin(wp.x * 0.23 + sin(wp.y * 0.11) * 2.0) * 0.5 + sin(wp.y * 0.19 - wp.x * 0.07) * 0.5;
            float h = offset.w * fade * (0.8 + 0.3 * patchN);
            float t = position.y;
            vec2 dir = vec2(cos(offset.z), sin(offset.z));     // across the blade
            vec2 fwd = vec2(-dir.y, dir.x);                     // the way it bends
            float gust = sin(time * 0.6 + wp.x * 0.05 + wp.y * 0.03) * 0.5 + 0.5;
            float wind = (sin(time * 1.7 + wp.x * 0.14 + wp.y * 0.09 + rnd.x * 1.5) * 0.5 + sin(time * 3.3 + wp.x * 0.55 + rnd.x * 6.0) * 0.18) * (0.5 + gust);
            vec2 windDir = normalize(vec2(0.8, 0.45));
            float bend = rnd.y * 0.6 + dot(fwd, windDir) * wind * 0.25;
            vec2 sway = windDir * wind * 0.22;
            float lean = t * t;
            vec3 local;
            local.xz = dir * position.x * rnd.w * (0.7 + offset.w * 0.6) + (fwd * bend + sway) * lean * h;
            local.y = t * h * (1.0 - 0.35 * bend * bend * t);
            vec3 grassWorld = vec3(wp.x, grassGround(wp) - 0.03, wp.y) + local;
            // normal: across-blade rounding, bent toward the sky, always turned to face the viewer
            vec3 bn = vec3(fwd.x, 0.0, fwd.y);
            vec3 toCam = camPos - grassWorld;
            if (dot(bn, toCam) < 0.0) bn = -bn;
            vec3 objectNormal = normalize(bn * 0.8 + vec3(dir.x, 0.0, dir.y) * position.x * 0.45 + vec3(0.0, 0.6 + lean * 0.4, 0.0));
            // colour: per blade hue/lightness, dry straw in patches, lighter tips
            float dry = smoothstep(0.55, 1.0, rnd.z * 0.7 + patchN * 0.45);
            vec3 col = uAlb * (0.75 + 0.5 * rnd.z);
            col = mix(col, vec3(dot(uAlb, vec3(0.6)) * 1.3, dot(uAlb, vec3(0.5)) * 1.1, uAlb.b * 0.6 + 0.004), dry * 0.55);
            col *= mix(1.0, 1.25, t);
            vGCol = col;
            vGT = t;
            vTrans = pow(max(dot(normalize(grassWorld - camPos + vec3(0.0, 1e-3, 0.0)), uSunDir), 0.0), 3.0) * t;
            `)
            .replace('#include <begin_vertex>', 'vec3 transformed = grassWorld;');
    };
    const flatNormalFix = `
                float faceDirection = 1.0;
                vec3 normal = normalize(vNormal);
                vec3 nonPerturbedNormal = normal;`;
    mat.onBeforeCompile = (sh) => {
        injectVertex(sh);
        sh.fragmentShader = `
            uniform vec3 uSunCol;
            varying vec3 vGCol; varying float vGT; varying float vTrans;
        ` + sh.fragmentShader
            .replace('#include <color_fragment>', `
                // crowded roots get little light
                diffuseColor.rgb = vGCol * mix(0.22, 1.0, pow(vGT, 0.6));`)
            .replace('#include <normal_fragment_begin>', flatNormalFix)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                // sunlight shining through the blade
                totalEmissiveRadiance += diffuseColor.rgb * uSunCol * vTrans * 0.55;`);
    };
    // used by the ambient-occlusion pass instead of its generic normal material, so it sees the
    // blades where they really are (the generic one would draw them undisplaced, with junk normals)
    const aoMat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide, blending: THREE.NoBlending });
    aoMat.onBeforeCompile = (sh) => {
        injectVertex(sh);
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', flatNormalFix);
    };
    // the shader text depends on the world's ground function: keep compiled programs apart
    mat.customProgramCacheKey = aoMat.customProgramCacheKey = () => 'ultragrass:' + groundGLSL;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.aoMaterial = aoMat;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    return {
        mesh,
        update(p, t) { u.camPos.value.copy(p); u.time.value = t; },
        dispose() { geo.dispose(); mat.dispose(); aoMat.dispose(); },
    };
}
