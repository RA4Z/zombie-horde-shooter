import { CharacterFrameSet, Dir8, angleToDir8, radToDeg } from './Characterrenderer';

/**
 * CharacterAnimator — gerencia qual frame mostrar baseado em:
 *  - Direção atual (Dir8)
 *  - Estado de movimento (andando / parado)
 *  - Timer de animação de caminhada
 *
 * Uso:
 *   const anim = new CharacterAnimator(scene, frameSet, container);
 *   // a cada update():
 *   anim.update(delta, isMoving, aimAngleRad);
 */
export class CharacterAnimator {
    private currentDir:    Dir8   = 'S';
    private currentFrame:  0|1|2  = 0;
    private lastShownFrame: 0|1|2 = 0; // frame que está de fato visível no container
    private lastShownDir:  Dir8   = 'S';
    private walkTimer:     number = 0;

    /** ms por frame de caminhada */
    private static readonly WALK_FPS = 180;

    private frameSet: CharacterFrameSet;
    private container: Phaser.GameObjects.Container;

    constructor(
        private scene: Phaser.Scene,
        frameSet: CharacterFrameSet,
        container: Phaser.GameObjects.Container,
    ) {
        this.frameSet  = frameSet;
        this.container = container;

        // Adiciona todos os Graphics ao container
        for (const dir of Object.values(frameSet.frames) as Array<[any,any,any]>) {
            for (const f of dir) container.add(f.gfx);
        }
        // Adiciona HP bar se existir (zumbi) — fundo primeiro, depois a barra
        if (frameSet.hpBg) {
            container.add(frameSet.hpBg);
        }
        if (frameSet.hpBar) {
            container.add(frameSet.hpBar);
        }

        this.showFrame('S', 0);
    }

    /**
     * Deve ser chamado a cada frame no update().
     * @param delta      ms desde o último frame
     * @param isMoving   true se o personagem está se movendo
     * @param aimAngle   ângulo de rotação em RADIANOS (espaço ISO de tela)
     */
    update(delta: number, isMoving: boolean, aimAngle: number) {
        const newDir = angleToDir8(radToDeg(aimAngle));

        if (isMoving) {
            this.walkTimer += delta;
            if (this.walkTimer >= CharacterAnimator.WALK_FPS) {
                this.walkTimer = 0;
                this.currentFrame = this.currentFrame === 1 ? 2 : 1;
            }
        } else {
            this.walkTimer    = 0;
            this.currentFrame = 0;
        }

        // Compara com o que REALMENTE está visível, não com currentFrame
        if (newDir !== this.lastShownDir || this.currentFrame !== this.lastShownFrame) {
            this.currentDir    = newDir;
            this.lastShownDir  = newDir;
            this.lastShownFrame = this.currentFrame;
            this.showFrame(newDir, this.currentFrame);
        }
    }

    /** Atualiza apenas a direção (para players remotos cujo delta não é conhecido) */
    updateDirection(aimAngle: number, isMoving: boolean, delta: number) {
        this.update(delta, isMoving, aimAngle);
    }

    /** Atualiza a largura da barra de HP (zumbi) */
    setHpFraction(fraction: number) {
        if (this.frameSet.hpBar) {
            this.frameSet.hpBar.width = Math.max(0, 22 * fraction);
        }
    }

    /** Flash vermelho ao levar hit */
    flashHit() {
        const frames = this.frameSet.frames[this.currentDir];
        const gfx = frames[this.currentFrame].gfx as any;
        gfx.setTint(0xff4422);
        this.scene.time.delayedCall(90, () => {
            if (gfx && gfx.active) gfx.clearTint();
        });
    }

    destroy() {
        // Graphics são destruídos pelo container pai
    }

    // ── Privado ───────────────────────────────────────────────────────────────

    private showFrame(dir: Dir8, frameIdx: 0|1|2) {
        // Oculta todos
        for (const d of Object.keys(this.frameSet.frames) as Dir8[]) {
            for (const f of this.frameSet.frames[d]) {
                f.gfx.setVisible(false);
            }
        }
        // Mostra o frame correto
        this.frameSet.frames[dir][frameIdx].gfx.setVisible(true);
    }
}