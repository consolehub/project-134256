import * as THREE from 'three';

// Mouse look with pointer lock. Browsers occasionally report a huge bogus mouse delta
// (especially right after locking or when the cursor would hit the screen edge), which
// makes the view snap. We ask for raw input where supported and drop those spikes.
class MouseLook extends THREE.EventDispatcher {
    constructor(camera, dom) {
        super();
        this.camera = camera; this.dom = dom; this.isLocked = false;
        this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
        this.sensitivity = 0.002;
        this.ignoreUntil = 0;
        this.last = [0, 0];
        document.addEventListener('pointerlockchange', () => {
            this.isLocked = document.pointerLockElement === this.dom;
            this.ignoreUntil = performance.now() + 80; // first events after locking are unreliable
            this.dispatchEvent({ type: this.isLocked ? 'lock' : 'unlock' });
        });
        document.addEventListener('mousemove', e => this.onMove(e));
    }
    onMove(e) {
        if (!this.isLocked || performance.now() < this.ignoreUntil) return;
        let dx = e.movementX || 0, dy = e.movementY || 0;
        // a single event this large is a browser glitch, not a real flick
        const mag = Math.hypot(dx, dy), prev = Math.hypot(this.last[0], this.last[1]);
        if (mag > 250 && mag > prev * 6 + 60) return;
        this.last = [dx, dy];
        this.euler.setFromQuaternion(this.camera.quaternion);
        this.euler.y -= dx * this.sensitivity;
        this.euler.x -= dy * this.sensitivity;
        this.euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.euler.x));
        this.camera.quaternion.setFromEuler(this.euler);
    }
    lock() {
        const p = this.dom.requestPointerLock?.({ unadjustedMovement: true });
        // raw input isn't available everywhere: fall back to a normal lock
        if (p && p.catch) p.catch(() => this.dom.requestPointerLock());
    }
}

export class InputManager {
    constructor(camera, domElement, isMobile) {
        this.camera = camera;
        this.domElement = domElement;
        this.isMobile = isMobile;
        this.moveState = { forward: false, backward: false, left: false, right: false, sprint: false, ax: 0, ay: 0 };
        this.controls = null;
        this.jumpCallbacks = [];
        this.init();
    }

    init() {
        if (!this.isMobile) {
            this.controls = new MouseLook(this.camera, this.domElement);
            const set = (code, v) => {
                switch (code) {
                    case 'ArrowUp': case 'KeyW': this.moveState.forward = v; break;
                    case 'ArrowLeft': case 'KeyA': this.moveState.left = v; break;
                    case 'ArrowDown': case 'KeyS': this.moveState.backward = v; break;
                    case 'ArrowRight': case 'KeyD': this.moveState.right = v; break;
                    case 'ShiftLeft': case 'ShiftRight': this.moveState.sprint = v; break;
                }
            };
            document.addEventListener('keydown', e => {
                set(e.code, true);
                if (e.code === 'Space') { e.preventDefault(); this.triggerJump(); }
            });
            document.addEventListener('keyup', e => set(e.code, false));
            window.addEventListener('blur', () => Object.keys(this.moveState).forEach(k => this.moveState[k] = false));
        } else {
            // Floating analog stick: touch anywhere on the left half and drag.
            // The rest of the screen is for looking around.
            const zone = document.getElementById('joystick-zone');
            const jumpBtn = document.getElementById('jump-btn');
            const base = document.createElement('div'); base.className = 'stick-base';
            const knob = document.createElement('div'); knob.className = 'stick-knob';
            base.appendChild(knob); document.body.appendChild(base);
            const R = 55;
            let stickId = null, sx = 0, sy = 0;
            const ms = this.moveState;
            const release = () => {
                stickId = null; ms.ax = ms.ay = 0; ms.sprint = false;
                base.classList.remove('on');
            };
            document.addEventListener('touchstart', e => {
                if (!document.body.classList.contains('playing')) return;
                for (const t of e.changedTouches) {
                    if (stickId !== null || t.clientX > window.innerWidth * 0.45 || t.target.closest('#jump-btn, button, #world-tag, #menu, #quality-modal')) continue;
                    stickId = t.identifier; sx = t.clientX; sy = t.clientY;
                    base.style.left = sx + 'px'; base.style.top = sy + 'px';
                    knob.style.transform = 'translate(-50%, -50%)';
                    base.classList.add('on');
                }
            }, { passive: true });
            document.addEventListener('touchmove', e => {
                for (const t of e.changedTouches) {
                    if (t.identifier !== stickId) continue;
                    let dx = t.clientX - sx, dy = t.clientY - sy;
                    const d = Math.hypot(dx, dy);
                    if (d > R) { dx *= R / d; dy *= R / d; }
                    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
                    // small dead zone, then analog; pushing to the rim runs
                    const m = Math.min(1, d / R), k = m < 0.12 ? 0 : (m - 0.12) / 0.88 / (m || 1);
                    ms.ax = dx / R * k; ms.ay = -dy / R * k;
                    ms.sprint = d > R * 1.15;
                }
            }, { passive: true });
            const endStick = e => { for (const t of e.changedTouches) if (t.identifier === stickId) release(); };
            document.addEventListener('touchend', endStick);
            document.addEventListener('touchcancel', endStick);
            zone?.remove();

            jumpBtn.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); this.triggerJump(); }, { passive: false });

            // Touch look (yaw + pitch)
            const euler = new THREE.Euler(0, 0, 0, 'YXZ');
            let lookId = null, lx = 0, ly = 0;
            document.addEventListener('touchstart', e => {
                for (const t of e.changedTouches) {
                    if (lookId === null && t.clientX > window.innerWidth * 0.45 && !t.target.closest('#jump-btn, button, #world-tag, #menu, #quality-modal')) {
                        lookId = t.identifier; lx = t.pageX; ly = t.pageY;
                    }
                }
            }, { passive: true });
            document.addEventListener('touchmove', e => {
                for (const t of e.changedTouches) {
                    if (t.identifier !== lookId) continue;
                    euler.setFromQuaternion(this.camera.quaternion);
                    euler.y -= (t.pageX - lx) * 0.005;
                    euler.x -= (t.pageY - ly) * 0.004;
                    euler.x = Math.max(-1.3, Math.min(1.3, euler.x));
                    this.camera.quaternion.setFromEuler(euler);
                    lx = t.pageX; ly = t.pageY;
                }
                e.preventDefault();
            }, { passive: false });
            const end = e => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; };
            document.addEventListener('touchend', end);
            document.addEventListener('touchcancel', end);
        }
    }

    onJump(cb) { this.jumpCallbacks.push(cb); }
    triggerJump() { this.jumpCallbacks.forEach(cb => cb()); }
    lock() { if (this.controls) this.controls.lock(); }
}
