/**
 * Entidade Player — funciona tanto para o jogador local quanto remotos.
 *
 * FIX: Label com o nome do jogador é adicionada FORA do container rotacionável,
 * diretamente na cena, e segue a posição do player a cada frame sem girar.
 */
export class Player extends Phaser.GameObjects.Container {
    private bodyRect: Phaser.GameObjects.Rectangle;
    private gun: Phaser.GameObjects.Rectangle;

    // Label de nome — fica FORA do container para não rotacionar
    private nameLabel: Phaser.GameObjects.Text;

    // Dimensões do losango do personagem (mundo isométrico)
    static readonly BODY_SIZE = 20;
    static readonly DRAW_SIZE = 22;

    constructor(scene: Phaser.Scene, x: number, y: number, isLocal: boolean) {
        super(scene, x, y);

        // Sombra no chão
        const shadow = scene.add.ellipse(0, 6, 28, 12, 0x000000, 0.35);

        // Corpo: losango isométrico
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

        // FIX: Label de nome criada diretamente na cena (não no container)
        // para que nunca gire com o player. Começa vazia; usa setNameLabel().
        this.nameLabel = scene.add.text(x, y - 28, '', {
            fontFamily: 'monospace',
            fontSize:   '11px',
            color:      isLocal ? '#00ff99' : '#88ccff',
            stroke:     '#000000',
            strokeThickness: 3,
            align: 'center',
        })
        .setOrigin(0.5, 1)
        .setDepth(999990); // sempre acima de tudo exceto HUD
    }

    /** Define o nome exibido acima do jogador */
    setNameLabel(name: string) {
        this.nameLabel.setText(name);
    }

    setBodyColor(color: number) {
        this.bodyRect.setFillStyle(color);
    }

    /**
     * FIX: Sobrescreve setPosition para manter a label sincronizada.
     * Também é chamado via Tween nos players remotos.
     */
    setPosition(x?: number, y?: number, z?: number, w?: number): this {
        super.setPosition(x, y, z, w);
        if (this.nameLabel) {
            this.nameLabel.setPosition(this.x, this.y - 28);
        }
        return this;
    }

    /** Garante que a label acompanha o player a cada frame (para tweens remotos) */
    preUpdate(_time: number, _delta: number) {
        if (this.nameLabel) {
            this.nameLabel.setPosition(this.x, this.y - 28);
            this.nameLabel.setVisible(this.visible);
        }
    }

    destroy(fromScene?: boolean) {
        this.nameLabel?.destroy();
        super.destroy(fromScene);
    }
}