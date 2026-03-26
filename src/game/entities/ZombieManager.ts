import { cartesianToIso } from '../utils/IsoMath';

export interface PlayerPosition {
    id: string;
    x: number;
    y: number;
}

/**
 * ZombieManager
 *
 * Movimento via setVelocity() a cada frame — nunca trava após colisão.
 * Anti-stuck: se o zumbi não avançou em 1s, aplica um desvio aleatório
 * por 0.4s para sair de trás de cantos de prédios.
 */
export class ZombieManager {
    readonly group: Phaser.Physics.Arcade.Group;
    readonly zombiesMap: Map<string, Phaser.GameObjects.Container> = new Map();
    private hpMap:      Map<string, number> = new Map();
    // Anti-stuck: última posição registrada e timestamp
    private lastPos:    Map<string, { x: number; y: number; t: number }> = new Map();
    private stuckUntil: Map<string, number> = new Map();
    private stuckDelta: Map<string, { vx: number; vy: number }> = new Map();

    private static readonly DRAW_SIZE = 12;
    private static readonly BODY_W    = 16;
    private static readonly BODY_H    = 8;
    private static readonly SPEED     = 65;   // px/s em espaço ISO
    private static readonly STUCK_CHECK_MS  = 1000; // verifica a cada 1s
    private static readonly STUCK_THRESHOLD = 3;    // px — se moveu menos que isso → stuck
    private static readonly STUCK_EVADE_MS  = 500;  // dura o desvio por 0.5s

    constructor(private scene: Phaser.Scene) {
        this.group = scene.physics.add.group();
    }

    spawn(id: string, worldX: number, worldY: number, hp = 1): Phaser.GameObjects.Container {
        if (this.zombiesMap.has(id)) return this.zombiesMap.get(id)!;

        const { isoX, isoY } = cartesianToIso(worldX, worldY);

        const shadow  = this.scene.add.ellipse(0, 5, 16, 6, 0x000000, 0.3);
        const body    = this.scene.add.rectangle(0, 0, ZombieManager.DRAW_SIZE, ZombieManager.DRAW_SIZE, 0x3a5500).setAngle(45);
        const head    = this.scene.add.ellipse(0, -7, 9, 6, 0x2d4400);
        const hpBg    = this.scene.add.rectangle(0, -13, 16, 2, 0x550000).setOrigin(0.5, 0.5);
        const hpBar   = this.scene.add.rectangle(-8, -13, 16, 2, 0x44ff44).setOrigin(0, 0.5);

        const container = this.scene.add.container(isoX, isoY, [shadow, body, head, hpBg, hpBar]);
        container.setScale(1, 0.55);

        this.scene.physics.add.existing(container);
        const phys = container.body as Phaser.Physics.Arcade.Body;
        phys.setSize(ZombieManager.BODY_W, ZombieManager.BODY_H);
        phys.setOffset(-ZombieManager.BODY_W / 2, -ZombieManager.BODY_H / 2);
        phys.setCollideWorldBounds(false);
        // Zumbi desliza ao bater em parede (não para completamente)
        phys.setBounce(0.1);

        this.group.add(container);
        this.zombiesMap.set(id, container);
        this.hpMap.set(id, hp);
        this.lastPos.set(id, { x: isoX, y: isoY, t: Date.now() });

        container.setData('worldX', worldX);
        container.setData('worldY', worldY);
        container.setData('maxHp', hp);
        container.setData('hpBarRef', hpBar);
        container.setData('bodyRef', body);

        return container;
    }

    hit(id: string): boolean {
        const current = this.hpMap.get(id);
        if (current === undefined) return false;
        const next = current - 1;
        this.hpMap.set(id, next);

        const zombie = this.zombiesMap.get(id);
        if (zombie) {
            const maxHp    = zombie.getData('maxHp') as number;
            const hpBar    = zombie.getData('hpBarRef') as Phaser.GameObjects.Rectangle | undefined;
            const bodyRect = zombie.getData('bodyRef') as Phaser.GameObjects.Rectangle | undefined;
            if (hpBar)    hpBar.width = Math.max(0, 16 * (next / maxHp));
            if (bodyRect) {
                bodyRect.setFillStyle(0xff2200);
                this.scene.time.delayedCall(80, () => bodyRect?.setFillStyle(0x3a5500));
            }
        }
        return next <= 0;
    }

