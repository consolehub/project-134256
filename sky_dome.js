import * as THREE from 'three';

// Seamless procedural sky: colour gradient + soft drifting clouds, computed per view
// direction (no texture, so there is nothing to wrap and no seam). Follows the camera.
export function createSkyDome({ zenith = 0x2f6fd6, horizon = 0xcfe6ff, ground = null, cloud = 0xffffff,
    coverage = 0.5, sunDir = new THREE.Vector3(0.5, 0.85, 0.3), sunColor = 0xfff4dc, brightness = 1 } = {}) {
    const uniforms = {
        uZenith: { value: new THREE.Color(zenith) },
        uHorizon: { value: new THREE.Color(horizon) },
        uGround: { value: new THREE.Color(ground ?? horizon) },
        uCloud: { value: new THREE.Color(cloud) },
        uSun: { value: sunDir.clone().normalize() },
        uSunColor: { value: new THREE.Color(sunColor) },
        uCoverage: { value: coverage },
        uBright: { value: brightness },
        uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
        uniforms, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
        vertexShader: `
            varying vec3 vDir;
            void main() {
                vDir = (modelMatrix * vec4(position, 0.0)).xyz;
                vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                gl_Position = p.xyww; // always at the far plane
            }`,
        fragmentShader: `
            // phones often default to half precision, which shatters the noise into seams
            precision highp float;
            uniform vec3 uZenith, uHorizon, uGround, uCloud, uSun, uSunColor;
            uniform float uCoverage, uBright, uTime;
            varying vec3 vDir;
            // lattice coordinates wrapped to a small range so the hash never runs out of precision
            float hash(vec2 p) { p = mod(p, 289.0); p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
            float noise(vec2 p) {
                vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
            }
            float fbm(vec2 p) {
                float v = 0.0, a = 0.5;
                mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
                for (int i = 0; i < 6; i++) { v += a * noise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
                return v;
            }
            void main() {
                vec3 d = normalize(vDir);
                float h = d.y;
                // sky gradient (brighter, paler toward the horizon)
                float t = pow(clamp(h, 0.0, 1.0), 0.55);
                vec3 col = mix(uHorizon, uZenith, t);
                col = mix(col, uGround, smoothstep(0.0, -0.08, h));
                // sun glow
                float sd = max(dot(d, normalize(uSun)), 0.0);
                col += uSunColor * (pow(sd, 8.0) * 0.18 + pow(sd, 600.0) * 4.0);
                // clouds on a flat layer above (perspective makes them bunch at the horizon)
                if (h > 0.0) {
                    vec2 uv = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
                    float n = fbm(uv);
                    float c = smoothstep(1.0 - uCoverage, 1.0 - uCoverage + 0.28, n);
                    // soft shading: lit tops, slightly grey bellies
                    float shade = mix(0.78, 1.05, smoothstep(0.35, 0.85, fbm(uv * 1.7 + 3.1)));
                    vec3 cc = uCloud * shade + uSunColor * pow(sd, 6.0) * 0.25;
                    c *= smoothstep(0.0, 0.12, h); // thin out toward the horizon
                    col = mix(col, cc, c * 0.92);
                }
                gl_FragColor = vec4(col * uBright, 1.0);
            }`,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    // stay centred on whichever camera draws it (main view, doorway view, water mirror)
    mesh.onBeforeRender = (r, s, cam) => {
        mesh.matrixWorld.makeTranslation(cam.position.x, cam.position.y, cam.position.z);
        uniforms.uTime.value = (performance.now() / 1000) % 20000;   // keep drift offsets small
    };
    return { mesh, uniforms };
}
