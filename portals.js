import * as THREE from 'three';
import { hash32, makeRng } from './seed.js';

// --------------------------------------------------------------------------
// Doorway portals. Every world has several doorways; each one is paired with a
// doorway in another world, both ways. Walking into a doorway carries you out
// of its partner. The destination is rendered live into the opening.
// --------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _qPi = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
const MAX_VIEWS = 2;                 // live doorway views rendered per frame

// The usual connections between world types (index pairs): a ring plus a few shortcuts.
const LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0], [7, 0], [1, 5], [7, 6], [4, 0], [7, 3], [7, 2], [8, 0], [8, 5], [9, 2], [9, 7], [9, 3], [10, 1], [10, 2], [10, 7], [11, 1], [11, 7], [11, 10], [11, 5], [12, 0], [12, 8], [12, 6], [13, 0], [13, 5], [13, 12], [14, 4], [14, 9], [14, 7]];
const NT = 15;
const USUAL = Array.from({ length: NT }, (_, t) => LINKS.flatMap(([a, b]) => a === t ? [b] : b === t ? [a] : []));
// how many doorways each world type can hold [min, max]
const CAPS = [[2, 6], [1, 5], [1, 5], [1, 5], [1, 4], [1, 5], [1, 3], [1, 6], [1, 3], [1, 5], [1, 4], [1, 4], [1, 4], [2, 4], [2, 4]];
// Travelling between two types flips the seed by a key shared by the pair: going through and
// back again XORs twice, so a doorway always returns you to the exact variation you came from.
const pairKey = (a, b) => hash32(Math.min(a, b) * 0x2545f491 + Math.max(a, b) * 0x9e3779b1 + 0x51ed27);

// Which world type each doorway of a variation leads to. Usually the usual neighbours, but a
// connection can be missing, lead somewhere unexpected, or there can be an extra doorway.
// A variation reached through a doorway always has a doorway back (first slot). Remembered,
// so revisiting a variation finds its doorways where they were.
const plans = new Map();
export function doorPlan(type, seed, from = null) {
    const key = type + ':' + seed;
    if (plans.has(key)) return plans.get(key);
    const r = makeRng(seed, 7000 + type);
    const other = () => { const t = r.int(0, NT - 2); return t >= type ? t + 1 : t; };
    const list = [];
    for (const u of USUAL[type]) {
        if (r.chance(0.12)) continue;                 // missing
        list.push(r.chance(0.18) ? other() : u);      // rerouted
    }
    if (r.chance(0.25)) list.push(other());           // extra
    if (r.chance(0.08)) list.push(other());
    const [mn, mx] = CAPS[type];
    while (list.length < mn) list.push(r.pick(USUAL[type]));
    if (from !== null && from !== type) {
        const i = list.indexOf(from);
        if (i >= 0) list.splice(i, 1);
        list.unshift(from);
    }
    list.length = Math.min(list.length, mx);
    plans.set(key, list);
    return list;
}

function frameMaterials(p) {
    return {
        paint: new THREE.MeshStandardMaterial({ color: p.frameColor ?? 0xe8e4dc, roughness: 0.7, envMapIntensity: p.frameEnv ?? 1 }),
    };
}

