import { Peer, DataConnection } from 'peerjs';
import { EventBus } from '../EventBus';

export class MultiplayerService {
    private peer: Peer;
    private connections: Map<string, DataConnection> = new Map();
    public isHost: boolean = false;
    public myID: string = "";

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

    private setupConnection(conn: DataConnection) {
        conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            console.log("Conectado a:", conn.peer);

            // Se for cliente, avisa o React que entrou
            if (!this.isHost) EventBus.emit('room-joined', conn.peer);
        });

        conn.on('data', (data: any) => {
            // Repassa os dados recebidos para a cena do Phaser
            EventBus.emit('network-data', { from: conn.peer, data });
        });
        
        conn.on('close', () => {
            console.log("Conexão perdida com:", conn.peer);
            this.connections.delete(conn.peer); // Remove da lista de conexões
            EventBus.emit('peer-disconnected', conn.peer); // Avisa o Phaser
        });

        conn.on('error', (err) => {
            console.error("Erro na conexão Peer:", err);
            this.connections.delete(conn.peer);
            EventBus.emit('peer-disconnected', conn.peer);
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