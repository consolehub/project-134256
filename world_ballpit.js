import * as THREE from 'three';
import { fadePool } from './light_pool.js';
import { makeRng } from './seed.js';

// Unlit material that fades to black the further it goes out past the room wall
function corridorMat(params, hw, len, bright) {
    const m = new THREE.MeshBasicMaterial(params);
    m.customProgramCacheKey = () => 'corridor' + hw + '|' + len + '|' + bright;
    m.onBeforeCompile = (sh) => {
        sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>',
            '#include <worldpos_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = 'varying vec3 vWP;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `
            float depthIn = max(abs(vWP.x) - ${hw.toFixed(2)}, 0.0) / ${len.toFixed(2)};
            outgoingLight *= ${bright.toFixed(2)} * pow(1.0 - clamp(depthIn, 0.0, 1.0), 2.2);
            #include <opaque_fragment>`);
    };
    return m;
}

// Painted "sky over sea" wall, tileable horizontally
function paintedWall(rand) {
    const W = 1024, H = 1024, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const horizon = H * 0.6;
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#9cc4e6'); sky.addColorStop(1, '#dcebf5');
    g.fillStyle = sky; g.fillRect(0, 0, W, horizon);
    // soft brushed clouds (wrapped so the texture tiles)
    g.filter = 'blur(14px)';
    for (let k = 0; k < 14; k++) {
        const x = rand() * W, y = 60 + rand() * (horizon - 220), s = 50 + rand() * 90;
        g.fillStyle = 'rgba(255,255,255,' + (0.45 + rand() * 0.35) + ')';
        for (const ox of [-W, 0, W]) for (let b = 0; b < 6; b++) {
            g.beginPath();
            g.ellipse(x + ox + (b - 2.5) * s * 0.55, y + Math.sin(b * 1.7) * s * 0.18, s * 0.6, s * 0.35, 0, 0, Math.PI * 2);
            g.fill();
        }
    }
    g.filter = 'none';
    // sea band with brush strokes
    const sea = g.createLinearGradient(0, horizon, 0, H);
    sea.addColorStop(0, '#0d7fb8'); sea.addColorStop(1, '#0a9fd0');
    g.fillStyle = sea; g.fillRect(0, horizon, W, H - horizon);
    for (let k = 0; k < 220; k++) {
        const y = horizon + 6 + rand() * (H - horizon), x = rand() * W, l = 60 + rand() * 220;
        g.strokeStyle = 'rgba(' + (rand() < 0.5 ? '255,255,255,' : '0,60,110,') + (0.05 + rand() * 0.1) + ')';
        g.lineWidth = 2 + rand() * 5;
        for (const ox of [-W, 0, W]) { g.beginPath(); g.moveTo(x + ox, y); g.quadraticCurveTo(x + ox + l / 2, y - 4, x + ox + l, y); g.stroke(); }
    }
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, horizon - 2, W, 3);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    return t;
}

