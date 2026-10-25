import * as THREE from 'three';

// --------------------------------------------------------------------------
// Bliss props: winding paths (shader + matching JS), white picket fences and
// one cream farmhouse model that every house in a variation is a copy of.
// --------------------------------------------------------------------------

export const MAX_PATHS = 3;

// Each path is a sinuous curve u = f(v) in a frame rotated by its angle.
// A = (amp1, freq1, phase1, amp2), B = (freq2, phase2, offset, halfWidth), R = (cos, sin, edge wobble)
export const PATHS_GLSL = `
uniform vec4 uPA[${MAX_PATHS}]; uniform vec4 uPB[${MAX_PATHS}]; uniform vec3 uPR[${MAX_PATHS}];
float pathDist(vec2 p) {
    float d = 1e5;
    for (int i = 0; i < ${MAX_PATHS}; i++) {
        vec4 A = uPA[i]; vec4 B = uPB[i]; vec3 R = uPR[i];
        float u = R.x * p.x + R.y * p.y, v = -R.y * p.x + R.x * p.y;
        float f = A.x * sin(v * A.y + A.z) + A.w * sin(v * B.x + B.y) - B.z;
        float hw = B.w * (1.0 + R.z * sin(v * 0.23 + B.y * 3.0));
        d = min(d, abs(u - f) - hw);
    }
    return d;
}`;

export function makePaths(list) {
    const A = [], B = [], R = [];
    for (let i = 0; i < MAX_PATHS; i++) {
        const p = list[i];
        A.push(p ? p.A : new THREE.Vector4());
        B.push(p ? p.B : new THREE.Vector4(0, 0, 0, -1e4));
        R.push(p ? new THREE.Vector3(Math.cos(p.angle), Math.sin(p.angle), p.wobble) : new THREE.Vector3(1, 0, 0));
    }
    const fOf = (p, v) => p.A.x * Math.sin(v * p.A.y + p.A.z) + p.A.w * Math.sin(v * p.B.x + p.B.y) - p.B.z;
    const hwOf = (p, v) => p.B.w * (1 + p.wobble * Math.sin(v * 0.23 + p.B.y * 3));
    const dist = (x, z) => {
        let d = 1e5;
        for (const p of list) {
            const c = Math.cos(p.angle), s = Math.sin(p.angle);
            const u = c * x + s * z, v = -s * x + c * z;
            d = Math.min(d, Math.abs(u - fOf(p, v)) - hwOf(p, v));
        }
        return d;
    };
    // a point beside path p at frame coordinate v, off metres past its edge on side +-1
    const beside = (p, v, side, off) => {
        const c = Math.cos(p.angle), s = Math.sin(p.angle);
        const u = fOf(p, v) + side * (hwOf(p, v) + off);
        return [c * u - s * v, s * u + c * v];
    };
    // set the frame offset so path p passes through world point (x, z)
    const through = (p, x, z) => {
        const c = Math.cos(p.angle), s = Math.sin(p.angle);
        const u = c * x + s * z, v = -s * x + c * z;
        p.B.z = 0; p.B.z = fOf(p, v) - u;
    };
    const vOf = (p, x, z) => -Math.sin(p.angle) * x + Math.cos(p.angle) * z;
    return { list, uniforms: { uPA: { value: A }, uPB: { value: B }, uPR: { value: R } }, dist, beside, through, vOf };
}

// ---------------------------------------------------------------- textures
function canvasTex(w, h, draw) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
}

// house dimensions (metres): front gable W wide, D deep, walls Hw, ridge Hp
const W = 6.4, D = 7.6, Hw = 5.2, Hp = 8.6, PX = 80;
const TRIM = '#f8f0d4', SHADE = 'rgba(120,96,50,0.35)', GLASS = '#15120f', SASH = '#fbf7ea';

