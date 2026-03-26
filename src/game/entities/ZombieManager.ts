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
 * FIX TypeScript: Phaser.GameObjects.Graphics NÃO tem setTint/clearTint.
 * O flash de hit é feito via CharacterAnimator.flashHit() que acessa o
 * Graphics correto e usa setTint internamente com type assertion segura.
 *
 * Movimento: setVelocity() a cada frame + anti-stuck perpendicular.
 */
export class ZombieManager {
    readonly group: Phaser.Physics.Arcade.Group;
    readonly zombiesMap: Map<string, Phaser.GameObjects.Container> = new Map();

    private hpMap:      Map<string, number>              = new Map();
    private animMap:    Map<string, CharacterAnimator>   = new Map();
    private lastPos:    Map<string, { x: number; y: number; t: number }> = new Map();
    private stuckUntil: Map<string, number>              = new Map();
    private stuckDelta: Map<string, { vx: number; vy: number }> = new Map();
    // Armazena o ângulo de movimento atual para animar na direção certa
    private moveAngle:  Map<string, number>              = new Map();

    private static readonly BODY_W          = 12;
    private static readonly BODY_H          = 8;
    private static readonly SPEED           = 90;
    private static readonly STUCK_CHECK_MS  = 600;
    private static readonly STUCK_THRESHOLD = 4;
    private static readonly STUCK_EVADE_MS  = 800;

    constructor(private scene: Phaser.Scene) {
        this.group = scene.physics.add.group();
    }

    spawn(id: string, worldX: number, worldY: number, hp = 1): Phaser.GameObjects.Container {
        if (this.zombiesMap.has(id)) return this.zombiesMap.get(id)!;

        const { isoX, isoY } = cartesianToIso(worldX, worldY);

        // Container wrapper — NÃO tem scaleY aqui; frames já são slim corretos
        const wrapper = this.scene.add.container(isoX, isoY);

        // Cria frames de animação e adiciona ao wrapper
        const frameSet  = createZombieFrames(this.scene);
        const animator  = new CharacterAnimator(this.scene, frameSet, wrapper);
        this.animMap.set(id, animator);

        // HP bar já está no frameSet
        if (frameSet.hpBar) {
            // A barra está posicionada em y=-35 no CharacterRenderer
        }

        this.scene.physics.add.existing(wrapper);
        const phys = wrapper.body as Phaser.Physics.Arcade.Body;
        phys.setSize(ZombieManager.BODY_W, ZombieManager.BODY_H);
        phys.setOffset(-ZombieManager.BODY_W / 2, -ZombieManager.BODY_H / 2 + 2);
        phys.setCollideWorldBounds(false);
        phys.setBounce(0.1);

        this.group.add(wrapper);
        this.zombiesMap.set(id, wrapper);
        this.hpMap.set(id, hp);
        this.moveAngle.set(id, 0);
        this.lastPos.set(id, { x: isoX, y: isoY, t: Date.now() });

        wrapper.setData('maxHp',    hp);
        wrapper.setData('hpFrac',   1);
        wrapper.setData('animId',   id);

        return wrapper;
    }

    /**
     * FIX: Phaser.GameObjects.Graphics não tem setTint/clearTint.
     * O flash de hit é delegado ao CharacterAnimator que usa type assertion
     * (gfx as any).setTint() internamente — seguro porque Phaser Canvas/WebGL
     * suportam tint em Graphics na prática, só não está tipado.
     */
    hit(id: string): boolean {
        const current = this.hpMap.get(id);
        if (current === undefined) return false;
        const next = current - 1;
        this.hpMap.set(id, next);

        const zombie = this.zombiesMap.get(id);
        if (zombie) {
            const maxHp   = zombie.getData('maxHp') as number;
            const frac    = Math.max(0, next / maxHp);
            // Atualiza HP bar via animator
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

            // Alvo mais próximo em ISO
            let tx = 0, ty = 0, minDist = Infinity;
            for (const p of players) {
                const { isoX: px, isoY: py } = cartesianToIso(p.x, p.y);
                const d = Math.hypot(zombie.x - px, zombie.y - py);
                if (d < minDist) { minDist = d; tx = px; ty = py; }
            }

            // Verifica stuck
            const lp = this.lastPos.get(id);
            if (lp && (now - lp.t) >= ZombieManager.STUCK_CHECK_MS) {
                const moved = Math.hypot(zombie.x - lp.x, zombie.y - lp.y);
                if (moved < ZombieManager.STUCK_THRESHOLD) {
                    const dx = tx - zombie.x, dy = ty - zombie.y;
                    const baseAngle = Math.atan2(dy, dx);
                    // Alterna entre desvio esquerda (+70°) e direita (-70°) aleatoriamente
                    const evadeAngle = baseAngle + (Math.random() < 0.5 ? 1.2 : -1.2);
                    this.stuckUntil.set(id, now + ZombieManager.STUCK_EVADE_MS);
                    this.stuckDelta.set(id, {
                        vx: Math.cos(evadeAngle) * ZombieManager.SPEED,
                        vy: Math.sin(evadeAngle) * ZombieManager.SPEED,
                    });
                }
                this.lastPos.set(id, { x: zombie.x, y: zombie.y, t: now });
            } else if (!lp) {
                this.lastPos.set(id, { x: zombie.x, y: zombie.y, t: now });
            }

            // Velocidade
            let vx = 0, vy = 0, isMoving = false;
            if (now < (this.stuckUntil.get(id) ?? 0)) {
                const sd = this.stuckDelta.get(id)!;
                vx = sd.vx; vy = sd.vy; isMoving = true;
            } else {
                const dx = tx - zombie.x, dy = ty - zombie.y;
                const dist = Math.hypot(dx, dy);
                if (dist > 4) {
                    vx = (dx / dist) * ZombieManager.SPEED;
                    vy = (dy / dist) * ZombieManager.SPEED;
                    isMoving = true;
                }
            }
            phys.setVelocity(vx, vy);

            // Ângulo de movimento para animação direcional
            const angle = isMoving ? Math.atan2(vy, vx) : (this.moveAngle.get(id) ?? 0);
            if (isMoving) this.moveAngle.set(id, angle);

            // Atualiza animação
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