    remove(id: string) {
        const z = this.zombiesMap.get(id);
        if (!z) return;
        z.destroy();
        this.zombiesMap.delete(id);
        this.hpMap.delete(id);
        this.lastPos.delete(id);
        this.stuckUntil.delete(id);
        this.stuckDelta.delete(id);
    }

    removeAll() {
        this.zombiesMap.forEach(z => z.destroy());
        this.zombiesMap.clear();
        this.hpMap.clear();
        this.lastPos.clear();
        this.stuckUntil.clear();
        this.stuckDelta.clear();
    }

    /**
     * Host: move cada zumbi em direção ao jogador mais próximo.
     * setVelocity() a cada frame → nunca trava permanentemente.
     * Anti-stuck: detecta imobilidade e aplica velocidade de desvio.
     */
    updateHost(players: PlayerPosition[]) {
        const now = Date.now();

        this.zombiesMap.forEach((zombie, id) => {
            const phys = zombie.body as Phaser.Physics.Arcade.Body;

            if (players.length === 0) {
                phys.setVelocity(0, 0);
                return;
            }

            // ── Encontra alvo mais próximo (em ISO) ─────────────────────────
            let tx = 0, ty = 0, minDist = Infinity;
            for (const p of players) {
                const { isoX: px, isoY: py } = cartesianToIso(p.x, p.y);
                const d = Math.hypot(zombie.x - px, zombie.y - py);
                if (d < minDist) { minDist = d; tx = px; ty = py; }
            }

            // ── Verifica se está travado ─────────────────────────────────────
            const lp = this.lastPos.get(id);
            if (lp && (now - lp.t) >= ZombieManager.STUCK_CHECK_MS) {
                const moved = Math.hypot(zombie.x - lp.x, zombie.y - lp.y);
                if (moved < ZombieManager.STUCK_THRESHOLD) {
                    // Escolhe desvio perpendicular aleatório
                    const dx  = tx - zombie.x;
                    const dy  = ty - zombie.y;
                    const len = Math.hypot(dx, dy) || 1;
                    // Perpendicular: rotaciona 90° para um lado aleatório
                    const sign = Math.random() < 0.5 ? 1 : -1;
                    const pvx  =  (-dy / len) * sign * ZombieManager.SPEED;
                    const pvy  =  ( dx / len) * sign * ZombieManager.SPEED;
                    this.stuckUntil.set(id, now + ZombieManager.STUCK_EVADE_MS);
                    this.stuckDelta.set(id, { vx: pvx, vy: pvy });
                }
                this.lastPos.set(id, { x: zombie.x, y: zombie.y, t: now });
            } else if (!lp) {
                this.lastPos.set(id, { x: zombie.x, y: zombie.y, t: now });
            }

            // ── Aplica velocidade ────────────────────────────────────────────
            const stuckExpiry = this.stuckUntil.get(id) ?? 0;
            if (now < stuckExpiry) {
                // Modo evasão — desloca perpendicularmente
                const sd = this.stuckDelta.get(id)!;
                phys.setVelocity(sd.vx, sd.vy);
            } else {
                // Modo normal — avança direto para o alvo
                const dx = tx - zombie.x;
                const dy = ty - zombie.y;
                const dist = Math.hypot(dx, dy);
                if (dist > 4) {
                    phys.setVelocity(
                        (dx / dist) * ZombieManager.SPEED,
                        (dy / dist) * ZombieManager.SPEED,
                    );
                } else {
                    phys.setVelocity(0, 0);
                }
            }

            zombie.setDepth(zombie.y);
        });
    }

    interpolateClient(lerpFactor = 0.15) {
        this.zombiesMap.forEach((zombie) => {
            const tx: number | undefined = zombie.getData('targetX');
            const ty: number | undefined = zombie.getData('targetY');
            if (tx === undefined || ty === undefined) return;
            zombie.setPosition(
                Phaser.Math.Linear(zombie.x, tx, lerpFactor),
                Phaser.Math.Linear(zombie.y, ty, lerpFactor),
            );
            zombie.setDepth(zombie.y);
        });
    }

    setTarget(id: string, isoX: number, isoY: number) {
        const z = this.zombiesMap.get(id);
        if (z) { z.setData('targetX', isoX); z.setData('targetY', isoY); }
    }

    setPosition(id: string, isoX: number, isoY: number) {
        const z = this.zombiesMap.get(id);
        if (!z) return;
        z.setPosition(isoX, isoY);
        z.setData('targetX', isoX);
        z.setData('targetY', isoY);
    }
}