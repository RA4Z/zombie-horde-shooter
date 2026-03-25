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

// ── Munição ──────────────────────────────────────────────────────────────────
const MAG_SIZE        = 12;
const RELOAD_TIME_MS  = 2200; // tempo de recarga em ms
const SHOOT_COOLDOWN  = 120;  // ms entre tiros (cadência)

// ── Escala do mundo ───────────────────────────────────────────────────────────
const CAMERA_ZOOM = 1.6;

// ── Layers de profundidade ────────────────────────────────────────────────────
// O sistema de depth usa as seguintes faixas:
//   -1000 a -501 : chão (ground tiles, roads)
//   -500         : CityWorld graphics base (setDepth no build())
//   -500 a -1    : decorações de chão
//   0+           : objetos do mundo — depth = isoY (paint-sort)
//                  prédios usam isoY da base + altura visual para ficar acima
//   999999       : UI / HUD

export class Game extends Scene {
    // Entidades
    private localPlayer!: Player;
    private remotePlayers: Map<string, Player> = new Map();
    private bullets!: Phaser.Physics.Arcade.Group;
    private zombies!: ZombieManager;
    private cityWorld!: CityWorld;
    private cityWorldBuilt = false;

    // Paredes (colisão)
    private walls!: Phaser.Physics.Arcade.StaticGroup;

    // Sistemas
    private horde!: HordeManager;
    private score!: ScoreManager;
    private vote!: VoteManager;
    private audio!: AudioManager;

    // Rede
    private multiplayer!: MultiplayerService;
    private isHost = false;
    private hostID = '';
    private lastHostHeartbeat = 0;
    private readonly MIGRATION_THRESHOLD = 4000;

    // Estado local
    private playerData: PlayerData = { x: 0, y: 0, speed: 220, hp: 100 };
    private lastDamageTime = 0;
    private isAlive = true;
    private isSpectating = false;
    private spectateTargetId = '';
    private myId = HOST_PLAYER_ID;
    private myName = 'Player';

    // Munição
    private ammo         = MAG_SIZE;
    private isReloading  = false;
    private reloadTimer: Phaser.Time.TimerEvent | null = null;
    private lastShootTime = 0;

    // Passos
    private isMoving = false;

    // Snapshots de rede
    private lastRemoteData: Map<string, { x: number; y: number }> = new Map();
    private lastSeenMap:    Map<string, number>                    = new Map();

    // Input
    private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
    private reloadKey!: Phaser.Input.Keyboard.Key;
    private spectateKeys!: { left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };

    // Timers
    private networkTimer!: Phaser.Time.TimerEvent;
    private heartbeatWorker: Worker | null = null;
    private zombieGroanTimer = 0;

    // Guard: impede start-game ser processado enquanto ja conectando
    private isConnecting = false;

    constructor() { super('Game'); }

    // =========================================================================
    create() {
        this.sound.pauseOnBlur = false;
        document.addEventListener('visibilitychange', this.onVisibilityChange);
        window.addEventListener('beforeunload', this.onBeforeUnload);

        this.cityWorld = new CityWorld(this);
        this.audio     = new AudioManager();

        // Grupos de física
        this.walls   = this.physics.add.staticGroup();
        this.bullets = this.physics.add.group();
        this.zombies = new ZombieManager(this);

        // Sistemas
        this.multiplayer = new MultiplayerService();
        this.horde       = new HordeManager();
        this.score       = new ScoreManager();
        this.vote        = new VoteManager();
        this.localPlayer = new Player(this, 0, 0, true);

        // Input
        if (this.input.keyboard) {
            this.wasd = this.input.keyboard.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
            this.reloadKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
            this.spectateKeys = {
                left:  this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
                right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
            };
        }
        this.input.on('pointerdown', this.shoot, this);

        // Colisões
        this.physics.add.overlap(
            this.bullets, this.zombies.group,
            (_b, _z) => this.handleZombieHit(
                _b as Phaser.GameObjects.GameObject,
                _z as Phaser.GameObjects.Container,
            ),
        );
        this.physics.add.overlap(
            this.localPlayer, this.zombies.group,
            this.handlePlayerZombieOverlap, undefined, this,
        );

        // Timer de broadcast de rede
        this.networkTimer = this.time.addEvent({
            delay: 50, callback: this.sendNetworkUpdates,
            callbackScope: this, loop: true, paused: true,
        });

        // Hooks horde
        this.horde.onSpawnZombie  = () => this.spawnZombieHost();
        this.horde.onStateChange  = (state) => this.multiplayer.broadcast('horde-state', { state });
        // FIX: onWaveComplete agora revive jogadores mortos antes de dar bônus
        this.horde.onWaveComplete = (wave) => {
            this.reviveDeadPlayers();
            this.score.onWaveComplete(wave);
            this.broadcastScores();
        };

        // Hooks votação
        this.vote.onRestart  = (staying) => this.handleVoteRestart(staying);
        this.vote.onAllLeave = () => {
            this.multiplayer.broadcast('session-end', {});
            EventBus.emit('session-end');
        };

        this.initHeartbeatWorker();
        this.setupNetworkEvents();

        EventBus.on('start-game',        this.onStartGame,      this);
        EventBus.on('cast-vote',         this.onCastVote,       this);
        EventBus.on('connection-error',  this.onConnectionError, this);

        // Zoom da câmera
        this.cameras.main.setZoom(CAMERA_ZOOM);
        this.cameras.main.centerOn(0, 0);

        EventBus.emit('current-scene-ready', this);
    }

