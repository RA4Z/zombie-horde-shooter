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
    bullets: Phaser.Physics.Arcade.Group;
    isHost: boolean = false;
    lastDamageTime: number = 0;
    lastRemoteData: Map<string, { x: number, y: number }> = new Map();
    wasd: any;

    playerData = { x: 0, y: 0, speed: 250, hp: 100 };

    constructor() {
        super('Game');
    }

    create() {
        this.cameras.main.setBackgroundColor('#2d2d2d');
        this.multiplayer = new MultiplayerService();
        this.zombies = new ZombieManager(this);
        this.bullets = this.physics.add.group();
        this.localPlayer = new Player(this, 0, 0, true);

        if (this.input.keyboard) {
            this.wasd = this.input.keyboard.addKeys('W,A,S,D');
        }

        this.time.addEvent({
            delay: 2000,
            callback: () => {
                if (this.isHost) this.spawnZombieHost();
            },
            loop: true
        });
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
        this.physics.add.overlap(this.bullets, this.zombies.group, (bullet, zombieContainer: any) => {
            bullet.destroy();

            // Se EU sou o Host, eu decido que o zumbi morreu e aviso geral
            if (this.isHost) {
                let zombieId = "";
                this.zombies.zombiesMap.forEach((v, k) => { if (v === zombieContainer) zombieId = k; });

                if (zombieId) {
                    this.zombies.remove(zombieId);
                    this.multiplayer.broadcast('zombie-death', { id: zombieId });
                }
            } else {
                // Se eu sou apenas um cliente, eu "escondo" o zumbi da minha tela
                // para parecer que acertei, mas o Host vai confirmar a morte depois.
                zombieContainer.setActive(false).setVisible(false);
            }
        });
        this.physics.add.overlap(this.localPlayer, this.zombies.group, (_player, _zombieContainer: any) => {
            if (this.time.now > (this.lastDamageTime || 0)) {
                this.playerData.hp -= 10;
                this.lastDamageTime = this.time.now + 500; // Meio segundo de invulnerabilidade

                EventBus.emit('player-stats', this.playerData);

                if (this.playerData.hp <= 0) {
                    console.log("VOCÊ MORREU!");
                    // this.scene.start('GameOver');
                }
            }
        });
        // 2. CONFIGURAR EVENTOS DE REDE P2P
        this.setupNetworkEvents();

        this.input.on('pointerdown', () => this.shoot());
        this.cameras.main.centerOn(0, 0);
        EventBus.emit('current-scene-ready', this);
    }

    spawnZombieHost() {
        const id = "zombie_" + Date.now() + Math.random();
        const angle = Math.random() * Math.PI * 2;
        const dist = 600;
        const x = this.playerData.x + Math.cos(angle) * dist;
        const y = this.playerData.y + Math.sin(angle) * dist;

        this.zombies.spawn(id, x, y);

        // Avisa os clientes
        this.multiplayer.broadcast('zombie-spawn', { id, x, y });
    }

    // No setupNetworkEvents, adicione os novos casos
    setupNetworkEvents() {
        EventBus.on('network-data', ({ from, data }: any) => {
            const msg = JSON.parse(data);

            if (msg.type === 'move') {
                this.lastRemoteData.set(from, { x: msg.x, y: msg.y });
                this.handleRemoteMove(from, msg);
            }


            if (msg.type === 'player-shoot') {
                this.createBullet(msg.x, msg.y, msg.angle);
            }

            if (msg.type === 'zombie-spawn') {
                this.zombies.spawn(msg.id, msg.x, msg.y);
            }

            if (msg.type === 'zombie-update') {
                msg.list.forEach((zData: any) => {
                    const zombie = this.zombies.zombiesMap.get(zData.id);
                    if (zombie) {
                        zombie.setPosition(zData.x, zData.y);
                        zombie.setDepth(zData.y);
                    } else if (!this.isHost) {
                        this.zombies.spawn(zData.id, zData.x, zData.y);
                    }
                });
            }

            if (msg.type === 'zombie-death') {
                this.zombies.remove(msg.id);
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
            angle: this.localPlayer.rotation
        });

        this.cameras.main.centerOn(isoX, isoY);

        if (this.isHost) {
            const allPlayers = [
                { id: 'host', x: this.playerData.x, y: this.playerData.y }
            ];
            this.remotePlayers.forEach((_p, id) => {
                const data = this.lastRemoteData.get(id);
                if (data) allPlayers.push({ id, x: data.x, y: data.y });
            });

            this.zombies.updateHost(allPlayers);

            const zombieList: any[] = [];
            this.zombies.zombiesMap.forEach((z, id) => {
                zombieList.push({ id, x: z.x, y: z.y }); // Enviamos o X/Y da tela
            });
            this.multiplayer.broadcast('zombie-update', { list: zombieList });
        }
    }

    shoot() {
        const angle = this.localPlayer.rotation;
        const x = this.playerData.x;
        const y = this.playerData.y;

        // 1. Cria a bala na nossa própria tela
        this.createBullet(x, y, angle);

        // 2. Avisa os outros que atiramos
        this.multiplayer.broadcast('player-shoot', { x, y, angle });
    }

    createBullet(startX: number, startY: number, angle: number) {
        // Converte posição lógica para visual para o ponto de partida
        const isoX = startX - startY;
        const isoY = (startX + startY) / 2;

        const bullet = this.add.circle(isoX, isoY, 5, 0xffff00);
        this.physics.add.existing(bullet);
        this.bullets.add(bullet);

        // Aumentar um pouco a caixa de colisão da bala para facilitar o acerto
        const body = bullet.body as Phaser.Physics.Arcade.Body;
        body.setSize(15, 15);

        const speed = 900;
        body.setVelocity(
            Math.cos(angle) * speed,
            (Math.sin(angle) * speed) / 2
        );

        this.time.delayedCall(1000, () => bullet.destroy());
    }
}