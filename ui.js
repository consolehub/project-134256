import { seedLabel } from './seed.js';
import { ENTITY_INFO } from './entities.js';
const pad = n => String(n).padStart(2, '0');
const wait = ms => new Promise(r => setTimeout(r, ms));

export class UI {
    constructor(isMobile) {
        this.isMobile = isMobile;
        this.started = false;
        this.loading = false;
        this.paused = false;
        this.inGame = false;
        if (isMobile) document.body.classList.add('mobile');
        this.menu = document.getElementById('menu');
        this.loadingScreen = document.getElementById('loading-screen');
        this.titleScreen = document.getElementById('title-screen');
        this.menuExtras = document.getElementById('menu-extras');
        this.pauseScreen = document.getElementById('pause-screen');
        this.audioScreen = document.getElementById('audio-screen');
        const menuArt = [
            'uploads/01a157aa-0cfe-7187-8d97-3d376893955d.jpg',
            'uploads/artworks-Skoo4MTzJzZYxzwk-vPhjqw-t1080x1080.jpg',
            'uploads/Liminal_house-2.webp',
        ][Math.floor(Math.random() * 3)];
        document.documentElement.style.setProperty('--menu-art', 'url("' + new URL(menuArt, document.baseURI).href + '")');
        this.eyebrow = document.getElementById('menu-eyebrow');
        this.startBtn = document.getElementById('start-btn');
        this.fullscreenBtn = document.getElementById('fullscreen-btn');
        const fullscreenTarget = document.documentElement;
        const requestFullscreen = fullscreenTarget.requestFullscreen || fullscreenTarget.webkitRequestFullscreen;
        const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
        const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
        if (!requestFullscreen || !exitFullscreen) {
            this.fullscreenBtn.hidden = true;
        } else {
            const syncFullscreen = () => {
                const active = isFullscreen();
                this.fullscreenBtn.textContent = active ? 'Exit Fullscreen' : 'Fullscreen';
                this.fullscreenBtn.setAttribute('aria-pressed', String(active));
            };
            this.fullscreenBtn.addEventListener('click', async () => {
                try {
                    if (isFullscreen()) await exitFullscreen.call(document);
                    else await requestFullscreen.call(fullscreenTarget);
                } catch {
                    this.fullscreenBtn.textContent = 'Unavailable';
                    window.setTimeout(syncFullscreen, 1400);
                }
            });
            document.addEventListener('fullscreenchange', syncFullscreen);
            document.addEventListener('webkitfullscreenchange', syncFullscreen);
            syncFullscreen();
        }
        this.toast = document.getElementById('toast');
        this.glitch = document.getElementById('glitch');
        this.firstWorld = true;
    }
    onStart(cb) {
        this.startBtn.addEventListener('click', async () => {
            if (this.loading) return;
            const first = !this.started;
            this.started = true;
            this.loading = true;
            this.menu.classList.add('hidden');
            this.loadingScreen.hidden = false;
            try {
                const startup = cb();
                await new Promise(resolve => requestAnimationFrame(resolve));
                await startup;
                this.loading = false;
                this.loadingScreen.hidden = true;
                this.menuExtras.hidden = false;
                this.hideMenu();
                if (first) this.showToast();
            } catch (error) {
                console.error('Could not start game', error);
                this.loading = false;
                this.started = false;
                this.loadingScreen.hidden = true;
                this.menu.classList.remove('hidden');
            }
        });
    }
    setLevels(names) {
        this.levelNames = [...names];
        this.levelsEl = document.getElementById('levels');
        this.levelsEl.innerHTML = names.map((n, i) =>
            '<button class="level" data-i="' + i + '"><span class="li">' + pad(i) + '</span>' + n + '</button>').join('');
        this.mainCard = this.titleScreen;
        this.levelScreen = document.getElementById('level-screen');
        this.entityScreen = document.getElementById('entity-screen');
        document.getElementById('levels-btn').addEventListener('click', () => this.showLevels(true));
        document.getElementById('levels-back').addEventListener('click', () => this.showLevels(false));
        this.entityList = document.getElementById('entity-list');
        document.getElementById('entity-log-btn').addEventListener('click', () => {
            this.renderEntityLog(this.getEncountered());
            this.showEntityLog(true);
        });
        document.getElementById('entities-back').addEventListener('click', () => this.showEntityLog(false));
        document.getElementById('audio-btn').addEventListener('click', () => this.showAudio(true));
        document.getElementById('audio-back').addEventListener('click', () => this.showAudio(false));
        // on phones, tapping the level tag opens the level select
        document.getElementById('world-tag').addEventListener('click', () => { if (this.inGame) { this.showPauseMenu(); this.showLevels(true); } });
        this.markLevel();
    }
    onPick(cb) {
        this.levelsEl.addEventListener('click', (e) => {
            const b = e.target.closest('.level');
            if (!b) return;
            this.started = true;
            this.eyebrow.textContent = 'Paused';
            this.startBtn.textContent = 'Resume';
            if (this.isMobile) this.hideMenu();
            this.showLevels(false);
            cb(Number(b.dataset.i));
        });
    }
    setEntityLog(getEncountered) {
        this.getEncountered = getEncountered;
    }
    renderEntityLog(encountered) {
        this.entityList.innerHTML = Object.entries(ENTITY_INFO).map(([kind, entity]) => encountered.has(kind)
            ? '<article class="entity-entry"><div class="entity-name">' + entity.name + '</div><div class="entity-description">' + entity.description + '</div></article>'
            : '<article class="entity-entry unknown"><span class="entity-question">?</span><div><div class="entity-name">???</div><div class="entity-description">Not encountered</div></div></article>').join('');
    }
    showEntityLog(on) {
        if (on) this.returnMenu = this.paused ? 'pause' : 'title';
        this.entityScreen.hidden = !on;
        this.levelScreen.hidden = true;
        this.audioScreen.hidden = true;
        this.pauseScreen.hidden = true;
        this.mainCard.hidden = on || this.returnMenu === 'pause';
        if (!on) this.pauseScreen.hidden = this.returnMenu !== 'pause';
    }
    showLevels(on) {
        if (on) this.returnMenu = this.paused ? 'pause' : 'title';
        this.levelScreen.hidden = !on;
        this.entityScreen.hidden = true;
        this.audioScreen.hidden = true;
        this.pauseScreen.hidden = on || this.returnMenu !== 'pause';
        this.mainCard.hidden = on || this.returnMenu === 'pause';
    }
    showAudio(on) {
        this.audioScreen.hidden = !on;
        this.pauseScreen.hidden = on;
        this.mainCard.hidden = true;
        this.levelScreen.hidden = true;
        this.entityScreen.hidden = true;
    }
    showPauseMenu() {
        if (document.pointerLockElement) document.exitPointerLock?.();
        this.paused = true;
        this.inGame = false;
        this.returnMenu = 'pause';
        this.mainCard.hidden = true;
        this.levelScreen.hidden = true;
        this.entityScreen.hidden = true;
        this.audioScreen.hidden = true;
        this.pauseScreen.hidden = false;
        this.menu.classList.add('pause-menu');
        this.menu.classList.remove('hidden');
    }
    returnToTitle() {
        this.paused = false;
        this.inGame = false;
        this.started = false;
        this.returnMenu = 'title';
        this.eyebrow.textContent = 'You have arrived';
        this.startBtn.textContent = 'Enter';
        this.menuExtras.hidden = true;
        this.mainCard.hidden = false;
        this.levelScreen.hidden = true;
        this.entityScreen.hidden = true;
        this.audioScreen.hidden = true;
        this.pauseScreen.hidden = true;
        this.menu.classList.remove('pause-menu', 'hidden');
        document.body.classList.remove('playing');
    }
    renameLevel(i, name) {
        (this.levelNames ??= [])[i] = name;
        const b = this.levelsEl?.querySelector('.level[data-i="' + i + '"]');
        if (b) b.innerHTML = '<span class="li">' + pad(i) + '</span>' + name;
    }
    markLevel() {
        if (!this.levelsEl) return;
        this.levelsEl.querySelectorAll('.level').forEach(b => b.classList.toggle('current', Number(b.dataset.i) === this.index));
    }
    hideMenu() {
        this.paused = false;
        this.inGame = true;
        this.menu.classList.remove('pause-menu');
        this.menu.classList.add('hidden');
        document.body.classList.add('playing');
    }
    showMenu(paused) {
        if (paused) this.showPauseMenu();
        else this.menu.classList.remove('hidden');
    }
    onResume(cb) { document.getElementById('resume-btn').addEventListener('click', cb); }
    onExit(cb) { document.getElementById('exit-btn').addEventListener('click', cb); }
    setWorld(name, index, seed) {
        this.name = name; this.index = index; this.seed = seedLabel(seed);
        document.getElementById('world-index').textContent = pad(index);
        document.getElementById('world-seed').textContent = this.seed;
        document.getElementById('world-name').textContent = name;
        this.markLevel();
        if (this.started && !this.loading) this.showToast();
    }
    showToast() {
        this.toast.querySelector('.toast-index').textContent = 'LEVEL ' + pad(this.index) + ' · ' + this.seed;
        this.toast.querySelector('.toast-name').textContent = this.name;
        this.toast.classList.remove('show');
        void this.toast.offsetWidth;
        this.toast.classList.add('show');
    }
    levelName(i) { return this.levelNames?.[i]; }
    onMultiplayer(cb) {
        this.mpBtn = document.getElementById('mp-toggle');
        this.playersEl = document.getElementById('players');
        if (this.mpBtn) this.mpBtn.addEventListener('click', () => cb(this.mpBtn.getAttribute('aria-pressed') !== 'true'));
    }
    onPlayer(cb) {
        this.playersEl?.addEventListener('click', (e) => {
            const b = e.target.closest('.player');
            if (b) cb(b.dataset.id);
        });
    }
    setPlayers(on, list) {
        if (!this.mpBtn) return;
        this.mpBtn.setAttribute('aria-pressed', String(on));
        this.mpBtn.textContent = on ? 'Multiplayer · On' : 'Multiplayer · Off';
        this.playersEl.hidden = !on;
        if (!on) return;
        const esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
        const html = list.length ? list.map(p =>
            '<button class="player' + (p.here ? ' here' : '') + '" data-id="' + esc(p.id) + '">' +
            '<img src="https://images.websim.com/avatar/' + encodeURIComponent(p.username) + '" alt="">' +
            '<span class="pn">@' + esc(p.username) + '</span>' +
            '<span class="pl">' + pad(p.world) + ' ' + esc(p.level) + ' · ' + seedLabel(p.seed) + '</span></button>').join('')
            : '<div class="no-players">Nobody else is exploring</div>';
        // only touch the DOM when something changed, so a click is never cut in half
        if (html !== this.playersHtml) { this.playersHtml = html; this.playersEl.innerHTML = html; }
    }
    onQuality(cb) {
        this.qualityButtons = [...document.querySelectorAll('[data-open-quality]')];
        this.qualityModal = document.getElementById('quality-modal');
        const close = () => {
            this.qualityModal.hidden = true;
            this.qualityButtons.forEach(button => button.setAttribute('aria-expanded', 'false'));
            this.qualityOpener?.focus();
        };
        this.qualityButtons.forEach(button => button.addEventListener('click', () => {
            this.qualityOpener = button;
            this.qualityModal.hidden = false;
            this.qualityButtons.forEach(item => item.setAttribute('aria-expanded', String(item === button)));
            document.getElementById('quality-close').focus();
        }));
        document.getElementById('quality-close').addEventListener('click', close);
        this.qualityModal.addEventListener('click', e => { if (e.target === this.qualityModal) close(); });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !this.qualityModal.hidden) { e.preventDefault(); close(); }
        });
        this.qualityModal.querySelectorAll('[data-setting]').forEach(button => {
            button.addEventListener('click', () => cb(button.dataset.setting, button.dataset.value));
        });
    }
    syncQualitySettings(settings) {
        document.querySelectorAll('#quality-modal [data-setting]').forEach(button => {
            button.setAttribute('aria-pressed', String(String(settings[button.dataset.setting]) === button.dataset.value));
        });
    }
    async glitchIn() { this.glitch.classList.add('on'); await wait(420); }
    async glitchOut() { await wait(180); this.glitch.classList.remove('on'); await wait(200); }
}
