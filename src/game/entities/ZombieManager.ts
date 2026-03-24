export class ZombieManager {
    group: Phaser.Physics.Arcade.Group;
    zombiesMap: Map<string, Phaser.GameObjects.Container> = new Map();

    constructor(private scene: Phaser.Scene) {
        this.group = scene.physics.add.group();
    }

    spawn(id: string, x: number, y: number) {
        const body = this.scene.add.rectangle(0, 0, 30, 30, 0x445500).setAngle(45);
        const container = this.scene.add.container(x, y, [body]);
        container.setScale(1, 0.5);

        this.scene.add.existing(container);
        this.scene.physics.add.existing(container);

        const physBody = container.body as Phaser.Physics.Arcade.Body;

        physBody.setSize(40, 30);
        physBody.setOffset(-20, -15);

        this.group.add(container);
        this.zombiesMap.set(id, container);
        return container;
    }

    remove(id: string) {
        const zombie = this.zombiesMap.get(id);
        if (zombie) {
            zombie.destroy();
            this.zombiesMap.delete(id);
        }
    }

    update(playerX: number, playerY: number) {
        this.group.getChildren().forEach((zombie: any) => {
            this.scene.physics.moveTo(zombie, playerX, playerY, 100);
            zombie.setDepth(zombie.y);
        });
    }

    updateHost(players: { id: string, x: number, y: number }[]) {
        if (players.length === 0) return;
        this.zombiesMap.forEach((zombie, _id) => {

            const zWorldX = (zombie.y + zombie.x / 2);
            const zWorldY = (zombie.y - zombie.x / 2);

            let closestPlayer = players[0];
            let minDist = Infinity;

            // 2. Encontrar o player mais próximo usando coordenadas do MUNDO
            players.forEach(p => {
                const dist = Phaser.Math.Distance.Between(zWorldX, zWorldY, p.x, p.y);
                if (dist < minDist) {
                    minDist = dist;
                    closestPlayer = p;
                }
            });

            // 3. MOVER o zumbi na tela em direção à posição ISOMÉTRICA do alvo
            const targetIsoX = closestPlayer.x - closestPlayer.y;
            const targetIsoY = (closestPlayer.x + closestPlayer.y) / 2;

            this.scene.physics.moveTo(zombie, targetIsoX, targetIsoY, 110);
            zombie.setDepth(zombie.y);
        });
    }

}