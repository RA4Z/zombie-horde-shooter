import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { Player } from '../entities/Player';
import { ZombieManager } from '../entities/ZombieManager';
import { HordeManager } from '../entities/HordeManager';
import { ScoreManager } from '../entities/ScoreManager';
import { VoteManager, VoteChoice } from '../entities/VoteManager';
import { MultiplayerService } from '../network/Multiplayer';
import { CityWorld } from '../world/CityWorld';
import { AudioManager } from '../audio/AudioManager';
import { cartesianToIso, isoToCartesian } from '../utils/IsoMath';

interface PlayerData { x: number; y: number; speed: number; hp: number; }

const HOST_PLAYER_ID = '__host__';
const MAG_SIZE        = 12;
const RELOAD_TIME_MS  = 2200;
const SHOOT_COOLDOWN  = 120;
const CAMERA_ZOOM     = 2.8;

export class Game extends Scene {
    private localPlayer!: Player;
    private remotePlayers: Map<string, Player> = new Map();
    private bullets!: Phaser.Physics.Arcade.Group;
    private zombies!: ZombieManager;
    private cityWorld!: CityWorld;
    private cityWorldBuilt = false;

    private walls!: Phaser.Physics.Arcade.StaticGroup;

    private horde!: HordeManager;
    private score!: ScoreManager;
    private vote!: VoteManager;
    private audio!: AudioManager;

    private multiplayer!: MultiplayerService;
    private isHost = false;
    private hostID = '';
    private lastHostHeartbeat = 0;
    private readonly MIGRATION_THRESHOLD = 4000;

    private playerData: PlayerData = { x: 0, y: 0, speed: 160, hp: 100 };
    private lastDamageTime = 0;
    private isAlive = true;
    private isSpectating = false;
    private spectateTargetId = '';
    private myId = HOST_PLAYER_ID;
    private myName = 'Player';

    private ammo         = MAG_SIZE;
    private isReloading  = false;
    private reloadTimer: Phaser.Time.TimerEvent | null = null;
    private lastShootTime = 0;
    private isMoving = false;

    // Ângulo de mira em espaço ISO de tela (não cartesiano)
    // usado para o sprite direcional e para a bala
    private aimAngleIso = 0;
    // Ângulo de mira em espaço cartesiano — usado para o movimento WASD relativo
    private aimAngleCart = 0;

    private lastRemoteData: Map<string, { x: number; y: number }> = new Map();
    // Último ângulo de mira recebido por jogador remoto (para animação)
    private lastRemoteAngle: Map<string, number> = new Map();
    private lastSeenMap: Map<string, number> = new Map();

    private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
    private reloadKey!: Phaser.Input.Keyboard.Key;
    private spectateKeys!: { left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };

    private networkTimer!: Phaser.Time.TimerEvent;
    private heartbeatWorker: Worker | null = null;
    private zombieGroanTimer = 0;
    private isConnecting = false;
    private sessionEnded = false;

    constructor() { super('Game'); }

