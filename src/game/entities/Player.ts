import { buildPlayerSprite } from './PlayerSprite';

/**
 * Player — container físico que envolve o sprite humanoide.
 *
 * O sprite (PlayerSprite) aponta para a direita por padrão.
 * setRotation() gira o container inteiro (sprite + arma).
 * O label de nome fica FORA do container para não girar.
 *
 * Escala: o container é achatado em Y (0.55) para dar perspectiva isométrica.
 */
export class Player extends Phaser.GameObjects.Container {
    private nameLabel: Phaser.GameObjects.Text;

    // Hitbox física (menor que o sprite para ser justa)
    static readonly BODY_W = 14;
    static readonly BODY_H = 8;

    constructor(scene: Phaser.Scene, x: number, y: number, isLocal: boolean) {
        super(scene, x, y);

        // Sprite humanoide
        const sprite = buildPlayerSprite(scene, isLocal);
        this.add(sprite);

        // Achatamento isométrico
        this.setScale(1, 0.55);

        scene.add.existing(this);
        scene.physics.add.existing(this);

        const body = this.body as Phaser.Physics.Arcade.Body;
        body.setSize(Player.BODY_W, Player.BODY_H);
        body.setOffset(-Player.BODY_W / 2, -Player.BODY_H / 2 + 8);

        // Label fora do container — nunca gira
        this.nameLabel = scene.add.text(x, y - 28, '', {
            fontFamily: 'Arial, sans-serif',
            fontSize:   '11px',
            fontStyle:  'bold',
            color:      '#ffffff',
            stroke:     '#000000',
            strokeThickness: 2,
            resolution: 2,
        })
        .setOrigin(0.5, 1)
        .setDepth(999990);
    }

    setNameLabel(name: string) {
        this.nameLabel.setText(name);
    }

    setPosition(x?: number, y?: number, z?: number, w?: number): this {
        super.setPosition(x, y, z, w);
        this.nameLabel?.setPosition(this.x, this.y - 28);
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