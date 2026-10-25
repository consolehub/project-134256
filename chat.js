// Text chat between explorers (only while multiplayer is on).
// T or Enter opens the box while playing; Enter sends, Escape closes.
const esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const SHOW_MS = 9000;

export class Chat {
    constructor(isMobile) {
        this.root = document.getElementById('chat');
        this.log = document.getElementById('chat-log');
        this.form = document.getElementById('chat-form');
        this.input = document.getElementById('chat-input');
        this.btn = document.getElementById('chat-btn');
        this.enabled = false;
        this.sendCb = null;
        this.form.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = this.input.value.trim();
            if (text) this.sendCb?.(text);
            this.close();
        });
        this.input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') this.close();
        });
        this.input.addEventListener('keyup', e => e.stopPropagation());
        this.input.addEventListener('blur', () => this.close());
        document.addEventListener('keydown', (e) => {
            if (!this.enabled || this.isOpen || e.repeat || !document.body.classList.contains('playing')) return;
            if (e.code === 'KeyT' || e.code === 'Enter') { e.preventDefault(); this.open(); }
        });
        this.btn.addEventListener('click', () => this.isOpen ? this.close() : this.open());
        this.btn.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    }
    get isOpen() { return this.root.classList.contains('open'); }
    onSend(cb) { this.sendCb = cb; }
    onOpen(cb) { this.openCb = cb; }
    setEnabled(on) {
        this.enabled = on;
        document.body.classList.toggle('mp-on', on);
        if (!on) { this.close(); this.log.innerHTML = ''; }
    }
    open() {
        if (!this.enabled) return;
        this.root.classList.add('open');
        this.openCb?.();
        this.input.value = '';
        // focus after this keypress, so the "t" doesn't land in the box
        requestAnimationFrame(() => this.input.focus());
    }
    close() {
        if (!this.isOpen) return;
        this.root.classList.remove('open');
        this.input.blur();
    }
    add({ username, text, mine }) {
        const row = document.createElement('div');
        row.className = 'chat-line' + (mine ? ' mine' : '');
        row.innerHTML = '<span class="cn">@' + esc(username) + '</span> ' + esc(text);
        this.log.appendChild(row);
        while (this.log.children.length > 30) this.log.firstChild.remove();
        setTimeout(() => row.classList.add('old'), SHOW_MS);
        this.log.scrollTop = this.log.scrollHeight;
    }
}