    // =========================================================================
    create() {
        this.sound.pauseOnBlur = false;
        document.addEventListener('visibilitychange', this.onVisibilityChange);
        window.addEventListener('beforeunload', this.onBeforeUnload);

        this.cityWorld = new CityWorld(this);
        this.audio     = new AudioManager();
        this.walls     = this.physics.add.staticGroup();
        this.bullets   = this.physics.add.group();
        this.zombies   = new ZombieManager(this);

        this.multiplayer = new MultiplayerService();
        this.horde       = new HordeManager();
        this.score       = new ScoreManager();
        this.vote        = new VoteManager();
        this.localPlayer = new Player(this, 0, 0, true);

        if (this.input.keyboard) {
            this.wasd = this.input.keyboard.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
            this.reloadKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
            this.spectateKeys = {
                left:  this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
                right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
            };
        }
        this.input.on('pointerdown', this.shoot, this);

        this.physics.add.overlap(
            this.bullets, this.zombies.group,
            (objA, objB) => {
                // Phaser não garante a ordem dos args — detectamos quem é zumbi pelo map
                const aIsZombie = [...this.zombies.zombiesMap.values()].includes(
                    objA as Phaser.GameObjects.Container);
                const bullet = (aIsZombie ? objB : objA) as Phaser.GameObjects.GameObject;
                const zombie = (aIsZombie ? objA : objB) as Phaser.GameObjects.Container;
                this.handleZombieHit(bullet, zombie);
            },
        );
        this.physics.add.overlap(
            this.localPlayer, this.zombies.group,
            this.handlePlayerZombieOverlap, undefined, this,
        );

        this.networkTimer = this.time.addEvent({
            delay: 50, callback: this.sendNetworkUpdates,
            callbackScope: this, loop: true, paused: true,
        });

        this.horde.onSpawnZombie  = () => this.spawnZombieHost();
        this.horde.onStateChange  = (state) => this.multiplayer.broadcast('horde-state', { state });
        this.horde.onWaveComplete = (wave) => {
            this.reviveDeadPlayers();
            this.score.onWaveComplete(wave);
            this.broadcastScores();
        };

        this.vote.onRestart  = (staying) => this.handleVoteRestart(staying);
        this.vote.onAllLeave = () => {
            this.multiplayer.broadcast('session-end', {});
            this.endSession();
        };

        this.initHeartbeatWorker();
        this.setupNetworkEvents();

        EventBus.on('start-game',       this.onStartGame,       this);
        EventBus.on('cast-vote',        this.onCastVote,        this);
        EventBus.on('connection-error', this.onConnectionError, this);

        this.cameras.main.setZoom(CAMERA_ZOOM);
        this.cameras.main.centerOn(0, 0);

        EventBus.emit('current-scene-ready', this);
    }

    // =========================================================================
    update(_time: number, delta: number) {
        if (!this.cityWorldBuilt) return;

        const TIMEOUT = 10_000;
        this.lastSeenMap.forEach((t, id) => { if (_time - t > TIMEOUT) this.removePlayer(id); });

        if (this.isHost) {
            this.zombies.updateHost(this.buildAlivePlayerList(), delta);
        } else {
            this.zombies.interpolateClient(0.12, delta);
            this.checkHostHealth(_time);
        }

        if (this.isAlive) {
            this.aimAtPointer();        // 1. calcula aimAngleIso e aimAngleCart
            this.processMovement(delta); // 2. move com WASD relativo ao aim

            // 3. Atualiza animação do player local
            this.localPlayer.tickAnim(delta, this.isMoving, this.aimAngleIso);

            if (this.reloadKey && Phaser.Input.Keyboard.JustDown(this.reloadKey)) this.startReload();

            this.audio.step(_time, this.isMoving);
            this.zombieGroanTimer -= delta;
            if (this.zombieGroanTimer <= 0 && this.zombies.zombiesMap.size > 0) {
                this.audio.zombieGroan();
                this.zombieGroanTimer = 2500 + Math.random() * 3000;
            }
        } else if (this.isSpectating) {
            this.updateSpectator();
        }

        // Atualiza animação dos players remotos
        this.remotePlayers.forEach((p, id) => {
            if (p.active) {
                const angle = this.lastRemoteAngle.get(id) ?? 0;
                const d = this.lastRemoteData.get(id);
                // Considera "em movimento" se tem dados de posição recentes
                const moving = d !== undefined;
                p.tickAnim(delta, moving, angle);
            }
        });

        this.updateCamera();
        this.updateDepths();
    }

    shutdown() {
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        window.removeEventListener('beforeunload', this.onBeforeUnload);
        this.heartbeatWorker?.terminate();
        this.heartbeatWorker = null;
        this.horde.destroy();
        this.vote.destroy();
        this.multiplayer.destroy();
        this.audio.destroy();
        this.cityWorldBuilt = false;
        this.sessionEnded   = false;
        EventBus.removeListener('start-game',        this.onStartGame);
        EventBus.removeListener('cast-vote',         this.onCastVote);
        EventBus.removeListener('connection-error',  this.onConnectionError);
        EventBus.removeListener('network-data',      this.onNetworkData);
        EventBus.removeListener('peer-disconnected', this.onPeerDisconnected);
    }

    // =========================================================================
    // Início de jogo
    // =========================================================================

