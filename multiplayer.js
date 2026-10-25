import * as THREE from 'three';

// Other explorers. Each one is only drawn inside the exact variation (level + seed) they are in,
// so two people in "the same level" but different seeds never see each other.
const SEND_MS = 100;
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

function makeLabel(text) {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    const font = '600 44px ui-monospace, Menlo, monospace';
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + 40;
    c.width = w; c.height = 72;
    g.font = font;
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.beginPath(); g.roundRect(0, 6, w, 60, 30); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, 37);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, toneMapped: false, depthWrite: false, transparent: true }));
    s.scale.set(0.28 * w / 72, 0.28, 1);
    return s;
}

// a quiet, faceless figure, built at eye height 1 and scaled to each world
function makeAvatar(name) {
    const g = new THREE.Group();
    g.userData.keep = true;   // survives world rebuilds
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.85, emissive: 0x2a2826 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.62, 4, 12), mat);
    body.position.y = 0.48;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), mat);
    head.position.y = 1.0;
    body.castShadow = head.castShadow = true;
    const label = makeLabel(name);
    label.position.y = 1.35;
    g.add(body, head, label);
    return g;
}

export class Multiplayer {
    constructor(scene, worlds) {
        this.scene = scene;
        this.worlds = worlds;
        this.enabled = false;
        this.room = null;
        this.myId = null;
        this.names = new Map();     // id -> username
        this.others = new Map();    // id -> { w, s, f, x, y, z, r, avatar, cur }
        this.lastSend = 0;
        this.listeners = [];
        this.chatListeners = [];
    }

    onChat(cb) { this.chatListeners.push(cb); }
    sendChat(text) { if (this.enabled && this.room) this.room.send({ type: 'chat', text }); }

    onChange(cb) { this.listeners.push(cb); }
    emit() { this.listeners.forEach(cb => cb()); }

    async setEnabled(on) {
        this.enabled = on;
        if (!on) {
            this.room?.send({ type: 'off' });
            for (const o of this.others.values()) o.avatar.removeFromParent();
            this.emit();
            return;
        }
        this.lastSend = 0;
        this.emit();
        if (!this.room) await this.connect();
    }

    async connect() {
        if (this.connecting) return this.connecting;
        this.connecting = (async () => {
            try {
                const room = await WebsimSocket.joinRoom();
                this.room = room;
                room.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
                room.onreconnect = () => { this.lastSend = 0; if (!this.enabled) room.send({ type: 'off' }); };
                room.onclose = () => { this.room = null; this.connecting = null; this.clear(); this.emit(); };
                if (!this.enabled) room.send({ type: 'off' });
            } catch (e) {
                console.error('Multiplayer: could not join', e);
                this.connecting = null;
            }
        })();
        return this.connecting;
    }

    clear() {
        for (const o of this.others.values()) o.avatar.removeFromParent();
        this.others.clear();
        this.names.clear();
    }

    onMessage(m) {
        if (m.type === 'welcome') {
            this.myId = m.id;
            this.setRoster(m.players);
        } else if (m.type === 'chat') {
            if (this.enabled) this.chatListeners.forEach(cb => cb({ ...m, mine: m.id === this.myId }));
        } else if (m.type === 'roster') {
            this.setRoster(m.players);
        } else if (m.type === 'snap') {
            const seen = new Set();
            for (const p of m.players) {
                if (p.id === this.myId) continue;
                seen.add(p.id);
                let o = this.others.get(p.id);
                if (!o) {
                    o = { avatar: makeAvatar('@' + (this.names.get(p.id) ?? 'guest')), cur: null };
                    this.others.set(p.id, o);
                }
                const moved = o.w !== p.w || o.s !== p.s;
                Object.assign(o, { w: p.w, s: p.s, f: p.f, x: p.x, y: p.y, z: p.z, r: p.r });
                if (moved) o.cur = null;   // changed level: snap rather than glide
            }
            for (const [id, o] of this.others) if (!seen.has(id)) { o.avatar.removeFromParent(); this.others.delete(id); }
            this.emit();
        }
    }

    setRoster(list) {
        this.names = new Map(list.map(p => [p.id, p.username]));
        for (const [id, o] of this.others) if (!this.names.has(id)) { o.avatar.removeFromParent(); this.others.delete(id); }
        this.emit();
    }

    /** Players to list in the menu */
    list() {
        return [...this.others].filter(([id]) => this.names.has(id))
            .map(([id, o]) => ({ id, username: this.names.get(id), world: o.w, seed: o.s }));
    }
    get(id) { return this.others.get(id); }

    /** Call once per frame with where we are */
    update(dt, me) {
        if (!this.enabled) return;
        const now = performance.now();
        if (this.room && now - this.lastSend > SEND_MS) {
            this.lastSend = now;
            _e.setFromQuaternion(me.quat);
            this.room.send({ type: 'state', w: me.world, s: me.seed, f: me.from ?? null, x: me.feet.x, y: me.feet.y, z: me.feet.z, r: _e.y });
        }
        const k = 1 - Math.exp(-dt * 12);
        for (const o of this.others.values()) {
            const W = this.worlds[o.w];
            const here = W && W.seed === o.s;
            if (!here) { o.avatar.removeFromParent(); continue; }
            if (o.avatar.parent !== W.group) { W.group.add(o.avatar); o.cur = null; }
            const a = o.avatar;
            if (!o.cur) { o.cur = true; a.position.set(o.x, o.y, o.z); a.rotation.y = o.r; }
            else {
                a.position.x += (o.x - a.position.x) * k;
                a.position.y += (o.y - a.position.y) * k;
                a.position.z += (o.z - a.position.z) * k;
                let d = o.r - a.rotation.y;
                d = Math.atan2(Math.sin(d), Math.cos(d));
                a.rotation.y += d * k;
            }
            a.scale.setScalar(W.eye);
        }
    }
}
