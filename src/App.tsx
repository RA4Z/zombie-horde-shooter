import { useState, useEffect, useCallback, useRef } from 'react';
import { EventBus } from './game/EventBus';
import { PhaserGame } from './PhaserGame';
import type { PlayerScore } from './game/entities/ScoreManager';
import type { HordeState } from './game/entities/HordeManager';
import type { VoteState, VoteChoice } from './game/entities/VoteManager';
import './App.css';

// ─── HUD ─────────────────────────────────────────────────────────────────────

function HealthBar({ hp }: { hp: number }) {
    const pct   = Math.max(0, Math.min(100, hp));
    const color = pct > 50 ? '#22dd66' : pct > 25 ? '#ffaa22' : '#ff3333';

    return (
        <div className="hud-hp-wrap">
            <div className="hud-hp-label">HP</div>
            <div className="hud-hp-track">
                <div
                    className="hud-hp-fill"
                    style={{ width: `${pct}%`, background: color }}
                />
                <div className="hud-hp-segments">
                    {[25, 50, 75].map(v => (
                        <div key={v} className="hud-hp-seg" style={{ left: `${v}%` }} />
                    ))}
                </div>
            </div>
            <div className="hud-hp-value">{hp}%</div>
        </div>
    );
}

function ScorePanel({ scores }: { scores: PlayerScore[] }) {
    return (
        <div className="hud-scores">
            {scores.slice(0, 4).map((p, i) => (
                <div key={p.id} className={`hud-score-row ${p.alive ? '' : 'dead'}`}>
                    <span className="hud-score-rank">#{i + 1}</span>
                    <span className="hud-score-name">{p.name.slice(0, 8)}</span>
                    <span className="hud-score-pts">{p.score}</span>
                    <span className="hud-score-kills">☠ {p.kills}</span>
                </div>
            ))}
        </div>
    );
}

function HordePanel({ horde }: { horde: HordeState | null }) {
    if (!horde) return null;

    return (
        <div className="hud-horde">
            <div className="hud-horde-wave">HORDA <span>{horde.wave || '—'}</span></div>
            {horde.phase === 'fighting' && (
                <div className="hud-horde-enemies">
                    Zumbis: <span>{horde.zombiesRemaining}</span> / {horde.zombiesTotal}
                </div>
            )}
            {horde.phase === 'countdown' && (
                <div className="hud-horde-countdown">
                    Próxima horda em <span>{horde.countdown}s</span>
                </div>
            )}
        </div>
    );
}

function SpectatorBanner({ targetId }: { targetId: string }) {
    return (
        <div className="spectator-banner">
            <div className="spectator-title">👁 ESPECTADOR</div>
            <div className="spectator-sub">
                {targetId ? `Spectando: ${targetId.slice(0, 8)}` : 'Aguardando jogadores…'}
            </div>
            <div className="spectator-hint">[ Q ] ← Trocar → [ E ]</div>
        </div>
    );
}

function HUD({
    hp, roomKey, scores, horde, isSpectating, spectateTarget,
}: {
    hp: number;
    roomKey: string;
    scores: PlayerScore[];
    horde: HordeState | null;
    isSpectating: boolean;
    spectateTarget: string;
}) {
    return (
        <>
            {/* Top-left: HP + sala */}
            <div className="hud-block hud-topleft">
                <HealthBar hp={hp} />
                {roomKey && <div className="hud-room">🔑 {roomKey.slice(0, 10)}…</div>}
            </div>

            {/* Top-center: Horda */}
            <div className="hud-block hud-topcenter">
                <HordePanel horde={horde} />
            </div>

            {/* Top-right: Placar */}
            <div className="hud-block hud-topright">
                <ScorePanel scores={scores} />
            </div>

            {/* Espectador */}
            {isSpectating && <SpectatorBanner targetId={spectateTarget} />}
        </>
    );
}

// ─── Leaderboard / Vote ───────────────────────────────────────────────────────

function VoteButton({ choice, current, onClick, label, icon }: {
    choice: VoteChoice; current: VoteChoice | null;
    onClick: (c: VoteChoice) => void; label: string; icon: string;
}) {
    const active = current === choice;
    return (
        <button
            className={`vote-btn ${choice} ${active ? 'active' : ''}`}
            onClick={() => onClick(choice)}
            disabled={current !== null}
        >
            <span className="vote-icon">{icon}</span>
            <span>{label}</span>
        </button>
    );
}

