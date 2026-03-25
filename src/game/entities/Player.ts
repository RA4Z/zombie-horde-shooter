/**
 * Entidade Player — funciona tanto para o jogador local quanto remotos.
 * Tamanho aumentado para melhor proporção com o cenário isométrico.
 */
export class Player extends Phaser.GameObjects.Container {
    private bodyRect: Phaser.GameObjects.Rectangle;
    private gun: Phaser.GameObjects.Rectangle;

    // Dimensões do losango do personagem (mundo isométrico)
    static readonly BODY_SIZE = 20;   // hitbox física (pequena para ser justa)
    static readonly DRAW_SIZE = 22;   // tamanho visual do losango

    constructor(scene: Phaser.Scene, x: number, y: number, isLocal: boolean) {
        super(scene, x, y);

        // Sombra no chão
        const shadow = scene.add.ellipse(0, 6, 28, 12, 0x000000, 0.35);

        // Corpo: losango isométrico (quadrado 45° achatado verticalmente pela escala do container)
        this.bodyRect = scene.add.rectangle(
            0, 0,
            Player.DRAW_SIZE, Player.DRAW_SIZE,
            isLocal ? 0x00ff66 : 0x4499ff,
        ).setAngle(45);

        // Detalhe no centro do corpo
        const detail = scene.add.rectangle(0, 0, 8, 8, isLocal ? 0x00cc44 : 0x2266cc).setAngle(45);

        // Cano da arma
        this.gun = scene.add.rectangle(14, 0, 18, 4, 0xdd3333).setOrigin(0, 0.5);

        this.add([shadow, this.bodyRect, detail, this.gun]);

        scene.add.existing(this);
        scene.physics.add.existing(this);

        // Hitbox física achatada — isométrico 2:1
        const body = this.body as Phaser.Physics.Arcade.Body;
        body.setSize(Player.BODY_SIZE * 2, Player.BODY_SIZE);
        body.setOffset(-Player.BODY_SIZE, -Player.BODY_SIZE / 2);
    }

    setBodyColor(color: number) {
        this.bodyRect.setFillStyle(color);
    }
}