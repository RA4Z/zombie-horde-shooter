import { EventBus } from '../EventBus';

export interface PlayerScore {
    id: string;
    name: string;
    score: number;
    kills: number;
    highestWave: number;
    alive: boolean;
}

/**
 * Rastreia pontuação e eliminações por jogador.
 * Rodado pelo HOST; estado sincronizado via rede.
 *
 * Pontuação:
 *  - +10 por zumbi eliminado
 *  - +50 por horda completada (todos os jogadores vivos recebem)
 *  - +100 bônus a cada 5 hordas
 */
export class ScoreManager {
    private scores: Map<string, PlayerScore> = new Map();

    registerPlayer(id: string, name: string) {
        if (!this.scores.has(id)) {
            this.scores.set(id, { id, name, score: 0, kills: 0, highestWave: 0, alive: true });
        }
    }

    addKill(playerId: string, currentWave: number) {
        const p = this.scores.get(playerId);
        if (!p) return;
        p.kills++;
        p.score += 10;
        p.highestWave = Math.max(p.highestWave, currentWave);
        this.emit();
    }

    /** Chamado quando uma horda termina — bonifica jogadores vivos */
    onWaveComplete(wave: number) {
        const bonus = wave % 5 === 0 ? 150 : 50;
        this.scores.forEach(p => {
            if (p.alive) {
                p.score += bonus;
                p.highestWave = Math.max(p.highestWave, wave);
            }
        });
        this.emit();
    }

    markDead(playerId: string) {
        const p = this.scores.get(playerId);
        if (p) { p.alive = false; this.emit(); }
    }

    markAlive(playerId: string) {
        const p = this.scores.get(playerId);
        if (p) { p.alive = true; this.emit(); }
    }

    allDead(): boolean {
        return [...this.scores.values()].every(p => !p.alive);
    }

    getLeaderboard(): PlayerScore[] {
        return [...this.scores.values()].sort((a, b) => b.score - a.score);
    }

    /** Restaura snapshot recebido do host */
    applySnapshot(scores: PlayerScore[]) {
        this.scores.clear();
        scores.forEach(s => this.scores.set(s.id, { ...s }));
        this.emit();
    }

    reset() {
        this.scores.forEach(p => {
            p.score = 0; p.kills = 0; p.highestWave = 0; p.alive = true;
        });
        this.emit();
    }

    private emit() {
        EventBus.emit('score-update', this.getLeaderboard());
    }
}