    private onStartGame = async (data: { isHost: boolean; roomId?: string; name?: string }) => {
        if (this.isConnecting) return;
        this.isConnecting = true;
        this.sessionEnded = false;

        if (data.name) this.myName = data.name.trim().slice(0, 16) || 'Player';
        this.localPlayer.setNameLabel(this.myName);

        if (!this.cityWorldBuilt) {
            try {
                this.cityWorld.build();
                this.buildWalls();
                this.cityWorldBuilt = true;
            } catch (err) {
                console.error('[Game] Erro ao construir CityWorld:', err);
                this.isConnecting = false;
                EventBus.emit('connection-error-ui', { reason: 'Erro ao carregar o mundo.' });
                return;
            }
        }

        this.physics.add.collider(this.localPlayer, this.walls);
        this.physics.add.collider(this.zombies.group, this.walls);

        this.isHost = data.isHost;
        this.lastHostHeartbeat = this.time.now;

        if (this.isHost) {
            this.myId = HOST_PLAYER_ID;
            const key = await this.multiplayer.hostGame();
            this.hostID = this.multiplayer.myID;
            this.score.registerPlayer(this.myId, this.myName);
            this.multiplayer.startHostHeartbeat();
            this.networkTimer.paused = false;
            this.horde.start();
            this.isConnecting = false;
            EventBus.emit('room-joined', key);
        } else if (data.roomId) {
            await this.multiplayer.joinGame(data.roomId);
            this.myId   = this.multiplayer.myID;
            this.hostID = data.roomId;
            this.multiplayer.broadcast('player-joined', { name: this.myName });
            this.isConnecting = false;
        }

        this.emitAmmoState();
    };

    // =========================================================================
    // Paredes — hitbox sólida por quarteirão inteiro
    // =========================================================================

    private buildWalls() {
        const T     = 64;
        const BLOCK = 4;
        const STEP  = BLOCK + 2;
        const RANGE = 4;

        const makeRng = (seed: number) => {
            let s = (seed ^ 0xdeadbeef) >>> 0 || 1;
            return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s = s >>> 0; return s / 4294967296; };
        };

