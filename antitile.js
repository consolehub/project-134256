// Hex-tile stochastic texturing (after Mikkelsen, "Practical Real-Time Hex-Tiling"):
// the map is sampled in a grid of hexagons, each at a random rotation and offset,
// blended softly at the borders, so a repeating texture never shows a pattern.
// A slow brightness drift on top breaks up the remaining uniformity.

const GLSL = `
vec2 atHash(vec2 p) { p = mod(p, 289.0); vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
float atNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(atHash(i).x, atHash(i + vec2(1, 0)).x, f.x), mix(atHash(i + vec2(0, 1)).x, atHash(i + vec2(1, 1)).x, f.x), f.y);
}
vec4 atSample(sampler2D tex, vec2 uv, vec2 vtx, vec2 dx, vec2 dy) {
    vec2 h = atHash(vtx);
    float a = h.x * 6.2831853;
    mat2 r = mat2(cos(a), sin(a), -sin(a), cos(a));
    return textureGrad(tex, r * uv + h * 7.31, r * dx, r * dy);
}
vec4 antiTile(sampler2D tex, vec2 uv, float cellScale) {
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    vec2 skewed = mat2(1.0, -0.57735027, 0.0, 1.15470054) * (uv * cellScale * 3.4641016);
    vec2 base = floor(skewed);
    vec3 t = vec3(fract(skewed), 0.0); t.z = 1.0 - t.x - t.y;
    float s = step(0.0, -t.z), s2 = 2.0 * s - 1.0;
    vec3 w = vec3(-t.z * s2, s - t.y * s2, s - t.x * s2);
    vec4 c1 = atSample(tex, uv, base + vec2(s, s), dx, dy);
    vec4 c2 = atSample(tex, uv, base + vec2(s, 1.0 - s), dx, dy);
    vec4 c3 = atSample(tex, uv, base + vec2(1.0 - s, s), dx, dy);
    // sharpen the blend so most of each hex is a single clean sample (keeps contrast)
    w = pow(w, vec3(6.0)); w /= (w.x + w.y + w.z);
    vec4 c = c1 * w.x + c2 * w.y + c3 * w.z;
    // slow light/dark drift over many tiles
    float m = atNoise(uv * 0.11) * 0.65 + atNoise(uv * 0.37 + 5.3) * 0.35;
    c.rgb *= mix(0.82, 1.14, m);
    return c;
}
`;

/** Patch a material's map lookup. cellScale: hexes per texture repeat (higher = smaller hexes). */
export function applyAntiTile(material, cellScale = 0.6) {
    material.customProgramCacheKey = () => 'antitile' + cellScale;
    material.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\n' + GLSL)
            .replace('#include <map_fragment>', `
                vec4 sampledDiffuseColor = antiTile(map, vMapUv, ${cellScale.toFixed(3)});
                diffuseColor *= sampledDiffuseColor;`);
    };
    return material;
}
