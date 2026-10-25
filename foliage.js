import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Leafy plants built from alpha-tested leaf cards on tapered branches.
// Everything a builder adds is merged into one leaf mesh and one bark mesh.

// Tapered, curved branch along points
function branchGeo(points, r0, r1, radial = 7) {
    const curve = new THREE.CatmullRomCurve3(points);
    const segs = Math.max(3, points.length * 3);
    const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
    const pos = g.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        curve.getPointAt(t, c);
        const r = r0 + (r1 - r0) * t;
        for (let j = 0; j <= radial; j++) {
            const k = i * (radial + 1) + j;
            v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
            pos.setXYZ(k, v.x, v.y, v.z);
        }
    }
    g.computeVertexNormals();
    g.deleteAttribute('uv');
    return g;
}

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _n = new THREE.Vector3(), _p = new THREE.Vector3();
// One leaf card (two-sided, as two front-facing quads so both sides shade outward)
function leafCard(center, size, rand, crown, tint) {
    const g = new THREE.PlaneGeometry(size, size);
    const back = new THREE.PlaneGeometry(size, size); back.rotateY(Math.PI);
    const both = mergeGeometries([g, back]);
    _e.set(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2);
    both.applyQuaternion(_q.setFromEuler(_e));
    both.translate(center.x, center.y, center.z);
    // normals point out from the crown centre: soft, volumetric shading
    _n.copy(center).sub(crown).normalize();
    const nrm = both.attributes.normal, n = nrm.count;
    for (let i = 0; i < n; i++) nrm.setXYZ(i, _n.x, _n.y + 0.25, _n.z);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([tint.r, tint.g, tint.b], i * 3);
    both.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return both;
}

export class Foliage {
    constructor(loadTex) {
        const tex = loadTex('asset_leaf_cluster.png');
        this.leafMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, vertexColors: true, roughness: 0.55, metalness: 0, envMapIntensity: 0.5 });
        this.barkMat = new THREE.MeshStandardMaterial({ color: 0x4e3a2c, roughness: 0.95 });
        this.leaves = []; this.bark = [];
    }
    tint(rand, base = 1) {
        const c = new THREE.Color().setHSL(0.24 + rand.range(-0.03, 0.04), rand.range(0.25, 0.5), rand.range(0.38, 0.55) * base);
        return c;
    }
    // a cluster of leaf cards filling an ellipsoid
    clump(rand, center, rx, ry, rz, count, size, crown = center) {
        for (let k = 0; k < count; k++) {
            // denser toward the surface so the silhouette stays full
            const u = rand() * Math.PI * 2, v = Math.acos(rand.range(-1, 1)), r = Math.pow(rand(), 0.35);
            _p.set(Math.sin(v) * Math.cos(u) * rx * r, Math.cos(v) * ry * r, Math.sin(v) * Math.sin(u) * rz * r).add(center);
            const shade = 0.75 + 0.35 * ((_p.y - center.y) / ry * 0.5 + 0.5);   // darker underneath
            this.leaves.push(leafCard(_p.clone(), size * rand.range(0.75, 1.25), rand, crown, this.tint(rand, shade)));
        }
    }
    bush(rand, x, y, z, r) {
        const c = new THREE.Vector3(x, y + r * 0.45, z);
        this.clump(rand, c, r, r * 0.7, r, Math.round(10 + r * r * 4), r * 0.9, c.clone().setY(y));
    }
    /** a broadleaf atrium tree: curved trunk, a few limbs, leafy clumps at their ends */
    tree(rand, x, y, z, height) {
        const lean = new THREE.Vector3(rand.range(-1, 1), 0, rand.range(-1, 1)).multiplyScalar(height * 0.04);
        const fork = height * rand.range(0.45, 0.6);
        const trunkPts = [0, 0.33, 0.66, 1].map(t => new THREE.Vector3(x + lean.x * t * t + rand.range(-0.15, 0.15) * t, y + fork * t, z + lean.z * t * t + rand.range(-0.15, 0.15) * t));
        const r0 = height * 0.035;
        this.bark.push(branchGeo(trunkPts, r0, r0 * 0.6, 9));
        // root flare
        const flare = new THREE.CylinderGeometry(r0 * 1.05, r0 * 1.8, height * 0.05, 9); flare.translate(x, y + height * 0.025, z);
        flare.deleteAttribute('uv'); this.bark.push(flare);
        const top = trunkPts[3];
        const crown = new THREE.Vector3(top.x, y + height * 0.78, top.z);
        const limbs = rand.int(3, 5), a0 = rand() * Math.PI * 2;
        for (let i = 0; i < limbs; i++) {
            const a = a0 + i / limbs * Math.PI * 2 + rand.range(-0.4, 0.4);
            const reach = height * rand.range(0.18, 0.3), rise = height * rand.range(0.25, 0.42);
            const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
            const end = top.clone().addScaledVector(dir, reach).setY(top.y + rise);
            const mid = top.clone().addScaledVector(dir, reach * 0.4).setY(top.y + rise * 0.55);
            this.bark.push(branchGeo([top.clone(), mid, end], r0 * 0.55, r0 * 0.18));
            // twigs + leaf clumps around the limb end
            const cr = height * rand.range(0.13, 0.19);
            this.clump(rand, end.clone().setY(end.y + cr * 0.2), cr * 1.2, cr * 0.8, cr * 1.2, Math.round(26 + cr * 4), height * 0.075, crown);
            this.clump(rand, mid.clone().lerp(end, 0.5), cr * 0.7, cr * 0.5, cr * 0.7, 8, height * 0.065, crown);
        }
        // fill the middle of the canopy
        const cr = height * 0.2;
        this.clump(rand, crown, cr, cr * 0.6, cr, 30, height * 0.08, crown.clone().setY(crown.y - cr));
    }
    /** merge everything added so far into meshes on the group */
    build(group) {
        const out = [];
        if (this.leaves.length) {
            const m = new THREE.Mesh(mergeGeometries(this.leaves), this.leafMat);
            m.castShadow = m.receiveShadow = true; group.add(m); out.push(m);
            this.leaves.forEach(g => g.dispose());
        }
        if (this.bark.length) {
            const m = new THREE.Mesh(mergeGeometries(this.bark), this.barkMat);
            m.castShadow = m.receiveShadow = true; group.add(m); out.push(m);
            this.bark.forEach(g => g.dispose());
        }
        this.leaves = []; this.bark = [];
        return out;
    }
}
