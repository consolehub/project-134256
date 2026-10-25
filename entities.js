import * as THREE from 'three';
import { Physics } from './physics.js';

// --------------------------------------------------------------------------
// Optional entities, loosely after the Backrooms wiki:
//   watcher   - a tall shadow standing far off on the hills; gone when you come close
//   smiler    - a dark shape with a glowing grin; hunts you once it sees you
//   partygoer - yellow, smiling, wants you to join the party
// Chasers kill on contact. All of it is off unless the setting is on.
// --------------------------------------------------------------------------

export const ENTITY_INFO = {
    watcher: { name: 'Watcher', description: 'A tall, silent silhouette watches from far away, then fades when you approach.' },
    smiler: { name: 'Smiler', description: 'A dark shape with a glowing grin that hunts once it spots you.' },
    partygoer: { name: 'Partygoer', description: 'A yellow, smiling figure that wanders until it sees you, then chases.' },
};

const KINDS = {
    0: [['watcher', 1]],                 // Bliss
    1: [['smiler', 2]],                  // Backrooms
    2: [['partygoer', 1]],               // Hotel
    4: [['partygoer', 1]],               // Ball pit
    5: [['watcher', 1]],                 // Night lawn
    7: [['smiler', 1]],                  // Hallway
    9: [['partygoer', 2]],               // Mall
    10: [['smiler', 1]],                 // Stairwell
    11: [['partygoer', 1]],              // Basement
    14: [['partygoer', 1]],              // Playground
};
// per kind, in multiples of the world's eye height / walk speed
const STATS = {
    smiler:    { sight: 10, chase: 1.18, roam: 0.35, reach: 0.32 },
    partygoer: { sight: 8, chase: 1.08, roam: 0.3, reach: 0.3 },
};

function canvas(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    return c;
}
const art = {};
function smilerArt() {
    return art.smiler ||= {
        blob: canvas(256, 256, (g) => {
            const r = g.createRadialGradient(128, 128, 10, 128, 128, 126);
            r.addColorStop(0, 'rgba(0,0,0,0.97)'); r.addColorStop(0.55, 'rgba(0,0,0,0.85)'); r.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = r; g.fillRect(0, 0, 256, 256);
            for (let i = 0; i < 900; i++) {
                const a = Math.random() * 6.283, d = 60 + Math.random() * 66;
                g.fillStyle = 'rgba(0,0,0,' + Math.random() * 0.5 + ')';
                g.fillRect(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 3, 3);
            }
        }),
        face: canvas(256, 256, (g) => {
            g.shadowColor = '#fff'; g.shadowBlur = 14; g.fillStyle = '#f4f6f0';
            for (const s of [-1, 1]) {
                g.beginPath(); g.ellipse(128 + s * 44, 92, 17, 10, s * 0.35, 0, Math.PI * 2); g.fill();
            }
            // the grin: a wide crescent full of teeth
            g.beginPath();
            g.moveTo(44, 132); g.quadraticCurveTo(128, 238, 212, 132); g.quadraticCurveTo(128, 186, 44, 132);
            g.fill();
            g.shadowBlur = 0; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = 3;
            for (let x = 56; x < 204; x += 11) {
                const t = (x - 44) / 168, y0 = 132 + 54 * 4 * t * (1 - t) * 0.5, y1 = 132 + 106 * 4 * t * (1 - t) * 0.5;
                g.beginPath(); g.moveTo(x, y0 - 2); g.lineTo(x + 1, y1 + 2); g.stroke();
            }
            g.beginPath(); g.moveTo(52, 140); g.quadraticCurveTo(128, 200, 204, 140); g.stroke();
        }),
    };
}
function partyFace() {
    return art.party ||= canvas(256, 256, (g) => {
        g.fillStyle = '#e9c43a';
        g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#100c06';
        for (const s of [-1, 1]) { g.beginPath(); g.ellipse(128 + s * 40, 96, 13, 22, 0, 0, Math.PI * 2); g.fill(); }
        g.lineCap = 'round'; g.strokeStyle = '#100c06'; g.lineWidth = 11;
        g.beginPath(); g.arc(128, 118, 76, 0.18 * Math.PI, 0.82 * Math.PI); g.stroke();
        g.lineWidth = 6;
        for (const s of [-1, 1]) { g.beginPath(); g.moveTo(128 + s * 66, 150); g.lineTo(128 + s * 80, 140); g.stroke(); }
    });
}
const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };

