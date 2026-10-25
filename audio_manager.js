export class AudioManager {
    constructor() {
        this.context = null;
        this.buffers = {};
        this.sources = {};
        this.gains = {};
        const storedVolume = localStorage.getItem('audioVolume');
        const savedVolume = storedVolume === null ? 1 : Number(storedVolume);
        this.volume = Number.isFinite(savedVolume) ? Math.max(0, Math.min(1, savedVolume)) : 1;
    }

    async init() {
        if (this.context) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.context = new AudioContext();
        this.masterGain = this.context.createGain();
        this.masterGain.gain.value = this.volume;
        this.masterGain.connect(this.context.destination);

        // Load Steps
        const stepMap = {
            'grass': 'asset_step_grass.mp3',
            'carpet': 'asset_step_carpet.mp3',
            'wood': 'asset_step_wood.mp3',
            'tile': ['asset_step_tile_1.wav', 'asset_step_tile_2.wav', 'asset_step_tile_3.wav'],
            'water': 'asset_step_water.mp3'
        };
        this.loadSound('asset_splash_big.wav').then(b => this.buffers.splashBig = b).catch(() => {});
        this.loadSound('asset_splash_small.wav').then(b => this.buffers.splashSmall = b).catch(() => {});
        // a type can have several recordings; a random one plays each step
        for (const [k, u] of Object.entries(stepMap)) {
            const urls = Array.isArray(u) ? u : [u];
            this.buffers[k] = [];
            urls.forEach(url => this.loadSound(url).then(b => this.buffers[k].push(b)).catch(() => {}));
        }

        // Looping ambience beds (all start together, levels set per world)
        await Promise.all([
            this.startLoop('wind', 'audio_wind.mp3', 0.4),
            this.startLoop('pool', 'audio_pool_ambience.mp3', 0),
            // pre-crossfaded, gapless WAV so the loop point is seamless
            this.startLoop('backrooms', 'audio_backrooms_loop.wav', 0),
        ]);
    }

    setVolume(value) {
        this.volume = Math.max(0, Math.min(1, Number(value) || 0));
        localStorage.setItem('audioVolume', String(this.volume));
        if (this.masterGain) this.masterGain.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.03);
    }

    async startLoop(name, url, level) {
        try {
            const buffer = await this.loadSound(url);
            const src = this.context.createBufferSource();
            src.buffer = buffer;
            src.loop = true;
            src.loopStart = 0;
            src.loopEnd = buffer.duration;
            const gain = this.context.createGain();
            gain.gain.value = this.pendingLevels?.[name] ?? level;
            src.connect(gain);
            gain.connect(this.masterGain);
            src.start(0);
            this.sources[name] = src;
            this.gains[name] = gain;
        } catch (e) {}
    }

    async loadSound(url) {
        const response = await fetch(new URL(url, import.meta.url).href);
        const arrayBuffer = await response.arrayBuffer();
        return await this.context.decodeAudioData(arrayBuffer);
    }

    playStep(type) {
        if (!this.context || this.context.state !== 'running') return;
        const list = this.buffers[type];
        if (list?.length) {
            // never the same recording twice in a row
            let k = Math.floor(Math.random() * list.length);
            if (list.length > 1 && k === this.lastStep?.[type]) k = (k + 1) % list.length;
            (this.lastStep ||= {})[type] = k;
            const buffer = list[k];
            const src = this.context.createBufferSource();
            src.buffer = buffer;
            src.playbackRate.value = 0.9 + Math.random() * 0.2;
            const gain = this.context.createGain();
            gain.gain.value = 0.25;
            src.connect(gain);
            gain.connect(this.masterGain);
            src.start(0);
        }
    }

    /** strength 0..1: how hard you hit the water */
    playSplash(strength) {
        if (!this.context || this.context.state !== 'running') return;
        const buffer = strength > 0.45 ? this.buffers.splashBig : this.buffers.splashSmall;
        if (!buffer) return;
        const src = this.context.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = 0.92 + Math.random() * 0.16;
        const gain = this.context.createGain();
        gain.gain.value = 0.35 + 0.5 * Math.min(1, strength);
        src.connect(gain);
        gain.connect(this.masterGain);
        src.start(0);
    }

    playGlitch() {
        if (!this.context || this.context.state !== 'running') return;
        const ctx = this.context, len = ctx.sampleRate * 0.7;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() > 0.97 ? 1 : 0.35);
        const src = ctx.createBufferSource(); src.buffer = buf;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
        f.frequency.setValueAtTime(400, ctx.currentTime);
        f.frequency.exponentialRampToValueAtTime(4000, ctx.currentTime + 0.6);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0, ctx.currentTime);
        g.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.25);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
        src.connect(f); f.connect(g); g.connect(this.masterGain);
        src.start();
    }

    setAmbience(worldId) {
        if (!this.context) return;
        const t = this.context.currentTime;
        const g = this.gains;

        // 0: Bliss, 1: Backrooms, 2: Hotel, 3: Poolrooms
        const levels = [
            { wind: 0.4 },                   // Bliss
            { backrooms: 0.45 },             // Backrooms
            { wind: 0.1 },                   // Hotel
            { pool: 0.8 },                   // Pool
            { pool: 0.15 },                  // Ball pit
            { wind: 0.12 },                  // Night lawn
            { wind: 0.25, pool: 0.3 },       // The Edge
            { backrooms: 0.125 },            // The Hallway
            { wind: 0.55 },                  // Sky Road
            { backrooms: 0.06, wind: 0.04 }, // Mall
            { backrooms: 0.05, pool: 0.12, wind: 0.05 }, // Stairwell
            { backrooms: 0.07, wind: 0.03 },             // Basement
            { wind: 0.06 },                              // The Surface (Moon / Mars)
            { wind: 0.3 },                               // The Field
            { backrooms: 0.045, pool: 0.08 }             // Playground
        ];

        const target = worldId == null ? {} : (levels[worldId] || levels[0]);

        this.pendingLevels = {};
        for (const name of ['wind', 'pool', 'backrooms']) {
            const v = target[name] || 0;
            this.pendingLevels[name] = v;
            if (g[name]) g[name].gain.setTargetAtTime(v, t, 0.2);
        }
    }
}