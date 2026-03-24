import { Peer, DataConnection } from 'peerjs';
import { EventBus } from '../EventBus';

type MessageHandler = (from: string, data: unknown) => void;

/**
 * Camada de rede P2P via PeerJS.
 *
 * Correções aplicadas:
 * - JSON.parse movido para cá (antes estava no Game.ts, misturando responsabilidades)
 * - Tratamento de erro em JSON malformado
 * - Heartbeat de host enviado daqui via broadcast periódico
 * - Peer destruído corretamente ao chamar destroy()
 */
export class MultiplayerService {
    private peer: Peer;
    private connections: Map<string, DataConnection> = new Map();
    private _myID: string = '';
    private _isHost: boolean = false;
    private _allPeers: string[] = [];
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    // Tempo (ms) entre heartbeats de host enviados aos clientes
    static readonly HEARTBEAT_INTERVAL = 1000;

    constructor() {
        this.peer = new Peer();
        this.peer.on('open', (id) => {
            this._myID = id;
            console.log('[P2P] Meu ID:', id);
        });
        this.peer.on('error', (err) => {
            console.error('[P2P] Erro no Peer:', err);
        });
    }

    get myID() { return this._myID; }
    get isHost() { return this._isHost; }
    get allPeers() { return [...this._allPeers]; }

    /** HOST: aguarda conexões e retorna o próprio ID para compartilhar */
    async hostGame(): Promise<string> {
        this._isHost = true;
        this.peer.on('connection', (conn) => this.setupConnection(conn));

        return new Promise<string>((resolve) => {
            if (this._myID) { resolve(this._myID); return; }
            this.peer.once('open', resolve);
        });
    }

    /** CLIENTE: conecta no ID do host */
    async joinGame(hostID: string): Promise<void> {
        this._isHost = false;
        const conn = this.peer.connect(hostID, { reliable: true });
        this.setupConnection(conn);
    }

    /** Envia uma mensagem serializada para todas as conexões abertas */
    broadcast(type: string, payload: Record<string, unknown> = {}) {
        const message = JSON.stringify({ type, ...payload });
        this.connections.forEach((conn) => {
            if (conn.open) conn.send(message);
        });
    }

    removePeer(id: string) {
        this.connections.delete(id);
        this.rebuildPeerList();
    }

    /** Inicia envio periódico de heartbeat (apenas para o host) */
    startHostHeartbeat() {
        this.stopHostHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            this.broadcast('host-heartbeat', {});
        }, MultiplayerService.HEARTBEAT_INTERVAL);
    }

    stopHostHeartbeat() {
        if (this.heartbeatInterval !== null) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /** Libera todos os recursos */
    destroy() {
        this.stopHostHeartbeat();
        this.connections.forEach((conn) => conn.close());
        this.connections.clear();
        this.peer.destroy();
    }

    // ─── privado ────────────────────────────────────────────────────────────────

    private rebuildPeerList() {
        this._allPeers = [this._myID, ...Array.from(this.connections.keys())].sort();
    }

    private setupConnection(conn: DataConnection) {
        conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            this.rebuildPeerList();
            console.log('[P2P] Conexão aberta com:', conn.peer);

            if (!this._isHost) {
                // Cliente avisa o React que entrou na sala
                EventBus.emit('room-joined', conn.peer);
            }
        });

        conn.on('close', () => {
            console.log('[P2P] Conexão fechada com:', conn.peer);
            this.removePeer(conn.peer);
            EventBus.emit('peer-disconnected', conn.peer);
        });

        conn.on('error', (err) => {
            console.error('[P2P] Erro na conexão com', conn.peer, err);
        });

        conn.on('data', (raw: unknown) => {
            if (typeof raw !== 'string') return;
            try {
                const data = JSON.parse(raw);
                EventBus.emit('network-data', { from: conn.peer, data });
            } catch {
                console.warn('[P2P] Dados malformados recebidos de', conn.peer);
            }
        });
    }
}