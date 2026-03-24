import { useState, useEffect, useCallback } from 'react';
import { EventBus } from './game/EventBus';
import { PhaserGame } from './PhaserGame';
import './App.css';

// ─── HUD ─────────────────────────────────────────────────────────────────────

function HUD({ hp, roomKey }: { hp: number; roomKey: string }) {
    const hpColor = hp > 50 ? '#44ff88' : hp > 25 ? '#ffaa00' : '#ff4444';

    return (
        <div style={{
            position: 'absolute', zIndex: 10, top: 20, left: 20,
            padding: '12px 18px',
            background: 'rgba(0,0,0,0.75)',
            color: 'white',
            fontFamily: 'monospace',
            border: '1px solid #444',
            borderRadius: 6,
            minWidth: 160,
        }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>SURVIVAL HUD</div>
            <div>HP: <span style={{ color: hpColor, fontWeight: 'bold' }}>{hp}%</span></div>
            {roomKey && (
                <div style={{ marginTop: 6, fontSize: 11, color: '#ffcc00' }}>
                    SALA: {roomKey}
                </div>
            )}
        </div>
    );
}

// ─── Menu principal ───────────────────────────────────────────────────────────

function MainMenuUI() {
    const [joinKey, setJoinKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState('');

    const startAsHost = useCallback(() => {
        setLoading(true);
        setError('');
        EventBus.emit('start-game', { isHost: true });
    }, []);

    const joinAsGuest = useCallback(() => {
        const key = joinKey.trim();
        if (!key) { setError('Informe a chave do host.'); return; }
        setLoading(true);
        setError('');
        EventBus.emit('start-game', { isHost: false, roomId: key });
    }, [joinKey]);

    if (loading) {
        return (
            <div className="menu">
                <div className="menu-loading">Conectando…</div>
            </div>
        );
    }

    return (
        <div className="menu">
            <h1>ZOMBIES MULTIPLAYER</h1>

            <button onClick={startAsHost}>CRIAR SALA (HOST)</button>

            <hr />

            <input
                value={joinKey}
                onChange={e => setJoinKey(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && joinAsGuest()}
                placeholder="Chave do Host"
                maxLength={64}
                spellCheck={false}
            />
            <button onClick={joinAsGuest}>ENTRAR NA SESSÃO</button>

            {error && <p style={{ color: '#ff6666', marginTop: 8, fontSize: 13 }}>{error}</p>}
        </div>
    );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
    const [hp, setHp]               = useState(100);
    const [gameStarted, setStarted] = useState(false);
    const [roomKey, setRoomKey]     = useState('');

    useEffect(() => {
        const onRoomJoined = (key: string) => {
            setStarted(true);
            setRoomKey(key);
        };

        const onPlayerStats = (data: { hp: number }) => {
            setHp(data.hp);
        };

        const onGameOver = () => {
            // Reseta o estado para exibir o menu novamente se necessário
            setStarted(false);
            setHp(100);
            setRoomKey('');
        };

        EventBus.on('room-joined',   onRoomJoined);
        EventBus.on('player-stats',  onPlayerStats);
        EventBus.on('game-over',     onGameOver);

        return () => {
            EventBus.removeListener('room-joined',  onRoomJoined);
            EventBus.removeListener('player-stats', onPlayerStats);
            EventBus.removeListener('game-over',    onGameOver);
        };
    }, []);

    return (
        <div id="app">
            <PhaserGame />
            {!gameStarted && <MainMenuUI />}
            {gameStarted  && <HUD hp={hp} roomKey={roomKey} />}
        </div>
    );
}