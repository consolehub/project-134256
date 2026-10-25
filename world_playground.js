import * as THREE from 'three';
import { makeRng } from './seed.js';

export function createPlayground({ scene, roomEnv, isMobile }, seed, doorCount = 3) {
    const rand = makeRng(seed, 1500);
    const theme = rand.int(0, 2), dark = rand.chance(0.24), giantPit = rand.chance(0.5);
    const colors = [
        [0xf83246, 0xffce16, 0x146cdd, 0x20bc63, 0x9d35db, 0xff7b1a],
        [0xf96eae, 0x8be6d9, 0xb49aff, 0xffe290, 0x66b8ed, 0xff965c],
        [0xf25b16, 0xafd615, 0x722cdb, 0x06bcb8, 0xf52b7e, 0x287fe5],
    ][theme];
    const group = new THREE.Group(); group.visible = false; scene.add(group);
    const colliders = [], slides = [], netVertices = [];
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const materials = colors.map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.02, envMapIntensity: 0.25 }));
    const wall = new THREE.MeshStandardMaterial({ color: theme === 1 ? 0xe6d9d0 : 0xe1e3d9, roughness: 0.95, envMapIntensity: 0.15 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x252b34, roughness: 0.85, envMapIntensity: 0.15 });
    const rope = new THREE.MeshStandardMaterial({ color: 0x232d30, roughness: 0.9, envMapIntensity: 0.15 });
    const solid = (x, y, z, w, h, d, noStep = false) => colliders.push({ minX: x - w / 2, maxX: x + w / 2, minY: y - h / 2, maxY: y + h / 2, minZ: z - d / 2, maxZ: z + d / 2, noStep });
    const box = (x, y, z, w, h, d, mat, collision = false) => {
        const m = new THREE.Mesh(boxGeo, mat); m.position.set(x, y, z); m.scale.set(w, h, d);
        m.castShadow = m.receiveShadow = true; group.add(m);
        if (collision) solid(x, y, z, w, h, d);
        return m;
    };
    const rodGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
    const rod = (a, b, radius, mat) => {
        const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
        const m = new THREE.Mesh(rodGeo, mat); m.position.copy(A).add(B).multiplyScalar(0.5);
        m.scale.set(radius, A.distanceTo(B), radius);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.sub(A).normalize());
        m.castShadow = true; group.add(m); return m;
    };
    // Net strands share one draw call. Their collision is a thin, non-climbable panel.
    const net = (x, y, z, width, height, alongX = true) => {
        for (let u = 0; u <= width + 0.001; u += 0.22) {
            const px = x + (alongX ? u : 0), pz = z + (alongX ? 0 : u);
            netVertices.push(px, y, pz, px, y + height, pz);
        }
        for (let v = 0; v <= height + 0.001; v += 0.22) {
            netVertices.push(x, y + v, z, x + (alongX ? width : 0), y + v, z + (alongX ? 0 : width));
        }
        solid(x + (alongX ? width / 2 : 0), y + height / 2, z + (alongX ? 0 : width / 2), alongX ? width : 0.09, height, alongX ? 0.09 : width, true);
    };
    const halfW = theme === 2 ? 34 : 30, halfD = 36, ceiling = 16;
    const portals = [];
    for (let k = 0; k < doorCount; k++) portals.push({ pos: new THREE.Vector3(-halfW + 0.01, 0, -25 + k * 15), yaw: Math.PI / 2, w: 1.8, h: 2.8, kind: 'wall', frameColor: colors[k % 6] });
    const pit = giantPit ? { x0: -22, x1: 13, z0: 18, z1: 31 } : { x0: -1, x1: 10, z0: 22, z1: 30 };
    const inPit = (x, z) => x > pit.x0 && x < pit.x1 && z > pit.z0 && z < pit.z1;
    // The pit is recessed, so entry, exit, and slide landings have real depth.
    box(0, -1.65, 0, halfW * 2, 0.3, halfD * 2, roof);
    const floorMats = [materials[1], materials[2], materials[3], materials[4]];
    const tileCount = Math.ceil(halfW * 2 / 2) * 36;
    const tiles = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ roughness: 0.85, envMapIntensity: 0.15 }), tileCount);
    const dummy = new THREE.Object3D(); let tile = 0;
    for (let x = -halfW + 1; x < halfW; x += 2) for (let z = -35; z < 36; z += 2) {
        // Cut exact pit edges instead of covering them with the checkerboard.
        const x0 = x - 1, x1 = x + 1, z0 = z - 1, z1 = z + 1;
        if (x1 > pit.x0 && x0 < pit.x1 && z1 > pit.z0 && z0 < pit.z1) {
            const pieces = [[x0, Math.min(x1, pit.x0), z0, z1], [Math.max(x0, pit.x1), x1, z0, z1],
                [Math.max(x0, pit.x0), Math.min(x1, pit.x1), z0, Math.min(z1, pit.z0)],
                [Math.max(x0, pit.x0), Math.min(x1, pit.x1), Math.max(z0, pit.z1), z1]];
            for (const [a, b, c, d] of pieces) if (b > a && d > c) box((a + b) / 2, -0.12, (c + d) / 2, b - a, 0.24, d - c, floorMats[(x + z + 100) % 4]);
            continue;
        }
        dummy.position.set(x, -0.12, z); dummy.scale.set(1.98, 0.24, 1.98); dummy.updateMatrix();
        tiles.setMatrixAt(tile, dummy.matrix); tiles.setColorAt(tile++, new THREE.Color(colors[((x + halfW - 1) / 2 + (z + 35) / 2) % 4]));
    }
    tiles.count = tile; tiles.receiveShadow = true; group.add(tiles);
    box(0, ceiling + 0.2, 0, halfW * 2, 0.4, halfD * 2, roof);
    for (const s of [-1, 1]) {
        box(s * (halfW + 0.3), ceiling / 2, 0, 0.6, ceiling, halfD * 2, wall, true);
        box(0, ceiling / 2, s * (halfD + 0.3), halfW * 2, ceiling, 0.6, wall, true);
        // Leave gaps in the west-wall padding for the wall-mounted doors.
        if (s === -1) {
            let start = -halfD;
            for (const p of portals) {
                const edge = p.pos.z - p.w / 2;
                if (edge > start) box(s * (halfW - 0.12), 1.1, (start + edge) / 2, 0.2, 2.2, edge - start, materials[1]);
                start = p.pos.z + p.w / 2;
            }
            if (start < halfD) box(s * (halfW - 0.12), 1.1, (start + halfD) / 2, 0.2, 2.2, halfD - start, materials[1]);
        } else box(s * (halfW - 0.12), 1.1, 0, 0.2, 2.2, halfD * 2, materials[1]);
        box(0, 1.1, s * (halfD - 0.12), halfW * 2, 2.2, 0.2, materials[0]);
    }
    for (let z = -32; z <= 32; z += 8) box(0, 15.6, z, halfW * 2, 0.3, 0.25, wall);

    const levels = theme === 1 ? 2 : 3, top = levels * 3.6;
    // Four connected play towers, with full-height entrances on every face.
    for (const x of [-14, 4]) for (const z of [-10, 8]) {
        for (const dx of [-4, 4]) for (const dz of [-4, 4]) {
            const px = x + dx, pz = z + dz;
            rod([px, 0, pz], [px, top + 2.5, pz], 0.17, materials[(dx + dz + 8) % 6]);
            solid(px, (top + 2.5) / 2, pz, 0.34, top + 2.5, 0.34);
        }
        for (let k = 1; k <= levels; k++) {
            const y = k * 3.6, mat = materials[(k + (x > 0 ? 2 : 0)) % 6];
            if (k === 1) box(x, y - 0.15, z, 8, 0.3, 8, mat, true);
            else {
                // Leave headroom above the incoming stair flight, with a landing at its top.
                box(x - 3.4, y - 0.15, z, 1.2, 0.3, 8, mat, true);
                box(x + 2, y - 0.15, z, 4, 0.3, 8, mat, true);
                box(x - 1.4, y - 0.15, z - 3.1, 2.8, 0.3, 1.8, mat, true);
                box(x - 1.4, y - 0.15, z + 3.35, 2.8, 0.3, 1.3, mat, true);
            }
            for (const side of [-1, 1]) {
                rod([x - 4, y + 2.5, z + side * 4], [x + 4, y + 2.5, z + side * 4], 0.14, mat);
                rod([x + side * 4, y + 2.5, z - 4], [x + side * 4, y + 2.5, z + 4], 0.14, mat);
                for (const offset of [-4, 1.5]) {
                    net(x + offset, y, z + side * 4, 2.5, 2.45);
                    net(x + side * 4, y, z + offset, 2.5, 2.45, false);
                }
            }
            // Soft, low obstacles can be jumped over or climbed onto.
            if (k === 1) box(x - 2, y + 0.35, z, 1.4, 0.7, 2.2, materials[4], true);
        }
        // Bright pitched caps above the netted towers.
        const cap = new THREE.Mesh(new THREE.ConeGeometry(5.8, 1.5, 4), materials[(x > 0 ? 1 : 0)]);
        cap.position.set(x, top + 3.25, z); cap.rotation.y = Math.PI / 4; group.add(cap);
    }
    // Broad padded steps enter the rear-left tower from the dry outer aisle.
    const stairs = (x, z, y, dx, dz, run, rise, width, count) => {
        for (let i = 0; i < count; i++) {
            const t = (i + 0.5) / count, h = rise / count;
            box(x + dx * run * t, y + h * (i + 0.5), z + dz * run * t,
                dx ? run / count + 0.02 : width, h, dz ? run / count + 0.02 : width, materials[i % 6], true);
        }
        for (const side of [-1, 1]) {
            const ox = dz * side * (width / 2 + 0.1), oz = -dx * side * (width / 2 + 0.1);
            rod([x + ox, y + 1.1, z + oz], [x + dx * run + ox, y + rise + 1.1, z + dz * run + oz], 0.09, materials[1]);
        }
    };
    stairs(-14, -23.6, 0, 0, 1, 9.6, 3.6, 2.8, 16);
    for (const x of [-14, 4]) for (const z of [-10, 8]) {
        for (let k = 1; k < levels; k++) stairs(x - 1.4, z - 3, k * 3.6, 0, 1, 6, 3.6, 2.2, 18);
    }
    // Climbing routes between floors are themselves rainbow stair bridges.
    stairs(-10, 8, 3.6, 1, 0, 10, 3.6, 2.8, 18);
    if (levels === 3) stairs(-10, -10, 7.2, 1, 0, 10, 3.6, 2.8, 18);
    for (const x of [-14, 4]) for (let k = 1; k <= levels; k++) {
        const y = k * 3.6;
        box(x, y - 0.12, -1, 2.8, 0.24, 10, materials[(k + 1) % 6], true);
        for (const side of [-1, 1]) {
            net(x + side * 1.4, y, -6, 10, 2.4, false);
            rod([x + side * 1.4, y + 2.4, -6], [x + side * 1.4, y + 2.4, 4], 0.1, materials[k % 6]);
        }
        // A walk-through cylindrical tunnel on the middle bridge.
        if (k === 2) {
            const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 5, 24, 1, true), materials[4]);
            tunnel.rotation.x = Math.PI / 2; tunnel.position.set(x, y + 1.3, -1); tunnel.material.side = THREE.DoubleSide; group.add(tunnel);
        }
    }
    box(-5, 3.48, -10, 10, 0.24, 2.8, materials[1], true);
    for (const side of [-1, 1]) net(-10, 3.6, -10 + side * 1.4, 10, 2.4);
    if (levels === 3) {
        box(-5, 10.68, 8, 10, 0.24, 2.8, materials[3], true);
        for (const side of [-1, 1]) net(-10, 10.8, 8 + side * 1.4, 10, 2.4);
    }

    // A continuous U-shaped slide surface, also used by collision and acceleration.
    const slide = (x, z, y, length, direction, width, color, tube = false, wave = 0) => {
        const end = direction > 0 ? -0.9 : 0;
        const center = t => x + Math.sin(t * Math.PI * 2) * wave;
        const height = t => end + (y - end) * (1 - t) * (1 - t);
        const path = { x, z, y, length, direction, width, center, height };
        slides.push(path);
        const vertices = [], indices = [], segments = 80, across = tube ? 24 : 10;
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            for (let j = 0; j <= across; j++) {
                const a = tube ? j / across * Math.PI * 2 : Math.PI + j / across * Math.PI;
                const r = width / 2;
                vertices.push(center(t) + Math.cos(a) * r, height(t) + r + Math.sin(a) * r, z + direction * length * t);
            }
        }
        for (let i = 0; i < segments; i++) for (let j = 0; j < across; j++) {
            const a = i * (across + 1) + j, b = a + across + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geo.setIndex(indices); geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.24, envMapIntensity: 0.35 });
        const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
        // Solid lips prevent walking through the sides of the chute.
        for (let i = 0; i < segments; i++) {
            const t = (i + 0.5) / segments;
            for (const side of [-1, 1]) solid(center(t) + side * width / 2, height(t) + width / 2, z + direction * length * t, 0.12, width, length / segments + 0.03, true);
            if (tube) solid(center(t), height(t) + width + 0.06, z + direction * length * t, width, 0.12, length / segments + 0.03, true);
        }
        if (tube) for (let t = 0; t <= 1.001; t += 0.125) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(width / 2 + 0.025, 0.07, 6, 24), materials[1]);
            ring.position.set(center(t), height(t) + width / 2, z + direction * length * t); group.add(ring);
        }
        return path;
    };
    // Three racing lanes feed directly into the ball pit.
    for (let lane = -1; lane <= 1; lane++) slide(4 + lane * 1.05, 12, 7.2, 14, 1, 0.98, colors[(lane + 2) % 6]);
    // A wide twisty tunnel descends from the highest rear deck.
    slide(4, -14, top, 18, -1, 3, colors[theme === 1 ? 1 : 3], true, theme === 2 ? 1.4 : 0.65);
    // A smaller wave slide and its own climbable step approach.
    stairs(20, 10, 0, 0, -1, 6, 2.4, 2.6, 12);
    box(20, 2.25, 2.6, 3, 0.3, 2.8, materials[4], true);
    slide(20, 1.2, 2.4, 9, -1, 2.8, colors[0], false, 0.5);

    // Padded stepping blocks and a slalom of foam rollers, all solid.
    for (let i = 0; i < 7; i++) {
        const x = -23, z = 10 - i * 2.4, h = 0.4 + (i % 3) * 0.3;
        box(x, h / 2, z, 2.5, h, 1.8, materials[i % 6], true);
    }
    for (let i = 0; i < 8; i++) {
        const x = 17 + (i % 2) * 4, z = -15 + Math.floor(i / 2) * 3;
        rod([x, 0.15, z], [x, 2.4, z], 0.48, materials[i % 6]); solid(x, 1.2, z, 0.85, 2.4, 0.85);
    }

    // Thousands of instanced balls part around the explorer, rather than forming a solid carpet.
    const count = Math.ceil((pit.x1 - pit.x0) * (pit.z1 - pit.z0) * (isMobile ? 24 : 34));
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.27, envMapIntensity: 0.4 });
    const player = { value: new THREE.Vector3(0, 99, 0) };
    ballMat.onBeforeCompile = sh => {
        sh.uniforms.uPlayer = player;
        sh.vertexShader = 'uniform vec3 uPlayer;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
            #include <begin_vertex>
            vec3 c = instanceMatrix[3].xyz;
            vec2 d = c.xz - uPlayer.xz;
            float k = max(0.0, 1.0 - length(d) / 0.85) * (1.0 - smoothstep(-0.4, 0.2, uPlayer.y));
            transformed.xz += normalize(d + 0.0001) * k * 0.55;
            transformed.y += k * 0.12;`);
    };
    const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.135, 8, 6), ballMat, count);
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
        dummy.position.set(rand.range(pit.x0 + 0.15, pit.x1 - 0.15), rand.range(-1.25, -0.55), rand.range(pit.z0 + 0.15, pit.z1 - 0.15));
        dummy.scale.setScalar(rand.range(0.9, 1.15)); dummy.updateMatrix(); balls.setMatrixAt(i, dummy.matrix); balls.setColorAt(i, color.set(rand.pick(colors)));
    }
    group.add(balls); balls.receiveShadow = true;
    const px = (pit.x0 + pit.x1) / 2, pz = (pit.z0 + pit.z1) / 2;
    for (const z of [pit.z0, pit.z1]) box(px, -0.22, z, pit.x1 - pit.x0, 0.5, 0.35, materials[0]);
    for (const x of [pit.x0, pit.x1]) box(x, -0.22, pz, 0.35, 0.5, pit.z1 - pit.z0, materials[1]);
    // Exit steps at both ends of every pit.
    for (const x of [pit.x0 + 1.1, pit.x1 - 1.1]) {
        box(x, -0.85, pit.z1 - 0.5, 1.8, 0.7, 1, materials[2], true);
        box(x, -1.08, pit.z1 - 1.5, 1.8, 0.24, 1, materials[3], true);
    }

    const netGeo = new THREE.BufferGeometry(); netGeo.setAttribute('position', new THREE.Float32BufferAttribute(netVertices, 3));
    group.add(new THREE.LineSegments(netGeo, new THREE.LineBasicMaterial({ color: 0x20292b, transparent: true, opacity: 0.72 })));
    const glow = new THREE.MeshStandardMaterial({ color: 0xf4f5ff, emissive: 0xd6e4ff, emissiveIntensity: 0.7 });
    group.add(new THREE.HemisphereLight(0xf2f5ff, 0x68628b, 0.16));
    for (const x of [-20, 0, 20]) for (const z of [-26, -10, 8, 26]) {
        box(x, 15.2, z, 5, 0.08, 0.55, glow);
        // Broad ceiling beams give the play structures real shade without
        // twelve overlapping point lights filling every shadow back in.
        if (x !== 0 && (z === -26 || z === 8)) {
            const light = new THREE.SpotLight(theme === 2 ? 0xe1cdff : 0xfff4e2, 130, 65, 1.15, 0.45, 1.5);
            light.position.set(x, 14.9, z);
            light.target.position.set(x * 0.65, 0, z + 8);
            light.castShadow = true;
            light.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
            light.shadow.camera.near = 0.3;
            light.shadow.camera.far = 65;
            light.shadow.bias = -0.00015;
            light.shadow.normalBias = 0.035;
            light.shadow.radius = 2;
            group.add(light, light.target);
        }
    }
    const surface = (s, p) => {
        const t = (p.z - s.z) * s.direction / s.length;
        if (t < 0 || t > 1 || Math.abs(p.x - s.center(t)) > s.width / 2 - 0.08) return null;
        // Match the round bottom of the rendered chute, not an invisible flat ramp.
        const dx = p.x - s.center(t), r = s.width / 2;
        return { t, y: s.height(t) + r - Math.sqrt(Math.max(0, r * r - dx * dx)) };
    };
    return {
        group, portals, colliders, blackout: dark,
        name: 'Playground',
        fog: new THREE.FogExp2(0x303147, 0.006), background: new THREE.Color(0x20202c), environment: roomEnv,
        exposure: 0.75, bloom: 0.08, bloomThreshold: 1.2,
        spawn: new THREE.Vector3(-22, 0, 31.8), spawnYaw: -0.3,
        eye: 1.7, radius: 0.3, height: 1.9, speed: 4.5, gravity: 22, jump: 6.8, stride: 1.5,
        stepHeight: 0.55, mantleHeight: 0.8, ceiling,
        bounds: { minX: -halfW, maxX: halfW, minZ: -halfD, maxZ: halfD },
        ground: (x, z) => inPit(x, z) ? -1.5 : 0,
        supportAt: (p, radius, maxTop) => {
            let y = -Infinity;
            for (const s of slides) {
                const hit = surface(s, p);
                if (hit && hit.y <= maxTop + 0.001) y = Math.max(y, hit.y);
            }
            return y;
        },
        beforeMove: (p, v, body, dt, active) => {
            if (!active) return;
            for (const s of slides) {
                const hit = surface(s, p);
                if (!hit || Math.abs(p.y - hit.y) > 0.38 || v.y > 0.1) continue;
                const target = 6 + hit.t * 9;
                v.z = s.direction * Math.max(target, v.z * s.direction);
                const next = Math.min(1, hit.t + target * dt / s.length);
                v.x = (s.center(next) - p.x) * 7;
                break;
            }
            if (inPit(p.x, p.z) && p.y < -0.5) { v.x *= Math.exp(-dt * 3); v.z *= Math.exp(-dt * 3); }
        },
        stepType: () => 'carpet',
        update: (pos, t, dt, cam, feet) => { player.value.copy(feet || pos); },
        setVisible: v => { group.visible = v; },
    };
}