// a humanoid of capsules; s = metres -> world units
function humanoid(s, { color, height, thin, mat }) {
    const root = new THREE.Group();
    const m = mat || new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const k = height / 1.8, w = thin ? 0.6 : 1;
    const cap = (r, l) => new THREE.CapsuleGeometry(r * s * w, l * s * k, 4, 10);
    const add = (geo, parent, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
    const limb = (x, y, r, l) => {
        const piv = new THREE.Group(); piv.position.set(x * s * w, y * s * k, 0); root.add(piv);
        add(cap(r, l), piv, 0, -(l / 2 + r) * s * k, 0); return piv;
    };
    add(cap(0.2, 0.5), root, 0, 1.2 * s * k, 0);
    const head = add(new THREE.SphereGeometry(0.17 * s * (thin ? 0.8 : 1), 16, 12), root, 0, 1.68 * s * k, 0);
    const legs = [limb(-0.1, 0.9, 0.08, 0.72), limb(0.1, 0.9, 0.08, 0.72)];
    const arms = [limb(-0.27, 1.48, 0.06, thin ? 0.95 : 0.6), limb(0.27, 1.48, 0.06, thin ? 0.95 : 0.6)];
    return { root, head, legs, arms, mat: m };
}

// segment a-b against an axis-aligned box (slab test)
function segHits(a, b, bx) {
    let t0 = 0, t1 = 1;
    for (const [p, q, lo, hi] of [[a.x, b.x, bx.minX, bx.maxX], [a.y, b.y, bx.minY, bx.maxY], [a.z, b.z, bx.minZ, bx.maxZ]]) {
        const d = q - p;
        if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; }
        let ta = (lo - p) / d, tb = (hi - p) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) return false;
    }
    return true;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();