function drawWindow(g, X, Y, cx, y0, w, h) {
    const x0 = cx - w / 2;
    g.fillStyle = SHADE; g.fillRect(X(x0 - 0.06), Y(y0 + h + 0.06), (w + 0.2) * PX, (h + 0.2) * PX);
    g.fillStyle = SASH; g.fillRect(X(x0 - 0.1), Y(y0 + h + 0.1), (w + 0.2) * PX, (h + 0.2) * PX);
    g.fillStyle = GLASS; g.fillRect(X(x0), Y(y0 + h), w * PX, h * PX);
    g.fillStyle = SASH;
    const m = 4;
    g.fillRect(X(cx) - m / 2, Y(y0 + h), m, h * PX);
    for (const f of [1 / 3, 2 / 3]) g.fillRect(X(x0), Y(y0 + h * f) - m / 2, w * PX, m);
}
function trimStroke(g, pts, X, Y) {
    g.lineJoin = 'miter';
    for (const [col, lw, off] of [[SHADE, 12, 3], [TRIM, 9, 0]]) {
        g.strokeStyle = col; g.lineWidth = lw;
        g.beginPath();
        pts.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](X(x) + off, Y(y) + off));
        g.closePath(); g.stroke();
    }
}
function facadeTex() {
    return canvasTex(W * PX, Hp * PX, (g, cw, ch) => {
        const X = x => x * PX, Y = y => ch - y * PX;
        const gr = g.createLinearGradient(0, 0, 0, ch);
        gr.addColorStop(0, '#f3e6bd'); gr.addColorStop(1, '#e8d8a8');
        g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
        // recessed panels: a gable-shaped upper frame, a long low one, two small squares
        trimStroke(g, [[0.85, 2.95], [0.85, 5.35], [3.2, 7.35], [5.55, 5.35], [5.55, 2.95]], X, Y);
        trimStroke(g, [[0.85, 0.6], [0.85, 2.25], [5.55, 2.25], [5.55, 0.6]], X, Y);
        trimStroke(g, [[2.75, 3.55], [2.75, 4.65], [3.65, 4.65], [3.65, 3.55]], X, Y);
        trimStroke(g, [[2.7, 5.05], [2.7, 6.0], [3.7, 6.0], [3.7, 5.05]], X, Y);
        drawWindow(g, X, Y, 1.75, 3.45, 0.85, 1.25);
        drawWindow(g, X, Y, 4.65, 3.45, 0.85, 1.25);
        for (const cx of [1.75, 3.2, 4.65]) drawWindow(g, X, Y, cx, 0.9, 0.78, 1.05);
    });
}
function sideTex() {
    return canvasTex(D * PX, Hw * PX, (g, cw, ch) => {
        const gr = g.createLinearGradient(0, 0, 0, ch);
        gr.addColorStop(0, '#f1e3b8'); gr.addColorStop(1, '#e6d5a4');
        g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
        g.fillStyle = 'rgba(150,120,60,0.06)';
        for (let x = 0; x < cw; x += 24) g.fillRect(x, 0, 2, ch);
    });
}
function shingleTex() {
    // a fixed little generator so every house gets the very same roof
    let s = 12345;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const t = canvasTex(256, 256, (g) => {
        g.fillStyle = '#6e2f22'; g.fillRect(0, 0, 256, 256);
        // courses run down the canvas columns (u runs along the slope)
        for (let cx = 0; cx < 256; cx += 32) {
            for (let y0 = (cx / 32 % 2) * 11 - 40; y0 < 256; ) {
                const h = 16 + r() * 14;
                g.fillStyle = 'hsl(' + (8 + r() * 6) + ',' + (42 + r() * 10) + '%,' + (26 + r() * 12) + '%)';
                g.fillRect(cx + 1, y0 + 1, 31, h - 2);
                y0 += h;
            }
            g.fillStyle = 'rgba(20,6,4,0.55)'; g.fillRect(cx, 0, 4, 256);
        }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

// ---------------------------------------------------------------- house
let houseCache = null;
/** The one farmhouse. Returns a fresh Group sharing geometry and materials. Front faces +z. */
export function makeHouse(env = 0.35) {
    if (!houseCache) {
        const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, envMapIntensity: 0.35, ...o });
        const mFacade = std({ map: facadeTex() }), mSide = std({ map: sideTex() });
        const mCream = std({ color: 0xead9a8 }), mTrim = std({ color: 0xf6eccc });
        const roofTex = shingleTex();
        const mRoof = std({ map: roofTex, roughness: 0.9 }), mRoofEdge = std({ color: 0x4a2018, roughness: 0.9 });
        const mSill = std({ color: 0xa47c50 }), mFound = std({ color: 0x7d776c, roughness: 0.95 });
        const parts = [];
        const box = (sx, sy, sz, x, y, z, mat) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
            m.position.set(x, y, z); parts.push(m); return m;
        };
        const sill = 0.38;
        box(W + 0.1, 3, D + 0.1, 0, -1.5, 0, mFound);
        box(W + 0.16, sill, D + 0.16, 0, sill / 2, 0, mSill);
        // body: textured long sides, plain gable ends (covered by the facade planes)
        const body = new THREE.Mesh(new THREE.BoxGeometry(W, Hw - sill, D), [mSide, mSide, mCream, mCream, mCream, mCream]);
        body.position.y = sill + (Hw - sill) / 2; parts.push(body);
        // gable-end facades, front and back alike
        const sh = new THREE.Shape([[-W / 2, 0], [W / 2, 0], [W / 2, Hw], [0, Hp], [-W / 2, Hw]].map(([x, y]) => new THREE.Vector2(x, y)));
        const fg = new THREE.ShapeGeometry(sh);
        const uv = fg.attributes.uv, fp = fg.attributes.position;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (fp.getX(i) + W / 2) / W, fp.getY(i) / Hp);
        for (const s of [1, -1]) {
            const f = new THREE.Mesh(fg, mFacade);
            f.position.z = s * (D / 2 + 0.012); f.rotation.y = s > 0 ? 0 : Math.PI; parts.push(f);
        }
        // corner boards, the belt course between the floors and a frieze under the eaves
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.26, Hw - sill, 0.26, sx * (W / 2 - 0.1), sill + (Hw - sill) / 2, sz * (D / 2 - 0.1), mTrim);
        box(W + 0.07, 0.2, D + 0.07, 0, 2.55, 0, mTrim);
        box(W + 0.07, 0.22, D + 0.03, 0, Hw - 0.11, 0, mTrim);
        // roof: two shingled slabs with an overhang, white rake boards, a ridge cap
        const a = Math.atan2(Hp - Hw, W / 2), ov = 0.5, run = W / 2 + ov, L = run / Math.cos(a), th = 0.16, Dr = D + 0.7;
        roofTex.repeat.set(L / 2, Dr / 2);
        for (const s of [1, -1]) {
            const nx = Math.sin(a) * s, ny = Math.cos(a);
            const cx = s * run / 2, cy = Hp - (run / 2) * Math.tan(a) + 0.03;
            const r = new THREE.Mesh(new THREE.BoxGeometry(L, th, Dr), [mRoofEdge, mRoofEdge, mRoof, mRoofEdge, mRoofEdge, mRoofEdge]);
            r.position.set(cx + nx * th / 2, cy + ny * th / 2, 0); r.rotation.z = -s * a; parts.push(r);
            for (const sz of [1, -1]) {
                const b = new THREE.Mesh(new THREE.BoxGeometry(L, 0.32, 0.12), mTrim);
                b.position.set(cx - nx * 0.1, cy - ny * 0.1, sz * (Dr / 2 - 0.08)); b.rotation.z = -s * a; parts.push(b);
            }
        }
        box(0.26, 0.12, Dr + 0.02, 0, Hp + th / Math.cos(a) - 0.02, 0, mRoofEdge);
        parts.forEach(m => { m.castShadow = m.receiveShadow = true; });
        houseCache = parts;
    }
    // the sky environment is shared, so match how strongly this variation's ground reflects it
    for (const m of houseCache) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mt => { mt.envMapIntensity = env; });
    const g = new THREE.Group();
    for (const p of houseCache) g.add(p.clone());
    return g;
}
export const HOUSE = { W, D, Hp };

