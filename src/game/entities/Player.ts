/**
 * Entidade Player — funciona tanto para o jogador local quanto remotos.
 * O container vive no espaço isométrico (tela); a posição LÓGICA (mundo)
 * é gerenciada externamente em playerData dentro de Game.ts.
 */
export class Player extends Phaser.GameObjects.Container {
    private bodyRect: Phaser.GameObjects.Rectangle;
    private gun: Phaser.GameObjects.Rectangle;

    constructor(scene: Phaser.Scene, x: number, y: number, isLocal: boolean) {
        super(scene, x, y);

        // Losango isométrico: quadrado rotacionado 45°, achatado na altura
        this.bodyRect = scene.add.rectangle(0, 0, 30, 30, isLocal ? 0x00ff44 : 0x4488ff).setAngle(45);
        // Cano da arma — aponta na direção da rotação do container
        this.gun = scene.add.rectangle(15, 0, 20, 5, 0xff3333).setOrigin(0, 0.5);

        this.add([this.bodyRect, this.gun]);

        scene.add.existing(this);
        scene.physics.add.existing(this);

        // Hitbox achatada para combinar com a perspectiva isométrica
        const body = this.body as Phaser.Physics.Arcade.Body;
        body.setSize(40, 20);
        body.setOffset(-20, -10);
    }

    /** Atualiza a cor do corpo (útil para feedback de dano, etc.) */
    setBodyColor(color: number) {
        this.bodyRect.setFillStyle(color);
    }
}