import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { Player } from '../entities/Player';
import { ZombieManager } from '../entities/ZombieManager';
import { HordeManager } from '../entities/HordeManager';
import { ScoreManager } from '../entities/ScoreManager';
import { VoteManager, VoteChoice } from '../entities/VoteManager';
import { MultiplayerService } from '../network/Multiplayer';
import { cartesianToIso } from '../utils/IsoMath';

interface PlayerData {
    x: number;
    y: number;
    speed: number;
    hp: number;
}

// ID reservado para o host local
const HOST_PLAYER_ID = '__host__';

export class Game extends Scene {
    // ── Entidades ──────────────────────────────────────────────────────────
    private localPlayer!: Player;
    private remotePlayers: Map<string, Player> = new Map();
    private bullets!: Phaser.Physics.Arcade.Group;
    private zombies!: ZombieManager;

    // ── Sistemas ───────────────────────────────────────────────────────────
    private horde!: HordeManager;
    private score!: ScoreManager;
    private vote!: VoteManager;

    // ── Rede ───────────────────────────────────────────────────────────────
    private multiplayer!: MultiplayerService;
    private isHost = false;
    private hostID = '';
    private lastHostHeartbeat = 0;
    private readonly MIGRATION_THRESHOLD = 4000;

    // ── Estado local ───────────────────────────────────────────────────────
    private playerData: PlayerData = { x: 0, y: 0, speed: 250, hp: 100 };
    private lastDamageTime = 0;
    private isAlive = true;
    private isSpectating = false;
    /** ID do player sendo espectado (apenas quando morto) */
    private spectateTargetId = '';
    private myId = HOST_PLAYER_ID;   // sobrescrito ao conectar

    // ── Snapshots de rede ──────────────────────────────────────────────────
    private lastRemoteData: Map<string, { x: number; y: number }> = new Map();
    private lastSeenMap: Map<string, number> = new Map();

    // ── Input ──────────────────────────────────────────────────────────────
    private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
    private spectateKeys!: { left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };

    // ── Timers ─────────────────────────────────────────────────────────────
    private networkTimer!: Phaser.Time.TimerEvent;

    // ── Worker ─────────────────────────────────────────────────────────────
    private heartbeatWorker: Worker | null = null;

    constructor() { super('Game'); }

    // =========================================================================
    create() {
        this.sound.pauseOnBlur = false;
        this.game.events.removeAllListeners('blur');
        this.game.events.removeAllListeners('focus');
        window.addEventListener('beforeunload', this.onBeforeUnload);

        this.cameras.main.setBackgroundColor('#1e1e2e');

        // ── Sistemas ──
        this.multiplayer = new MultiplayerService();
        this.zombies     = new ZombieManager(this);
        this.horde       = new HordeManager();
        this.score       = new ScoreManager();
        this.vote        = new VoteManager();
        this.bullets     = this.physics.add.group();
        this.localPlayer = new Player(this, 0, 0, true);

        // ── Input ──
        if (this.input.keyboard) {
            this.wasd = this.input.keyboard.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
            this.spectateKeys = {
                left:  this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
                right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
            };
        }
        this.input.on('pointerdown', this.shoot, this);

        // ── Colisões ──
        this.physics.add.overlap(
            this.bullets, this.zombies.group,
            (_b, _z) => this.handleZombieHit(_b as Phaser.GameObjects.GameObject, _z as Phaser.GameObjects.Container),
        );
        this.physics.add.overlap(
            this.localPlayer, this.zombies.group,
            this.handlePlayerZombieOverlap, undefined, this,
        );

        // ── Timers ──
        this.networkTimer = this.time.addEvent({
            delay: 50, callback: this.sendNetworkUpdates,
            callbackScope: this, loop: true, paused: true,
        });

        // ── Horde hooks ──
        this.horde.onSpawnZombie  = () => this.spawnZombieHost();
        this.horde.onStateChange  = (state: any) => {
            this.multiplayer.broadcast('horde-state', { state });
            // Bonifica jogadores ao completar horda
            if (state.phase === 'countdown' && state.wave > 0) {
                this.score.onWaveComplete(state.wave);
                this.broadcastScores();
            }
        };

        // ── Vote hooks ──
        this.vote.onRestart  = (staying: any) => this.handleVoteRestart(staying);
        this.vote.onAllLeave = () => this.multiplayer.broadcast('session-end', {});

        this.initHeartbeatWorker();
        this.setupNetworkEvents();
        EventBus.once('start-game', this.onStartGame, this);
        EventBus.on('cast-vote', (choice: VoteChoice) => {
            if (this.isHost) {
                this.vote.castVote(this.myId, choice);
            } else {
                this.multiplayer.broadcast('cast-vote', { choice });
            }
        });

        this.cameras.main.centerOn(0, 0);
        EventBus.emit('current-scene-ready', this);
    }