// Free-standing door frame
function buildStanding(p, s) {
    const g = new THREE.Group();
    const { paint } = frameMaterials(p);
    const w = p.w, h = p.h, t = 0.45 * s, d = 0.9 * s;
    const add = (geo, x, y, z, mat = paint, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
    add(new THREE.BoxGeometry(t, h + t, d), -w / 2 - t / 2, (h + t) / 2, -d / 2 + 0.05 * s);
    add(new THREE.BoxGeometry(t, h + t, d), w / 2 + t / 2, (h + t) / 2, -d / 2 + 0.05 * s);
    add(new THREE.BoxGeometry(w + t * 2, t, d), 0, h + t / 2, -d / 2 + 0.05 * s);
    add(new THREE.BoxGeometry(w, 0.08 * s, d), 0, 0.04 * s, -d / 2 + 0.05 * s);
    return { group: g, colliders: [
        [-w / 2 - t, -w / 2, 0, h + t, -d, 0.05 * s],
        [w / 2, w / 2 + t, 0, h + t, -d, 0.05 * s],
    ] };
}

// Trim around an opening in a wall (the wall itself belongs to the world)
function buildTrim(p, s) {
    const g = new THREE.Group();
    const { paint } = frameMaterials(p);
    const w = p.w, h = p.h, t = 0.4 * s, d = 0.35 * s;
    const add = (geo, x, y) => { const m = new THREE.Mesh(geo, paint); m.position.set(x, y, d / 2 - 0.05 * s); m.castShadow = m.receiveShadow = true; g.add(m); };
    add(new THREE.BoxGeometry(t, h + t, d), -w / 2 - t / 2, (h + t) / 2);
    add(new THREE.BoxGeometry(t, h + t, d), w / 2 + t / 2, (h + t) / 2);
    add(new THREE.BoxGeometry(w + t * 2, t, d), 0, h + t / 2);
    return { group: g, colliders: [] };
}

// Remove an AABB "hole" from a box, returning the remaining pieces
function subtract(b, hole) {
    if (b.maxX <= hole.minX || b.minX >= hole.maxX || b.maxY <= hole.minY || b.minY >= hole.maxY || b.maxZ <= hole.minZ || b.minZ >= hole.maxZ) return [b];
    const out = [];
    const c = { ...b };
    if (c.minX < hole.minX) { out.push({ ...c, maxX: hole.minX }); c.minX = hole.minX; }
    if (c.maxX > hole.maxX) { out.push({ ...c, minX: hole.maxX }); c.maxX = hole.maxX; }
    if (c.minZ < hole.minZ) { out.push({ ...c, maxZ: hole.minZ }); c.minZ = hole.minZ; }
    if (c.maxZ > hole.maxZ) { out.push({ ...c, minZ: hole.maxZ }); c.maxZ = hole.maxZ; }
    if (c.minY < hole.minY) out.push({ ...c, maxY: hole.minY });
    if (c.maxY > hole.maxY) out.push({ ...c, minY: hole.maxY });
    return out;
}

export class Portals {
    constructor(renderer, scene, worlds) {
        this.renderer = renderer;
        this.scene = scene;
        this.worlds = worlds;          // one live instance per world type (mutated by main)
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        this.res = { value: size.clone() };
        this.rts = [];
        for (let i = 0; i < MAX_VIEWS; i++) this.rts.push(new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType }));
        this.vcam = new THREE.PerspectiveCamera();
        this.frustum = new THREE.Frustum();
        this.m4 = new THREE.Matrix4();
    }

    /** Where doorway p leads: the world type and the seed of the variation behind it */
    dest(p) {
        const w = this.worlds[p.world], t = w.plan?.[p.slot];
        if (t === undefined) return null;
        return { world: t, from: p.world, seed: (w.seed ^ pairKey(p.world, t)) >>> 0 };
    }
    hasDest(wi, slot) { return this.worlds[wi].plan?.[slot] !== undefined; }

    /** Variations every doorway of world wi needs on the other side */
    needed(wi) {
        return (this.worlds[wi].portals || []).map(p => this.dest(p)).filter(Boolean);
    }

    /** Point world wi's doorways at their partners, where the right variation is built */
    link(wi) {
        const w = this.worlds[wi];
        for (const p of w.portals || []) {
            const d = this.dest(p), D = d && this.worlds[d.world];
            p.link = (D && D.seed === d.seed) ? D.portals?.[D.plan?.indexOf(wi) ?? -1] ?? null : null;
            if (!p.uniforms) continue;
            p.uniforms.live.value = 0;
            if (D) p.uniforms.fallback.value.copy(D.background?.isColor ? D.background : (D.fog?.color ?? new THREE.Color(0))).multiplyScalar(D.exposure / w.exposure * 0.3);   // a dim haze, never a glowing slab
        }
    }

    /** Build the frames, wall holes and view surfaces of a freshly generated world */
    attach(wi) {
        const w = this.worlds[wi], s = w.eye / 7;
        (w.portals || []).forEach((p, pi) => {
            p.world = wi; p.slot = pi; p.link = null;
            p.quat = new THREE.Quaternion().setFromAxisAngle(UP, p.yaw);
            p.inv = p.quat.clone().invert();
            p.normal = new THREE.Vector3(0, 0, 1).applyQuaternion(p.quat);
            const root = new THREE.Group();
            root.position.copy(p.pos);
            root.quaternion.copy(p.quat);
            w.group.add(root);
            if (p.kind !== 'builtIn') {
                const f = p.kind === 'wall' ? buildTrim(p, s) : buildStanding(p, s);
                root.add(f.group);
                for (const c of f.colliders) w.colliders.push(this.toWorldBox(p, c));
            }
            // open a hole through any wall behind a wall doorway
            if (p.kind !== 'standing') {
                const hole = this.toWorldBox(p, [-p.w / 2, p.w / 2, 0.02, p.h, -6 * s, 0.6 * s]);
                w.colliders.splice(0, w.colliders.length, ...w.colliders.flatMap(b => subtract(b, hole)));
            }
            if (!this.hasDest(wi, pi)) return;
            const uniforms = {
                tView: { value: this.rts[0].texture }, res: this.res,
                gain: { value: 1 }, live: { value: 0 }, fallback: { value: new THREE.Color(0) },
            };
            const mat = new THREE.ShaderMaterial({
                uniforms, fog: false, toneMapped: false,
                vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
                fragmentShader: `
                    uniform sampler2D tView; uniform vec2 res; uniform float gain; uniform float live; uniform vec3 fallback;
                    void main(){
                        vec3 c = texture2D(tView, gl_FragCoord.xy / res).rgb * gain;
                        gl_FragColor = vec4(mix(fallback, c, live), 1.0);
                    }`,
            });
            const surf = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), mat);
            surf.position.set(0, p.h / 2, p.inset ?? 0.03 * s);
            root.add(surf);
            const standing = p.kind === 'standing';
            const back = new THREE.Mesh(new THREE.PlaneGeometry(p.w + (standing ? 0.9 * s : 0), p.h + (standing ? 0.45 * s : 0)),
                new THREE.MeshStandardMaterial({ color: p.leafColor ?? p.frameColor ?? 0xdedad2, roughness: 0.75, envMapIntensity: p.frameEnv ?? 1, side: THREE.FrontSide }));
            back.position.set(0, (p.h + (standing ? 0.45 * s : 0)) / 2,
                standing ? -0.852 * s : (p.inset ?? 0.03 * s) - 0.02 * s);
            back.rotation.y = Math.PI;
            root.add(back);
            p.back = back;
            p.surface = surf; p.uniforms = uniforms;
            p.box = new THREE.Box3();
        });
    }

    // local box [x0,x1,y0,y1,z0,z1] -> world AABB (yaw is a multiple of 90°)
    toWorldBox(p, [x0, x1, y0, y1, z0, z1]) {
        const xs = [], zs = [];
        for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
            _v.set(x, 0, z).applyQuaternion(p.quat); xs.push(_v.x); zs.push(_v.z);
        }
        return {
            minX: p.pos.x + Math.min(...xs), maxX: p.pos.x + Math.max(...xs),
            minY: p.pos.y + y0, maxY: p.pos.y + y1,
            minZ: p.pos.z + Math.min(...zs), maxZ: p.pos.z + Math.max(...zs),
        };
    }

    setSize() {
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        for (const rt of this.rts) rt.setSize(size.x, size.y);
        this.res.value.copy(size);
    }

    scale(A) { return this.worlds[A.link.world].eye / this.worlds[A.world].eye; }
    mapPoint(A, pt, out) {
        const B = A.link, s = this.scale(A);
        out.copy(pt).sub(A.pos).applyQuaternion(A.inv);
        out.set(-out.x * s, out.y * s, -out.z * s);
        return out.applyQuaternion(B.quat).add(B.pos);
    }
    mapDir(A, v, out) {
        const B = A.link, s = this.scale(A);
        out.copy(v).applyQuaternion(A.inv);
        out.set(-out.x * s, out.y * s, -out.z * s);
        return out.applyQuaternion(B.quat);
    }
    mapQuat(A, q, out) { return out.copy(A.link.quat).multiply(_qPi).multiply(A.inv).multiply(q); }
    local(p, pt) { return _v.copy(pt).sub(p.pos).applyQuaternion(p.inv); }

    /** Did the feet just walk into one of this world's doorways? */
    crossing(wi, prev, now) {
        const w = this.worlds[wi];
        // cross a little before the camera reaches the plane, so the near plane never pokes through
        const margin = Math.max(0.15 * w.eye / 7, 0.25);
        for (const p of w.portals || []) {
            if (!p.link) continue;
            const a = this.local(p, prev).z;
            const l = this.local(p, now);
            const inOpening = Math.abs(l.x) < p.w / 2 && l.y > -1 && l.y < p.h;
            if (a >= margin - 1e-4) {
                if (l.z <= margin && inOpening) return p;
                continue;
            }
            // Backing out of a doorway you only just came through: you emerge a hair behind its
            // plane, so stepping back carries you back to where you came from (in front of the
            // partner doorway, just past its trigger) instead of out behind this door.
            const D = this.worlds[p.link.world];
            const back = Math.max(Math.max(0.15 * D.eye / 7, 0.25) / this.scale(p), margin) + 1e-3;
            if (a > -back && l.z <= -back && inOpening) return p;
        }
        return null;
    }

    /** An unconnected doorway (destination still generating) is a solid wall, never an open hole */
    blockUnlinked(wi, prev, now, velocity, radius) {
        for (const p of this.worlds[wi].portals || []) {
            if (p.link || !this.hasDest(wi, p.slot)) continue;
            const a = this.local(p, prev).z;
            const b = this.local(p, now);
            if (a < -0.01 || b.z >= radius || Math.abs(b.x) > p.w / 2 + radius || b.y >= p.h || b.y < -1) continue;
            now.addScaledVector(p.normal, radius - b.z);
            const inward = velocity.dot(p.normal);
            if (inward < 0) velocity.addScaledVector(p.normal, -inward);
        }
    }

    /** Is the player close to a doorway whose destination isn't built yet? */
    nearUnlinked(wi, pos, dist) {
        return (this.worlds[wi].portals || []).some(p => !p.link && this.hasDest(wi, p.slot) && p.pos.distanceTo(pos) < dist);
    }

    // A player can leave a portal they just emerged from, but cannot enter it from behind.
    blockBackside(wi, prev, now, velocity, radius, height) {
        for (const p of this.worlds[wi].portals || []) {
            if (!p.link) continue;
            const a = this.local(p, prev).clone();
            const b = this.local(p, now);
            if (a.z > -radius || b.z <= -radius ||
                Math.max(Math.abs(a.x), Math.abs(b.x)) > p.w / 2 + radius ||
                b.y >= p.h || b.y + height <= 0) continue;
            now.addScaledVector(p.normal, -radius - b.z);
            const inward = velocity.dot(p.normal);
            if (inward > 0) velocity.addScaledVector(p.normal, -inward);
        }
    }

    /**
     * Call right before the main render. While the camera is standing inside a doorway it
     * just came out of (behind its plane), clip away everything behind that doorway (the
     * wall it is set in, the door's back face) so stepping through never flashes.
     */
    prepareMain(wi, camera, radius) {
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        for (const p of this.worlds[wi].portals || []) {
            if (!p.back) continue;
            const l = this.local(p, camera.position);
            const inOpening = Math.abs(l.x) < p.w / 2 + radius && l.y > -1 && l.y < p.h + 1;
            const behindClose = inOpening && l.z < 0.05 && l.z > -radius * 0.9 - 0.5 * this.worlds[wi].eye / 7;
            p.back.visible = !behindClose;
            if (behindClose) this.obliqueClip(camera, p);
        }
    }

    // Oblique near plane: clip everything behind the destination doorway
    obliqueClip(cam, B) {
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(B.normal, _v.copy(B.pos).addScaledVector(B.normal, -0.02));
        plane.applyMatrix4(cam.matrixWorldInverse);
        const c = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
        const P = cam.projectionMatrix, e = P.elements;
        const q = new THREE.Vector4(
            (Math.sign(c.x) + e[8]) / e[0], (Math.sign(c.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
        c.multiplyScalar(2 / c.dot(q));
        e[2] = c.x; e[6] = c.y; e[10] = c.z + 1; e[14] = c.w;
        cam.projectionMatrixInverse.copy(P).invert();
    }

    renderView(A, camera, rt, t, dt) {
        const w = this.worlds[A.world], B = A.link, D = this.worlds[B.world];
        const vcam = this.vcam;
        vcam.fov = camera.fov; vcam.aspect = camera.aspect; vcam.near = camera.near; vcam.far = camera.far;
        this.mapPoint(A, camera.position, vcam.position);
        this.mapQuat(A, camera.quaternion, vcam.quaternion);
        vcam.updateMatrixWorld();
        vcam.updateProjectionMatrix();
        this.obliqueClip(vcam, B);

        const vFeet = this.mapPoint(A, _v.copy(camera.position).setY(camera.position.y - w.eye), new THREE.Vector3());
        D.update(vcam.position, t, dt, vcam, vFeet);

        const scene = this.scene, r = this.renderer;
        const saved = [scene.fog, scene.background, scene.environment];
        w.setVisible(false); D.setVisible(true);
        for (const p of D.portals || []) {
            if (p.surface) p.surface.visible = false;
            if (p.back) p.back.visible = false;
        }
        scene.fog = D.fog; scene.background = D.background; scene.environment = D.environment;
        const prevRT = r.getRenderTarget();
        r.setRenderTarget(rt);
        r.clear();
        r.render(scene, vcam);
        r.setRenderTarget(prevRT);
        for (const p of D.portals || []) {
            if (p.surface) p.surface.visible = true;
            if (p.back) p.back.visible = true;
        }
        D.setVisible(false); w.setVisible(true);
        [scene.fog, scene.background, scene.environment] = saved;
        A.uniforms.tView.value = rt.texture;
        A.uniforms.gain.value = D.exposure / w.exposure;
        A.uniforms.live.value = 1;
    }

    /** Is every sample point of doorway p hidden from eye by the world's colliders? */
    occluded(w, eye, p) {
        const pts = [[0, 0.5], [-0.35, 0.3], [0.35, 0.3], [-0.35, 0.8], [0.35, 0.8]];
        const target = new THREE.Vector3(), dir = new THREE.Vector3();
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(p.quat);
        for (const [fx, fy] of pts) {
            target.copy(p.pos).addScaledVector(right, fx * p.w).addScaledVector(p.normal, 0.15);
            target.y += fy * p.h;
            dir.subVectors(target, eye);
            if (!this.segmentBlocked(w.colliders || [], eye, dir)) return false;
        }
        return true;
    }
    segmentBlocked(boxes, o, d) {
        for (const b of boxes) {
            let t0 = 0, t1 = 1, hit = true;
            for (const [a, lo, hi] of [['x', b.minX, b.maxX], ['y', b.minY, b.maxY], ['z', b.minZ, b.maxZ]]) {
                const da = d[a], oa = o[a];
                if (Math.abs(da) < 1e-9) { if (oa < lo || oa > hi) { hit = false; break; } continue; }
                let ta = (lo - oa) / da, tb = (hi - oa) / da;
                if (ta > tb) [ta, tb] = [tb, ta];
                if (ta > t0) t0 = ta;
                if (tb < t1) t1 = tb;
                if (t0 > t1) { hit = false; break; }
            }
            if (hit) return true;
        }
        return false;
    }

    /** Render the nearest visible doorways of the current world (before the main render) */
    render(wi, camera, t, dt) {
        const w = this.worlds[wi];
        if (!w.portals) return;
        camera.updateMatrixWorld();
        this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.m4);
        const far = 160 * w.eye / 7;
        const vis = [];
        for (const p of w.portals) {
            if (!p.surface) continue;
            p.uniforms.live.value = 0;
            if (!p.link) continue;
            p.surface.updateMatrixWorld();
            p.box.setFromObject(p.surface);
            if (this.local(p, camera.position).z < 0) continue;
            const d = p.box.distanceToPoint(camera.position);
            if (d > far || !this.frustum.intersectsBox(p.box)) continue;
            vis.push([d, p]);
        }
        // doorways hidden behind walls go last, so the live views go to the ones you can actually see
        if (vis.length > MAX_VIEWS) {
            for (const v of vis) if (this.occluded(w, camera.position, v[1])) v[0] += 1e6;
        }
        vis.sort((a, b) => a[0] - b[0]);
        vis.slice(0, MAX_VIEWS).forEach(([, p], i) => this.renderView(p, camera, this.rts[i], t, dt));
    }

    /** Compile every world's shaders up front so doorways never hitch */
    warmup(camera, current = 0) {
        const r = this.renderer, scene = this.scene;
        const rt = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType });
        const prev = r.getRenderTarget();
        const saved = [scene.fog, scene.background, scene.environment];
        const cam = camera.clone();
        this.worlds.forEach((w, i) => {
            this.worlds.forEach((o, j) => o.setVisible(i === j));
            scene.fog = w.fog; scene.background = w.background; scene.environment = w.environment;
            cam.position.copy(w.spawn).y += w.eye;
            cam.updateMatrixWorld();
            r.setRenderTarget(rt);
            r.render(scene, cam);
        });
        r.setRenderTarget(prev);
        this.worlds.forEach((o, j) => o.setVisible(j === current));
        [scene.fog, scene.background, scene.environment] = saved;
        rt.dispose();
    }
}
