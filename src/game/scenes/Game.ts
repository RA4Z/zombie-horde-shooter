import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { Player } from '../entities/Player';
import { ZombieManager } from '../entities/ZombieManager';
import { MultiplayerService } from '../network/Multiplayer';
import { cartesianToIso } from '../utils/IsoMath';

/** Estado lógico (mundo cartesiano) do jogador local */
interface PlayerData {
    x: number;
    y: number;
    speed: number;
    hp: number;
}

/**
 * Cena principal do jogo.
 *
 * Responsabilidades:
 *  - Input local (teclado + mouse)
 *  - Disparo de projéteis
 *  - Sincronização de rede (via MultiplayerService + EventBus)
 *  - Host Migration automática
 *  - Loop de atualização de zumbis (host) e interpolação (cliente)
 */
export class Game extends Scene {
    // ─── Entidades ───────────────────────────────────────────────────────────
    private localPlayer!: Player;
    private remotePlayers: Map<string, Player> = new Map();
    private bullets!: Phaser.Physics.Arcade.Group;
    private zombies!: ZombieManager;

    // ─── Rede ────────────────────────────────────────────────────────────────
    private multiplayer!: MultiplayerService;
    private isHost: boolean = false;
    private hostID: string = '';
    private lastHostHeartbeat: number = 0;
    private readonly MIGRATION_THRESHOLD = 4000; // ms sem heartbeat → migração

    // ─── Estado do jogador ───────────────────────────────────────────────────
    private playerData: PlayerData = { x: 0, y: 0, speed: 250, hp: 100 };
    private lastDamageTime: number = 0;

    // ─── Snapshots de rede ───────────────────────────────────────────────────
    /** Última posição lógica conhecida de cada peer (para IA dos zumbis) */
    private lastRemoteData: Map<string, { x: number; y: number }> = new Map();
    /** Último timestamp em que cada peer mandou dados (para timeout) */
    private lastSeenMap: Map<string, number> = new Map();

    // ─── Input ───────────────────────────────────────────────────────────────
    private wasd!: Record<string, Phaser.Input.Keyboard.Key>;

    // ─── Worker (simulação em background) ────────────────────────────────────
    private heartbeatWorker: Worker | null = null;

    // ─── Timers ──────────────────────────────────────────────────────────────
    /** Timer Phaser para broadcast periódico do host */
    private networkTimer!: Phaser.Time.TimerEvent;
    /** Timer Phaser para spawn periódico de zumbis (apenas host) */
    private spawnTimer!: Phaser.Time.TimerEvent;

    constructor() {
        super('Game');
    }

    // =========================================================================
    // Ciclo de vida
    // =========================================================================

    create() {
        // Previne comportamento estranho ao trocar de aba
        this.sound.pauseOnBlur = false;
        this.game.events.removeAllListeners('blur');
        this.game.events.removeAllListeners('focus');

        // Avisa o jogador ao fechar a aba
        window.addEventListener('beforeunload', this.onBeforeUnload);

        this.cameras.main.setBackgroundColor('#2d2d2d');

        // ── Entidades ──
        this.multiplayer = new MultiplayerService();
        this.zombies      = new ZombieManager(this);
        this.bullets      = this.physics.add.group();
        this.localPlayer  = new Player(this, 0, 0, true);

        // ── Input ──
        if (this.input.keyboard) {
            this.wasd = this.input.keyboard.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
        }
        this.input.on('pointerdown', this.shoot, this);

        // ── Colisões ──
        this.physics.add.overlap(
            this.bullets,
            this.zombies.group,
            (_bullet, _zombie) => this.handleZombieHit(
                _bullet as Phaser.GameObjects.GameObject,
                _zombie as Phaser.GameObjects.Container,
            ),
        );

        this.physics.add.overlap(
            this.localPlayer,
            this.zombies.group,
            this.handlePlayerZombieOverlap,
            undefined,
            this,
        );

        // ── Timers de rede / spawn ──
        this.networkTimer = this.time.addEvent({
            delay: 50,           // ~20Hz de broadcast
            callback: this.sendNetworkUpdates,
            callbackScope: this,
            loop: true,
            paused: true,        // só ativa após entrar na sala
        });

        this.spawnTimer = this.time.addEvent({
            delay: 2000,
            callback: () => { if (this.isHost) this.spawnZombieHost(); },
            callbackScope: this,
            loop: true,
            paused: true,
        });

        // ── Worker de heartbeat para rodar quando minimizado ──
        this.initHeartbeatWorker();

        // ── Eventos de rede ──
        this.setupNetworkEvents();

        // ── Comando de início vindo do React ──
        EventBus.once('start-game', this.onStartGame, this);

        this.cameras.main.centerOn(0, 0);
        EventBus.emit('current-scene-ready', this);
    }

