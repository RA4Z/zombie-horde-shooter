import { EventBus } from '../EventBus';

export interface HordeState {
    wave: number;
    zombiesRemaining: number;
    zombiesTotal: number;
    phase: 'fighting' | 'countdown' | 'idle';
    countdown: number;
}

/**
 * HordeManager — sistema de hordas infinitas.
 *
 * FIX: onWaveComplete é chamado UMA ÚNICA VEZ por horda, no momento em que
 * o último zumbi morre (ANTES do countdown). onStateChange apenas replica
 * o estado pela rede — ele NUNCA aciona bônus de pontuação.
 */
export class HordeManager {
    private static readonly BASE_COUNT        = 5;
    private static readonly SCALE_PER_WAVE    = 3;
    private static readonly BASE_HP           = 1;
    private static readonly HP_BONUS_INTERVAL = 5;
    private static readonly HP_BONUS_VALUE    = 1;
    private static readonly COUNTDOWN_SECS    = 10;
    private static readonly SPAWN_INTERVAL_MS = 800;

    wave            = 0;
    zombieHp        = HordeManager.BASE_HP;
    phase: HordeState['phase'] = 'idle';

    private zombiesAlive     = 0;
    private zombiesSpawned   = 0;
    private zombiesThisWave  = 0;
    private countdownSecs    = 0;
    private countdownTimer:  ReturnType<typeof setInterval> | null = null;
    private spawnTimer:      ReturnType<typeof setInterval> | null = null;
    private waveCompleteFired = false;   // guard: dispara bônus só 1x por horda

    /** Chamado para fazer spawn de um zumbi (host only) */
    onSpawnZombie: (() => void) | null = null;
    /** Chamado para broadcast de rede — NÃO deve acionar pontuação */
    onStateChange: ((state: HordeState) => void) | null = null;
    /** Chamado UMA VEZ quando todos os zumbis da horda morreram */
    onWaveComplete: ((wave: number) => void) | null = null;

    start() {
        this.clearTimers();
        this.wave             = 0;
        this.zombieHp         = HordeManager.BASE_HP;
        this.zombiesAlive     = 0;
        this.zombiesSpawned   = 0;
        this.zombiesThisWave  = 0;
        this.phase            = 'idle';
        this.waveCompleteFired = false;
        this.beginCountdown();
    }

    onZombieDied() {
        this.zombiesAlive = Math.max(0, this.zombiesAlive - 1);
        this.broadcastState();

        const allSpawned  = this.zombiesSpawned >= this.zombiesThisWave;
        const allDead     = this.zombiesAlive === 0;
        const fighting    = this.phase === 'fighting';

        if (fighting && allSpawned && allDead && !this.waveCompleteFired) {
            this.waveCompleteFired = true;
            // Bônus ANTES do countdown
            this.onWaveComplete?.(this.wave);
            this.beginCountdown();
        }
    }

    applyNetworkState(state: HordeState) {
        this.wave          = state.wave;
        this.zombiesAlive  = state.zombiesRemaining;
        this.phase         = state.phase;
        this.countdownSecs = state.countdown;
        EventBus.emit('horde-state', state);
    }

    destroy() { this.clearTimers(); }

    getState(): HordeState {
        return {
            wave:             this.wave,
            zombiesRemaining: this.zombiesAlive,
            zombiesTotal:     this.zombiesThisWave,
            phase:            this.phase,
            countdown:        this.countdownSecs,
        };
    }

    private beginCountdown() {
        this.clearTimers();
        this.phase         = 'countdown';
        this.countdownSecs = HordeManager.COUNTDOWN_SECS;
        this.broadcastState();

        this.countdownTimer = setInterval(() => {
            this.countdownSecs = Math.max(0, this.countdownSecs - 1);
            this.broadcastState();
            if (this.countdownSecs <= 0) {
                clearInterval(this.countdownTimer!);
                this.countdownTimer = null;
                this.startNextWave();
            }
        }, 1000);
    }

    private startNextWave() {
        this.wave++;
        this.zombiesThisWave  = HordeManager.BASE_COUNT + (this.wave - 1) * HordeManager.SCALE_PER_WAVE;
        this.zombiesSpawned   = 0;
        this.zombiesAlive     = 0;
        this.phase            = 'fighting';
        this.waveCompleteFired = false;

        this.zombieHp = HordeManager.BASE_HP +
            Math.floor((this.wave - 1) / HordeManager.HP_BONUS_INTERVAL) * HordeManager.HP_BONUS_VALUE;

        this.broadcastState();

        this.spawnTimer = setInterval(() => {
            if (this.zombiesSpawned >= this.zombiesThisWave) {
                clearInterval(this.spawnTimer!);
                this.spawnTimer = null;
                return;
            }
            this.zombiesSpawned++;
            this.zombiesAlive++;
            this.onSpawnZombie?.();
            this.broadcastState();
        }, HordeManager.SPAWN_INTERVAL_MS);
    }

    private broadcastState() {
        const state = this.getState();
        EventBus.emit('horde-state', state);     // → React local
        this.onStateChange?.(state);             // → rede (NÃO pontuação)
    }

    private clearTimers() {
        if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
        if (this.spawnTimer)     { clearInterval(this.spawnTimer);     this.spawnTimer     = null; }
    }
}