// ---------------------------------------------------------------- fences
const PICKET = 0.24, POST_EVERY = 10;
let picketGeo = null;
/**
 * White picket fences. runs: arrays of [x, z] polyline points; keep(x, z) filters pickets out
 * (paths, doors, houses). Returns { group, colliders }.
 */
export function buildFences(runs, height, keep, env = 0.35) {
    if (!picketGeo) {
        const s = new THREE.Shape([[-0.045, 0], [0.045, 0], [0.045, 0.92], [0, 1.0], [-0.045, 0.92]].map(([x, y]) => new THREE.Vector2(x, y)));
        picketGeo = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false });
        picketGeo.translate(0, 0, -0.0125);
    }
    const pk = [], rails = [], cols = [];
    for (const run of runs) {
        // resample the polyline every PICKET metres
        const pts = [];
        let carry = 0;
        for (let i = 1; i < run.length; i++) {
            const [x0, z0] = run[i - 1], [x1, z1] = run[i];
            const len = Math.hypot(x1 - x0, z1 - z0);
            if (len < 1e-6) continue;
            let d = carry;
            for (; d < len; d += PICKET) {
                const t = d / len;
                pts.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, dx: (x1 - x0) / len, dz: (z1 - z0) / len });
            }
            carry = d - len;
        }
        pts.forEach(p => { p.ok = keep(p.x, p.z); p.y = height(p.x, p.z) - 0.08; });
        pts.forEach((p, i) => { if (p.ok) pk.push({ ...p, post: i % POST_EVERY === 0 }); });
        for (let i = 0; i + POST_EVERY < pts.length; i += POST_EVERY) {
            const seg = pts.slice(i, i + POST_EVERY + 1);
            if (!seg.every(p => p.ok)) continue;
            rails.push({ a: seg[0], b: seg[seg.length - 1] });
        }
        // thin collision boxes every few pickets, so a diagonal fence stays a thin wall
        for (let i = 0; i + 4 < pts.length; i += 4) {
            const p0 = pts[i], p1 = pts[i + 4];
            if (!p0.ok || !p1.ok) continue;
            cols.push({ minX: Math.min(p0.x, p1.x) - 0.06, maxX: Math.max(p0.x, p1.x) + 0.06, minY: Math.min(p0.y, p1.y) - 1,
                maxY: Math.max(p0.y, p1.y) + 1.0, minZ: Math.min(p0.z, p1.z) - 0.06, maxZ: Math.max(p0.z, p1.z) + 0.06 });
        }
    }
    const group = new THREE.Group();
    if (!pk.length) return { group, colliders: cols };
    const mat = new THREE.MeshStandardMaterial({ color: 0xeeece4, roughness: 0.75, envMapIntensity: env });
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qz = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
    const pickets = new THREE.InstancedMesh(picketGeo, mat, pk.length);
    pk.forEach((p, i) => {
        q.setFromAxisAngle(Y, Math.atan2(-p.dz, p.dx));
        sc.set(p.post ? 1.9 : 1, p.post ? 1.08 : 1, p.post ? 3.2 : 1);
        pickets.setMatrixAt(i, m4.compose(v.set(p.x, p.y, p.z), q, sc));
    });
    const railMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.08, 0.035), mat, Math.max(1, rails.length * 2));
    railMesh.count = rails.length * 2;
    rails.forEach(({ a, b }, i) => {
        const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), dy = b.y - a.y;
        q.setFromAxisAngle(Y, Math.atan2(-dz, dx)).multiply(qz.setFromAxisAngle(Z, Math.atan2(dy, len)));
        const nx = dz / len * 0.035, nz = -dx / len * 0.035;   // just behind the pickets
        [0.28, 0.74].forEach((h, k) => railMesh.setMatrixAt(i * 2 + k,
            m4.compose(v.set((a.x + b.x) / 2 + nx, (a.y + b.y) / 2 + h, (a.z + b.z) / 2 + nz), q, sc.set(Math.hypot(len, dy), 1, 1))));
    });
    for (const m of [pickets, railMesh]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; group.add(m); }
    return { group, colliders: cols };
}