function paintedCeiling(rand) {
    const S = 512, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#b8d4ea'; g.fillRect(0, 0, S, S);
    g.filter = 'blur(18px)';
    for (let k = 0; k < 18; k++) {
        const x = rand() * S, y = rand() * S, r = 30 + rand() * 70;
        g.fillStyle = 'rgba(255,255,255,' + (0.3 + rand() * 0.4) + ')';
        for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.beginPath(); g.ellipse(x + ox, y + oy, r * 1.5, r * 0.7, rand(), 0, Math.PI * 2); g.fill(); }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

export function createBallPit({ scene, roomEnv, loadTex, isMobile }, seed, doorCount = 3) {
    const group = new THREE.Group();
    group.visible = false;
    scene.add(group);
    const rand = makeRng(seed, 4);

    // --- Variation ---
    const Wd = rand.pick([20, 22, 26, 26, 30]), L = rand.pick([140, 160, 180, 200, 220]), H = rand.range(14, 24);
    const dockGap = rand.range(30, 44);
    const palettes = [
        [0x0f8f94], [0x0f8f94], [0xd8343a, 0xf2c230, 0x2a6ad8, 0x3aa84a], [0xf06aa8, 0xffffff],
        [0xe8e8e2], [0xf28a1e, 0xd8343a], [0x6a4fd0, 0x2fb8d8], [0x101418],
    ];
    const palette = rand.pick(palettes);
    const pitY = -4, ballTop = 0;
    const hw = Wd / 2, hl = L / 2;

    // --- Room shell ---
    const wallTex = paintedWall(rand);
    wallTex.repeat.set(L / 22, 1);
    const matWall = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85, envMapIntensity: 0.2 });
    const ceilTex = paintedCeiling(rand);
    ceilTex.repeat.set(Wd / 20, L / 20);
    const matCeil = new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.9, envMapIntensity: 0.2 });
    const muralTex = loadTex('asset_ballpit_mural.png', 1, 1, true, 'ballpit');
    muralTex.wrapS = muralTex.wrapT = THREE.ClampToEdgeWrapping;
    const matMural = new THREE.MeshStandardMaterial({ map: muralTex, roughness: 0.85, envMapIntensity: 0.2 });
    const matBase = new THREE.MeshStandardMaterial({ color: 0x0a5f8c, roughness: 0.9 });

    const wallH = H - pitY;
    [-1, 1].forEach(side => {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(L, wallH), matWall);
        w.rotation.y = -side * Math.PI / 2;
        w.position.set(side * hw, pitY + wallH / 2, 0);
        group.add(w);
        // mural above the balls, faces into the room
        const muralH = H - ballTop + 0.5;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(Wd, muralH), matMural);
        m.rotation.y = side > 0 ? 0 : Math.PI;
        m.position.set(0, ballTop - 0.5 + muralH / 2, -side * hl);
        group.add(m);
        const low = new THREE.Mesh(new THREE.PlaneGeometry(Wd, ballTop - pitY), matBase);
        low.rotation.y = m.rotation.y;
        low.position.set(0, (ballTop + pitY) / 2, -side * hl);
        group.add(low);
    });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(Wd, L), matCeil);
    ceil.rotation.x = Math.PI / 2; ceil.position.y = H;
    group.add(ceil);
    // dark pit floor seen between balls
    const under = new THREE.Mesh(new THREE.PlaneGeometry(Wd, L), new THREE.MeshStandardMaterial({ color: 0x03303a, roughness: 1 }));
    under.rotation.x = -Math.PI / 2; under.position.y = ballTop - 1.8;
    group.add(under);
    // painted island "beach" rug in front of each mural
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xc9a77a, roughness: 1 });
    [-1, 1].forEach(side => {
        const sand = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.4, 40), sandMat);
        sand.scale.set(8, 1, 5);
        sand.position.set(0, ballTop - 0.3, -side * (hl - 1));
        group.add(sand);
    });

    // --- Docks with posts, rope and a dark doorway ---
    const solids = [];
    const doors = [];
    const wood = new THREE.MeshStandardMaterial({ color: 0x3b2618, roughness: 0.8 });
    const brass = new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.35, metalness: 0.8 });
    const rope = new THREE.MeshStandardMaterial({ color: 0x8a7350, roughness: 1 });
    const black = new THREE.MeshBasicMaterial({ color: 0x020203 });
    const dockTop = 1.2;
    const portals = [];
    for (let z = -hl + 30, k = 0; z < hl - 20 || k < doorCount; z += dockGap, k++) {
        const side = k % 2 ? 1 : -1;
        const dw = 7, dd = 9;
        const x = side * (hw - dw / 2);
        const deck = new THREE.Mesh(new THREE.BoxGeometry(dw, dockTop - pitY, dd), wood);
        deck.position.set(x, (dockTop + pitY) / 2, z);
        deck.castShadow = deck.receiveShadow = true;
        group.add(deck);
        // plank lines
        for (let pz = -dd / 2 + 0.75; pz < dd / 2; pz += 1.5) {
            const pl = new THREE.Mesh(new THREE.BoxGeometry(dw, 0.04, 0.08), black);
            pl.position.set(x, dockTop + 0.01, z + pz); group.add(pl);
        }
        // doorway: a very long corridor that fades to black
        doors.push({ side, z });
        // the first doorway is a real passage (portal); the others are endless corridors
        if (k < doorCount) portals.push({ pos: new THREE.Vector3(side * hw, dockTop, z), yaw: -side * Math.PI / 2, w: 5.5, h: 10, kind: 'builtIn' });
        else {
            const cw = 5.5, ch = 10, cl = 90;
            const cx = side * (hw + cl / 2);
            const cwTex = wallTex.clone(); cwTex.needsUpdate = true;
            cwTex.repeat.set(cl / 22, ch / wallH); cwTex.offset.set(0, (dockTop - pitY) / wallH);
            const cWall = corridorMat({ map: cwTex, side: THREE.DoubleSide }, hw, cl, 0.75);
            [-1, 1].forEach(sz => {
                const pw = new THREE.Mesh(new THREE.PlaneGeometry(cl, ch), cWall);
                pw.position.set(cx, dockTop + ch / 2, z + sz * cw / 2);
                group.add(pw);
            });
            const cfl = new THREE.Mesh(new THREE.PlaneGeometry(cl, cw), corridorMat({ color: 0x4a3020 }, hw, cl, 0.9));
            cfl.rotation.x = -Math.PI / 2; cfl.position.set(cx, dockTop, z); group.add(cfl);
            const cTex = ceilTex.clone(); cTex.needsUpdate = true; cTex.repeat.set(cl / 20, cw / 20);
            const cce = new THREE.Mesh(new THREE.PlaneGeometry(cl, cw), corridorMat({ map: cTex }, hw, cl, 0.7));
            cce.rotation.x = Math.PI / 2; cce.position.set(cx, dockTop + ch, z); group.add(cce);
            const cap = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), black);
            cap.rotation.y = side * -Math.PI / 2; cap.position.set(side * (hw + cl), dockTop + ch / 2, z); group.add(cap);
        }
        // the room's lintel above the opening reaches the ceiling via the wall itself
        const trim = new THREE.MeshStandardMaterial({ color: 0x7d878c, roughness: 0.8 });
        [[0.4, 10.4, 0.4, -2.95, 5.2], [0.4, 10.4, 0.4, 2.95, 5.2], [0.4, 0.4, 6.3, 0, 10.2]].forEach(([sx, sy, sz, oz, oy]) => {
            const t = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), trim);
            t.position.set(side * (hw - 0.2), dockTop + oy, z + oz);
            group.add(t);
        });
        // posts + rope at the open corner
        const px = side * (hw - dw) + side * 0.4;
        const posts = [z - dd / 2 + 0.4, z + dd / 2 - 0.4];
        posts.forEach(pz => {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 5.5, 12), wood);
            post.position.set(px, dockTop + 2.75 - 1, pz); post.castShadow = true; group.add(post);
            const knob = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), brass);
            knob.position.set(px, dockTop + 4.4, pz); group.add(knob);
        });
        const curve = new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(px, dockTop + 3.6, posts[0]),
            new THREE.Vector3(px, dockTop + 1.9, z),
            new THREE.Vector3(px, dockTop + 3.6, posts[1]));
        group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.1, 6), rope));
        solids.push({ minX: x - dw / 2, maxX: x + dw / 2, minY: pitY, maxY: dockTop, minZ: z - dd / 2, maxZ: z + dd / 2 });
        posts.forEach(pz => solids.push({ minX: px - 0.35, maxX: px + 0.35, minY: dockTop, maxY: dockTop + 4.9, minZ: pz - 0.35, maxZ: pz + 0.35 }));
    }

    // cut the doorway openings out of the side walls
    matWall.customProgramCacheKey = () => 'pitwall' + JSON.stringify(doors);
    matWall.onBeforeCompile = (sh) => {
        sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>',
            '#include <worldpos_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        const tests = doors.map(d => `if (vWP.x * ${d.side.toFixed(1)} > 0.0 && abs(vWP.z - ${d.z.toFixed(2)}) < 2.75 && vWP.y > ${dockTop.toFixed(2)} && vWP.y < ${(dockTop + 10).toFixed(2)}) discard;`).join('\n');
        sh.fragmentShader = 'varying vec3 vWP;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + tests);
    };

    // --- Balls ---
    const r = 0.46;
    const area = Wd * L;
    const count = Math.ceil(area * (isMobile ? 1.4 : 2.75));
    const ballMat = new THREE.MeshPhysicalMaterial({ color: palette.length === 1 ? palette[0] : 0xffffff, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.15, envMapIntensity: 0.6 });
    const playerU = { value: new THREE.Vector3(0, 99, 0) };
    ballMat.onBeforeCompile = (sh) => {
        sh.uniforms.uPlayer = playerU;
        sh.vertexShader = 'uniform vec3 uPlayer;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
            #include <begin_vertex>
            vec3 ctr = instanceMatrix[3].xyz;
            vec2 dv = ctr.xz - uPlayer.xz;
            float dd = length(dv);
            float pr = 2.4;
            if (dd < pr && uPlayer.y < 0.5) {
                float k = 1.0 - dd / pr;
                transformed.xz += normalize(dv + 0.0001) * k * 1.3;
                transformed.y += k * 0.45;
            }`);
    };
    const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(r, 14, 10), ballMat, count);
    const m4 = new THREE.Matrix4(), _c = new THREE.Color();
    let n = 0;
    const avoid = (x, z) => solids.some(s => x > s.minX - r && x < s.maxX + r && z > s.minZ - r && z < s.maxZ + r);
    // jittered hex packing, top layer first, then a nested layer underneath
    const sp = r * 2.02, rowH = sp * 0.866;
    for (let layer = 0; layer < 2 && n < count; layer++) {
        const ox = layer ? sp / 2 : 0, oz = layer ? rowH / 3 : 0;
        for (let row = 0, z = -hl + r + oz; z < hl - r && n < count; z += rowH, row++) {
            for (let x = -hw + r + ox + (row % 2) * sp / 2; x < hw - r && n < count; x += sp) {
                const jx = x + (rand() - 0.5) * 0.18, jz = z + (rand() - 0.5) * 0.18;
                if (avoid(jx, jz)) continue;
                const y = ballTop - r - layer * r * 0.85 + (rand() - 0.5) * (layer ? 0.1 : 0.35);
                m4.makeTranslation(jx, y, jz);
                if (palette.length > 1) balls.setColorAt(n, _c.set(rand.pick(palette)));
                balls.setMatrixAt(n++, m4);
            }
        }
    }
    balls.count = n;
    balls.receiveShadow = true;
    group.add(balls);

    // --- Recessed round ceiling lights ---
    const lights = [];
    const discMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 2.6 });
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ea, roughness: 0.4, metalness: 0.5 });
    const disc = new THREE.CylinderGeometry(1.1, 1.1, 0.05, 32);
    const ring = new THREE.TorusGeometry(1.2, 0.12, 8, 32); ring.rotateX(Math.PI / 2);
    for (let z = -hl + 8; z <= hl - 8; z += 14) {
        const d = new THREE.Mesh(disc, discMat); d.position.set(0, H - 0.03, z); group.add(d);
        const g = new THREE.Mesh(ring, ringMat); g.position.set(0, H - 0.05, z); group.add(g);
        lights.push(new THREE.Vector3(0, H - 0.6, z));
    }
    const pool = [];
    for (let k = 0; k < Math.min(lights.length, isMobile ? 4 : 8); k++) {
        const l = new THREE.PointLight(0xfff0dc, 11, 40, 1.3);
        group.add(l); pool.push(l);
    }
    group.add(new THREE.HemisphereLight(0xbcd6ec, 0x0a4a5a, 0.3));

    const EYE = 7;
    let lastCell = '';
    // side walls as solid slabs, with a gap only at the portal doorway
    const roomWalls = [];
    const slab = (x0, x1, y0, y1, z0, z1) => roomWalls.push({ minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1 });
    slab(hw, hw + 4, pitY - 5, H + 5, -hl, hl);
    slab(-hw - 4, -hw, pitY - 5, H + 5, -hl, hl); // doorway holes are cut by the portal system

    return {
        group,
        portals,
        name: 'Ball Pit',
        fog: new THREE.FogExp2(0x3c6a80, 0.006),
        background: new THREE.Color(0x3c6a80),
        environment: roomEnv,
        exposure: 0.8,
        bloom: 0.5, bloomThreshold: 0.9,
        spawn: new THREE.Vector3(0, pitY, hl - 14),
        eye: EYE, speed: 12, gravity: 45, jump: 14, stride: 5, ceiling: H,
        stepType: (p) => (p.y > pitY + 1 ? 'wood' : 'carpet'),
        ground: () => pitY,
        colliders: [...solids, ...roomWalls],
        // the side walls are solid: you can look down the doorways but not walk in
        bounds: { minX: -hw - 10, maxX: hw + 10, minZ: -hl + 6, maxZ: hl - 6 },
        update: (pos, t, dt, cam, feet) => {
            playerU.value.copy(feet || pos);
            const c = Math.round(pos.z / 14);
            if (c !== lastCell) {
                lastCell = c;
                lights.sort((a, b) => Math.abs(a.z - pos.z) - Math.abs(b.z - pos.z));
                pool.forEach((l, k) => l.position.copy(lights[k]));
            }
            fadePool(pool, pos, lights.length <= pool.length);
        },
        setVisible: (v) => { group.visible = v; },
    };
}
