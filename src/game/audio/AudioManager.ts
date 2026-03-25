/**
 * AudioManager — sons procedurais via Web Audio API.
 * Não depende de arquivos de áudio externos.
 * Todos os sons são sintetizados em tempo real.
 */
export class AudioManager {
    private ctx: AudioContext | null = null;
    private stepTimer = 0;
    private readonly STEP_INTERVAL = 320; // ms entre passos

    private getCtx(): AudioContext {
        if (!this.ctx || this.ctx.state === 'closed') {
            this.ctx = new AudioContext();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        return this.ctx;
    }

    // ── Tiro de pistola ───────────────────────────────────────────────────────
    shoot() {
        try {
            const ctx = this.getCtx();
            const now = ctx.currentTime;

            // Ruído de disparo
            const bufSize = ctx.sampleRate * 0.08;
            const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);

            const noise = ctx.createBufferSource();
            noise.buffer = buf;

            // Filtro passa-alta para crack metálico
            const filter = ctx.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.value = 2000;

            // Envelope de volume
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.55, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

            // Tom de percussão (corpo do tiro)
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(180, now);
            osc.frequency.exponentialRampToValueAtTime(40, now + 0.06);
            const oscGain = ctx.createGain();
            oscGain.gain.setValueAtTime(0.4, now);
            oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

            noise.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            osc.connect(oscGain);
            oscGain.connect(ctx.destination);

            noise.start(now);
            noise.stop(now + 0.08);
            osc.start(now);
            osc.stop(now + 0.06);
        } catch { /* silencia erros de áudio */ }
    }

    // ── Clique de pistola vazia ───────────────────────────────────────────────
    emptyClick() {
        try {
            const ctx = this.getCtx();
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            osc.type = 'square';
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.exponentialRampToValueAtTime(200, now + 0.03);
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.03);
        } catch { /* silencia */ }
    }

    // ── Recarga ───────────────────────────────────────────────────────────────
    reloadStart() {
        try {
            const ctx = this.getCtx();
            const now = ctx.currentTime;

            // Clique de ejeção do pente
            this.metalClick(ctx, now, 0.3, 600);
            // Som de deslize metálico
            this.metalSlide(ctx, now + 0.05);
            // Clique de encaixe do pente novo
            this.metalClick(ctx, now + 1.6, 0.5, 300);
            // Clic final de armação (slide)
            this.metalSlide(ctx, now + 1.75);
            this.metalClick(ctx, now + 1.9, 0.4, 500);
        } catch { /* silencia */ }
    }

    reloadDone() {
        try {
            const ctx = this.getCtx();
            const now = ctx.currentTime;
            // Tom de confirmação suave
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.linearRampToValueAtTime(660, now + 0.08);
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.12);
        } catch { /* silencia */ }
    }

    // ── Passo do jogador ──────────────────────────────────────────────────────
    step(now: number, isMoving: boolean) {
        if (!isMoving) { this.stepTimer = 0; return; }
        this.stepTimer += 16; // ~60fps delta aproximado
        if (this.stepTimer < this.STEP_INTERVAL) return;
        this.stepTimer = 0;
        try {
            const ctx = this.getCtx();
            const t = ctx.currentTime;
            const bufSize = Math.floor(ctx.sampleRate * 0.04);
            const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < bufSize; i++) {
                data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
            }
            const noise = ctx.createBufferSource();
            noise.buffer = buf;
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 800 + Math.random() * 300;
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.18, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            noise.start(t);
            noise.stop(t + 0.04);
        } catch { /* silencia */ }
    }

    // ── Gemido de zumbi ───────────────────────────────────────────────────────
    zombieGroan() {
        try {
            const ctx = this.getCtx();
            const now = ctx.currentTime;
            const freq = 80 + Math.random() * 60;
            const dur  = 0.3 + Math.random() * 0.4;

            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, now);
            osc.frequency.linearRampToValueAtTime(freq * (0.7 + Math.random() * 0.4), now + dur);

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(600, now);
            filter.frequency.linearRampToValueAtTime(200, now + dur);
            filter.Q.value = 8;

            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.25, now + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + dur);
        } catch { /* silencia */ }
    }

    // ── Zumbi levando hit ─────────────────────────────────────────────────────
    zombieHit() {
        try {
            const ctx = this.getCtx();
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(200 + Math.random() * 100, now);
            osc.frequency.exponentialRampToValueAtTime(50, now + 0.15);
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.15);
        } catch { /* silencia */ }
    }

    // ── Zumbi morrendo ────────────────────────────────────────────────────────
    zombieDeath() {
        try {
            const ctx = this.getCtx();
            const now = ctx.currentTime;

            // Grito decrescente
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(250, now);
            osc.frequency.exponentialRampToValueAtTime(30, now + 0.5);
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 1200;
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.4, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.5);

            // Impacto de queda
            const bufSize = Math.floor(ctx.sampleRate * 0.1);
            const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
            const noise = ctx.createBufferSource();
            noise.buffer = buf;
            const nFilter = ctx.createBiquadFilter();
            nFilter.type = 'lowpass';
            nFilter.frequency.value = 400;
            const nGain = ctx.createGain();
            nGain.gain.setValueAtTime(0.35, now + 0.1);
            nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
            noise.connect(nFilter);
            nFilter.connect(nGain);
            nGain.connect(ctx.destination);
            noise.start(now + 0.1);
            noise.stop(now + 0.3);
        } catch { /* silencia */ }
    }

    // ── Dano ao jogador ───────────────────────────────────────────────────────
    playerHurt() {
        try {
            const ctx = this.getCtx();
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.2);
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.4, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.2);
        } catch { /* silencia */ }
    }

    // ── Morte do jogador ──────────────────────────────────────────────────────
    playerDeath() {
        try {
            const ctx = this.getCtx();
            const now = ctx.currentTime;
            // Queda dramática de frequência
            for (let i = 0; i < 3; i++) {
                const osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(400 - i * 80, now + i * 0.15);
                osc.frequency.exponentialRampToValueAtTime(30, now + i * 0.15 + 0.3);
                const gain = ctx.createGain();
                gain.gain.setValueAtTime(0.3, now + i * 0.15);
                gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.3);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + i * 0.15);
                osc.stop(now + i * 0.15 + 0.3);
            }
        } catch { /* silencia */ }
    }

    destroy() {
        try { this.ctx?.close(); } catch { /* silencia */ }
        this.ctx = null;
    }

    // ── Helpers privados ──────────────────────────────────────────────────────

    private metalClick(ctx: AudioContext, when: number, vol: number, freq: number) {
        const bufSize = Math.floor(ctx.sampleRate * 0.02);
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
        const noise = ctx.createBufferSource();
        noise.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = freq;
        filter.Q.value = 5;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(vol, when);
        gain.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        noise.start(when);
        noise.stop(when + 0.05);
    }

    private metalSlide(ctx: AudioContext, when: number) {
        const bufSize = Math.floor(ctx.sampleRate * 0.12);
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * 0.3;
        const noise = ctx.createBufferSource();
        noise.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(3000, when);
        filter.frequency.linearRampToValueAtTime(800, when + 0.12);
        filter.Q.value = 3;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, when);
        gain.gain.linearRampToValueAtTime(0.25, when + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        noise.start(when);
        noise.stop(when + 0.12);
    }
}