    // =========================================================================
    update(_time: number, delta: number) {
        if (!this.cityWorldBuilt) return;

        const TIMEOUT = 10_000;
        this.lastSeenMap.forEach((t, id) => {
            if (_time - t > TIMEOUT) this.removePlayer(id);
        });

        if (this.isHost) {
            this.zombies.updateHost(this.buildAlivePlayerList());
        } else {
            this.zombies.interpolateClient(0.12);
            this.checkHostHealth(_time);
        }

        if (this.isAlive) {
            this.processMovement(delta);
            this.aimAtPointer();

            if (this.reloadKey && Phaser.Input.Keyboard.JustDown(this.reloadKey)) {
                this.startReload();
            }

            this.audio.step(_time, this.isMoving);

            this.zombieGroanTimer -= delta;
            if (this.zombieGroanTimer <= 0 && this.zombies.zombiesMap.size > 0) {
                this.audio.zombieGroan();
                this.zombieGroanTimer = 2500 + Math.random() * 3000;
            }
        } else if (this.isSpectating) {
            this.updateSpectator();
        }

        this.updateCamera();

        // FIX: Depth sort de players e zumbis para que prédios fiquem na frente
        // quando o objeto está "atrás" (menor isoY = mais ao norte = menor depth)
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
        EventBus.removeListener('start-game',        this.onStartGame);
        EventBus.removeListener('cast-vote',         this.onCastVote);
        EventBus.removeListener('connection-error',  this.onConnectionError);
        EventBus.removeListener('network-data',      this.onNetworkData);
        EventBus.removeListener('peer-disconnected', this.onPeerDisconnected);
    }

    // =========================================================================
    // Inicio de jogo
    // =========================================================================

