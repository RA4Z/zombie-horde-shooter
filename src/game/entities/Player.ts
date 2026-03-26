/**
 * Entidade Player — local e remoto.
 *
 * Label de nome: branco, fonte pequena não-pixelada, fora do container.
 */
export class Player extends Phaser.GameObjects.Container {
    private bodyRect: Phaser.GameObjects.Rectangle;
    private nameLabel: Phaser.GameObjects.Text;

    static readonly BODY_SIZE = 10;
    static readonly DRAW_SIZE = 12;

    constructor(scene: Phaser.Scene, x: number, y: number, isLocal: boolean) {
        super(scene, x, y);

        const shadow = scene.add.ellipse(0, 4, 16, 7, 0x000000, 0.4);

        this.bodyRect = scene.add.rectangle(
            0, 0,
            Player.DRAW_SIZE, Player.DRAW_SIZE,
            isLocal ? 0x00ff66 : 0x4499ff,
        ).setAngle(45);

        const detail = scene.add.rectangle(0, 0, 5, 5, isLocal ? 0x00cc44 : 0x2266cc).setAngle(45);

        // Cano da arma — aponta para direita (angle=0) por padrão
        const gun = scene.add.rectangle(9, 0, 11, 3, 0xdd3333).setOrigin(0, 0.5);

        this.add([shadow, this.bodyRect, detail, gun]);

        scene.add.existing(this);
        scene.physics.add.existing(this);

        const body = this.body as Phaser.Physics.Arcade.Body;
        body.setSize(Player.BODY_SIZE * 2, Player.BODY_SIZE);
        body.setOffset(-Player.BODY_SIZE, -Player.BODY_SIZE / 2);

        // ── Label de nome fora do container (não gira) ──────────────────────
        // Usa Arial para evitar pixelação; branco; tamanho pequeno
        this.nameLabel = scene.add.text(x, y - 20, '', {
            fontFamily: 'Arial, sans-serif',
            fontSize:   '11px',
            fontStyle:  'bold',
            color:      '#ffffff',
            stroke:     '#000000',
            strokeThickness: 2,
            resolution: 2,     // renderiza em 2× para evitar pixelação
        })
        .setOrigin(0.5, 1)
        .setDepth(999990);
    }

    setNameLabel(name: string) {
        this.nameLabel.setText(name);
    }

    setBodyColor(color: number) {
        this.bodyRect.setFillStyle(color);
    }

    /** Mantém o label alinhado quando a posição muda (tweens inclusive) */
    setPosition(x?: number, y?: number, z?: number, w?: number): this {
        super.setPosition(x, y, z, w);
        this.nameLabel?.setPosition(this.x, this.y - 20);
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