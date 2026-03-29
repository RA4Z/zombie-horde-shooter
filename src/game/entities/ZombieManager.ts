import { cartesianToIso } from '../utils/IsoMath';
import { createZombieFrames, angleToDir8, radToDeg } from './CharacterRenderer';
import { CharacterAnimator } from './CharacterAnimator';

export interface PlayerPosition {
    id: string;
    x: number;
    y: number;
}

/**
 * ZombieManager — spawn, HP, movimento e animação direcional dos zumbis.
 *
 * FIX 1 — Hitbox: aumentada para cobrir o corpo inteiro do zumbi (18×28).
 * FIX 2 — Seguir player: buildAlivePlayerList() já passa coordenadas
 *          cartesianas; a conversão isoToCartesian foi removida daqui para
 *          evitar double-conversion. O alvo é calculado em ISO igual ao
 *          zombie.x/y, convertendo px/py também para ISO antes de comparar.
 */
export class ZombieManager {
    readonly group: Phaser.Physics.Arcade.Group;
    readonly zombiesMap: Map<string, Phaser.GameObjects.Container> = new Map();

    private hpMap: Map<string, number> = new Map();
    private animMap: Map<string, CharacterAnimator> = new Map();
    private lastPos: Map<string, { x: number; y: number; t: number }> = new Map();
    private stuckUntil: Map<string, number> = new Map();
    private stuckDelta: Map<string, { vx: number; vy: number }> = new Map();
    private moveAngle: Map<string, number> = new Map();

    // FIX: hitbox agora cobre o corpo inteiro (largura 18, altura 28)
    private static readonly BODY_W = 18;
    private static readonly BODY_H = 28;
    private static readonly SPEED = 90;
    private static readonly STUCK_CHECK_MS = 600;
    private static readonly STUCK_THRESHOLD = 4;
    private static readonly STUCK_EVADE_MS = 800;

    constructor(private scene: Phaser.Scene) {
        this.group = scene.physics.add.group();
    }

    spawn(id: string, worldX: number, worldY: number, hp = 1): Phaser.GameObjects.Container {
        if (this.zombiesMap.has(id)) return this.zombiesMap.get(id)!;

        const { isoX, isoY } = cartesianToIso(worldX, worldY);

        const wrapper = this.scene.add.container(isoX, isoY);

        const frameSet = createZombieFrames(this.scene);
        const animator = new CharacterAnimator(this.scene, frameSet, wrapper);
        this.animMap.set(id, animator);

        this.scene.physics.add.existing(wrapper);
        const phys = wrapper.body as Phaser.Physics.Arcade.Body;

        // FIX: hitbox cobre corpo inteiro — offsetY ajustado para centrar verticalmente
        phys.setSize(ZombieManager.BODY_W, ZombieManager.BODY_H);
        phys.setOffset(-ZombieManager.BODY_W / 2, -ZombieManager.BODY_H + 4);
        phys.setCollideWorldBounds(false);
        phys.setBounce(0.1);

        this.group.add(wrapper);
        this.zombiesMap.set(id, wrapper);
        this.hpMap.set(id, hp);
        this.moveAngle.set(id, 0);
        this.lastPos.set(id, { x: isoX, y: isoY, t: Date.now() });

        wrapper.setData('maxHp', hp);
        wrapper.setData('hpFrac', 1);
        wrapper.setData('animId', id);

        return wrapper;
    }