    // =========================================================================
    update(_time: number, delta: number) {
        const TIMEOUT = 10_000;
        this.lastSeenMap.forEach((t, id) => {
            if (_time - t > TIMEOUT) this.removePlayer(id);
        });

        if (this.isHost) {
            // Apenas players VIVOS para a IA dos zumbis
            this.zombies.updateHost(this.buildAlivePlayerList());
        } else {
            this.zombies.interpolateClient(0.15);
            this.checkHostHealth(_time);
        }

        if (this.isAlive) {
            this.processMovement(delta);
            this.aimAtPointer();
        } else if (this.isSpectating) {
            this.updateSpectator(delta);
        }

        // Câmera segue o alvo (player local ou espectado)
        this.updateCamera();
    }

    shutdown() {
        window.removeEventListener('beforeunload', this.onBeforeUnload);
        this.heartbeatWorker?.terminate();
        this.horde.destroy();
        this.vote.destroy();
        this.multiplayer.destroy();
        EventBus.removeAllListeners();
    }

    // =========================================================================
    // Início / Role
    // =========================================================================

    private onStartGame = async (data: { isHost: boolean; roomId?: string }) => {
        this.isHost = data.isHost;
        this.lastHostHeartbeat = this.time.now;

        if (this.isHost) {
            this.myId = HOST_PLAYER_ID;
            const key = await this.multiplayer.hostGame();
            this.hostID = this.multiplayer.myID;
            this.score.registerPlayer(this.myId, 'Host');
            this.multiplayer.startHostHeartbeat();
            this.networkTimer.paused = false;
            this.horde.start();
            EventBus.emit('room-joined', key);
        } else if (data.roomId) {
            await this.multiplayer.joinGame(data.roomId);
            this.myId = this.multiplayer.myID;
            this.hostID = data.roomId;
        }
    };

    private startHostRole() {
        this.isHost = true;
        this.hostID = this.multiplayer.myID;
        this.multiplayer.startHostHeartbeat();
        this.networkTimer.paused = false;
    }