export class Entities {
    constructor(audio) {
        this.audio = audio;
        this.enabled = localStorage.getItem('entities') !== '0';
        try {
            const saved = JSON.parse(localStorage.getItem('encounteredEntities') || '[]');
            this.encountered = new Set(Array.isArray(saved) ? saved.filter(kind => ENTITY_INFO[kind]) : []);
        } catch {
            this.encountered = new Set();
        }
        this.list = [];
        this.world = null;
        this.physics = new Physics();
        this.dead = false;
    }
    markEncountered(kind) {
        if (this.encountered.has(kind)) return;
        this.encountered.add(kind);
        localStorage.setItem('encounteredEntities', JSON.stringify([...this.encountered]));
    }
    setEnabled(on) {
        this.enabled = on;
        localStorage.setItem('entities', on ? '1' : '0');
        this.clear();
    }
    clear() {
        for (const e of this.list) e.root.parent?.remove(e.root);
        this.list = [];
        this.world = null;
        this.setChase(0);
    }
    /** the face to flash on screen when kind gets you */
    faceURL(kind) {
        if (kind === 'smiler') {
            const a = smilerArt();
            return canvas(256, 256, g => { g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256); g.drawImage(a.blob, 0, 0); g.drawImage(a.face, 0, 0); }).toDataURL();
        }
        return canvas(256, 256, g => { g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256); g.drawImage(partyFace(), 0, 0); }).toDataURL();
    }

    spawnAll(w, index, feet) {
        this.world = w; this.index = index; this.age = 0;
        this.physics.setWorld(w);
        for (const [kind, n] of KINDS[index] || []) for (let i = 0; i < n; i++) this.spawn(kind, w, feet);
    }
    spawn(kind, w, feet) {
        const s = w.eye / 1.7;
        let e;
        if (kind === 'watcher') {
            const mat = new THREE.MeshBasicMaterial({ color: 0x030303, transparent: true, opacity: 1 });
            const h = humanoid(s, { height: 2.5, thin: true, mat });
            h.arms.forEach((a, i) => { a.rotation.z = (i ? -1 : 1) * 0.06; });
            e = { kind, ...h, fade: 0, hidden: true, wait: 2 + Math.random() * 6 };
        } else if (kind === 'smiler') {
            const a = smilerArt();
            const root = new THREE.Group();
            const blob = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(a.blob), transparent: true, depthWrite: false }));
            const face = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(a.face), transparent: true, depthWrite: false, fog: false, toneMapped: false }));
            const size = w.eye * 0.75;
            blob.scale.setScalar(size * 1.3); face.scale.setScalar(size);
            face.renderOrder = 1;
            root.add(blob, face);
            e = { kind, root, blob, face, size };
        } else {
            const h = humanoid(s, { color: 0xd9b23a, height: 1.85 });
            const f = new THREE.Mesh(new THREE.CircleGeometry(0.16 * s, 24), new THREE.MeshStandardMaterial({ map: tex(partyFace()), roughness: 0.7 }));
            f.position.z = 0.165 * s; h.head.add(f);
            e = { kind, ...h };
        }
        e.root.userData.keep = true;   // shared art: never disposed with the world
        e.pos = new THREE.Vector3(); e.vel = new THREE.Vector3(); e.body = { grounded: false };
        e.state = 'roam'; e.lost = 0; e.stuck = 0; e.phase = Math.random() * 6; e.target = null; e.grace = 4;
        w.group.add(e.root);
        if (kind === 'watcher') this.placeWatcher(e, w, feet);
        else if (!this.placeChaser(e, w, feet)) { e.root.parent.remove(e.root); return; }
        this.list.push(e);
    }

    // somewhere off on the hills, roughly in front of you
    placeWatcher(e, w, feet) {
        const s = w.eye / 1.7;
        e.root.visible = false; e.hidden = true;
        for (let k = 0; k < 20; k++) {
            const ang = Math.random() * Math.PI * 2, d = (50 + Math.random() * 70) * s;
            const x = feet.x + Math.sin(ang) * d, z = feet.z + Math.cos(ang) * d;
            const y = w.ground ? w.ground(x, z) : feet.y;
            if (!isFinite(y) || y < -1000) continue;
            e.pos.set(x, y - 0.05 * s, z);
            e.root.position.copy(e.pos);
            return;
        }
    }
    // out of your sight, a fair distance off, standing on a real floor
    placeChaser(e, w, feet) {
        const r = (w.radius ?? 1.6) * 0.8;
        let fallback = null;
        for (let k = 0; k < 60; k++) {
            const ang = Math.random() * Math.PI * 2, d = w.eye * (9 + Math.random() * 14);
            const x = feet.x + Math.sin(ang) * d, z = feet.z + Math.cos(ang) * d;
            const y = this.physics.supportAt({ x, z }, r, feet.y + w.eye * 0.6);
            if (Math.abs(y - feet.y) > w.eye * 0.6) continue;
            const p = new THREE.Vector3(x, y, z);
            if (!this.physics.headroom(p, y, r, w.eye)) continue;
            if (this.blocked(p.clone().setY(y + w.eye * 0.8), _b.copy(feet).setY(feet.y + w.eye))) { e.pos.copy(p); e.root.position.copy(p); return true; }
            fallback ||= p;
        }
        if (!fallback) return false;
        e.pos.copy(fallback); e.root.position.copy(fallback);
        return true;
    }
    blocked(a, b) {
        const bx = this.physics.query(Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.z, b.z), Math.max(a.z, b.z));
        for (const box of bx) if (segHits(a, b, box)) return true;
        return false;
    }

    /** returns the kind that caught you, if any */
    update(dt, { w, index, feet, camera, active }) {
        if (!this.enabled || this.dead) return null;
        if (this.world !== w) { this.clear(); this.spawnAll(w, index, feet); }
        if (!active) { this.setChase(0); return null; }
        this.age += dt;
        let chase = 0, caught = null;
        const s = w.eye / 1.7;
        for (const e of this.list) {
            if (e.kind === 'watcher') { this.updateWatcher(e, w, feet, camera, dt, s); continue; }
            const r = this.updateChaser(e, w, feet, dt);
            if (r === 'caught') caught = e.kind;
            if (e.state === 'chase') chase = Math.max(chase, 1 - Math.min(1, e.dist / (w.eye * 12)));
        }
        this.setChase(chase);
        return caught;
    }

    updateWatcher(e, w, feet, camera, dt, s) {
        const dist = Math.hypot(e.pos.x - feet.x, e.pos.z - feet.z);
        if (e.hidden) {
            e.wait -= dt;
            if (e.wait <= 0) {
                this.placeWatcher(e, w, feet);
                if (Math.hypot(e.pos.x - feet.x, e.pos.z - feet.z) > 40 * s) {
                    e.hidden = false; e.root.visible = true; e.fade = 1; e.mat.opacity = 1;
                    this.markEncountered(e.kind);
                }
                else e.wait = 1;
            }
            return;
        }
        // always facing you
        e.root.rotation.y = Math.atan2(feet.x - e.pos.x, feet.z - e.pos.z);
        if (dist < 24 * s || dist > 220 * s) e.vanishing = true;
        if (e.vanishing) {
            // flicker out
            e.fade -= dt * 3.5;
            e.mat.opacity = Math.max(0, e.fade) * (Math.random() > 0.3 ? 1 : 0.2);
            if (e.fade <= 0) { e.vanishing = false; e.hidden = true; e.root.visible = false; e.wait = 15 + Math.random() * 40; }
        }
    }

    updateChaser(e, w, feet, dt) {
        const S = STATS[e.kind], eye = w.eye;
        e.grace -= dt;
        const head = _a.copy(e.pos).setY(e.pos.y + eye * 0.85), you = _b.copy(feet).setY(feet.y + eye * 0.9);
        e.dist = Math.hypot(feet.x - e.pos.x, feet.z - e.pos.z);
        const sees = this.age > 5 && e.dist < S.sight * eye && Math.abs(feet.y - e.pos.y) < eye * 1.5 && !this.blocked(head, you);
        if (sees) {
            this.markEncountered(e.kind);
            e.state = 'chase'; e.lost = 0; e.target = feet.clone();
        } else if (e.state === 'chase') {
            e.lost += dt;
            if (e.lost > 5) { e.state = 'roam'; e.target = null; }
        }
        // where to go
        if (!e.target || (e.state === 'roam' && (Math.hypot(e.target.x - e.pos.x, e.target.z - e.pos.z) < eye * 0.6 || e.stuck > 1.5))) {
            const a = Math.random() * Math.PI * 2, d = eye * (3 + Math.random() * 8);
            e.target = new THREE.Vector3(e.pos.x + Math.sin(a) * d, e.pos.y, e.pos.z + Math.cos(a) * d);
            e.stuck = 0;
        }
        _d.set(e.target.x - e.pos.x, 0, e.target.z - e.pos.z);
        const len = _d.length();
        const speed = w.speed * (e.state === 'chase' ? S.chase : S.roam);
        if (len > 0.01) _d.multiplyScalar(speed / len);
        e.vel.x += (_d.x - e.vel.x) * Math.min(1, 8 * dt);
        e.vel.z += (_d.z - e.vel.z) * Math.min(1, 8 * dt);
        const before = e.pos.clone();
        const r = (w.radius ?? 1.6) * 0.8;
        const opts = { radius: r, height: w.height ?? eye + 0.8, stepHeight: w.stepHeight ?? eye * 0.24, mantleHeight: 0,
            gravity: w.gravity, ceiling: w.ceiling, bounds: w.bounds };
        const sub = Math.max(1, Math.ceil(speed * dt / (r * 0.5)));
        for (let i = 0; i < sub; i++) this.physics.move(e.pos, e.vel, e.body, dt / sub, opts);
        const moved = Math.hypot(e.pos.x - before.x, e.pos.z - before.z);
        e.stuck = moved < speed * dt * 0.25 ? e.stuck + dt : 0;
        if (e.state === 'chase' && e.stuck > 2.5) { e.state = 'roam'; e.target = null; }
        // fell out of the level or wandered far away: come back from somewhere else
        if (e.pos.y < feet.y - eye * 4 || (e.state === 'roam' && e.dist > eye * 45)) { this.placeChaser(e, w, feet); e.vel.set(0, 0, 0); e.state = 'roam'; e.target = null; }
        // pose
        e.root.position.copy(e.pos);
        const hs = Math.hypot(e.vel.x, e.vel.z);
        e.phase += hs * dt / (eye * 0.25);
        if (e.kind === 'smiler') {
            const bob = Math.sin(performance.now() / 600 + e.phase * 0.2) * eye * 0.05;
            e.blob.position.y = e.face.position.y = eye * 0.8 + bob;
            const flick = e.state === 'chase' ? 0.85 + Math.random() * 0.15 : 1;
            e.face.material.opacity = flick;
        } else {
            if (hs > 0.1) e.root.rotation.y = Math.atan2(e.vel.x, e.vel.z);
            const sw = Math.sin(e.phase) * Math.min(1, hs / w.speed) * 0.7;
            e.legs[0].rotation.x = sw; e.legs[1].rotation.x = -sw;
            e.arms[0].rotation.x = -sw * 0.8; e.arms[1].rotation.x = sw * 0.8;
            // arms reach for you when it's close
            if (e.state === 'chase' && e.dist < eye * 3) e.arms.forEach(a => { a.rotation.x = -1.3; });
            e.head.rotation.y = e.state === 'chase' ? Math.atan2(feet.x - e.pos.x, feet.z - e.pos.z) - e.root.rotation.y : 0;
        }
        if (e.grace <= 0 && this.age > 5 && e.dist < eye * S.reach + r && Math.abs(feet.y - e.pos.y) < eye) return 'caught';
        return null;
    }

    // --- sound: a growl that swells as a hunter closes in ---
    setChase(level) {
        const A = this.audio, ctx = A?.context;
        if (!ctx) return;
        if (!this.chaseGain && !this.loading) {
            this.loading = true;
            A.loadSound('sfx_entity_chase.wav').then(buf => {
                const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
                const g = ctx.createGain(); g.gain.value = 0;
                src.connect(g); g.connect(A.masterGain || ctx.destination); src.start();
                this.chaseGain = g;
            }).catch(() => {});
            A.loadSound('sfx_entity_scare.wav').then(b => { this.scareBuf = b; }).catch(() => {});
        }
        this.chaseGain?.gain.setTargetAtTime(level * 0.9, ctx.currentTime, 0.3);
    }
    playScare() {
        const ctx = this.audio?.context;
        if (!ctx || !this.scareBuf) return;
        const src = ctx.createBufferSource(); src.buffer = this.scareBuf;
        const g = ctx.createGain(); g.gain.value = 0.9;
        src.connect(g); g.connect(this.audio.masterGain || ctx.destination); src.start();
    }
}
