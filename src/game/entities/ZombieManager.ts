import { cartesianToIso } from '../utils/IsoMath';
import { createZombieFrames, angleToDir8, radToDeg } from './CharacterRenderer';
import { CharacterAnimator } from './CharacterAnimator';

export interface PlayerPosition {
    id: string;
    x: number;
    y: number;
}

export class ZombieManager {
    readonly group: Phaser.Physics.Arcade.Group;
    readonly zombiesMap: Map<string, Phaser.GameObjects.Container> = new Map();

    private hpMap:      Map<string, number>            = new Map();
    private animMap:    Map<string, CharacterAnimator> = new Map();
    private lastPos:    Map<string, { x: number; y: number; t: number }> = new Map();
    private stuckUntil: Map<string, number>            = new Map();
    private stuckDelta: Map<string, { vx: number; vy: number }> = new Map();
    private moveAngle:  Map<string, number>            = new Map();

    // Hitbox cobre o corpo inteiro
    private static readonly BODY_W = 18;
    private static readonly BODY_H = 28;

    // Comportamento agressivo
    private static readonly SPEED           = 145;  // bem mais rápido que antes (era 90)
    private static readonly SPEED_SPRINT    = 195;  // sprint ao levar hit
    private static readonly STUCK_CHECK_MS  = 300;  // detecta stuck mais rápido (era 600)
    private static readonly STUCK_THRESHOLD = 2;    // threshold menor (era 4)
    private static readonly STUCK_EVADE_MS  = 450;  // evasão curta para retomar perseguição logo

    constructor(private scene: Phaser.Scene) {
        this.group = scene.physics.add.group();
    }

    spawn(id: string, worldX: number, worldY: number, hp = 1): Phaser.GameObjects.Container {
        if (this.zombiesMap.has(id)) return this.zombiesMap.get(id)!;

        const { isoX, isoY } = cartesianToIso(worldX, worldY);

        const wrapper  = this.scene.add.container(isoX, isoY);
        const frameSet = createZombieFrames(this.scene);
        const animator = new CharacterAnimator(this.scene, frameSet, wrapper);
        this.animMap.set(id, animator);

        this.scene.physics.add.existing(wrapper);
        const phys = wrapper.body as Phaser.Physics.Arcade.Body;
        phys.setSize(ZombieManager.BODY_W, ZombieManager.BODY_H);
        phys.setOffset(-ZombieManager.BODY_W / 2, -ZombieManager.BODY_H + 4);
        phys.setCollideWorldBounds(false);
        phys.setBounce(0);
        phys.setMaxVelocity(ZombieManager.SPEED_SPRINT, ZombieManager.SPEED_SPRINT);

        this.group.add(wrapper);
        this.zombiesMap.set(id, wrapper);
        this.hpMap.set(id, hp);
        this.moveAngle.set(id, 0);
        this.lastPos.set(id, { x: isoX, y: isoY, t: Date.now() });

        wrapper.setData('maxHp',     hp);
        wrapper.setData('animId',    id);
        // 30% dos zumbis já nascem em modo sprint
        wrapper.setData('sprinting', Math.random() < 0.3);

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
            const anim  = this.animMap.get(id);
            if (anim) {
                anim.setHpFraction(Math.max(0, next / maxHp));
                anim.flashHit();
            }
            // Levar hit faz o zumbi enfurecer
            zombie.setData('sprinting', true);
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
     * Host: perseguição agressiva com anti-stuck melhorado.
     * players[].x/y são CARTESIANOS — convertidos para ISO antes de usar.
     */
    updateHost(players: PlayerPosition[], delta = 16) {
        const now = Date.now();

        this.zombiesMap.forEach((zombie, id) => {
            const phys = zombie.body as Phaser.Physics.Arcade.Body;

            if (players.length === 0) {
                phys.setVelocity(0, 0);
                this.animMap.get(id)?.update(delta, false, this.moveAngle.get(id) ?? 0);
                return;
            }

            // Alvo mais próximo (cartesiano → ISO)
            let tx = 0, ty = 0, minDist = Infinity;
            for (const p of players) {
                const { isoX: px, isoY: py } = cartesianToIso(p.x, p.y);
                const d = Math.hypot(zombie.x - px, zombie.y - py);
                if (d < minDist) { minDist = d; tx = px; ty = py; }
            }

            const isSprinting = zombie.getData('sprinting') as boolean;
            const speed = isSprinting ? ZombieManager.SPEED_SPRINT : ZombieManager.SPEED;

            // ── Anti-stuck ───────────────────────────────────────────────
            const lp = this.lastPos.get(id);
            if (lp && (now - lp.t) >= ZombieManager.STUCK_CHECK_MS) {
                const moved = Math.hypot(zombie.x - lp.x, zombie.y - lp.y);
                if (moved < ZombieManager.STUCK_THRESHOLD) {
                    const baseAngle  = Math.atan2(ty - zombie.y, tx - zombie.x);
                    const offsets    = [0.9, -0.9, 1.6, -1.6, Math.PI * 0.6];
                    const evadeAngle = baseAngle + offsets[Math.floor(Math.random() * offsets.length)];
                    this.stuckUntil.set(id, now + ZombieManager.STUCK_EVADE_MS);
                    this.stuckDelta.set(id, {
                        vx: Math.cos(evadeAngle) * speed * 1.3,
                        vy: Math.sin(evadeAngle) * speed * 1.3,
                    });
                }
                this.lastPos.set(id, { x: zombie.x, y: zombie.y, t: now });
            } else if (!lp) {
                this.lastPos.set(id, { x: zombie.x, y: zombie.y, t: now });
            }

            // ── Velocidade ───────────────────────────────────────────────
            let vx = 0, vy = 0, isMoving = false;

            if (now < (this.stuckUntil.get(id) ?? 0)) {
                const sd = this.stuckDelta.get(id)!;
                vx = sd.vx; vy = sd.vy; isMoving = true;
            } else {
                const dx   = tx - zombie.x;
                const dy   = ty - zombie.y;
                const dist = Math.hypot(dx, dy);

                if (dist > 2) {
                    vx = (dx / dist) * speed;
                    vy = (dy / dist) * speed;
                    isMoving = true;

                    // Jitter lateral pequeno — movimento parece mais caótico
                    // e evita que todos se empilhem na mesma linha
                    const jitter = (Math.random() - 0.5) * 20;
                    vx += (-dy / dist) * jitter;
                    vy += ( dx / dist) * jitter;
                }
            }

            phys.setVelocity(vx, vy);

            // ── Animação ─────────────────────────────────────────────────
            const angle = isMoving ? Math.atan2(vy, vx) : (this.moveAngle.get(id) ?? 0);
            if (isMoving) this.moveAngle.set(id, angle);
            this.animMap.get(id)?.update(delta, isMoving, angle);

            zombie.setDepth(zombie.y);
        });
    }

    /**
     * Cliente: interpola posições recebidas do host.
     */
    interpolateClient(lerpFactor = 0.18, delta = 16) {
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
            this.animMap.get(id)?.update(delta, isMoving, angle);
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