function LeaderboardScreen({
    scores, vote, onVote,
}: {
    scores: PlayerScore[];
    vote: VoteState | null;
    onVote: (c: VoteChoice) => void;
}) {
    const [myVote, setMyVote] = useState<VoteChoice | null>(null);
    const timeLeft = vote?.timeLeft ?? 30;

    const handleVote = (c: VoteChoice) => {
        setMyVote(c);
        onVote(c);
    };

    const totalVotes = vote ? Object.keys(vote.votes).length : 0;
    const totalPlayers = vote?.totalPlayers ?? 1;
    const pct = Math.round((timeLeft / 30) * 100);

    return (
        <div className="overlay-fullscreen leaderboard-screen">
            <h1 className="lb-title">💀 TODOS MORRERAM</h1>

            {/* Tabela */}
            <div className="lb-table-wrap">
                <table className="lb-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Jogador</th>
                            <th>Pontos</th>
                            <th>Kills</th>
                            <th>Melhor horda</th>
                        </tr>
                    </thead>
                    <tbody>
                        {scores.map((p, i) => (
                            <tr key={p.id} className={i === 0 ? 'lb-first' : ''}>
                                <td>{i === 0 ? '🏆' : i + 1}</td>
                                <td>{p.name}</td>
                                <td className="lb-pts">{p.score}</td>
                                <td>☠ {p.kills}</td>
                                <td>Horda {p.highestWave}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Votação */}
            <div className="vote-section">
                <h2>O que deseja fazer?</h2>

                {/* Timer ring */}
                <div className="vote-timer">
                    <svg viewBox="0 0 44 44" className="vote-timer-svg">
                        <circle cx="22" cy="22" r="18" fill="none" stroke="#333" strokeWidth="4" />
                        <circle
                            cx="22" cy="22" r="18" fill="none"
                            stroke={timeLeft <= 10 ? '#ff4444' : '#44aaff'}
                            strokeWidth="4"
                            strokeDasharray={`${2 * Math.PI * 18}`}
                            strokeDashoffset={`${2 * Math.PI * 18 * (1 - pct / 100)}`}
                            strokeLinecap="round"
                            style={{ transition: 'stroke-dashoffset 1s linear', transform: 'rotate(-90deg)', transformOrigin: 'center' }}
                        />
                        <text x="22" y="27" textAnchor="middle" fontSize="13" fill="white" fontWeight="bold">
                            {timeLeft}s
                        </text>
                    </svg>
                    <div className="vote-progress-label">
                        {totalVotes}/{totalPlayers} votaram
                    </div>
                </div>

                <div className="vote-buttons">
                    <VoteButton choice="restart" current={myVote} onClick={handleVote} label="RECOMEÇAR" icon="🔄" />
                    <VoteButton choice="leave"   current={myVote} onClick={handleVote} label="SAIR"      icon="🚪" />
                </div>

                {myVote && (
                    <div className="vote-cast-msg">
                        Voto registrado: {myVote === 'restart' ? '🔄 Recomeçar' : '🚪 Sair'}
                        {' — aguardando outros jogadores…'}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Menu principal ───────────────────────────────────────────────────────────

function MainMenuUI() {
    const [joinKey, setJoinKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState('');

    const startAsHost = useCallback(() => {
        setLoading(true); setError('');
        EventBus.emit('start-game', { isHost: true });
    }, []);

    const joinAsGuest = useCallback(() => {
        const key = joinKey.trim();
        if (!key) { setError('Informe a chave do host.'); return; }
        setLoading(true); setError('');
        EventBus.emit('start-game', { isHost: false, roomId: key });
    }, [joinKey]);

    if (loading) return (
        <div className="menu"><div className="menu-loading">Conectando…</div></div>
    );

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
                maxLength={64} spellCheck={false}
            />
            <button onClick={joinAsGuest}>ENTRAR NA SESSÃO</button>
            {error && <p className="menu-error">{error}</p>}
        </div>
    );
}

// ─── App ──────────────────────────────────────────────────────────────────────

type Screen = 'menu' | 'game' | 'leaderboard';

export default function App() {
    const [screen, setScreen]           = useState<Screen>('menu');
    const [hp, setHp]                   = useState(100);
    const [roomKey, setRoomKey]         = useState('');
    const [scores, setScores]           = useState<PlayerScore[]>([]);
    const [horde, setHorde]             = useState<HordeState | null>(null);
    const [isSpectating, setSpectating] = useState(false);
    const [spectateTarget, setSpectTarget] = useState('');
    const [voteState, setVoteState]     = useState<VoteState | null>(null);
    const leaderboardRef                = useRef<PlayerScore[]>([]);

    useEffect(() => {
        const onRoomJoined = (key: string) => { setScreen('game'); setRoomKey(key); };

        const onPlayerStats = (d: { hp: number }) => setHp(d.hp);

        const onPlayerDied = () => setSpectating(true);

        const onSpectateTarget = (d: { targetId: string }) => setSpectTarget(d.targetId);

        const onHordeState = (s: HordeState) => setHorde(s);

        const onScoreUpdate = (s: PlayerScore[]) => {
            setScores(s);
            leaderboardRef.current = s;
        };

        const onShowLeaderboard = (d: { scores: PlayerScore[]; vote: VoteState }) => {
            setScores(d.scores);
            setVoteState(d.vote);
            setScreen('leaderboard');
        };

        const onVoteState = (s: VoteState) => setVoteState(s);

        const onVoteResolved = (d: { staying: string[] }) => {
            // Se meu ID não está em staying → sair
            // (React não tem acesso ao myId do Phaser; usamos session-end para isso)
        };

        const onSessionEnd = () => {
            setScreen('menu');
            setHp(100); setRoomKey(''); setScores([]); setHorde(null);
            setSpectating(false); setVoteState(null);
        };

        const onGameRestarted = () => {
            setScreen('game');
            setHp(100); setSpectating(false); setVoteState(null);
        };

        EventBus.on('room-joined',       onRoomJoined);
        EventBus.on('player-stats',      onPlayerStats);
        EventBus.on('player-died',       onPlayerDied);
        EventBus.on('spectate-start',    onSpectateTarget);
        EventBus.on('spectate-target',   onSpectateTarget);
        EventBus.on('horde-state',       onHordeState);
        EventBus.on('score-update',      onScoreUpdate);
        EventBus.on('show-leaderboard',  onShowLeaderboard);
        EventBus.on('vote-state',        onVoteState);
        EventBus.on('vote-resolved',     onVoteResolved);
        EventBus.on('session-end',       onSessionEnd);
        EventBus.on('game-restarted',    onGameRestarted);

        return () => {
            EventBus.removeListener('room-joined',       onRoomJoined);
            EventBus.removeListener('player-stats',      onPlayerStats);
            EventBus.removeListener('player-died',       onPlayerDied);
            EventBus.removeListener('spectate-start',    onSpectateTarget);
            EventBus.removeListener('spectate-target',   onSpectateTarget);
            EventBus.removeListener('horde-state',       onHordeState);
            EventBus.removeListener('score-update',      onScoreUpdate);
            EventBus.removeListener('show-leaderboard',  onShowLeaderboard);
            EventBus.removeListener('vote-state',        onVoteState);
            EventBus.removeListener('vote-resolved',     onVoteResolved);
            EventBus.removeListener('session-end',       onSessionEnd);
            EventBus.removeListener('game-restarted',    onGameRestarted);
        };
    }, []);

    const handleVote = useCallback((choice: VoteChoice) => {
        EventBus.emit('cast-vote', choice);
    }, []);

    return (
        <div id="app">
            <PhaserGame />

            {screen === 'menu' && <MainMenuUI />}

            {screen === 'game' && (
                <HUD
                    hp={hp}
                    roomKey={roomKey}
                    scores={scores}
                    horde={horde}
                    isSpectating={isSpectating}
                    spectateTarget={spectateTarget}
                />
            )}

            {screen === 'leaderboard' && (
                <LeaderboardScreen
                    scores={scores}
                    vote={voteState}
                    onVote={handleVote}
                />
            )}
        </div>
    );
}