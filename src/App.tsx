import { useState, useEffect } from 'react';
import { EventBus } from './game/EventBus';
import { PhaserGame } from './PhaserGame';
import './App.css'; // <--- IMPORTANTE: Importe o CSS aqui

export default function App() {
    const [hp, setHp] = useState(100);
    const [gameStarted, setGameStarted] = useState(false); // Mantém como false
    const [roomKey, setRoomKey] = useState("");

    useEffect(() => {
        const onRoomJoined = (key: string) => {
            console.log("React: Sala/Conexão estabelecida!", key);
            setGameStarted(true); // <--- ESCONDE O MENU
            setRoomKey(key);
        };

        EventBus.on('room-joined', onRoomJoined);

        EventBus.on('player-stats', (data: any) => {
            setHp(data.hp);
        });

        return () => {
            EventBus.removeListener('room-joined');
            EventBus.removeListener('player-stats');
        };
    }, []);

    return (
        <div id="app">
            {/* O PhaserGame fica sempre no fundo */}
            <PhaserGame />

            {/* Menu aparece se o jogo não tiver começado */}
            {!gameStarted && <MainMenuUI />}

            {/* HUD aparece se o jogo começou */}
            {gameStarted && (
                <div style={{
                    position: 'absolute', zIndex: 10, top: '20px', left: '20px',
                    padding: '15px', background: 'rgba(0,0,0,0.8)', color: 'white',
                    fontFamily: 'monospace', border: '2px solid #555'
                }}>
                    <h2>SURVIVAL HUD</h2>
                    <p>HP: {hp}%</p>
                    {roomKey && <p style={{ color: 'yellow' }}>SALA: {roomKey}</p>}
                </div>
            )}
        </div>
    );
}

function MainMenuUI() {
    const [joinKey, setJoinKey] = useState("");
    const [loading, setLoading] = useState(false); // <--- ESTADO DE CARREGAMENTO

    const startAsHost = () => {
        setLoading(true);
        EventBus.emit('start-game', { isHost: true });
    };

    const joinAsGuest = () => {
        setLoading(true);
        EventBus.emit('start-game', { isHost: false, roomId: joinKey });
    };

    return (
        <div className="menu">
            {loading ? (
                <h2>Conectando...</h2>
            ) : (
                <>
                    <h1>ZOMBIES MULTIPLAYER</h1>
                    <button onClick={startAsHost}>CRIAR SALA (HOST)</button>
                    <hr />
                    <input value={joinKey} onChange={e => setJoinKey(e.target.value)} placeholder="Chave do Host" />
                    <button onClick={joinAsGuest}>ENTRAR NA SESSÃO</button>
                </>
            )}
        </div>
    );
}