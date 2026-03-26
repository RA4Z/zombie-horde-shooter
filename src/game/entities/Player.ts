import { createPlayerFrames } from './CharacterRenderer';
import { CharacterAnimator } from './CharacterAnimator';

/**
 * Player — container físico com sprite humanoide slim + animação direcional.
 *
 * NÃO usa setRotation() — a direção é gerenciada pelo CharacterAnimator
 * que troca os frames das 8 direções conforme o ângulo de mira.
 *
 * O container NÃO é achatado em Y globalmente; cada Graphics frame já é
 * desenhado com proporções isométricas corretas (slim, alto).
 */
export class Player extends Phaser.GameObjects.Container {
    private animator: CharacterAnimator;
    private nameLabel: Phaser.GameObjects.Text;

    // O ângulo de rotação do container não é mais usado para o sprite;
    // é mantido para compatibilidade com o código de rede que lê .rotation.
    // O animator usa aimAngle passado via update().
    private _aimAngle = 0;
    private _isMoving = false;
    private _delta = 16;

    static readonly BODY_W = 10;
    static readonly BODY_H = 6;

    constructor(scene: Phaser.Scene, x: number, y: number, isLocal: boolean) {
        super(scene, x, y);

        // Cria todos os 24 frames (8 dirs × 3 fases)
        const frameSet = createPlayerFrames(scene, isLocal);
        this.animator = new CharacterAnimator(scene, frameSet, this);

        scene.add.existing(this);
        scene.physics.add.existing(this);

        const body = this.body as Phaser.Physics.Arcade.Body;
        body.setSize(Player.BODY_W, Player.BODY_H);
        body.setOffset(-Player.BODY_W / 2, -Player.BODY_H / 2 + 2);

        // Label fora do container — nunca gira, posição Y elevada
        this.nameLabel = scene.add.text(x, y - 36, '', {
            fontFamily: 'Arial, sans-serif',
            fontSize: '11px',
            fontStyle: 'bold',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 2,
            resolution: 2,
        })
            .setOrigin(0.5, 1)
            .setDepth(999990);
    }

    setNameLabel(name: string) { this.nameLabel.setText(name); }

    /**
     * Atualiza animação. Deve ser chamado no update() da cena.
     * @param delta     ms desde o último frame
     * @param isMoving  true se está se movendo
     * @param aimAngle  ângulo em radianos (espaço ISO de tela)
     */
    tickAnim(delta: number, isMoving: boolean, aimAngle: number) {
        this._aimAngle = aimAngle;
        this._isMoving = isMoving;
        this._delta = delta;
        this.animator.update(delta, isMoving, aimAngle);
    }

    // Sobrescreve setRotation para interceptar o ângulo sem girar o sprite.
    // Armazena em _aimAngle E em _rotation (campo interno do Phaser) para que
    // o código de rede que lê .rotation continue recebendo o valor correto.
    // NÃO declaramos um getter aqui — Container já define rotation como
    // propriedade (não accessor), então redefinir causaria TS2611.
    setRotation(radians?: number): this {
        if (radians !== undefined) {
            this._aimAngle = radians;
            // Atualiza o campo interno do Phaser sem acionar o setter original
            // (que giraria o sprite). Assim .rotation retorna o valor esperado.
            (this as any)._rotation = radians;
        }
        return this;
    }

    setPosition(x?: number, y?: number, z?: number, w?: number): this {
        super.setPosition(x, y, z, w);
        this.nameLabel?.setPosition(this.x, this.y - 36);
        return this;
    }

    setVisible(value: boolean): this {
        super.setVisible(value);
        this.nameLabel?.setVisible(value);
        return this;
    }

    destroy(fromScene?: boolean) {
        this.nameLabel?.destroy();
        super.destroy(fromScene);
    }
}