import { EventBus } from '../EventBus';

export type VoteChoice = 'restart' | 'leave';

export interface VoteState {
    votes: Record<string, VoteChoice>;
    totalPlayers: number;
    timeLeft: number;   // segundos
}

/**
 * Sistema de votação pós-game (host-side).
 *
 * Regras:
 *  - 30 segundos para todos votarem
 *  - Quem não votar é considerado "leave" ao expirar
 *  - Se todos votarem antes dos 30s, resolve imediatamente
 *  - Resultado: "restart" se QUALQUER jogador viu restart; o resto sai
 */
export class VoteManager {
    private static readonly VOTE_TIMEOUT = 30;

    private votes: Map<string, VoteChoice> = new Map();
    private players: Set<string> = new Set();
    private timeLeft = VoteManager.VOTE_TIMEOUT;
    private timer: ReturnType<typeof setInterval> | null = null;
    private resolved = false;

    onRestart: ((staying: string[]) => void) | null = null;
    onAllLeave: (() => void) | null = null;

    start(playerIds: string[]) {
        this.votes.clear();
        this.players = new Set(playerIds);
        this.timeLeft = VoteManager.VOTE_TIMEOUT;
        this.resolved = false;

        this.broadcastState();

        this.timer = setInterval(() => {
            this.timeLeft--;
            this.broadcastState();
            if (this.timeLeft <= 0) this.resolve(true);
        }, 1000);
    }

    castVote(playerId: string, choice: VoteChoice) {
        if (this.resolved) return;
        this.votes.set(playerId, choice);
        this.broadcastState();

        // Resolve imediatamente se todos votaram
        if (this.votes.size >= this.players.size) {
            this.resolve(false);
        }
    }

    destroy() {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }

    getState(): VoteState {
        const votes: Record<string, VoteChoice> = {};
        this.votes.forEach((v, k) => { votes[k] = v; });
        return { votes, totalPlayers: this.players.size, timeLeft: this.timeLeft };
    }

    applyNetworkState(state: VoteState) {
        this.timeLeft = state.timeLeft;
        EventBus.emit('vote-state', state);
    }

    // ─────────────────────────────────────────────────────────────────────────

    private resolve(timeout: boolean) {
        if (this.resolved) return;
        this.resolved = true;
        if (this.timer) { clearInterval(this.timer); this.timer = null; }

        // Quem não votou → leave (timeout)
        if (timeout) {
            this.players.forEach(id => {
                if (!this.votes.has(id)) this.votes.set(id, 'leave');
            });
        }

        const staying = [...this.players].filter(id => this.votes.get(id) === 'restart');

        EventBus.emit('vote-resolved', { staying });

        if (staying.length > 0) {
            this.onRestart?.(staying);
        } else {
            this.onAllLeave?.();
        }
    }

    private broadcastState() {
        EventBus.emit('vote-state', this.getState());
    }
}