        for (let bx = -RANGE; bx <= RANGE; bx++) {
            for (let by = -RANGE; by <= RANGE; by++) {
                const ox   = bx * STEP * T;
                const oy   = by * STEP * T;
                const seed = bx * 137 + by * 1009;
                const rng  = makeRng(seed);
                const type = rng();

                if (type < 0.5) {
                    this.addWallBlock(ox, oy, BLOCK * T, BLOCK * T);
                }
            }
        }
    }

    private addWallBlock(wx: number, wy: number, w: number, d: number) {
        const cx = wx + w / 2;
        const cy = wy + d / 2;
        const { isoX, isoY } = cartesianToIso(cx, cy);
        const isoW = w + d;
        const isoH = (w + d) / 2;
        const wall = this.add.rectangle(isoX, isoY, isoW, isoH, 0x000000, 0);
        this.physics.add.existing(wall, true);
        this.walls.add(wall);
    }

    // =========================================================================
    // Depth sort
    // =========================================================================

    private updateDepths() {
        if (this.localPlayer.active) this.localPlayer.setDepth(this.localPlayer.y);
        this.remotePlayers.forEach((p) => { if (p.active) p.setDepth(p.y); });
        this.zombies.zombiesMap.forEach((z) => z.setDepth(z.y));
    }

    // =========================================================================
    // Munição
    // =========================================================================

    private startReload() {
        if (this.isReloading || this.ammo === MAG_SIZE) return;
        this.isReloading = true;
        this.audio.reloadStart();
        EventBus.emit('ammo-state', { ammo: this.ammo, max: MAG_SIZE, reloading: true });
        this.reloadTimer = this.time.delayedCall(RELOAD_TIME_MS, () => {
            this.ammo = MAG_SIZE; this.isReloading = false; this.reloadTimer = null;
            this.audio.reloadDone(); this.emitAmmoState();
        });
    }

    private emitAmmoState() {
        EventBus.emit('ammo-state', { ammo: this.ammo, max: MAG_SIZE, reloading: this.isReloading });
    }

    private onCastVote = (choice: VoteChoice) => {
        if (this.isHost) this.vote.castVote(this.myId, choice);
        else this.multiplayer.broadcast('cast-vote', { choice });
    };

    private onConnectionError = (data: { reason: string }) => {
        this.isConnecting = false;
        this.multiplayer.destroy();
        EventBus.emit('connection-error-ui', data);
    };

    // =========================================================================
    // Worker
    // =========================================================================

    private initHeartbeatWorker() {
        try {
            this.heartbeatWorker = new Worker('/heartbeatWorker.js');
            this.heartbeatWorker.onmessage = (e) => {
                if (e.data !== 'tick') return;
                if (this.isHost) this.runHostBackgroundSimulation();
                else             this.sendClientData();
            };
        } catch { console.warn('[Game] heartbeatWorker não encontrado.'); }
        this.events.once('destroy', () => this.heartbeatWorker?.terminate());
    }

    private onVisibilityChange = () => {};

    // =========================================================================
    // Rede
    // =========================================================================

    private setupNetworkEvents() {
        EventBus.on('network-data',      this.onNetworkData,      this);
        EventBus.on('peer-disconnected', this.onPeerDisconnected, this);
    }

    private onNetworkData = ({ from, data }: { from: string; data: Record<string, unknown> }) => {
        this.lastSeenMap.set(from, this.time.now);
        const type = data.type as string;
        if (from === this.hostID || type === 'host-heartbeat') this.lastHostHeartbeat = this.time.now;

        switch (type) {
            case 'host-heartbeat': break;
            case 'host-migration-start': this.handleHostMigration(data.newHostID as string); break;

            case 'player-joined':
                if (this.isHost) {
                    const joinName = (data.name as string) ?? from.slice(0, 6);
                    this.score.registerPlayer(from, joinName);
                    if (!this.remotePlayers.has(from)) {
                        const remote = new Player(this, 0, 0, false);
                        remote.setNameLabel(joinName);
                        this.remotePlayers.set(from, remote);
                        this.physics.add.collider(remote, this.walls);
                    }
                    this.broadcastScores();
                    this.multiplayer.broadcast('player-names', { names: this.buildNamesMap() });
                    this.multiplayer.broadcast('horde-state', { state: this.horde.getState() });
                }
                break;

            case 'player-names': {
                const names = data.names as Record<string, string>;
                Object.entries(names).forEach(([id, name]) => {
                    if (id === this.myId) return;
                    let remote = this.remotePlayers.get(id);
                    if (!remote) {
                        remote = new Player(this, 0, 0, false);
                        this.remotePlayers.set(id, remote);
                        this.physics.add.collider(remote, this.walls);
                    }
                    remote.setNameLabel(name);
                });
                break;
            }

            case 'player-leaving': this.removePlayer(from); break;
            case 'move':           this.handleRemoteMove(from, data); break;

            case 'player-shoot':
                this.createBullet(data.x as number, data.y as number, data.angle as number, false, data.shooterId as string);
                break;

            case 'zombie-spawn':
                if (!this.isHost) this.zombies.spawn(data.id as string, data.x as number, data.y as number, data.hp as number);
                break;

            case 'zombie-update':
                this.handleZombieUpdate(data.list as Array<{ id: string; isoX: number; isoY: number }>);
                break;

            case 'zombie-death': this.audio.zombieDeath(); this.zombies.remove(data.id as string); break;
            case 'zombie-hit':   this.audio.zombieHit();   this.zombies.hit(data.id as string);    break;

            case 'player-revived':
                if (!this.isHost && (data.id as string) === this.myId) this.handleRevive();
                break;

            case 'horde-state':
                if (!this.isHost) this.horde.applyNetworkState(data.state as any);
                break;

            case 'score-update':
                if (!this.isHost) this.score.applySnapshot(data.scores as any);
                break;

            case 'player-dead':    this.lastRemoteData.delete(from); break;
            case 'cast-vote':
                if (this.isHost) this.vote.castVote(from, data.choice as VoteChoice);
                break;

            case 'vote-state':
                if (!this.isHost) { this.vote.applyNetworkState(data as any); EventBus.emit('vote-state', data); }
                break;

            case 'vote-resolved':    this.handleVoteResolved(data.staying as string[]); break;
            case 'show-leaderboard': EventBus.emit('show-leaderboard', data); break;
            case 'session-end':      this.endSession(); break;
            case 'game-restart':     this.restartGame(); break;
        }
    };

    private onPeerDisconnected = (id: string) => {
        this.removePlayer(id);
        if (this.isHost) { this.score.markDead(id); this.checkAllDead(); }
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
        this.removePlayer(this.hostID);
        this.multiplayer.removePeer(this.hostID);
        this.isHost  = true;
        this.hostID  = this.multiplayer.myID;
        this.multiplayer.startHostHeartbeat();
        this.networkTimer.paused = false;
        this.multiplayer.broadcast('host-migration-start', { newHostID: this.multiplayer.myID });
        this.horde.onSpawnZombie  = () => this.spawnZombieHost();
        this.horde.onStateChange  = (state) => this.multiplayer.broadcast('horde-state', { state });
        this.horde.onWaveComplete = (wave) => { this.reviveDeadPlayers(); this.score.onWaveComplete(wave); this.broadcastScores(); };
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
        // Armazena o ângulo recebido para animar na direção certa
        const angle = data.angle as number ?? 0;
        this.lastRemoteAngle.set(id, angle);

        let remote = this.remotePlayers.get(id);
        if (!remote) {
            remote = new Player(this, 0, 0, false);
            const entry = this.score.getLeaderboard().find(p => p.id === id);
            if (entry) remote.setNameLabel(entry.name);
            this.remotePlayers.set(id, remote);
            this.physics.add.collider(remote, this.walls);
        }
        const { isoX, isoY } = cartesianToIso(data.x as number, data.y as number);
        this.tweens.add({ targets: remote, x: isoX, y: isoY, duration: 50, ease: 'Linear' });
        // NÃO chama setRotation — a animação direcional é feita via tickAnim no update()
    }

    private removePlayer(id: string) {
        const remote = this.remotePlayers.get(id);
        if (remote) { remote.destroy(); this.remotePlayers.delete(id); }
        this.lastRemoteData.delete(id);
        this.lastRemoteAngle.delete(id);
        this.lastSeenMap.delete(id);
        this.multiplayer.removePeer(id);
    }

    private buildNamesMap(): Record<string, string> {
        const map: Record<string, string> = {};
        this.score.getLeaderboard().forEach(p => { map[p.id] = p.name; });
        return map;
    }

    // =========================================================================
    // Zumbis
    // =========================================================================

    private spawnZombieHost() {
        const id     = `z_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const angle  = Math.random() * Math.PI * 2;
        const worldX = this.playerData.x + Math.cos(angle) * 500;
        const worldY = this.playerData.y + Math.sin(angle) * 500;
        const hp     = this.horde.zombieHp;
        this.zombies.spawn(id, worldX, worldY, hp);
        this.multiplayer.broadcast('zombie-spawn', { id, x: worldX, y: worldY, hp });
    }

    private handleZombieUpdate(list: Array<{ id: string; isoX: number; isoY: number }>) {
        list.forEach(({ id, isoX, isoY }) => {
            if (!this.zombies.zombiesMap.has(id)) this.zombies.spawn(id, isoX, isoY);
            if (!this.isHost) {
                const z = this.zombies.zombiesMap.get(id);
                if (z) {
                    const dx = Math.abs(z.x - isoX), dy = Math.abs(z.y - isoY);
                    if (dx < 800 && dy < 800) this.zombies.setTarget(id, isoX, isoY);
                    else this.zombies.setPosition(id, isoX, isoY);
                }
            }
        });
    }

    private handleZombieHit(bullet: Phaser.GameObjects.GameObject, zombieContainer: Phaser.GameObjects.Container) {
        // Lê shooterId ANTES de destruir a bala (getData fica indisponível após destroy)
        const shooterId = (bullet as any).getData?.('shooterId') as string | undefined ?? this.myId;
        bullet.destroy();
        if (!this.isHost) return;
        let zombieId: string | undefined;
        this.zombies.zombiesMap.forEach((v, k) => { if (v === zombieContainer) zombieId = k; });
        if (!zombieId) return;
        const died = this.zombies.hit(zombieId);
        if (died) {
            this.audio.zombieDeath();
            this.score.addKill(shooterId, this.horde.wave);
            this.horde.onZombieDied();
            this.zombies.remove(zombieId);
            this.multiplayer.broadcast('zombie-death', { id: zombieId });
            this.broadcastScores();
        } else {
            this.audio.zombieHit();
            this.multiplayer.broadcast('zombie-hit', { id: zombieId });
        }
    }

    private handlePlayerZombieOverlap = () => {
        if (!this.isAlive || this.time.now <= this.lastDamageTime) return;
        this.playerData.hp = Math.max(0, this.playerData.hp - 10);
        this.lastDamageTime = this.time.now + 500;
        this.audio.playerHurt();
        EventBus.emit('player-stats', { hp: this.playerData.hp });
        if (this.playerData.hp <= 0) this.playerDied();
    };

    // =========================================================================
    // Morte / Revive
    // =========================================================================

    private playerDied() {
        this.isAlive = false; this.isSpectating = true;
        this.localPlayer.setVisible(false).setActive(false);
        (this.localPlayer.body as Phaser.Physics.Arcade.Body).enable = false;
        this.multiplayer.broadcast('player-dead', { id: this.myId });
        this.audio.playerDeath();
        EventBus.emit('player-died', {});
        if (this.isHost) { this.score.markDead(this.myId); this.checkAllDead(); }
        this.startSpectating();
    }

    private reviveDeadPlayers() {
        if (!this.isHost) return;
        if (!this.isAlive) { this.handleRevive(); this.score.markAlive(this.myId); }
        const deadRemotes: string[] = [];
        this.score.getLeaderboard().forEach(p => { if (!p.alive && p.id !== this.myId) deadRemotes.push(p.id); });
        deadRemotes.forEach(id => {
            this.score.markAlive(id);
            this.multiplayer.broadcast('player-revived', { id });
            const remote = this.remotePlayers.get(id);
            if (remote) { remote.setVisible(true).setActive(true); (remote.body as Phaser.Physics.Arcade.Body).enable = true; }
        });
    }

    private handleRevive() {
        this.isAlive = true; this.isSpectating = false; this.playerData.hp = 100;
        this.localPlayer.setVisible(true).setActive(true);
        (this.localPlayer.body as Phaser.Physics.Arcade.Body).enable = true;
        EventBus.emit('player-stats', { hp: 100 }); EventBus.emit('player-revived', {});
    }

    private startSpectating() {
        const targets = this.getSpectateTargets();
        this.spectateTargetId = targets[0] ?? '';
        EventBus.emit('spectate-start', { targetId: this.spectateTargetId });
    }

    private getSpectateTargets() {
        const out: string[] = [];
        this.remotePlayers.forEach((p, id) => { if (p.active) out.push(id); });
        return out;
    }

    private updateSpectator() {
        if (Phaser.Input.Keyboard.JustDown(this.spectateKeys.left))  this.cycleSpectateTarget(-1);
        if (Phaser.Input.Keyboard.JustDown(this.spectateKeys.right)) this.cycleSpectateTarget(1);
    }

    private cycleSpectateTarget(dir: 1 | -1) {
        const t = this.getSpectateTargets();
        if (!t.length) return;
        const i = t.indexOf(this.spectateTargetId);
        this.spectateTargetId = t[(i + dir + t.length) % t.length];
        EventBus.emit('spectate-target', { targetId: this.spectateTargetId });
    }

    private checkAllDead() {
        if (!this.isHost || !this.score.allDead()) return;
        this.time.delayedCall(800, () => {
            const allIds = [this.myId, ...Array.from(this.remotePlayers.keys())];
            this.vote.start(allIds);
            const lb = { scores: this.score.getLeaderboard(), vote: this.vote.getState() };
            EventBus.emit('show-leaderboard', lb);
            this.multiplayer.broadcast('show-leaderboard', lb as any);
            this.multiplayer.broadcast('vote-state', { ...this.vote.getState() });
        });
    }

    // =========================================================================
    // Session / Vote
    // =========================================================================

    private endSession() {
        if (this.sessionEnded) return;
        this.sessionEnded = true;
        this.horde.destroy();
        this.vote.destroy();
        this.networkTimer.paused = true;
        this.multiplayer.stopHostHeartbeat();
        this.zombies.removeAll();
        this.isAlive = true; this.isSpectating = false;
        this.playerData = { x: 0, y: 0, speed: 160, hp: 100 };
        this.lastDamageTime = 0; this.spectateTargetId = '';
        this.multiplayer.destroy();
        EventBus.emit('session-end');
    }

    private handleVoteResolved(staying: string[]) {
        if (!staying.includes(this.myId)) this.endSession();
    }

    private handleVoteRestart(staying: string[]) {
        this.multiplayer.broadcast('vote-resolved', { staying });
        this.time.delayedCall(400, () => { this.multiplayer.broadcast('game-restart', {}); this.restartGame(); });
    }

    private restartGame() {
        this.horde.destroy(); this.zombies.removeAll(); this.score.reset();
        this.isConnecting = false; this.sessionEnded = false;
        this.playerData = { x: 0, y: 0, speed: 160, hp: 100 };
        this.isAlive = true; this.isSpectating = false;
        this.lastDamageTime = 0; this.spectateTargetId = '';
        this.ammo = MAG_SIZE; this.isReloading = false;
        this.reloadTimer?.remove(); this.reloadTimer = null;
        this.localPlayer.setVisible(true).setActive(true);
        (this.localPlayer.body as Phaser.Physics.Arcade.Body).enable = true;
        this.localPlayer.setPosition(0, 0);
        EventBus.emit('player-stats', { hp: 100 }); EventBus.emit('game-restarted', {});
        this.emitAmmoState();
        if (this.isHost) {
            this.horde = new HordeManager();
            this.horde.onSpawnZombie  = () => this.spawnZombieHost();
            this.horde.onStateChange  = (state) => this.multiplayer.broadcast('horde-state', { state });
            this.horde.onWaveComplete = (wave) => { this.reviveDeadPlayers(); this.score.onWaveComplete(wave); this.broadcastScores(); };
            this.horde.start();
        }
    }

    // =========================================================================
    // Background
    // =========================================================================

    private sendNetworkUpdates() {
        if (!this.isHost) return;
        // Envia o ângulo ISO (que os clientes usam para animar)
        this.multiplayer.broadcast('move', {
            x: this.playerData.x, y: this.playerData.y,
            angle: this.aimAngleIso,
        });
        const list: Array<{ id: string; isoX: number; isoY: number }> = [];
        this.zombies.zombiesMap.forEach((z, id) => list.push({ id, isoX: z.x, isoY: z.y }));
        if (list.length > 0) this.multiplayer.broadcast('zombie-update', { list });
    }

    private runHostBackgroundSimulation() {
        this.zombies.updateHost(this.buildAlivePlayerList());
        this.physics.world.step(1 / 30);
        this.physics.world.overlap(this.bullets, this.zombies.group,
            (objA, objB) => {
                const aIsZombie = [...this.zombies.zombiesMap.values()].includes(
                    objA as Phaser.GameObjects.Container);
                const bullet = (aIsZombie ? objB : objA) as Phaser.GameObjects.GameObject;
                const zombie = (aIsZombie ? objA : objB) as Phaser.GameObjects.Container;
                this.handleZombieHit(bullet, zombie);
            });
        this.sendNetworkUpdates();
    }

    private sendClientData() {
        if (!this.isAlive) return;
        this.multiplayer.broadcast('move', {
            x: this.playerData.x, y: this.playerData.y,
            angle: this.aimAngleIso,
        });
    }

    private broadcastScores() {
        const lb = this.score.getLeaderboard();
        this.multiplayer.broadcast('score-update', { scores: lb });
        EventBus.emit('score-update', lb);
    }

    // =========================================================================
    // Input
    // =========================================================================

    /**
     * Calcula dois ângulos a partir da posição do cursor:
     *   aimAngleIso  — ângulo no espaço ISO de tela (para sprite direcional e bala)
     *   aimAngleCart — ângulo no espaço cartesiano (para movimento WASD relativo)
     */
    private aimAtPointer() {
        const ptr   = this.input.activePointer;
        const world = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
        const { isoX: px, isoY: py } = cartesianToIso(this.playerData.x, this.playerData.y);

        // Vetor ISO do player ao cursor
        const dIsoX = world.x - px;
        const dIsoY = world.y - py;

        // Ângulo ISO direto (para sprite e bala)
        this.aimAngleIso = Math.atan2(dIsoY, dIsoX);

        // Converte para cartesiano (para movimento)
        const dCartX = (dIsoX + 2 * dIsoY) / 2;
        const dCartY = (2 * dIsoY - dIsoX) / 2;
        this.aimAngleCart = Math.atan2(dCartY, dCartX);
    }

    /** WASD relativo ao aim em coordenadas cartesianas */
    private processMovement(delta: number) {
        const a = this.aimAngleCart;
        const fwdX =  Math.cos(a), fwdY =  Math.sin(a);
        const rgtX =  Math.sin(a), rgtY = -Math.cos(a);

        let mx = 0, my = 0;
        if (this.wasd?.W?.isDown) { mx += fwdX; my += fwdY; }
        if (this.wasd?.S?.isDown) { mx -= fwdX; my -= fwdY; }
        if (this.wasd?.A?.isDown) { mx -= rgtX; my -= rgtY; }
        if (this.wasd?.D?.isDown) { mx += rgtX; my += rgtY; }

        this.isMoving = mx !== 0 || my !== 0;
        if (this.isMoving) {
            const len = Math.hypot(mx, my);
            const dt  = delta / 1000;
            this.playerData.x += (mx / len) * this.playerData.speed * dt;
            this.playerData.y += (my / len) * this.playerData.speed * dt;
        }

        const { isoX, isoY } = cartesianToIso(this.playerData.x, this.playerData.y);
        this.localPlayer.setPosition(isoX, isoY);
    }

    private shoot() {
        if (!this.isAlive) return;
        const now = this.time.now;
        if (now - this.lastShootTime < SHOOT_COOLDOWN) return;
        this.lastShootTime = now;
        if (this.ammo <= 0 || this.isReloading) {
            if (!this.isReloading) { this.audio.emptyClick(); this.startReload(); }
            return;
        }
        this.ammo--; this.emitAmmoState(); this.audio.shoot();

        // Usa aimAngleIso diretamente para a bala (já está no espaço correto)
        this.createBullet(this.playerData.x, this.playerData.y, this.aimAngleIso, true, this.myId);
        this.multiplayer.broadcast('player-shoot', {
            x: this.playerData.x, y: this.playerData.y,
            angle: this.aimAngleIso, shooterId: this.myId,
        });
        if (this.ammo === 0) this.time.delayedCall(300, () => this.startReload());
    }

    private createBullet(wx: number, wy: number, angle: number, _local: boolean, shooterId?: string) {
        const { isoX, isoY } = cartesianToIso(wx, wy);
        const bullet = this.add.circle(isoX, isoY, 4, 0xffee22);
        this.physics.add.existing(bullet);
        this.bullets.add(bullet);
        (bullet as any).setData('shooterId', shooterId ?? this.myId);
        const body = bullet.body as Phaser.Physics.Arcade.Body;
        body.setSize(10, 10);
        body.setVelocity(Math.cos(angle) * 900, Math.sin(angle) * 900);
        this.time.delayedCall(900, () => { if (bullet.active) bullet.destroy(); });
    }

    // =========================================================================
    // Camera
    // =========================================================================

    private updateCamera() {
        if (this.isAlive) {
            const { isoX, isoY } = cartesianToIso(this.playerData.x, this.playerData.y);
            this.cameras.main.centerOn(isoX, isoY);
        } else {
            const target = this.remotePlayers.get(this.spectateTargetId);
            if (target) this.cameras.main.centerOn(target.x, target.y);
        }
    }

    // =========================================================================
    private buildAlivePlayerList() {
        const list = this.isAlive ? [{ id: this.myId, x: this.playerData.x, y: this.playerData.y }] : [];
        this.remotePlayers.forEach((p, id) => {
            if (p.active) { const d = this.lastRemoteData.get(id); if (d) list.push({ id, x: d.x, y: d.y }); }
        });
        return list;
    }

    private onBeforeUnload = () => { this.multiplayer.broadcast('player-leaving', { id: this.myId }); };
}