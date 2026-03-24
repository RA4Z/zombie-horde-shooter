export class Player extends Phaser.GameObjects.Container {
    bodyCircle: Phaser.GameObjects.Rectangle;
    gun: Phaser.GameObjects.Rectangle;

    constructor(scene: Phaser.Scene, x: number, y: number, isLocal: boolean) {
        super(scene, x, y);
        
        this.bodyCircle = scene.add.rectangle(0, 0, 30, 30, isLocal ? 0x00ff00 : 0x0000ff).setAngle(45);
        this.gun = scene.add.rectangle(15, 0, 20, 5, 0xff0000).setOrigin(0, 0.5);
        
        this.add([this.bodyCircle, this.gun]);
        scene.add.existing(this);
        scene.physics.add.existing(this);
    }

    updateRotation(angle: number) {
        this.setRotation(angle);
    }
}