export class ZombieManager {
    group: Phaser.Physics.Arcade.Group;

    constructor(private scene: Phaser.Scene) {
        this.group = scene.physics.add.group();
    }

    spawn(x: number, y: number) {
        const zombieBody = this.scene.add.rectangle(0, 0, 30, 30, 0x556600).setAngle(45);
        const container = this.scene.add.container(x, y, [zombieBody]);
        this.group.add(container);
        return container;
    }

    update(playerX: number, playerY: number) {
        this.group.getChildren().forEach((zombie: any) => {
            this.scene.physics.moveTo(zombie, playerX, playerY, 120);
            zombie.setDepth(zombie.y);
        });
    }
}