import { EventBus } from '../EventBus';

export interface HordeState {
    wave: number;
    zombiesRemaining: number;
    zombiesTotal: number;
    phase: 'fighting' | 'countdown' | 'idle';
    countdown: number; // segundos restantes
}

/**
 * Gerencia o sistema de hordas infinitas.
 *
 * Regras:
 *  - Cada horda tem (BASE_COUNT + wave * SCALE_PER_WAVE) zumbis
 *  - A cada 5 hordas, o HP dos zumbis aumenta em HP_BONUS_PER_5_WAVES
 *  - Entre hordas: countdown de 10s antes de iniciar a próxima
 *  - Só o HOST executa a lógica; clientes recebem via rede
 */
export class HordeManager {
    private static readonly BASE_COUNT        = 5;
    private static readonly SCALE_PER_WAVE    = 3;
    private static readonly BASE_HP           = 1;
    private static readonly HP_BONUS_INTERVAL = 5;
    private static readonly HP_BONUS_VALUE    = 1; // +1 hit para matar a cada 5 hordas
    private static readonly COUNTDOWN_SECS    = 10;
    private static readonly SPAWN_INTERVAL_MS = 800; // ms entre spawns individuais

    wave            = 0;
    zombieHp        = HordeManager.BASE_HP;
    phase: HordeState['phase'] = 'idle';

    private zombiesAlive     = 0;
    private zombiesSpawned   = 0;
    private zombiesThisWave  = 0;
    private countdownSecs    = 0;
    private countdownTimer: ReturnType<typeof setInterval> | null = null;
    private spawnTimer:     ReturnType<typeof setInterval> | null = null;

    /** Callback chamado pelo HordeManager para spawnar um zumbi */
    onSpawnZombie: (() => void) | null = null;
    /** Callback chamado quando o estado muda (para broadcast de rede) */
    onStateChange: ((state: HordeState) => void) | null = null;

    // ─────────────────────────────────────────────────────────────────────────

    /** Inicia o sistema (primeira contagem regressiva) */
    start() {
        this.beginCountdown();
    }

    /** Deve ser chamado pelo Game toda vez que um zumbi morre */
    onZombieDied() {
        this.zombiesAlive = Math.max(0, this.zombiesAlive - 1);
        this.broadcastState();

        if (this.zombiesAlive === 0 && this.zombiesSpawned >= this.zombiesThisWave) {
            this.beginCountdown();
        }
    }

    /** Restaura o estado recebido do host (clientes) */
    applyNetworkState(state: HordeState) {
        this.wave          = state.wave;
        this.zombiesAlive  = state.zombiesRemaining;
        this.phase         = state.phase;
        this.countdownSecs = state.countdown;
        EventBus.emit('horde-state', state);
    }

    destroy() {
        this.clearTimers();
    }

    getState(): HordeState {
        return {
            wave:             this.wave,
            zombiesRemaining: this.zombiesAlive,
            zombiesTotal:     this.zombiesThisWave,
            phase:            this.phase,
            countdown:        this.countdownSecs,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────

    private beginCountdown() {
        this.clearTimers();
        this.phase         = 'countdown';
        this.countdownSecs = HordeManager.COUNTDOWN_SECS;
        this.broadcastState();

        this.countdownTimer = setInterval(() => {
            this.countdownSecs--;
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
        this.zombiesThisWave = HordeManager.BASE_COUNT + (this.wave - 1) * HordeManager.SCALE_PER_WAVE;
        this.zombiesSpawned  = 0;
        this.zombiesAlive    = 0;
        this.phase           = 'fighting';

        // HP aumenta a cada 5 hordas
        this.zombieHp = HordeManager.BASE_HP +
            Math.floor((this.wave - 1) / HordeManager.HP_BONUS_INTERVAL) * HordeManager.HP_BONUS_VALUE;

        this.broadcastState();

        // Spawna os zumbis espaçados para não travar a rede
        this.spawnTimer = setInterval(() => {
            if (this.zombiesSpawned >= this.zombiesThisWave) {
                clearInterval(this.spawnTimer!);
                this.spawnTimer = null;
                return;
            }
            this.zombiesSpawned++;
            this.zombiesAlive++;
            this.onSpawnZombie?.();
        }, HordeManager.SPAWN_INTERVAL_MS);
    }

    private broadcastState() {
        const state = this.getState();
        EventBus.emit('horde-state', state);        // para React local
        this.onStateChange?.(state);                // para broadcast de rede
    }

    private clearTimers() {
        if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
        if (this.spawnTimer)     { clearInterval(this.spawnTimer);     this.spawnTimer     = null; }
    }
}