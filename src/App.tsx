import { useState, useEffect } from 'react';
import { EventBus } from './game/EventBus';
import { PhaserGame } from './PhaserGame';
import './App.css'; // <--- IMPORTANTE: Importe o CSS aqui

export default function App() {
    const [hp, setHp] = useState(100);
    const [gameStarted, setGameStarted] = useState(false); // Mantém como false
    const [roomKey, setRoomKey] = useState("");

    useEffect(() => {
        // Escuta quando o jogo CONECTAR de fato
        EventBus.on('room-joined', (key: string) => {
            setGameStarted(true); // Só mostra o HUD quando a sala existir
            setRoomKey(key);
        });

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

// Mantenha a sua função MainMenuUI aqui embaixo ou em outro arquivo
function MainMenuUI() {
    const [joinKey, setJoinKey] = useState("");

    const startAsHost = () => {
        // Envia evento para o Phaser avisando que queremos ser HOST
        EventBus.emit('start-game', { isHost: true });
    };

    const joinAsGuest = () => {
        EventBus.emit('start-game', { isHost: false, roomId: joinKey });
    };

    return (
        <div style={{
            position: 'absolute', zIndex: 20, top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)', background: '#111',
            padding: '40px', border: '2px solid green', color: 'white', textAlign: 'center'
        }}>
            <h1>ZOMBIES MULTIPLAYER</h1>
            <button onClick={startAsHost} style={{ padding: '10px 20px', cursor: 'pointer' }}>CRIAR SALA (HOST)</button>
            <div style={{ margin: '20px 0' }}>OU</div>
            <input
                value={joinKey}
                onChange={e => setJoinKey(e.target.value)}
                placeholder="Cole a chave aqui"
                style={{ padding: '10px', width: '200px' }}
            />
            <br /><br />
            <button onClick={joinAsGuest} style={{ padding: '10px 20px', cursor: 'pointer' }}>ENTRAR NA SESSÃO</button>
        </div>
    );
}