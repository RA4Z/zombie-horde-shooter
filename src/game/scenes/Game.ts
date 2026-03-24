import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { Player } from '../entities/Player';
import { MultiplayerService } from '../network/Multiplayer';
import { ZombieManager } from '../entities/ZombieManager';

export class Game extends Scene {
    localPlayer: Player;
    multiplayer: MultiplayerService;
    zombies: ZombieManager;
    remotePlayers: Map<string, Player> = new Map();
    isHost: boolean = false;
    wasd: any;

    playerData = { x: 0, y: 0, speed: 250, hp: 100 };

    constructor() {
        super('Game');
    }

    create() {
        this.cameras.main.setBackgroundColor('#2d2d2d');
        this.multiplayer = new MultiplayerService();
        this.zombies = new ZombieManager(this);
        this.localPlayer = new Player(this, 0, 0, true);

        if (this.input.keyboard) {
            this.wasd = this.input.keyboard.addKeys('W,A,S,D');
        }

        // 1. ESCUTAR COMANDO DO REACT PARA INICIAR
        EventBus.on('start-game', async (data: { isHost: boolean, roomId?: string }) => {
            this.isHost = data.isHost;
            if (this.isHost) {
                const key = await this.multiplayer.hostGame();
                EventBus.emit('room-joined', key);
            } else if (data.roomId) {
                await this.multiplayer.joinGame(data.roomId);
            }
        });

        // 2. CONFIGURAR EVENTOS DE REDE P2P
        this.setupNetworkEvents();

        this.input.on('pointerdown', () => this.shoot());
        this.cameras.main.centerOn(0, 0);
        EventBus.emit('current-scene-ready', this);
    }

    setupNetworkEvents() {
        // No PeerJS, ouvimos as mensagens que chegam via EventBus
        EventBus.on('network-data', ({ from, data }: { from: string, data: string }) => {
            const msg = JSON.parse(data);

            // Se for mensagem de movimento
            if (msg.type === 'move') {
                this.handleRemoteMove(from, msg);
            }

            // Se for mensagem de tiro (podemos adicionar depois)
            if (msg.type === 'shoot') {
                // lógica de tiro remoto
            }
        });
        EventBus.on('peer-disconnected', (id: string) => {
            const remote = this.remotePlayers.get(id);
            if (remote) {
                console.log("Removendo player da cena:", id);
                remote.destroy(); // Remove o boneco do Phaser
                this.remotePlayers.delete(id); // Remove do nosso Map
            }
        });
    }

    handleRemoteMove(id: string, data: any) {
        let remote = this.remotePlayers.get(id);

        // Se o player ainda não existe na nossa tela, criamos ele
        if (!remote) {
            remote = new Player(this, data.x, data.y, false);
            this.remotePlayers.set(id, remote);
        }

        // Atualiza a posição visual
        const isoX = data.x - data.y;
        const isoY = (data.x + data.y) / 2;
        remote.setPosition(isoX, isoY);
        remote.setRotation(data.angle);
    }

    update(_time: number, delta: number) {
        const dt = delta / 1000;
        let moveX = 0; let moveY = 0;

        if (this.wasd?.A.isDown) moveX -= 1;
        if (this.wasd?.D.isDown) moveX += 1;
        if (this.wasd?.W.isDown) moveY -= 1;
        if (this.wasd?.S.isDown) moveY += 1;

        if (moveX !== 0 || moveY !== 0) {
            const length = Math.sqrt(moveX * moveX + moveY * moveY);
            this.playerData.x += (moveX / length) * this.playerData.speed * dt;
            this.playerData.y += (moveY / length) * this.playerData.speed * dt;
        }

        const isoX = this.playerData.x - this.playerData.y;
        const isoY = (this.playerData.x + this.playerData.y) / 2;
        this.localPlayer.setPosition(isoX, isoY);

        const pointer = this.input.activePointer;
        const angle = Math.atan2((pointer.y - (this.cameras.main.height / 2)) * 2, pointer.x - (this.cameras.main.width / 2));
        this.localPlayer.setRotation(angle);

        // 3. ENVIAR PARA TODOS VIA BROADCAST (Substitui o sendMove)
        this.multiplayer.broadcast('move', {
            x: this.playerData.x,
            y: this.playerData.y,
            angle: angle
        });

        this.cameras.main.centerOn(isoX, isoY);

        if (this.isHost) {
            this.zombies.update(this.localPlayer.x, this.localPlayer.y);
        }
    }

    shoot() {
        const bullet = this.add.circle(this.localPlayer.x, this.localPlayer.y, 4, 0xffff00);
        this.physics.add.existing(bullet);
        const speed = 800;
        const angle = this.localPlayer.rotation;
        (bullet.body as Phaser.Physics.Arcade.Body).setVelocity(
            Math.cos(angle) * speed,
            (Math.sin(angle) * speed) / 2
        );
        this.time.delayedCall(1000, () => bullet.destroy());
    }
}