    private initHeartbeatWorker() {
        try {
            this.heartbeatWorker = new Worker('/heartbeatWorker.js');
            this.heartbeatWorker.onmessage = (e) => {
                if (e.data !== 'tick') return;
                if (this.isHost) this.runHostBackgroundSimulation();
                else this.sendClientData();
            };
        } catch {
            console.warn('[Game] heartbeatWorker não encontrado.');
        }
        this.events.on('destroy', () => this.heartbeatWorker?.terminate());
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
            case 'host-heartbeat': break;

            case 'host-migration-start':
                this.handleHostMigration(data.newHostID as string);
                break;

            case 'player-joined':
                // Host registra novo player
                if (this.isHost) {
                    this.score.registerPlayer(from, data.name as string ?? from.slice(0, 6));
                    this.broadcastScores();
                    // Sincroniza estado atual para o novo player
                    this.multiplayer.broadcast('horde-state', { state: this.horde.getState() });
                }
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
                if (!this.isHost)
                    this.zombies.spawn(data.id as string, data.x as number, data.y as number, data.hp as number);
                break;

            case 'zombie-update':
                this.handleZombieUpdate(data.list as Array<{ id: string; isoX: number; isoY: number }>);
                break;

            case 'zombie-death':
                this.zombies.remove(data.id as string);
                break;

            case 'horde-state':
                if (!this.isHost) this.horde.applyNetworkState(data.state as any);
                break;

            case 'score-update':
                if (!this.isHost) this.score.applySnapshot(data.scores as any);
                break;

            case 'player-dead':
                // Outro player morreu: remove da lista de alvos de IA
                this.lastRemoteData.delete(from);
                break;

            case 'cast-vote':
                if (this.isHost) this.vote.castVote(from, data.choice as VoteChoice);
                break;

            case 'vote-state':
                if (!this.isHost) this.vote.applyNetworkState(data as any);
                break;

            case 'vote-resolved':
                this.handleVoteResolved(data.staying as string[]);
                break;

            case 'session-end':
                EventBus.emit('session-end');
                break;

            case 'game-restart':
                this.restartGame();
                break;

            default:
                console.warn('[Game] Tipo desconhecido:', type);
        }
    };

    private onPeerDisconnected = (id: string) => {
        this.removePlayer(id);
        if (this.isHost) {
            this.score.markDead(id);
            this.checkAllDead();
        }
    };

    // =========================================================================
    // Host Migration
    // =========================================================================

    private checkHostHealth(t: number) {
        if (this.isHost || this.lastHostHeartbeat === 0) return;
        if (t - this.lastHostHeartbeat < this.MIGRATION_THRESHOLD) return;
        const remaining = this.multiplayer.allPeers.filter(id => id !== this.hostID);
        if (remaining[0] === this.multiplayer.myID) this.becomeHost();
    }

    private becomeHost() {
        if (this.isHost) return;
        const old = this.hostID;
        this.removePlayer(old);
        this.multiplayer.removePeer(old);
        this.startHostRole();
        this.multiplayer.broadcast('host-migration-start', { newHostID: this.multiplayer.myID });
        // Assume controle do horde
        this.horde.start();
    }

    private handleHostMigration(newHostID: string) {
        this.removePlayer(this.hostID);
        this.hostID = newHostID;
        this.lastHostHeartbeat = this.time.now;
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
        this.tweens.add({ targets: remote, x: isoX, y: isoY, duration: 50, ease: 'Linear' });
        remote.setRotation(data.angle as number);
        remote.setDepth(isoY);
    }

    private removePlayer(id: string) {
        const remote = this.remotePlayers.get(id);
        if (remote) { remote.destroy(); this.remotePlayers.delete(id); }
        this.lastRemoteData.delete(id);
        this.lastSeenMap.delete(id);
        this.multiplayer.removePeer(id);
    }

    // =========================================================================
    // Zumbis
    // =========================================================================

    private spawnZombieHost() {
        const id = `z_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const angle  = Math.random() * Math.PI * 2;
        const dist   = 600;
        const worldX = this.playerData.x + Math.cos(angle) * dist;
        const worldY = this.playerData.y + Math.sin(angle) * dist;
        const hp     = this.horde.zombieHp;

        this.zombies.spawn(id, worldX, worldY, hp);
        this.multiplayer.broadcast('zombie-spawn', { id, x: worldX, y: worldY, hp });
    }

    private handleZombieUpdate(list: Array<{ id: string; isoX: number; isoY: number }>) {
        list.forEach(({ id, isoX, isoY }) => {
            if (!this.zombies.zombiesMap.has(id)) this.zombies.spawn(id, isoX, isoY);
            if (!this.isHost) this.zombies.setTarget(id, isoX, isoY);
        });
    }

    private handleZombieHit(
        bullet: Phaser.GameObjects.GameObject,
        zombieContainer: Phaser.GameObjects.Container,
    ) {
        if (!this.isHost) {
            bullet.destroy();
            return; // Apenas o host processa mortes
        }
        bullet.destroy();

        let zombieId: string | undefined;
        this.zombies.zombiesMap.forEach((v, k) => { if (v === zombieContainer) zombieId = k; });
        if (!zombieId) return;

        const died = this.zombies.hit(zombieId);
        if (died) {
            // Credita kill para o shooter — usamos o localPlayer do host
            this.score.addKill(this.myId, this.horde.wave);
            this.horde.onZombieDied();
            this.zombies.remove(zombieId);
            this.multiplayer.broadcast('zombie-death', { id: zombieId });
            this.broadcastScores();
        } else {
            // Sincroniza HP visual nos clientes (bala acertou mas não matou)
            this.multiplayer.broadcast('zombie-hit', { id: zombieId });
        }
    }

    private handlePlayerZombieOverlap = () => {
        if (!this.isAlive || this.time.now <= this.lastDamageTime) return;
        this.playerData.hp = Math.max(0, this.playerData.hp - 10);
        this.lastDamageTime = this.time.now + 500;
        EventBus.emit('player-stats', { hp: this.playerData.hp });

        if (this.playerData.hp <= 0) this.playerDied();
    };

    // =========================================================================
    // Morte / Espectador
    // =========================================================================

    private playerDied() {
        this.isAlive     = false;
        this.isSpectating = true;
        this.localPlayer.setVisible(false);
        this.localPlayer.setActive(false);

        // Desativa física para não receber mais dano
        const body = this.localPlayer.body as Phaser.Physics.Arcade.Body;
        body.enable = false;

        this.multiplayer.broadcast('player-dead', { id: this.myId });
        EventBus.emit('player-died', {});

        if (this.isHost) {
            this.score.markDead(this.myId);
            this.checkAllDead();
        }

        // Começa a espectar o primeiro player disponível
        this.startSpectating();
    }

    private startSpectating() {
        const targets = this.getSpectateTargets();
        if (targets.length > 0) {
            this.spectateTargetId = targets[0];
        }
        EventBus.emit('spectate-start', { targetId: this.spectateTargetId });
    }

    private getSpectateTargets(): string[] {
        // HOST_PLAYER_ID representa o host local; demais são IDs dos remotos
        const targets: string[] = [];
        if (this.isHost && this.isAlive) targets.push(HOST_PLAYER_ID);
        this.remotePlayers.forEach((p, id) => {
            if (p.active) targets.push(id);
        });
        return targets;
    }

    private updateSpectator(_delta: number) {
        // Q / E para trocar de alvo
        if (Phaser.Input.Keyboard.JustDown(this.spectateKeys.left)) this.cycleSpectateTarget(-1);
        if (Phaser.Input.Keyboard.JustDown(this.spectateKeys.right)) this.cycleSpectateTarget(1);
    }

    private cycleSpectateTarget(dir: 1 | -1) {
        const targets = this.getSpectateTargets();
        if (targets.length === 0) return;
        const idx  = targets.indexOf(this.spectateTargetId);
        const next = (idx + dir + targets.length) % targets.length;
        this.spectateTargetId = targets[next];
        EventBus.emit('spectate-target', { targetId: this.spectateTargetId });
    }

    private checkAllDead() {
        if (!this.isHost) return;
        if (!this.score.allDead()) return;

        // Pequeno delay para o último evento de morte propagar
        this.time.delayedCall(800, () => {
            const allIds = [this.myId, ...Array.from(this.remotePlayers.keys())];
            this.vote.start(allIds);
            this.multiplayer.broadcast('vote-state', { ...this.vote.getState() });
            EventBus.emit('show-leaderboard', {
                scores: this.score.getLeaderboard(),
                vote: this.vote.getState(),
            });
        });
    }

    // =========================================================================
    // Votação
    // =========================================================================

    private handleVoteResolved(staying: string[]) {
        EventBus.emit('vote-resolved', { staying });
    }

    private handleVoteRestart(staying: string[]) {
        // Avisa quem deve sair
        this.multiplayer.broadcast('vote-resolved', { staying });
        // Reinicia para quem fica
        this.time.delayedCall(500, () => {
            this.multiplayer.broadcast('game-restart', {});
            this.restartGame();
        });
    }

    private restartGame() {
        this.zombies.removeAll();
        this.score.reset();
        this.playerData.hp = 100;
        this.isAlive = true;
        this.isSpectating = false;
        this.localPlayer.setVisible(true);
        this.localPlayer.setActive(true);
        const body = this.localPlayer.body as Phaser.Physics.Arcade.Body;
        body.enable = true;
        EventBus.emit('player-stats', { hp: 100 });
        EventBus.emit('game-restarted', {});
        if (this.isHost) this.horde.start();
    }

    // =========================================================================
    // Host: simulação em background
    // =========================================================================

    private sendNetworkUpdates() {
        if (!this.isHost) return;

        this.multiplayer.broadcast('move', {
            x: this.playerData.x, y: this.playerData.y,
            angle: this.localPlayer.rotation,
        });

        const list: Array<{ id: string; isoX: number; isoY: number }> = [];
        this.zombies.zombiesMap.forEach((z, id) => list.push({ id, isoX: z.x, isoY: z.y }));
        if (list.length > 0) this.multiplayer.broadcast('zombie-update', { list });
    }

    private runHostBackgroundSimulation() {
        this.zombies.updateHost(this.buildAlivePlayerList());
        this.physics.world.step(1 / 30);
        this.physics.world.overlap(
            this.bullets, this.zombies.group,
            (b, z) => this.handleZombieHit(b as Phaser.GameObjects.GameObject, z as Phaser.GameObjects.Container),
        );
        this.sendNetworkUpdates();
    }

    private sendClientData() {
        if (!this.isAlive) return;
        this.multiplayer.broadcast('move', {
            x: this.playerData.x, y: this.playerData.y,
            angle: this.localPlayer.rotation,
        });
    }

    private broadcastScores() {
        this.multiplayer.broadcast('score-update', { scores: this.score.getLeaderboard() });
        EventBus.emit('score-update', this.score.getLeaderboard());
    }

    // =========================================================================
    // Input
    // =========================================================================

    private processMovement(delta: number) {
        let mx = 0, my = 0;
        if (this.wasd?.A?.isDown) mx -= 1;
        if (this.wasd?.D?.isDown) mx += 1;
        if (this.wasd?.W?.isDown) my -= 1;
        if (this.wasd?.S?.isDown) my += 1;

        if (mx !== 0 || my !== 0) {
            const len = Math.hypot(mx, my);
            const dt  = delta / 1000;
            this.playerData.x += (mx / len) * this.playerData.speed * dt;
            this.playerData.y += (my / len) * this.playerData.speed * dt;
        }

        const { isoX, isoY } = cartesianToIso(this.playerData.x, this.playerData.y);
        this.localPlayer.setPosition(isoX, isoY);
        this.localPlayer.setDepth(isoY);
    }

    private aimAtPointer() {
        const p  = this.input.activePointer;
        const cx = this.cameras.main.width  / 2;
        const cy = this.cameras.main.height / 2;
        this.localPlayer.setRotation(Math.atan2((p.y - cy) * 2, p.x - cx));
    }

    private shoot() {
        if (!this.isAlive) return;
        const angle = this.localPlayer.rotation;
        this.createBullet(this.playerData.x, this.playerData.y, angle);
        this.multiplayer.broadcast('player-shoot', { x: this.playerData.x, y: this.playerData.y, angle });
    }

    private createBullet(wx: number, wy: number, angle: number) {
        const { isoX, isoY } = cartesianToIso(wx, wy);
        const bullet = this.add.circle(isoX, isoY, 5, 0xffee55);
        this.physics.add.existing(bullet);
        this.bullets.add(bullet);
        const body = bullet.body as Phaser.Physics.Arcade.Body;
        body.setSize(15, 15);
        body.setVelocity(Math.cos(angle) * 900, (Math.sin(angle) * 900) / 2);
        this.time.delayedCall(1000, () => { if (bullet.active) bullet.destroy(); });
    }

    // =========================================================================
    // Camera
    // =========================================================================

    private updateCamera() {
        if (this.isAlive) {
            const { isoX, isoY } = cartesianToIso(this.playerData.x, this.playerData.y);
            this.cameras.main.centerOn(isoX, isoY);
        } else {
            // Segue o alvo espectado
            const target = this.spectateTargetId === HOST_PLAYER_ID
                ? null // host morreu, câmera livre
                : this.remotePlayers.get(this.spectateTargetId);
            if (target) this.cameras.main.centerOn(target.x, target.y);
        }
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private buildAlivePlayerList() {
        const list = this.isAlive
            ? [{ id: this.myId, x: this.playerData.x, y: this.playerData.y }]
            : [];
        this.remotePlayers.forEach((p, id) => {
            if (p.active) {
                const d = this.lastRemoteData.get(id);
                if (d) list.push({ id, x: d.x, y: d.y });
            }
        });
        return list;
    }

    private onBeforeUnload = () => {
        this.multiplayer.broadcast('player-leaving', { id: this.myId });
    };
}