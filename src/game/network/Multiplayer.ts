import { Peer, DataConnection } from 'peerjs';
import { EventBus } from '../EventBus';

export class MultiplayerService {
    private peer!: Peer;
    private connections: Map<string, DataConnection> = new Map();
    private _myID = '';
    private _isHost = false;
    private _allPeers: string[] = [];
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    private static readonly HEARTBEAT_MS       = 1000;
    private static readonly CONNECTION_TIMEOUT  = 8000;

    constructor() { this.createPeer(); }

    get myID()     { return this._myID; }
    get isHost()   { return this._isHost; }
    get allPeers() { return [...this._allPeers]; }

    async hostGame(): Promise<string> {
        this._isHost = true;
        this.peer.on('connection', (conn) => this.setupConnection(conn));
        return this.waitForId();
    }

    async joinGame(hostID: string): Promise<void> {
        this._isHost = false;
        await this.waitForId();
        const conn = this.peer.connect(hostID, { reliable: true });
        const timer = setTimeout(() => {
            if (!this.connections.has(conn.peer)) {
                EventBus.emit('connection-error', { reason: 'Nao foi possivel conectar. Verifique a chave.' });
            }
        }, MultiplayerService.CONNECTION_TIMEOUT);
        conn.once('open', () => clearTimeout(timer));
        conn.once('error', () => {
            clearTimeout(timer);
            EventBus.emit('connection-error', { reason: 'Host nao encontrado. Verifique a chave.' });
        });
        this.setupConnection(conn);
    }

    broadcast(type: string, payload: Record<string, unknown> = {}) {
        const msg = JSON.stringify({ type, ...payload });
        this.connections.forEach((conn) => { if (conn.open) conn.send(msg); });
    }

    removePeer(id: string) {
        this.connections.delete(id);
        this.rebuildPeerList();
    }

    startHostHeartbeat() {
        this.stopHostHeartbeat();
        this.heartbeatInterval = setInterval(
            () => this.broadcast('host-heartbeat', {}),
            MultiplayerService.HEARTBEAT_MS,
        );
    }

    stopHostHeartbeat() {
        if (this.heartbeatInterval !== null) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    destroy() {
        this.stopHostHeartbeat();
        this.connections.forEach((c) => { try { c.close(); } catch (_) {} });
        this.connections.clear();
        this._allPeers = [];
        this._myID     = '';
        this._isHost   = false;
        try { this.peer.destroy(); } catch (_) {}
        this.createPeer();
    }

    private createPeer() {
        this.peer = new Peer();
        this.peer.on('open', (id) => {
            this._myID = id;
            console.log('[P2P] ID:', id);
        });
        this.peer.on('error', (err: any) => {
            console.error('[P2P] Erro global:', err.type, err);
            if (err.type === 'peer-unavailable' || err.type === 'network') {
                EventBus.emit('connection-error', { reason: 'Host nao encontrado. Verifique a chave.' });
            }
        });
    }

    private waitForId(): Promise<string> {
        return new Promise<string>((resolve) => {
            if (this._myID) { resolve(this._myID); return; }
            this.peer.once('open', resolve);
        });
    }

    private rebuildPeerList() {
        this._allPeers = [this._myID, ...Array.from(this.connections.keys())].sort();
    }

    private setupConnection(conn: DataConnection) {
        conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            this.rebuildPeerList();
            console.log('[P2P] Conexao aberta:', conn.peer);
            if (!this._isHost) EventBus.emit('room-joined', conn.peer);
        });
        conn.on('close', () => {
            this.removePeer(conn.peer);
            EventBus.emit('peer-disconnected', conn.peer);
        });
        conn.on('error', (err) => {
            console.error('[P2P] Erro na conexao:', conn.peer, err);
        });
        conn.on('data', (raw: unknown) => {
            if (typeof raw !== 'string') return;
            try {
                const data = JSON.parse(raw);
                EventBus.emit('network-data', { from: conn.peer, data });
            } catch (_) {
                console.warn('[P2P] Dados malformados de', conn.peer);
            }
        });
    }
}