    hit(id: string): boolean {
        const current = this.hpMap.get(id);
        if (current === undefined) return false;
        const next = current - 1;
        this.hpMap.set(id, next);

        const zombie = this.zombiesMap.get(id);
        if (zombie) {
            const maxHp = zombie.getData('maxHp') as number;
            const frac = Math.max(0, next / maxHp);
            const anim = this.animMap.get(id);
            if (anim) {
                anim.setHpFraction(frac);
                anim.flashHit();
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
        this.animMap.delete(id);
        this.lastPos.delete(id);
        this.stuckUntil.delete(id);
        this.stuckDelta.delete(id);
        this.moveAngle.delete(id);
    }

    removeAll() {
        this.zombiesMap.forEach(z => z.destroy());
        this.zombiesMap.clear();
        this.hpMap.clear();
        this.animMap.clear();
        this.lastPos.clear();
        this.stuckUntil.clear();
        this.stuckDelta.clear();
        this.moveAngle.clear();
    }

    /**
     * Host: move zumbis em direção ao alvo + atualiza animação direcional.
     *
     * FIX: players[].x/y são coordenadas CARTESIANAS (vindas de playerData.x/y).
     * Convertemos para ISO aqui antes de comparar com zombie.x/y (que já estão em ISO).
     */
    updateHost(players: PlayerPosition[], delta = 16) {
        const now = Date.now();

        this.zombiesMap.forEach((zombie, id) => {
            const phys = zombie.body as Phaser.Physics.Arcade.Body;

            if (players.length === 0) {
                phys.setVelocity(0, 0);
                const anim = this.animMap.get(id);
                anim?.update(delta, false, this.moveAngle.get(id) ?? 0);
                return;
            }

            // FIX: converte posição do player de cartesiano para ISO antes de calcular distância
            let tx = 0, ty = 0, minDist = Infinity;
            for (const p of players) {
                const { isoX: px, isoY: py } = cartesianToIso(p.x, p.y);
                const d = Math.hypot(zombie.x - px, zombie.y - py);
                if (d < minDist) { minDist = d; tx = px; ty = py; }
            }

            const dx = tx - zombie.x, dy = ty - zombie.y;
            const dist = Math.hypot(dx, dy);

            let vx = 0, vy = 0, isMoving = false;

            if (now < (this.stuckUntil.get(id) ?? 0)) {
                // Evasão ativa
                const sd = this.stuckDelta.get(id)!;
                vx = sd.vx; vy = sd.vy; isMoving = true;
            } else if (dist > 4) {
                // Direção ao player
                vx = (dx / dist) * ZombieManager.SPEED;
                vy = (dy / dist) * ZombieManager.SPEED;
                isMoving = true;
            }

            // Verifica stuck com threshold menor (2px) para detectar mais rápido
            const lp = this.lastPos.get(id);
            if (lp && (now - lp.t) >= ZombieManager.STUCK_CHECK_MS) {
                const moved = Math.hypot(zombie.x - lp.x, zombie.y - lp.y);
                if (moved < 2 && isMoving) { // stuck!
                    // Tenta 3 ângulos de evasão e escolhe o mais diferente da parede
                    const baseAngle = Math.atan2(dy, dx);
                    const offsets = [1.0, -1.0, 1.6, -1.6, Math.PI * 0.8];
                    const evadeOff = offsets[Math.floor(Math.random() * offsets.length)];
                    const evadeAngle = baseAngle + evadeOff;
                    this.stuckUntil.set(id, now + ZombieManager.STUCK_EVADE_MS);
                    this.stuckDelta.set(id, {
                        vx: Math.cos(evadeAngle) * ZombieManager.SPEED * 1.2,
                        vy: Math.sin(evadeAngle) * ZombieManager.SPEED * 1.2,
                    });
                }
                this.lastPos.set(id, { x: zombie.x, y: zombie.y, t: now });
            } else if (!lp) {
                this.lastPos.set(id, { x: zombie.x, y: zombie.y, t: now });
            }

            phys.setVelocity(vx, vy);

            const angle = isMoving ? Math.atan2(vy, vx) : (this.moveAngle.get(id) ?? 0);
            if (isMoving) this.moveAngle.set(id, angle);

            const anim = this.animMap.get(id);
            anim?.update(delta, isMoving, angle);

            zombie.setDepth(zombie.y);
        });
    }

    /**
     * Cliente: interpola posições recebidas do host + atualiza animação.
     */
    interpolateClient(lerpFactor = 0.15, delta = 16) {
        this.zombiesMap.forEach((zombie, id) => {
            const tx: number | undefined = zombie.getData('targetX');
            const ty: number | undefined = zombie.getData('targetY');
            if (tx === undefined || ty === undefined) return;

            const prevX = zombie.x, prevY = zombie.y;
            zombie.setPosition(
                Phaser.Math.Linear(zombie.x, tx, lerpFactor),
                Phaser.Math.Linear(zombie.y, ty, lerpFactor),
            );
            zombie.setDepth(zombie.y);

            const dx = zombie.x - prevX, dy = zombie.y - prevY;
            const dist = Math.hypot(dx, dy);
            const isMoving = dist > 0.3;
            const angle = isMoving ? Math.atan2(dy, dx) : (this.moveAngle.get(id) ?? 0);
            if (isMoving) this.moveAngle.set(id, angle);

            const anim = this.animMap.get(id);
            anim?.update(delta, isMoving, angle);
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