import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { Player } from '../entities/Player';
import { ZombieManager } from '../entities/ZombieManager';
import { HordeManager } from '../entities/HordeManager';
import { ScoreManager } from '../entities/ScoreManager';
import { VoteManager, VoteChoice } from '../entities/VoteManager';
import { MultiplayerService } from '../network/Multiplayer';
import { CityWorld } from '../world/CityWorld';
import { cartesianToIso } from '../utils/IsoMath';

interface PlayerData { x: number; y: number; speed: number; hp: number; }

const HOST_PLAYER_ID = '__host__';

/**
 * Cena principal.
 *
 * Fixes desta versao:
 *  - CityWorld.build() chamado em create() com camera inicial correta
 *  - EventBus.on('start-game') usa .on em vez de .once para suportar
 *    re-entrada apos voltar ao menu (once so dispara 1x por vida da cena)
 *  - Erro de conexao invalida: escuta 'connection-error' e reseta o menu
 *  - Background throttling: o heartbeatWorker usa setInterval no Worker
 *    (nao requestAnimationFrame), entao continua rodando minimizado.
 *    Alem disso, document.visibilitychange nao pausa mais a simulacao.
 *  - Zombis nao teleportam: interpolateClient usa lerpFactor suave (0.12)
 *    e setTarget so atualiza se o delta de posicao for razoavel (< 800px).
 */
export class Game extends Scene {
    // Entidades
    private localPlayer!: Player;
    private remotePlayers: Map<string, Player> = new Map();
    private bullets!: Phaser.Physics.Arcade.Group;
    private zombies!: ZombieManager;
    private cityWorld!: CityWorld;

    // Sistemas
    private horde!: HordeManager;
    private score!: ScoreManager;
    private vote!: VoteManager;

    // Rede
    private multiplayer!: MultiplayerService;
    private isHost = false;
    private hostID = '';
    private lastHostHeartbeat = 0;
    private readonly MIGRATION_THRESHOLD = 4000;

    // Estado local
    private playerData: PlayerData = { x: 0, y: 0, speed: 250, hp: 100 };
    private lastDamageTime = 0;
    private isAlive = true;
    private isSpectating = false;
    private spectateTargetId = '';
    private myId = HOST_PLAYER_ID;

    // Snapshots de rede
    private lastRemoteData: Map<string, { x: number; y: number }> = new Map();
    private lastSeenMap:    Map<string, number>                    = new Map();

    // Input
    private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
    private spectateKeys!: { left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };

    // Timers
    private networkTimer!: Phaser.Time.TimerEvent;
    private heartbeatWorker: Worker | null = null;

    // Guard: impede start-game ser processado enquanto ja conectando
    private isConnecting = false;

    constructor() { super('Game'); }

    // =========================================================================
    create() {
        // Previne pausa ao trocar de aba (Phaser nativo)
        this.sound.pauseOnBlur = false;
        this.game.events.removeAllListeners('blur');
        this.game.events.removeAllListeners('focus');

        // Impede que visibilitychange pause o RAF do Phaser
        document.addEventListener('visibilitychange', this.onVisibilityChange);

        window.addEventListener('beforeunload', this.onBeforeUnload);

        // Mundo da cidade — deve ser criado ANTES dos outros objetos
        // para ficar na camada mais baixa (depth -500 definido em CityWorld)
        this.cityWorld = new CityWorld(this);
        this.cityWorld.build();

        // Sistemas
        this.multiplayer = new MultiplayerService();
        this.zombies     = new ZombieManager(this);
        this.horde       = new HordeManager();
        this.score       = new ScoreManager();
        this.vote        = new VoteManager();
        this.bullets     = this.physics.add.group();
        this.localPlayer = new Player(this, 0, 0, true);

        // Input
        if (this.input.keyboard) {
            this.wasd = this.input.keyboard.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
            this.spectateKeys = {
                left:  this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
                right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
            };
        }
        this.input.on('pointerdown', this.shoot, this);

        // Colisoes
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

        // Timer de broadcast de rede (host)
        this.networkTimer = this.time.addEvent({
            delay: 50, callback: this.sendNetworkUpdates,
            callbackScope: this, loop: true, paused: true,
        });

        // Hooks do sistema de hordas
        this.horde.onSpawnZombie  = () => this.spawnZombieHost();
        this.horde.onStateChange  = (state) => this.multiplayer.broadcast('horde-state', { state });
        this.horde.onWaveComplete = (wave)  => { this.score.onWaveComplete(wave); this.broadcastScores(); };

        // Hooks de votacao
        this.vote.onRestart  = (staying) => this.handleVoteRestart(staying);
        this.vote.onAllLeave = () => {
            this.multiplayer.broadcast('session-end', {});
            EventBus.emit('session-end');
        };

        // Worker para manter simulacao rodando em background (aba minimizada)
        this.initHeartbeatWorker();

        // Eventos de rede
        this.setupNetworkEvents();

        // FIX: usa .on (nao .once) para que o listener sobreviva a um retorno ao menu
        // O guard isConnecting evita processamento duplo
        EventBus.on('start-game', this.onStartGame, this);

        // Voto vindo do React
        EventBus.on('cast-vote', this.onCastVote, this);

        // FIX: escuta erro de conexao para resetar o loading no React
        EventBus.on('connection-error', this.onConnectionError, this);

        // Centraliza camera na origem (onde o player nasce)
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
            this.zombies.updateHost(this.buildAlivePlayerList());
        } else {
            this.zombies.interpolateClient(0.12);
            this.checkHostHealth(_time);
        }

