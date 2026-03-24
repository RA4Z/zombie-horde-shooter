import { Peer, DataConnection } from 'peerjs';
import { EventBus } from '../EventBus';

export class MultiplayerService {
    private peer: Peer;
    private connections: Map<string, DataConnection> = new Map();
    public isHost: boolean = false;
    public myID: string = "";
    public allPeers: string[] = [];

    constructor() {
        // Inicializa o Peer (usa o servidor público da PeerJS apenas para "encontrar" os players)
        this.peer = new Peer();

        this.peer.on('open', (id) => {
            this.myID = id;
            console.log("Seu ID de conexão:", id);
        });
    }

    // O HOST inicia a espera por conexões
    async hostGame() {
        this.isHost = true;

        this.peer.on('connection', (conn) => {
            this.setupConnection(conn);
        });

        // Retorna o ID para o Host passar para os amigos
        return new Promise<string>((resolve) => {
            if (this.myID) resolve(this.myID);
            this.peer.on('open', (id) => resolve(id));
        });
    }

    // O CLIENTE conecta no ID do Host
    async joinGame(hostID: string) {
        this.isHost = false;
        const conn = this.peer.connect(hostID);
        this.setupConnection(conn);
    }

    private updatePeerList() {
        // Pega seu próprio ID + IDs dos outros e coloca em ordem alfabética
        this.allPeers = [this.myID, ...Array.from(this.connections.keys())].sort();
    }

    getNextHostID() {
        return this.allPeers[0]; // O primeiro da lista ordenada
    }

    removePeer(id: string) {
        this.connections.delete(id);
        this.allPeers = [this.myID, ...Array.from(this.connections.keys())].sort();
    }

    private setupConnection(conn: DataConnection) {
        conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            this.updatePeerList();
            console.log("P2P: Conexão aberta com o Host!");
            if (!this.isHost) {
                EventBus.emit('room-joined', conn.peer);
            }
        });

        // ESTE É O EVENTO CRÍTICO: Quando qualquer player fecha a aba
        conn.on('close', () => {
            console.log("Player saiu da rede:", conn.peer);
            this.removePeer(conn.peer); // Remove da lista de sucessão
            EventBus.emit('peer-disconnected', conn.peer); // Avisa o Phaser para limpar a tela
        });

        conn.on('data', (data: any) => {
            EventBus.emit('network-data', { from: conn.peer, data });
        });
    }


    // Envia dados para todos (se for Host) ou para o Host (se for Cliente)
    broadcast(type: string, payload: any) {
        const message = JSON.stringify({ type, ...payload });
        this.connections.forEach(conn => {
            if (conn.open) conn.send(message);
        });
    }
}