    private onStartGame = async (data: { isHost: boolean; roomId?: string; name?: string }) => {
        if (this.isConnecting) return;
        this.isConnecting = true;

        // FIX: armazena o nome informado no menu
        if (data.name) this.myName = data.name.trim().slice(0, 16) || 'Player';
        // Atualiza o label do player local
        this.localPlayer.setNameLabel(this.myName);

        if (!this.cityWorldBuilt) {
            try {
                this.cityWorld.build();
                this.buildWalls();
                this.cityWorldBuilt = true;
            } catch (err) {
                console.error('[Game] Erro ao construir CityWorld:', err);
                this.isConnecting = false;
                EventBus.emit('connection-error-ui', { reason: 'Erro ao carregar o mundo. Recarregue a página.' });
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
            this.isConnecting = false;
        }

        this.emitAmmoState();
    };

    // =========================================================================
    // Paredes de colisão
    // =========================================================================

    private buildWalls() {
        const T     = 64;
        const BLOCK = 4;
        const STEP  = BLOCK + 2;
        const RANGE = 4;

        const makeRng = (seed: number) => {
            let s = (seed ^ 0xdeadbeef) >>> 0 || 1;
            return () => {
                s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
                s = s >>> 0;
                return s / 4294967296;
            };
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

        const isoW = (w + d);
        const isoH = (w + d) / 2;

        const wall = this.add.rectangle(isoX, isoY, isoW, isoH, 0xff0000, 0);
        this.physics.add.existing(wall, true);
        this.walls.add(wall);
    }

    // =========================================================================
    // Sistema de Depth / Layers
    // =========================================================================

    /**
     * FIX: Atualiza depth de todos os objetos dinâmicos a cada frame.
     * Usa isoY como chave de depth (painter's algorithm).
     * O CityWorld usa depth -500 (fundo). Prédios são desenhados pelo Graphics
     * com depth -500, mas o truque para que fiquem "na frente" dos objetos
     * que passam por trás deles é: cada objeto usa seu isoY como depth.
     * Objetos com isoY menor (mais ao norte/esquerda) têm depth menor → ficam atrás.
     * Prédios que se projetam para cima: depth = isoY_base + altura_visual.
     * Isso é gerenciado pelo CityWorld ao emitir os dados de profundidade via
     * `buildingDepths`, que são retângulos invisíveis com depth correto.
     */
    private updateDepths() {
        // Player local
        if (this.localPlayer.active) {
            this.localPlayer.setDepth(this.localPlayer.y);
        }

        // Players remotos
        this.remotePlayers.forEach((p) => {
            if (p.active) p.setDepth(p.y);
        });

        // Zumbis
        this.zombies.zombiesMap.forEach((z) => {
            z.setDepth(z.y);
        });
    }

    // =========================================================================
    // Sistema de munição
    // =========================================================================

    private startReload() {
        if (this.isReloading || this.ammo === MAG_SIZE) return;
        this.isReloading = true;
        this.audio.reloadStart();
        EventBus.emit('ammo-state', { ammo: this.ammo, max: MAG_SIZE, reloading: true });

        this.reloadTimer = this.time.delayedCall(RELOAD_TIME_MS, () => {
            this.ammo = MAG_SIZE;
            this.isReloading = false;
            this.reloadTimer = null;
            this.audio.reloadDone();
            this.emitAmmoState();
        });
    }

    private emitAmmoState() {
        EventBus.emit('ammo-state', { ammo: this.ammo, max: MAG_SIZE, reloading: this.isReloading });
    }

    // =========================================================================
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
    // Worker (background throttling fix)
    // =========================================================================

    private initHeartbeatWorker() {
        try {
            this.heartbeatWorker = new Worker('/heartbeatWorker.js');
            this.heartbeatWorker.onmessage = (e) => {
                if (e.data !== 'tick') return;
                if (this.isHost) this.runHostBackgroundSimulation();
                else             this.sendClientData();
            };
        } catch {
            console.warn('[Game] heartbeatWorker não encontrado — background sim desativada.');
        }
        this.events.once('destroy', () => this.heartbeatWorker?.terminate());
    }

    private onVisibilityChange = () => { /* intencional: não pausar */ };

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

        if (from === this.hostID || type === 'host-heartbeat') {
            this.lastHostHeartbeat = this.time.now;
        }

        switch (type) {
            case 'host-heartbeat': break;
            case 'host-migration-start': this.handleHostMigration(data.newHostID as string); break;

            case 'player-joined':
                if (this.isHost) {
                    // FIX: recebe o nome do jogador que entrou
                    const joinName = (data.name as string) ?? from.slice(0, 6);
                    this.score.registerPlayer(from, joinName);
                    // Cria o container visual do player remoto com o nome
                    if (!this.remotePlayers.has(from)) {
                        const remote = new Player(this, 0, 0, false);
                        remote.setNameLabel(joinName);
                        this.remotePlayers.set(from, remote);
                        // Colisão com paredes
                        this.physics.add.collider(remote, this.walls);
                    }
                    this.broadcastScores();
                    this.multiplayer.broadcast('horde-state', { state: this.horde.getState() });
                }
                break;

            case 'player-leaving': this.removePlayer(from); break;
            case 'move':           this.handleRemoteMove(from, data); break;

            case 'player-shoot':
                this.createBullet(data.x as number, data.y as number, data.angle as number, false);
                break;

            case 'zombie-spawn':
                if (!this.isHost)
                    this.zombies.spawn(data.id as string, data.x as number, data.y as number, data.hp as number);
                break;

            case 'zombie-update':
                this.handleZombieUpdate(data.list as Array<{ id: string; isoX: number; isoY: number }>);
                break;

            case 'zombie-death':
                this.audio.zombieDeath();
                this.zombies.remove(data.id as string);
                break;

            case 'zombie-hit':
                this.audio.zombieHit();
                this.zombies.hit(data.id as string);
                break;

            // FIX: host notifica clientes sobre revive ao fim da horda
            case 'player-revived':
                if (!this.isHost && (data.id as string) === this.myId) {
                    this.handleRevive();
                }
                break;

            case 'horde-state':
                if (!this.isHost) this.horde.applyNetworkState(data.state as any);
                break;

            case 'score-update':
                if (!this.isHost) this.score.applySnapshot(data.scores as any);
                break;

            case 'player-dead':       this.lastRemoteData.delete(from); break;
            case 'cast-vote':
                if (this.isHost) this.vote.castVote(from, data.choice as VoteChoice);
                break;

            case 'vote-state':
                if (!this.isHost) {
                    this.vote.applyNetworkState(data as any);
                    EventBus.emit('vote-state', data);
                }
                break;

            case 'vote-resolved':    this.handleVoteResolved(data.staying as string[]); break;
            case 'show-leaderboard': EventBus.emit('show-leaderboard', data); break;
            case 'session-end':      EventBus.emit('session-end'); break;
            case 'game-restart':     this.restartGame(); break;
            default: break;
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
        this.horde.onWaveComplete = (wave) => {
            this.reviveDeadPlayers();
            this.score.onWaveComplete(wave);
            this.broadcastScores();
        };
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
            // FIX: tenta usar o nome já registrado no score
            const lb = this.score.getLeaderboard();
            const entry = lb.find(p => p.id === id);
            if (entry) remote.setNameLabel(entry.name);
            this.remotePlayers.set(id, remote);
            this.physics.add.collider(remote, this.walls);
        }
        const { isoX, isoY } = cartesianToIso(data.x as number, data.y as number);
        this.tweens.add({ targets: remote, x: isoX, y: isoY, duration: 50, ease: 'Linear' });
        remote.setRotation(data.angle as number);
        // depth atualizado em updateDepths()
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
            if (!this.zombies.zombiesMap.has(id)) {
                this.zombies.spawn(id, isoX, isoY);
            }
            if (!this.isHost) {
                const z = this.zombies.zombiesMap.get(id);
                if (z) {
                    const dx = Math.abs(z.x - isoX);
                    const dy = Math.abs(z.y - isoY);
                    if (dx < 800 && dy < 800) {
                        this.zombies.setTarget(id, isoX, isoY);
                    } else {
                        this.zombies.setPosition(id, isoX, isoY);
                    }
                }
            }
        });
    }

    private handleZombieHit(
        bullet: Phaser.GameObjects.GameObject,
        zombieContainer: Phaser.GameObjects.Container,
    ) {
        bullet.destroy();
        if (!this.isHost) return;

        let zombieId: string | undefined;
        this.zombies.zombiesMap.forEach((v, k) => { if (v === zombieContainer) zombieId = k; });
        if (!zombieId) return;

        const died = this.zombies.hit(zombieId);
        if (died) {
            this.audio.zombieDeath();

            // FIX: atribui o kill ao jogador que disparou a bala (marcado na bala)
            // A bala carrega 'shooterId'; se não tiver (bala de cliente) usamos myId
            const shooterId = (bullet as any).getData?.('shooterId') as string | undefined ?? this.myId;
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
    // Morte / Espectador / Revive
    // =========================================================================

    private playerDied() {
        this.isAlive      = false;
        this.isSpectating = true;
        this.localPlayer.setVisible(false).setActive(false);
        (this.localPlayer.body as Phaser.Physics.Arcade.Body).enable = false;
        this.multiplayer.broadcast('player-dead', { id: this.myId });
        this.audio.playerDeath();
        EventBus.emit('player-died', {});
        if (this.isHost) { this.score.markDead(this.myId); this.checkAllDead(); }
        this.startSpectating();
    }

    /**
     * FIX: Revive todos os jogadores mortos ao fim da horda (host-side).
     * Jogadores remotos mortos recebem 'player-revived' pela rede.
     * O host revive a si mesmo diretamente.
     */
    private reviveDeadPlayers() {
        if (!this.isHost) return;

        // Revive host se estiver morto
        if (!this.isAlive) {
            this.handleRevive();
            this.score.markAlive(this.myId);
        }

        // Revive remotos mortos
        const deadRemotes: string[] = [];
        this.score.getLeaderboard().forEach(p => {
            if (!p.alive && p.id !== this.myId) deadRemotes.push(p.id);
        });
        deadRemotes.forEach(id => {
            this.score.markAlive(id);
            this.multiplayer.broadcast('player-revived', { id });
            // Reativa o container visual do player remoto
            const remote = this.remotePlayers.get(id);
            if (remote) {
                remote.setVisible(true).setActive(true);
                (remote.body as Phaser.Physics.Arcade.Body).enable = true;
            }
        });
    }

    /** Restaura estado vivo do jogador local */
    private handleRevive() {
        this.isAlive      = true;
        this.isSpectating = false;
        this.playerData.hp = 100;
        this.localPlayer.setVisible(true).setActive(true);
        (this.localPlayer.body as Phaser.Physics.Arcade.Body).enable = true;
        EventBus.emit('player-stats',   { hp: 100 });
        EventBus.emit('player-revived', {});
    }

    private startSpectating() {
        const targets = this.getSpectateTargets();
        this.spectateTargetId = targets[0] ?? '';
        EventBus.emit('spectate-start', { targetId: this.spectateTargetId });
    }

    private getSpectateTargets(): string[] {
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
    // Votação
    // =========================================================================

    private handleVoteResolved(staying: string[]) {
        if (!staying.includes(this.myId)) {
            this.multiplayer.destroy();
            EventBus.emit('session-end');
        }
    }

    private handleVoteRestart(staying: string[]) {
        this.multiplayer.broadcast('vote-resolved', { staying });
        this.time.delayedCall(400, () => {
            this.multiplayer.broadcast('game-restart', {});
            this.restartGame();
        });
    }

    private restartGame() {
        this.horde.destroy();
        this.zombies.removeAll();
        this.score.reset();
        this.isConnecting    = false;
        this.playerData      = { x: 0, y: 0, speed: 220, hp: 100 };
        this.isAlive         = true;
        this.isSpectating    = false;
        this.lastDamageTime  = 0;
        this.spectateTargetId = '';
        this.ammo            = MAG_SIZE;
        this.isReloading     = false;
        this.reloadTimer?.remove();
        this.reloadTimer = null;
        this.localPlayer.setVisible(true).setActive(true);
        (this.localPlayer.body as Phaser.Physics.Arcade.Body).enable = true;
        this.localPlayer.setPosition(0, 0);
        EventBus.emit('player-stats',  { hp: 100 });
        EventBus.emit('game-restarted', {});
        this.emitAmmoState();
        if (this.isHost) {
            this.horde = new HordeManager();
            this.horde.onSpawnZombie  = () => this.spawnZombieHost();
            this.horde.onStateChange  = (state) => this.multiplayer.broadcast('horde-state', { state });
            this.horde.onWaveComplete = (wave) => {
                this.reviveDeadPlayers();
                this.score.onWaveComplete(wave);
                this.broadcastScores();
            };
            this.horde.start();
        }
    }

    // =========================================================================
    // Simulação em background
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
            (b, z) => this.handleZombieHit(
                b as Phaser.GameObjects.GameObject,
                z as Phaser.GameObjects.Container,
            ),
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
        const lb = this.score.getLeaderboard();
        this.multiplayer.broadcast('score-update', { scores: lb });
        EventBus.emit('score-update', lb);
    }

    // =========================================================================
    // Input
    // =========================================================================

    /**
     * FIX: Movimento relativo à direção que o player está olhando.
     * W = avança na direção do aim, S = recua, A/D = strafe lateral.
     *
     * O ângulo de rotação do player (this.localPlayer.rotation) é calculado
     * em espaço de tela pelo aimAtPointer(). Precisamos converter esse
     * ângulo de tela para o espaço cartesiano do mundo (que usa proporção 2:1).
     *
     * A bala já usa angle diretamente com coseno/seno em espaço de tela;
     * aqui fazemos o mesmo para o movimento, mas re-mapeamos para cartesiano.
     */
    private processMovement(delta: number) {
        const angle = this.localPlayer.rotation; // ângulo em espaço de tela

        // Vetores de tela
        const fwdScreenX = Math.cos(angle);
        const fwdScreenY = Math.sin(angle);

        // Perpendicular (direita = +90°)
        const rgtScreenX =  fwdScreenY;
        const rgtScreenY = -fwdScreenX;

        // Acumula direção de input
        let dx = 0, dy = 0;
        if (this.wasd?.W?.isDown) { dx += fwdScreenX; dy += fwdScreenY; }
        if (this.wasd?.S?.isDown) { dx -= fwdScreenX; dy -= fwdScreenY; }
        if (this.wasd?.A?.isDown) { dx -= rgtScreenX; dy -= rgtScreenY; }
        if (this.wasd?.D?.isDown) { dx += rgtScreenX; dy += rgtScreenY; }

        this.isMoving = dx !== 0 || dy !== 0;

        if (this.isMoving) {
            const len = Math.hypot(dx, dy);
            const dt  = delta / 1000;

            // Converte vetor de tela para cartesiano (inverso de isoToCartesian):
            // isoX = x - y  →  x = (isoX + isoY*2)/2, y = (isoY*2 - isoX)/2
            // mas isoY em tela = (x+y)/2, então para movimento usamos:
            // cartX += (dx - dy) * speed * dt  (aproximação para isométrico 2:1)
            // cartY += (dx + dy) * speed * dt
            // O factor 2 no dy compensa o achatamento vertical da projeção.
            const nx = dx / len;
            const ny = dy / len;
            this.playerData.x += (nx - ny * 2) * this.playerData.speed * dt;
            this.playerData.y += (nx + ny * 2) * this.playerData.speed * dt;
        }

        const { isoX, isoY } = cartesianToIso(this.playerData.x, this.playerData.y);
        this.localPlayer.setPosition(isoX, isoY);
        // depth atualizado em updateDepths()
    }

    private aimAtPointer() {
        const p  = this.input.activePointer;
        const cx = this.cameras.main.width  / 2;
        const cy = this.cameras.main.height / 2;
        this.localPlayer.setRotation(Math.atan2((p.y - cy) * 2, p.x - cx));
    }

    private shoot() {
        if (!this.isAlive) return;

        const now = this.time.now;
        if (now - this.lastShootTime < SHOOT_COOLDOWN) return;
        this.lastShootTime = now;

        if (this.ammo <= 0 || this.isReloading) {
            if (!this.isReloading) {
                this.audio.emptyClick();
                this.startReload();
            }
            return;
        }

        this.ammo--;
        this.emitAmmoState();
        this.audio.shoot();

        const angle = this.localPlayer.rotation;
        // FIX: passa o shooterId para a bala para atribuição correta de kills
        this.createBullet(this.playerData.x, this.playerData.y, angle, true, this.myId);
        this.multiplayer.broadcast('player-shoot', {
            x: this.playerData.x, y: this.playerData.y, angle,
            shooterId: this.myId,
        });

        if (this.ammo === 0) {
            this.time.delayedCall(300, () => this.startReload());
        }
    }

    /**
     * FIX: createBullet agora recebe e armazena o shooterId na bala.
     * O host usa esse dado em handleZombieHit para dar o kill ao jogador certo.
     */
    private createBullet(wx: number, wy: number, angle: number, _local: boolean, shooterId?: string) {
        const { isoX, isoY } = cartesianToIso(wx, wy);
        const bullet = this.add.circle(isoX, isoY, 4, 0xffee22) as Phaser.GameObjects.Arc & { shooterId?: string };
        this.physics.add.existing(bullet);
        this.bullets.add(bullet);
        // Marca quem atirou para atribuição de kill
        (bullet as any).setData('shooterId', shooterId ?? this.myId);
        const body = bullet.body as Phaser.Physics.Arcade.Body;
        body.setSize(10, 10);
        body.setVelocity(Math.cos(angle) * 950, (Math.sin(angle) * 950) / 2);
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