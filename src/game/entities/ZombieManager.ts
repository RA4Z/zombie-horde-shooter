import { cartesianToIso } from '../utils/IsoMath';

export interface PlayerPosition {
    id: string;
    x: number;
    y: number;
}

export class ZombieManager {
    readonly group: Phaser.Physics.Arcade.Group;
    readonly zombiesMap: Map<string, Phaser.GameObjects.Container> = new Map();
    private hpMap: Map<string, number> = new Map();

    constructor(private scene: Phaser.Scene) {
        this.group = scene.physics.add.group();
    }

    spawn(id: string, worldX: number, worldY: number, hp = 1): Phaser.GameObjects.Container {
        if (this.zombiesMap.has(id)) return this.zombiesMap.get(id)!;

        const { isoX, isoY } = cartesianToIso(worldX, worldY);

        const hpBg  = this.scene.add.rectangle(-15, -22, 30, 4, 0x880000).setOrigin(0, 0.5);
        const hpBar = this.scene.add.rectangle(-15, -22, 30, 4, 0x44ff44).setOrigin(0, 0.5);
        const body  = this.scene.add.rectangle(0, 0, 30, 30, 0x335500).setAngle(45);

        const container = this.scene.add.container(isoX, isoY, [hpBg, hpBar, body]);
        container.setScale(1, 0.5);

        this.scene.physics.add.existing(container);
        const physBody = container.body as Phaser.Physics.Arcade.Body;
        physBody.setSize(40, 30);
        physBody.setOffset(-20, -15);

        this.group.add(container);
        this.zombiesMap.set(id, container);
        this.hpMap.set(id, hp);

        container.setData('worldX', worldX);
        container.setData('worldY', worldY);
        container.setData('maxHp', hp);
        container.setData('hpBarRef', hpBar);

        return container;
    }

    /** Aplica 1 de dano. Retorna true se morreu. */
    hit(id: string): boolean {
        const current = this.hpMap.get(id);
        if (current === undefined) return false;
        const next = current - 1;
        this.hpMap.set(id, next);

        const zombie = this.zombiesMap.get(id);
        if (zombie) {
            const maxHp = zombie.getData('maxHp') as number;
            const hpBar = zombie.getData('hpBarRef') as Phaser.GameObjects.Rectangle | undefined;
            if (hpBar) hpBar.width = Math.max(0, 30 * (next / maxHp));
            const bodyRect = zombie.list[2] as Phaser.GameObjects.Rectangle;
            bodyRect?.setFillStyle(0xff2200);
            this.scene.time.delayedCall(80, () => bodyRect?.setFillStyle(0x335500));
        }
        return next <= 0;
    }

    remove(id: string) {
        const zombie = this.zombiesMap.get(id);
        if (!zombie) return;
        zombie.destroy();
        this.zombiesMap.delete(id);
        this.hpMap.delete(id);
    }

    removeAll() {
        this.zombiesMap.forEach(z => z.destroy());
        this.zombiesMap.clear();
        this.hpMap.clear();
    }

    updateHost(players: PlayerPosition[]) {
        if (players.length === 0) return;
        this.zombiesMap.forEach((zombie) => {
            const worldX: number = zombie.getData('worldX') ?? 0;
            const worldY: number = zombie.getData('worldY') ?? 0;
            let closest = players[0];
            let minDist = Infinity;
            for (const p of players) {
                const d = Phaser.Math.Distance.Between(worldX, worldY, p.x, p.y);
                if (d < minDist) { minDist = d; closest = p; }
            }
            const { isoX, isoY } = cartesianToIso(closest.x, closest.y);
            this.scene.physics.moveTo(zombie, isoX, isoY, 110);
            zombie.setDepth(zombie.y);
            zombie.setData('worldX', (zombie.x + zombie.y * 2) / 2 + zombie.y / 2);
            zombie.setData('worldY', zombie.y - zombie.x / 4);
        });
    }

    interpolateClient(lerpFactor = 0.15) {
        this.zombiesMap.forEach((zombie) => {
            const tx: number | undefined = zombie.getData('targetX');
            const ty: number | undefined = zombie.getData('targetY');
            if (tx === undefined || ty === undefined) return;
            zombie.setPosition(
                Phaser.Math.Linear(zombie.x, tx, lerpFactor),
                Phaser.Math.Linear(zombie.y, ty, lerpFactor),
            );
            zombie.setDepth(zombie.y);
        });
    }

    setTarget(id: string, isoX: number, isoY: number) {
        const z = this.zombiesMap.get(id);
        if (z) { z.setData('targetX', isoX); z.setData('targetY', isoY); }
    }

    /** Posiciona o zombie diretamente (sem interpolacao) — usado em spawns distantes */
    setPosition(id: string, isoX: number, isoY: number) {
        const z = this.zombiesMap.get(id);
        if (!z) return;
        z.setPosition(isoX, isoY);
        z.setData('targetX', isoX);
        z.setData('targetY', isoY);
    }
}