    update(_time: number, delta: number) {
        const TIMEOUT_THRESHOLD = 10_000;

        // Remove players que pararam de mandar dados
        this.lastSeenMap.forEach((lastTime, id) => {
            if (_time - lastTime > TIMEOUT_THRESHOLD) {
                console.warn('[Game] Player silencioso, removendo:', id);
                this.removePlayer(id);
            }
        });

        // ── Host: atualiza IA dos zumbis no loop principal também ──
        if (this.isHost) {
            this.zombies.updateHost(this.buildPlayerList());
        } else {
            // Cliente: interpola zumbis suavemente
            this.zombies.interpolateClient(0.15);
            // Verifica se o host está vivo
            this.checkHostHealth(_time);
        }

        // ── Movimento local ──
        this.processMovement(delta);

        // ── Rotação para o cursor ──
        this.aimAtPointer();

        // ── Câmera segue o player local ──
        const { isoX, isoY } = cartesianToIso(this.playerData.x, this.playerData.y);
        this.cameras.main.centerOn(isoX, isoY);
    }

    shutdown() {
        window.removeEventListener('beforeunload', this.onBeforeUnload);
        this.heartbeatWorker?.terminate();
        this.heartbeatWorker = null;
        this.multiplayer.destroy();
        EventBus.removeAllListeners();
    }

    // =========================================================================
    // Inicialização
    // =========================================================================

    private onStartGame = async (data: { isHost: boolean; roomId?: string }) => {
        this.isHost = data.isHost;
        this.lastHostHeartbeat = this.time.now;

        if (this.isHost) {
            const key = await this.multiplayer.hostGame();
            this.hostID = this.multiplayer.myID;
            this.multiplayer.startHostHeartbeat();
            this.networkTimer.paused = false;
            this.spawnTimer.paused   = false;
            EventBus.emit('room-joined', key);
        } else if (data.roomId) {
            console.log('[Game] Conectando ao host:', data.roomId);
            await this.multiplayer.joinGame(data.roomId);
            this.hostID = data.roomId;
            // room-joined é emitido pelo MultiplayerService ao abrir a conexão
        }
    };

    private initHeartbeatWorker() {
        try {
            this.heartbeatWorker = new Worker('/heartbeatWorker.js');
            this.heartbeatWorker.onmessage = (e) => {
                if (e.data !== 'tick') return;
                if (this.isHost) {
                    this.runHostBackgroundSimulation();
                } else {
                    this.sendClientData();
                }
            };
        } catch {
            console.warn('[Game] heartbeatWorker não encontrado — simulação em background desativada.');
        }

        this.events.on('destroy', () => {
            this.heartbeatWorker?.terminate();
        });
    }

    // =========================================================================
    // Eventos de rede
    // =========================================================================

    private setupNetworkEvents() {
        EventBus.on('network-data', this.onNetworkData, this);
        EventBus.on('peer-disconnected', this.onPeerDisconnected, this);
    }

    private onNetworkData = ({ from, data }: { from: string; data: Record<string, unknown> }) => {
        this.lastSeenMap.set(from, this.time.now);

        const type = data.type as string;

        if (from === this.hostID || type === 'host-heartbeat') {
            this.lastHostHeartbeat = this.time.now;
        }

        switch (type) {
            case 'host-heartbeat':
                break;

            case 'host-migration-start':
                this.handleHostMigration(data.newHostID as string);
                break;

            case 'player-leaving':
                this.removePlayer(from);
                break;

            case 'move':
                this.handleRemoteMove(from, data);
                break;

            case 'player-shoot':
                this.createBullet(data.x as number, data.y as number, data.angle as number);
                break;

            case 'zombie-spawn':
                this.zombies.spawn(data.id as string, data.x as number, data.y as number);
                break;

            case 'zombie-update':
                this.handleZombieUpdate(data.list as Array<{ id: string; isoX: number; isoY: number }>);
                break;

            case 'zombie-death':
                this.zombies.remove(data.id as string);
                break;

            default:
                console.warn('[Game] Tipo de mensagem desconhecido:', type);
        }
    };

    private onPeerDisconnected = (id: string) => {
        console.log('[Game] Peer desconectado:', id);
        this.removePlayer(id);
    };

