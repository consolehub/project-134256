import * as THREE from 'three';

// Water splash effect: a burst of droplets thrown up and falling back, plus
// ripple rings spreading on the surface. Each splash lives ~1.5s.

function dropTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(235,248,255,0.85)'); grd.addColorStop(1, 'rgba(220,240,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

const DROPS = 70, RINGS = 3;

export class Splashes {
    constructor(scene) {
        this.scene = scene;
        this.tex = dropTexture();
        this.active = [];
        this.ringGeo = new THREE.RingGeometry(0.82, 1, 48); this.ringGeo.rotateX(-Math.PI / 2);
    }

    /** pos: where the body hits the surface (y = water level), strength 0..1, scale: world scale (eye / 7) */
    spawn(pos, strength, scale) {
        const n = Math.round(DROPS * (0.35 + 0.65 * strength));
        const geo = new THREE.BufferGeometry();
        const p = new Float32Array(n * 3), v = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, r = Math.random() * 1.2 * scale;
            p.set([pos.x + Math.cos(a) * r, pos.y + 0.05 * scale, pos.z + Math.sin(a) * r], i * 3);
            const out = (2 + Math.random() * 5) * scale * (0.6 + strength), up = (4 + Math.random() * 10) * scale * (0.5 + strength);
            v.set([Math.cos(a) * out, up, Math.sin(a) * out], i * 3);
        }
        geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
        const drops = new THREE.Points(geo, new THREE.PointsMaterial({
            map: this.tex, size: 0.55 * scale, transparent: true, depthWrite: false, opacity: 0.9, color: 0xf2faff, fog: true }));
        drops.frustumCulled = false;
        this.scene.add(drops);
        const rings = [];
        for (let k = 0; k < RINGS; k++) {
            const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
            m.position.set(pos.x, pos.y + 0.03 * scale, pos.z);
            this.scene.add(m); rings.push(m);
        }
        // a white foam patch right where you went in
        const foam = new THREE.Mesh(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 * strength + 0.2, depthWrite: false }));
        foam.position.set(pos.x, pos.y + 0.04 * scale, pos.z);
        foam.scale.setScalar(1.6 * scale);
        this.scene.add(foam);
        this.active.push({ drops, vel: v, rings, foam, t: 0, y0: pos.y, scale, strength, g: 30 * scale });
    }

    update(dt) {
        for (let i = this.active.length - 1; i >= 0; i--) {
            const s = this.active[i];
            s.t += dt;
            const pa = s.drops.geometry.attributes.position, arr = pa.array, v = s.vel;
            for (let k = 0; k < arr.length; k += 3) {
                if (arr[k + 1] < s.y0 - 0.2 * s.scale) continue;   // fell back in
                v[k + 1] -= s.g * dt;
                arr[k] += v[k] * dt; arr[k + 1] += v[k + 1] * dt; arr[k + 2] += v[k + 2] * dt;
            }
            pa.needsUpdate = true;
            s.drops.material.opacity = 0.9 * Math.max(0, 1 - s.t / 1.3);
            s.rings.forEach((r, k) => {
                const tt = s.t - k * 0.18;
                if (tt < 0) return;
                const R = (1.2 + tt * (5 + 4 * s.strength)) * s.scale;
                r.scale.setScalar(R);
                r.material.opacity = 0.45 * Math.max(0, 1 - tt / 1.4);
            });
            s.foam.material.opacity *= Math.exp(-dt * 2.2);
            s.foam.scale.multiplyScalar(1 + dt * 0.6);
            if (s.t > 1.8) { this.remove(s); this.active.splice(i, 1); }
        }
    }

    remove(s) {
        this.scene.remove(s.drops, s.foam, ...s.rings);
        s.drops.geometry.dispose(); s.drops.material.dispose();
        s.foam.geometry.dispose(); s.foam.material.dispose();
        s.rings.forEach(r => r.material.dispose());
    }

    clear() { this.active.forEach(s => this.remove(s)); this.active = []; }
}
