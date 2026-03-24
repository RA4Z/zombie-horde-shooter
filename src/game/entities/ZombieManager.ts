import { cartesianToIso } from '../utils/IsoMath';

interface PlayerPosition {
    id: string;
    x: number; // mundo (cartesiano)
    y: number;
}

/**
 * Gerencia spawn, remoção e movimentação de todos os zumbis na cena.
 * O Host controla a IA; clientes apenas interpolam as posições recebidas.
 */
export class ZombieManager {
    readonly group: Phaser.Physics.Arcade.Group;
    readonly zombiesMap: Map<string, Phaser.GameObjects.Container> = new Map();

    constructor(private scene: Phaser.Scene) {
        this.group = scene.physics.add.group();
    }

    spawn(id: string, worldX: number, worldY: number): Phaser.GameObjects.Container {
        // Evita zumbis duplicados (pode receber spawn duas vezes em race conditions)
        if (this.zombiesMap.has(id)) return this.zombiesMap.get(id)!;

        const { isoX, isoY } = cartesianToIso(worldX, worldY);

        const body = this.scene.add.rectangle(0, 0, 30, 30, 0x445500).setAngle(45);
        const container = this.scene.add.container(isoX, isoY, [body]);
        container.setScale(1, 0.5);

        this.scene.physics.add.existing(container);
        const physBody = container.body as Phaser.Physics.Arcade.Body;
        physBody.setSize(40, 30);
        physBody.setOffset(-20, -15);

        this.group.add(container);
        this.zombiesMap.set(id, container);

        // Armazena a posição lógica para uso da IA do host
        container.setData('worldX', worldX);
        container.setData('worldY', worldY);

        return container;
    }

    remove(id: string) {
        const zombie = this.zombiesMap.get(id);
        if (!zombie) return;
        zombie.destroy();
        this.zombiesMap.delete(id);
    }

    removeAll() {
        this.zombiesMap.forEach(z => z.destroy());
        this.zombiesMap.clear();
    }

    /**
     * HOST: Move cada zumbi em direção ao player mais próximo.
     * Recebe posições no espaço do MUNDO (cartesiano).
     */
    updateHost(players: PlayerPosition[]) {
        if (players.length === 0) return;

        this.zombiesMap.forEach((zombie) => {
            const worldX: number = zombie.getData('worldX') ?? 0;
            const worldY: number = zombie.getData('worldY') ?? 0;

            // Encontra o player mais próximo usando distância cartesiana
            let closest = players[0];
            let minDist = Infinity;
            for (const p of players) {
                const d = Phaser.Math.Distance.Between(worldX, worldY, p.x, p.y);
                if (d < minDist) { minDist = d; closest = p; }
            }

            // Move no espaço isométrico (tela) em direção à posição ISO do alvo
            const { isoX: targetIsoX, isoY: targetIsoY } = cartesianToIso(closest.x, closest.y);
            this.scene.physics.moveTo(zombie, targetIsoX, targetIsoY, 110);
            zombie.setDepth(zombie.y);

            // Atualiza posição lógica aproximada a partir da posição na tela
            // (simplificado; para precisão total use isoToCartesian)
            zombie.setData('worldX', (zombie.x + zombie.y * 2) / 2 + zombie.y / 2);
            zombie.setData('worldY', zombie.y - zombie.x / 4);
        });
    }

    /**
     * CLIENTE: Interpola suavemente cada zumbi para a posição alvo recebida do host.
     * @param lerpFactor 0 = não move; 1 = teleporta; 0.15 = suave
     */
    interpolateClient(lerpFactor = 0.15) {
        this.zombiesMap.forEach((zombie) => {
            const targetX: number | undefined = zombie.getData('targetX');
            const targetY: number | undefined = zombie.getData('targetY');
            if (targetX === undefined || targetY === undefined) return;

            const newX = Phaser.Math.Linear(zombie.x, targetX, lerpFactor);
            const newY = Phaser.Math.Linear(zombie.y, targetY, lerpFactor);
            zombie.setPosition(newX, newY);
            zombie.setDepth(newY);
        });
    }

    /** Define destino de interpolação para um zumbi (clientes) */
    setTarget(id: string, isoX: number, isoY: number) {
        const zombie = this.zombiesMap.get(id);
        if (!zombie) return;
        zombie.setData('targetX', isoX);
        zombie.setData('targetY', isoY);
    }
}