    // =========================================================================
    // Lógica do host
    // =========================================================================

    private sendNetworkUpdates() {
        if (!this.isHost) return;

        // Envia posição do host
        this.multiplayer.broadcast('move', {
            x: this.playerData.x,
            y: this.playerData.y,
            angle: this.localPlayer.rotation,
        });

        // Envia posições ISO dos zumbis para os clientes interpolarem
        const zombieList: Array<{ id: string; isoX: number; isoY: number }> = [];
        this.zombies.zombiesMap.forEach((z, id) => {
            zombieList.push({ id, isoX: z.x, isoY: z.y });
        });

        if (zombieList.length > 0) {
            this.multiplayer.broadcast('zombie-update', { list: zombieList });
        }
    }

    private spawnZombieHost() {
        const id = `zombie_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
        const angle = Math.random() * Math.PI * 2;
        const dist  = 600;
        // Spawn ao redor do host em coordenadas de MUNDO
        const worldX = this.playerData.x + Math.cos(angle) * dist;
        const worldY = this.playerData.y + Math.sin(angle) * dist;

        this.zombies.spawn(id, worldX, worldY);
        this.multiplayer.broadcast('zombie-spawn', { id, x: worldX, y: worldY });
    }

    /** Roda quando o jogo está em background (via Worker) */
    private runHostBackgroundSimulation() {
        this.zombies.updateHost(this.buildPlayerList());
        this.physics.world.step(1 / 30);
        this.physics.world.overlap(
            this.bullets,
            this.zombies.group,
            (b, z) => this.handleZombieHit(
                b as Phaser.GameObjects.GameObject,
                z as Phaser.GameObjects.Container,
            ),
        );
        this.sendNetworkUpdates();
    }

    private startHostRole() {
        this.isHost = true;
        this.hostID = this.multiplayer.myID;
        this.multiplayer.startHostHeartbeat();
        this.networkTimer.paused = false;
        this.spawnTimer.paused   = false;
    }

    // =========================================================================
    // Host Migration
    // =========================================================================

    private checkHostHealth(currentTime: number) {
        if (this.isHost || this.lastHostHeartbeat === 0) return;

        const elapsed = currentTime - this.lastHostHeartbeat;
        if (elapsed < this.MIGRATION_THRESHOLD) return;

        const remaining = this.multiplayer.allPeers.filter(id => id !== this.hostID);
        const nextHost  = remaining[0]; // menor ID alfabético

        if (nextHost === this.multiplayer.myID) {
            console.log('%c[Migration] EU SOU O NOVO HOST', 'color:red;font-weight:bold;font-size:16px');
            this.becomeHost();
        }
        // else: aguarda o novo host anunciar-se via host-migration-start
    }

    private becomeHost() {
        if (this.isHost) return;

        const oldHostID = this.hostID;
        this.removePlayer(oldHostID); // limpa o fantasma do host antigo

        this.multiplayer.removePeer(oldHostID);

        this.startHostRole();

        this.multiplayer.broadcast('host-migration-start', {
            newHostID: this.multiplayer.myID,
        });

        console.log('[Migration] Migração concluída, novo host:', this.multiplayer.myID);
    }

    private handleHostMigration(newHostID: string) {
        this.removePlayer(this.hostID);   // remove sprite do host antigo
        this.hostID = newHostID;
        this.lastHostHeartbeat = this.time.now;
        console.log('[Migration] Novo host reconhecido:', newHostID);
    }

    // =========================================================================
    // Jogadores remotos
    // =========================================================================

    private handleRemoteMove(id: string, data: Record<string, unknown>) {
        this.lastRemoteData.set(id, { x: data.x as number, y: data.y as number });

        let remote = this.remotePlayers.get(id);
        if (!remote) {
            remote = new Player(this, 0, 0, false);
            this.remotePlayers.set(id, remote);
        }

        const { isoX, isoY } = cartesianToIso(data.x as number, data.y as number);

        // Tween curto para suavizar o movimento de rede
        this.tweens.add({
            targets: remote,
            x: isoX,
            y: isoY,
            duration: 50,
            ease: 'Linear',
        });

        remote.setRotation(data.angle as number);
        remote.setDepth(isoY);
    }

    private removePlayer(id: string) {
        const remote = this.remotePlayers.get(id);
        if (remote) {
            remote.destroy();
            this.remotePlayers.delete(id);
        }
        this.lastRemoteData.delete(id);
        this.lastSeenMap.delete(id);
        this.multiplayer.removePeer(id);
    }

    // =========================================================================
    // Zumbis
    // =========================================================================

    private handleZombieUpdate(list: Array<{ id: string; isoX: number; isoY: number }>) {
        list.forEach(({ id, isoX, isoY }) => {
            if (!this.zombies.zombiesMap.has(id)) {
                // Cria o zumbi com posição ISO convertida de volta (aproximado)
                this.zombies.spawn(id, isoX, isoY);
            }
            if (!this.isHost) {
                this.zombies.setTarget(id, isoX, isoY);
            }
        });
    }

    private handleZombieHit(
        bullet: Phaser.GameObjects.GameObject,
        zombieContainer: Phaser.GameObjects.Container,
    ) {
        bullet.destroy();

        // Encontra o ID pelo container (poderia ser otimizado com WeakMap reverso)
        let zombieId: string | undefined;
        this.zombies.zombiesMap.forEach((v, k) => {
            if (v === zombieContainer) zombieId = k;
        });

        if (zombieId) {
            this.zombies.remove(zombieId);
            this.multiplayer.broadcast('zombie-death', { id: zombieId });
        }
    }

    private handlePlayerZombieOverlap = () => {
        if (this.time.now <= this.lastDamageTime) return;

        this.playerData.hp = Math.max(0, this.playerData.hp - 10);
        this.lastDamageTime = this.time.now + 500; // 500ms de invulnerabilidade

        EventBus.emit('player-stats', { hp: this.playerData.hp });

        if (this.playerData.hp <= 0) {
            this.scene.start('GameOver');
        }
    };

    // =========================================================================
    // Disparo
    // =========================================================================

    private shoot() {
        const angle = this.localPlayer.rotation;
        this.createBullet(this.playerData.x, this.playerData.y, angle);
        this.multiplayer.broadcast('player-shoot', {
            x: this.playerData.x,
            y: this.playerData.y,
            angle,
        });
    }

    private createBullet(worldX: number, worldY: number, angle: number) {
        const { isoX, isoY } = cartesianToIso(worldX, worldY);

        const bullet = this.add.circle(isoX, isoY, 5, 0xffff00);
        this.physics.add.existing(bullet);
        this.bullets.add(bullet);

        const body = bullet.body as Phaser.Physics.Arcade.Body;
        body.setSize(15, 15);
        body.setVelocity(
            Math.cos(angle) * 900,
            (Math.sin(angle) * 900) / 2,
        );

        // Auto-destruição após 1 segundo
        this.time.delayedCall(1000, () => {
            if (bullet.active) bullet.destroy();
        });
    }

    // =========================================================================
    // Input / movimento
    // =========================================================================

    private processMovement(delta: number) {
        let moveX = 0;
        let moveY = 0;

        if (this.wasd?.A?.isDown) moveX -= 1;
        if (this.wasd?.D?.isDown) moveX += 1;
        if (this.wasd?.W?.isDown) moveY -= 1;
        if (this.wasd?.S?.isDown) moveY += 1;

        if (moveX !== 0 || moveY !== 0) {
            const len = Math.hypot(moveX, moveY);
            const dt  = delta / 1000;
            this.playerData.x += (moveX / len) * this.playerData.speed * dt;
            this.playerData.y += (moveY / len) * this.playerData.speed * dt;
        }

        const { isoX, isoY } = cartesianToIso(this.playerData.x, this.playerData.y);
        this.localPlayer.setPosition(isoX, isoY);
        this.localPlayer.setDepth(isoY);
    }

    private aimAtPointer() {
        const pointer = this.input.activePointer;
        const cx = this.cameras.main.width  / 2;
        const cy = this.cameras.main.height / 2;
        // Fator 2 compensa o achatamento isométrico no eixo Y
        const angle = Math.atan2((pointer.y - cy) * 2, pointer.x - cx);
        this.localPlayer.setRotation(angle);
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private buildPlayerList() {
        const list = [{ id: 'host', x: this.playerData.x, y: this.playerData.y }];
        this.remotePlayers.forEach((_p, id) => {
            const d = this.lastRemoteData.get(id);
            if (d) list.push({ id, x: d.x, y: d.y });
        });
        return list;
    }

    private sendClientData() {
        this.multiplayer.broadcast('move', {
            x: this.playerData.x,
            y: this.playerData.y,
            angle: this.localPlayer.rotation,
        });
    }

    private onBeforeUnload = () => {
        this.multiplayer.broadcast('player-leaving', { id: this.multiplayer.myID });
    };
}