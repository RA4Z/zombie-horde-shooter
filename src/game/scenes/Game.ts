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
    private heartbeatWorker: Worker | null = null;
    hostID_atual: string = "";
    private lastHostHeartbeat: number = 0;
    private migrationThreshold: number = 3000;
    lastSeenMap: Map<string, number> = new Map();
    wasd: any;

    playerData = { x: 0, y: 0, speed: 250, hp: 100 };

    constructor() {
        super('Game');
    }

    create() {
        window.addEventListener('beforeunload', () => {
            this.multiplayer.broadcast('player-leaving', { id: this.multiplayer.myID });
        });
        this.sound.pauseOnBlur = false;
        this.game.events.removeAllListeners('blur');
        this.game.events.removeAllListeners('focus');
        this.heartbeatWorker = new Worker('/heartbeatWorker.js');
        this.heartbeatWorker.onmessage = (e) => {
            if (e.data === 'tick') {
                if (this.isHost) {
                    this.runHostSimulation(); // IA e Física
                } else {
                    this.sendClientData(); // Cliente envia posição mesmo minimizado
                }
            }
        };

        this.events.on('destroy', () => {
            this.heartbeatWorker?.terminate();
        });

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

            // Marcar o tempo inicial para não dar erro de host morto
            this.lastHostHeartbeat = this.time.now;

            if (this.isHost) {
                const key = await this.multiplayer.hostGame();
                this.hostID_atual = this.multiplayer.myID;
                this.startHostHeartbeat();
                EventBus.emit('room-joined', key); // Avisa o React (Host)
            } else if (data.roomId) {
                console.log("Tentando conectar ao Host:", data.roomId);
                await this.multiplayer.joinGame(data.roomId);
                this.hostID_atual = data.roomId;
                // O EventBus.emit('room-joined') será chamado automaticamente 
                // pelo Multiplayer.ts assim que a conexão abrir!
            }
        });
        this.physics.add.overlap(this.bullets, this.zombies.group, (bullet: any, zombie: any) => {
            // Se estiver em foco, a colisão normal do Phaser chama a nossa função
            this.handleZombieHit(bullet, zombie as Phaser.GameObjects.Container);
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

    sendNetworkUpdates() {
        if (!this.multiplayer || !this.multiplayer.isHost) return;

        const zombieList: any[] = [];
        this.zombies.zombiesMap.forEach((z, id) => {
            zombieList.push({ id, x: z.x, y: z.y });
        });

        if (zombieList.length > 0) {
            this.multiplayer.broadcast('zombie-update', { list: zombieList });
        }

        this.multiplayer.broadcast('move', {
            x: this.playerData.x,
            y: this.playerData.y,
            angle: this.localPlayer.rotation
        });
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

    setupNetworkEvents() {
        EventBus.on('network-data', ({ from, data }: any) => {
            this.lastSeenMap.set(from, this.time.now);
            const msg = JSON.parse(data);

            if (from === this.hostID_atual) {
                this.lastHostHeartbeat = this.time.now;
            }

            if (msg.type === 'host-migration-start') {
                this.hostID_atual = msg.newHostID; // Muda quem eu devo ouvir
                this.lastHostHeartbeat = this.time.now;
                console.log("Sessão migrada para o novo Host:", msg.newHostID);
            }

            if (msg.type === 'player-leaving') {
                this.removeGhostPlayer(from);
            }
            if (msg.type === 'move') {
                this.lastRemoteData.set(from, { x: msg.x, y: msg.y });

                let remote = this.remotePlayers.get(from);
                if (!remote) {
                    remote = new Player(this, msg.x, msg.y, false);
                    this.remotePlayers.set(from, remote);
                }

                const isoX = msg.x - msg.y;
                const isoY = (msg.x + msg.y) / 2;
                remote.setPosition(isoX, isoY);
                remote.setRotation(msg.angle);
                remote.setDepth(remote.y);
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
                        if (!this.isHost) {
                            zombie.setData('targetX', zData.x);
                            zombie.setData('targetY', zData.y);
                        } else {
                            zombie.setPosition(zData.x, zData.y);
                        }
                    } else if (!this.isHost) {
                        const newZombie = this.zombies.spawn(zData.id, zData.x, zData.y);
                        newZombie.setData('targetX', zData.x);
                        newZombie.setData('targetY', zData.y);
                    }
                });
            }

            if (msg.type === 'zombie-death') {
                this.zombies.remove(msg.id);
            }
        });
        EventBus.on('peer-disconnected', (id: string) => {
            console.log("Limpando fantasma do player:", id);

            // 1. Remove o boneco visual da tela
            const remote = this.remotePlayers.get(id);
            if (remote) {
                remote.destroy(); // Mata o objeto no Phaser
                this.remotePlayers.delete(id); // Remove do Map visual
            }

            // 2. Remove os dados de posição (ESSENCIAL PARA OS ZUMBIS PARAREM DE IR NELE)
            this.lastRemoteData.delete(id);

            // 3. Remove da lista de sucessão caso você seja o host
            this.multiplayer.removePeer(id);
        });
    }

    removeGhostPlayer(id: string) {
        console.log("Exorcizando fantasma:", id);

        const remote = this.remotePlayers.get(id);
        if (remote) {
            remote.destroy();
            this.remotePlayers.delete(id);
        }
        this.lastRemoteData.delete(id);
        this.lastSeenMap.delete(id);
        this.multiplayer.removePeer(id);
    }

    handleRemoteMove(id: string, data: any) {
        let remote = this.remotePlayers.get(id);

        if (!remote) {
            remote = new Player(this, data.x, data.y, false);
            this.remotePlayers.set(id, remote);
        }

        const targetIsoX = data.x - data.y;
        const targetIsoY = (data.x + data.y) / 2;

        this.tweens.add({
            targets: remote,
            x: targetIsoX,
            y: targetIsoY,
            duration: 50, // Tempo entre as batidas do worker (50ms)
            ease: 'Linear'
        });

        remote.setRotation(data.angle)
    }

    update(_time: number, delta: number) {
        const timeoutThreshold = 10000;
        this.lastSeenMap.forEach((lastTime, id) => {
            if (_time - lastTime > timeoutThreshold) {
                console.warn("Player", id, "está em silêncio há muito tempo. Removendo...");
                this.removeGhostPlayer(id);
            }
        });
        if (this.isHost) {
            const allPlayers = [{ id: 'host', x: this.playerData.x, y: this.playerData.y }];

            this.remotePlayers.forEach((_p, id) => {
                const data = this.lastRemoteData.get(id);
                if (data) {
                    allPlayers.push({ id, x: data.x, y: data.y });
                }
            });

            this.zombies.updateHost(allPlayers);
        }
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

        this.cameras.main.centerOn(isoX, isoY);

        if (!this.isHost) {
            this.checkHostHealth(_time);
        }
        if (!this.isHost) {
            this.zombies.zombiesMap.forEach((zombie) => {
                const targetX = zombie.getData('targetX');
                const targetY = zombie.getData('targetY');

                if (targetX !== undefined && targetY !== undefined) {
                    // O valor 0.2 define a suavidade (0.1 = mais lento/suave, 0.5 = mais rápido)
                    const lerpFactor = 0.15;

                    const newX = Phaser.Math.Linear(zombie.x, targetX, lerpFactor);
                    const newY = Phaser.Math.Linear(zombie.y, targetY, lerpFactor);

                    zombie.setPosition(newX, newY);
                    zombie.setDepth(newY); // Mantém a profundidade correta
                }
            });
        }
    }

    runHostSimulation() {
        // 1. Atualiza IA dos Zumbis
        const allPlayers = [{ id: 'host', x: this.playerData.x, y: this.playerData.y }];
        this.remotePlayers.forEach((_p, id) => {
            const data = this.lastRemoteData.get(id);
            if (data) allPlayers.push({ id, x: data.x, y: data.y });
        });
        this.zombies.updateHost(allPlayers);

        // 2. FORÇA A FÍSICA A ANDAR (Passo manual de 33ms)
        // Isso garante que colisões e movimentos funcionem a 30fps no background
        this.physics.world.step(1 / 30);

        // 3. Checa colisões de tiros (manual)
        this.physics.world.overlap(this.bullets, this.zombies.group, (bullet: any, zombie: any) => {
            this.handleZombieHit(bullet, zombie);
        });

        // 4. Envia tudo para os clientes
        this.sendNetworkUpdates();
    }

    sendClientData() {
        // Se você for cliente e estiver minimizado, continue mandando sua posição
        this.multiplayer.broadcast('move', {
            x: this.playerData.x,
            y: this.playerData.y,
            angle: this.localPlayer.rotation
        });
    }

    handleZombieHit(bullet: Phaser.GameObjects.GameObject, zombieContainer: Phaser.GameObjects.Container) {
        // 1. Destruir a bala
        bullet.destroy();

        // 2. Achar o ID do zumbi
        let zombieId = "";
        this.zombies.zombiesMap.forEach((v, k) => {
            if (v === zombieContainer) zombieId = k;
        });

        if (zombieId) {
            // 3. Remover fisicamente do Host imediatamente
            this.zombies.remove(zombieId);

            // 4. Avisar todos os players para removerem também
            this.multiplayer.broadcast('zombie-death', { id: zombieId });
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

    checkHostHealth(currentTime: number) {
        if (this.isHost || this.lastHostHeartbeat === 0) return;

        const timeSinceLastSignal = currentTime - this.lastHostHeartbeat;

        if (timeSinceLastSignal > this.migrationThreshold) {
            // FILTRO: Pegamos todos os players, EXCETO o host que sumiu
            const remainingPeers = this.multiplayer.allPeers.filter(id => id !== this.hostID_atual);

            // O novo sucessor é o menor ID entre os que sobraram
            const nextHost = remainingPeers[0];

            if (nextHost === this.multiplayer.myID) {
                console.log("%c EU SOU O NOVO HOST!", "background: red; color: white; font-size: 20px");
                this.becomeHost();
            } else {
                // Se eu não sou o próximo, eu apenas espero, mas evito o spam
                if (this.time.now % 2000 < 20) { // Loga apenas a cada 2 segundos
                    console.log("Aguardando sucessor real:", nextHost);
                }
            }
        }
    }

    becomeHost() {
        if (this.isHost) return;

        const oldHostID = this.hostID_atual; // Guarda quem era o fantasma

        this.isHost = true;
        this.hostID_atual = this.multiplayer.myID;

        const ghostPlayer = this.remotePlayers.get(oldHostID);
        if (ghostPlayer) {
            ghostPlayer.destroy();
            this.remotePlayers.delete(oldHostID);
        }

        this.lastRemoteData.delete(oldHostID);

        this.multiplayer.removePeer(oldHostID);

        // --- CONTINUAÇÃO NORMAL ---
        this.multiplayer.broadcast('host-migration-start', {
            newHostID: this.multiplayer.myID
        });

        this.startHostHeartbeat();
        console.log("%c EU SOU O NOVO HOST E LIMPEI OS FANTASMAS!", "color: red; font-weight: bold;");
    }

    handleHostMigration(newHostID: string) {
        const oldHostID = this.hostID_atual;

        // Se o host antigo ainda estiver na tela, removemos
        const oldSprite = this.remotePlayers.get(oldHostID);
        if (oldSprite) {
            oldSprite.destroy();
            this.remotePlayers.delete(oldHostID);
        }
        this.lastRemoteData.delete(oldHostID);

        // Agora o "Dono da Sala" mudou
        this.hostID_atual = newHostID;
        this.lastHostHeartbeat = this.time.now;
    }

    startHostHeartbeat() {
        // Se já existir um worker, mata o antigo antes de começar
        this.heartbeatWorker?.terminate();

        this.heartbeatWorker = new Worker('/heartbeatWorker.js');
        this.heartbeatWorker.onmessage = (e) => {
            if (e.data === 'tick' && this.isHost) {
                this.runHostSimulation();
            }
        };
        console.log("Marcapasso de Host iniciado!");
    }
}