import { cartesianToIso } from '../utils/IsoMath';
import { buildZombieSprite } from './ZombieSprite';

export interface PlayerPosition {
    id: string;
    x: number;
    y: number;
}

/**
 * ZombieManager — spawn, HP e movimento dos zumbis humanoides.
 *
 * Movimento via setVelocity() a cada frame → nunca para após colisão.
 * Anti-stuck: desvio perpendicular ao detectar imobilidade.
 */
export class ZombieManager {
    readonly group: Phaser.Physics.Arcade.Group;
    readonly zombiesMap: Map<string, Phaser.GameObjects.Container> = new Map();
    private hpMap:      Map<string, number> = new Map();
    private lastPos:    Map<string, { x: number; y: number; t: number }> = new Map();
    private stuckUntil: Map<string, number> = new Map();
    private stuckDelta: Map<string, { vx: number; vy: number }> = new Map();

    private static readonly BODY_W          = 14;
    private static readonly BODY_H          = 8;
    private static readonly SPEED           = 60;
    private static readonly STUCK_CHECK_MS  = 900;
    private static readonly STUCK_THRESHOLD = 2;
    private static readonly STUCK_EVADE_MS  = 600;

    constructor(private scene: Phaser.Scene) {
        this.group = scene.physics.add.group();
    }

    spawn(id: string, worldX: number, worldY: number, hp = 1): Phaser.GameObjects.Container {
        if (this.zombiesMap.has(id)) return this.zombiesMap.get(id)!;

        const { isoX, isoY } = cartesianToIso(worldX, worldY);

        // Sprite humanoide
        const { container: sprite, hpBarRef, bodyRef } = buildZombieSprite(this.scene, hp);
        sprite.setScale(1, 0.55); // achatamento isométrico

        const wrapper = this.scene.add.container(isoX, isoY, [sprite]);

        this.scene.physics.add.existing(wrapper);
        const phys = wrapper.body as Phaser.Physics.Arcade.Body;
        phys.setSize(ZombieManager.BODY_W, ZombieManager.BODY_H);
        phys.setOffset(-ZombieManager.BODY_W / 2, -ZombieManager.BODY_H / 2 + 8);
        phys.setCollideWorldBounds(false);
        phys.setBounce(0.1);

        this.group.add(wrapper);
        this.zombiesMap.set(id, wrapper);
        this.hpMap.set(id, hp);
        this.lastPos.set(id, { x: isoX, y: isoY, t: Date.now() });

        wrapper.setData('worldX', worldX);
        wrapper.setData('worldY', worldY);
        wrapper.setData('maxHp',  hp);
        wrapper.setData('hpBarRef', hpBarRef);
        wrapper.setData('bodyRef',  bodyRef);

        return wrapper;
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
            const bodyGfx  = zombie.getData('bodyRef')  as Phaser.GameObjects.Graphics  | undefined;
            if (hpBar)   hpBar.width = Math.max(0, 22 * (next / maxHp));
            if (bodyGfx) {
                // Flash vermelho: recolorir temporariamente
                bodyGfx.setTint(0xff4422);
                this.scene.time.delayedCall(90, () => bodyGfx?.clearTint());
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

    updateHost(players: PlayerPosition[]) {
        const now = Date.now();

        this.zombiesMap.forEach((zombie, id) => {
            const phys = zombie.body as Phaser.Physics.Arcade.Body;

            if (players.length === 0) { phys.setVelocity(0, 0); return; }

            // Alvo mais próximo em ISO
            let tx = 0, ty = 0, minDist = Infinity;
            for (const p of players) {
                const { isoX: px, isoY: py } = cartesianToIso(p.x, p.y);
                const d = Math.hypot(zombie.x - px, zombie.y - py);
                if (d < minDist) { minDist = d; tx = px; ty = py; }
            }

            // Verifica travamento
            const lp = this.lastPos.get(id);
            if (lp && (now - lp.t) >= ZombieManager.STUCK_CHECK_MS) {
                const moved = Math.hypot(zombie.x - lp.x, zombie.y - lp.y);
                if (moved < ZombieManager.STUCK_THRESHOLD) {
                    const dx = tx - zombie.x, dy = ty - zombie.y;
                    const len = Math.hypot(dx, dy) || 1;
                    const sign = Math.random() < 0.5 ? 1 : -1;
                    this.stuckUntil.set(id, now + ZombieManager.STUCK_EVADE_MS);
                    this.stuckDelta.set(id, {
                        vx: (-dy / len) * sign * ZombieManager.SPEED,
                        vy: ( dx / len) * sign * ZombieManager.SPEED,
                    });
                }
                this.lastPos.set(id, { x: zombie.x, y: zombie.y, t: now });
            } else if (!lp) {
                this.lastPos.set(id, { x: zombie.x, y: zombie.y, t: now });
            }

            // Aplica velocidade
            if (now < (this.stuckUntil.get(id) ?? 0)) {
                const sd = this.stuckDelta.get(id)!;
                phys.setVelocity(sd.vx, sd.vy);
            } else {
                const dx = tx - zombie.x, dy = ty - zombie.y;
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