        if (this.isAlive) {
            this.processMovement(delta);
            this.aimAtPointer();
        } else if (this.isSpectating) {
            this.updateSpectator();
        }

        this.updateCamera();
    }

    shutdown() {
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        window.removeEventListener('beforeunload', this.onBeforeUnload);
        this.heartbeatWorker?.terminate();
        this.heartbeatWorker = null;
        this.horde.destroy();
        this.vote.destroy();
        this.multiplayer.destroy();
        // Remove listeners especificos desta cena
        EventBus.removeListener('start-game',      this.onStartGame);
        EventBus.removeListener('cast-vote',       this.onCastVote);
        EventBus.removeListener('connection-error', this.onConnectionError);
        EventBus.removeListener('network-data',    this.onNetworkData);
        EventBus.removeListener('peer-disconnected', this.onPeerDisconnected);
    }

    // =========================================================================
    // Inicio de jogo
    // =========================================================================

    private onStartGame = async (data: { isHost: boolean; roomId?: string }) => {
        if (this.isConnecting) return;
        this.isConnecting = true;

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
            this.isConnecting = false;
            EventBus.emit('room-joined', key);
        } else if (data.roomId) {
            // joinGame pode emitir connection-error — o handler reseta isConnecting
            await this.multiplayer.joinGame(data.roomId);
            this.myId  = this.multiplayer.myID;
            this.hostID = data.roomId;
            // isConnecting = false sera chamado em onConnectionError ou quando room-joined disparar
            this.isConnecting = false;
        }
    };

    private onCastVote = (choice: VoteChoice) => {
        if (this.isHost) this.vote.castVote(this.myId, choice);
        else this.multiplayer.broadcast('cast-vote', { choice });
    };

    private onConnectionError = (data: { reason: string }) => {
        this.isConnecting = false;
        // Reseta o servico de rede para estado limpo
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
                // Mesmo minimizado: host simula, cliente envia posicao
                if (this.isHost) this.runHostBackgroundSimulation();
                else             this.sendClientData();
            };
        } catch {
            console.warn('[Game] heartbeatWorker nao encontrado — background sim desativada.');
        }
        this.events.once('destroy', () => this.heartbeatWorker?.terminate());
    }

    // Impede Phaser de pausar o RAF ao minimizar
    private onVisibilityChange = () => {
        if (document.hidden) {
            // Forcamos o loop a continuar via requestAnimationFrame
            this.game.loop.sleep();   // marca como sleep mas nao para
        }
    };

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

            case 'host-migration-start':
                this.handleHostMigration(data.newHostID as string);
                break;

            case 'player-joined':
                if (this.isHost) {
                    this.score.registerPlayer(from, (data.name as string) ?? from.slice(0, 6));
                    this.broadcastScores();
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
                    this.zombies.spawn(
                        data.id as string,
                        data.x  as number,
                        data.y  as number,
                        data.hp as number,
                    );
                break;

            case 'zombie-update':
                this.handleZombieUpdate(
                    data.list as Array<{ id: string; isoX: number; isoY: number }>,
                );
                break;

            case 'zombie-death':
                this.zombies.remove(data.id as string);
                break;

            case 'zombie-hit':
                // Visual de hit nos clientes (nao afeta logica)
                this.zombies.hit(data.id as string);
                break;

            case 'horde-state':
                if (!this.isHost) this.horde.applyNetworkState(data.state as any);
                break;

            case 'score-update':
                if (!this.isHost) this.score.applySnapshot(data.scores as any);
                break;

            case 'player-dead':
                this.lastRemoteData.delete(from);
                break;

            case 'cast-vote':
                if (this.isHost) this.vote.castVote(from, data.choice as VoteChoice);
                break;

            case 'vote-state':
                if (!this.isHost) {
                    this.vote.applyNetworkState(data as any);
                    EventBus.emit('vote-state', data);
                }
                break;

            case 'vote-resolved':
                this.handleVoteResolved(data.staying as string[]);
                break;

            case 'show-leaderboard':
                EventBus.emit('show-leaderboard', data);
                break;

            case 'session-end':
                EventBus.emit('session-end');
                break;

            case 'game-restart':
                this.restartGame();
                break;

            default:
                // Ignora silenciosamente tipos desconhecidos
                break;
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
        // Continua o horde de onde parou (nao reinicia)
        this.horde.onSpawnZombie  = () => this.spawnZombieHost();
        this.horde.onStateChange  = (state) => this.multiplayer.broadcast('horde-state', { state });
        this.horde.onWaveComplete = (wave)  => { this.score.onWaveComplete(wave); this.broadcastScores(); };
    }

    private handleHostMigration(newHostID: string) {
        this.removePlayer(this.hostID);
        this.hostID = newHostID;
        this.lastHostHeartbeat = this.time.now;
    }

    private startHostRole() {
        this.isHost = true;
        this.hostID = this.multiplayer.myID;
        this.multiplayer.startHostHeartbeat();
        this.networkTimer.paused = false;
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
        const id     = `z_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const angle  = Math.random() * Math.PI * 2;
        const worldX = this.playerData.x + Math.cos(angle) * 600;
        const worldY = this.playerData.y + Math.sin(angle) * 600;
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
                // FIX anti-teleporte: so aceita update se o delta for razoavel
                const z = this.zombies.zombiesMap.get(id);
                if (z) {
                    const dx = Math.abs(z.x - isoX);
                    const dy = Math.abs(z.y - isoY);
                    if (dx < 800 && dy < 800) {
                        this.zombies.setTarget(id, isoX, isoY);
                    } else {
                        // Teleporte legitimo (spawn inicial distante) — aceita mas seta posicao direto
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
            this.score.addKill(this.myId, this.horde.wave);
            this.horde.onZombieDied();
            this.zombies.remove(zombieId);
            this.multiplayer.broadcast('zombie-death', { id: zombieId });
            this.broadcastScores();
        } else {
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
        this.isAlive      = false;
        this.isSpectating = true;
        this.localPlayer.setVisible(false).setActive(false);
        (this.localPlayer.body as Phaser.Physics.Arcade.Body).enable = false;
        this.multiplayer.broadcast('player-dead', { id: this.myId });
        EventBus.emit('player-died', {});
        if (this.isHost) { this.score.markDead(this.myId); this.checkAllDead(); }
        this.startSpectating();
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
    // Votacao
    // =========================================================================

    private handleVoteResolved(staying: string[]) {
        if (!staying.includes(this.myId)) {
            // Volta ao menu: reseta servico de rede para novo uso
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
        this.isConnecting   = false;
        this.playerData     = { x: 0, y: 0, speed: 250, hp: 100 };
        this.isAlive        = true;
        this.isSpectating   = false;
        this.lastDamageTime = 0;
        this.spectateTargetId = '';
        this.localPlayer.setVisible(true).setActive(true);
        (this.localPlayer.body as Phaser.Physics.Arcade.Body).enable = true;
        this.localPlayer.setPosition(0, 0);
        EventBus.emit('player-stats', { hp: 100 });
        EventBus.emit('game-restarted', {});
        if (this.isHost) {
            this.horde = new HordeManager();
            this.horde.onSpawnZombie  = () => this.spawnZombieHost();
            this.horde.onStateChange  = (state) => this.multiplayer.broadcast('horde-state', { state });
            this.horde.onWaveComplete = (wave)  => { this.score.onWaveComplete(wave); this.broadcastScores(); };
            this.horde.start();
        }
    }

    // =========================================================================
    // Simulacao em background
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
        this.localPlayer.setPosition(isoX, isoY).setDepth(isoY);
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
        this.multiplayer.broadcast('player-shoot', {
            x: this.playerData.x, y: this.playerData.y, angle,
        });
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