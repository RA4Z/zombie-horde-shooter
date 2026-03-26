import { useState, useEffect, useCallback } from 'react';
import { EventBus } from './game/EventBus';
import { PhaserGame } from './PhaserGame';
import type { PlayerScore } from './game/entities/ScoreManager';
import type { HordeState }  from './game/entities/HordeManager';
import type { VoteState, VoteChoice } from './game/entities/VoteManager';
import './App.css';

// ─── HP Bar ───────────────────────────────────────────────────────────────────

function HealthBar({ hp }: { hp: number }) {
    const pct   = Math.max(0, Math.min(100, hp));
    const color = pct > 50 ? '#22dd66' : pct > 25 ? '#ffaa22' : '#ff3333';
    const glow  = pct > 50 ? '#22dd6640' : pct > 25 ? '#ffaa2240' : '#ff333340';
    return (
        <div className="hud-hp-wrap">
            <div className="hud-hp-label">HP</div>
            <div className="hud-hp-track">
                <div className="hud-hp-fill" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px ${glow}` }} />
                {[25, 50, 75].map(v => <div key={v} className="hud-hp-seg" style={{ left: `${v}%` }} />)}
            </div>
            <div className="hud-hp-value" style={{ color }}>{hp}</div>
        </div>
    );
}

// ─── Ammo Display ─────────────────────────────────────────────────────────────

function AmmoDisplay({ ammo, max, reloading }: { ammo: number; max: number; reloading: boolean }) {
    return (
        <div className="hud-ammo-wrap">
            <div className="hud-ammo-label">🔫</div>
            {reloading ? (
                <div className="hud-ammo-reloading">RECARREGANDO…</div>
            ) : (
                <div className="hud-ammo-bullets">
                    {Array.from({ length: max }).map((_, i) => (
                        <div key={i} className={`hud-ammo-bullet ${i < ammo ? 'full' : 'empty'}`} />
                    ))}
                </div>
            )}
            <div className="hud-ammo-count" style={{ color: ammo === 0 ? '#ff4444' : '#fff' }}>
                {ammo}/{max}
            </div>
        </div>
    );
}

// ─── Room Key (clicável para copiar) ─────────────────────────────────────────

function RoomKey({ roomKey }: { roomKey: string }) {
    const [copied, setCopied] = useState(false);

    const copy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(roomKey);
        } catch {
            const el = Object.assign(document.createElement('textarea'), {
                value: roomKey, style: 'position:fixed;opacity:0;top:0;left:0',
            });
            document.body.appendChild(el);
            el.focus(); el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
    }, [roomKey]);

    return (
        <div className="hud-room" onClick={copy} role="button" title="Clique para copiar a chave completa">
            <span className="hud-room-icon">{copied ? '✅' : '🔑'}</span>
            <span className="hud-room-key">{copied ? 'Chave copiada!' : roomKey}</span>
        </div>
    );
}

// ─── Score Panel ──────────────────────────────────────────────────────────────

function ScorePanel({ scores }: { scores: PlayerScore[] }) {
    if (scores.length === 0) return null;
    return (
        <div className="hud-scores">
            <div className="hud-scores-title">PLACAR</div>
            {scores.slice(0, 4).map((p, i) => (
                <div key={p.id} className={`hud-score-row ${p.alive ? '' : 'dead'}`}>
                    <span className="hud-score-rank">{i === 0 ? '👑' : `#${i + 1}`}</span>
                    <span className="hud-score-name">{p.name.slice(0, 9)}</span>
                    <span className="hud-score-pts">{p.score}</span>
                    <span className="hud-score-kills">☠{p.kills}</span>
                </div>
            ))}
        </div>
    );
}

// ─── Horde Panel ─────────────────────────────────────────────────────────────

function HordePanel({ horde }: { horde: HordeState | null }) {
    if (!horde || horde.phase === 'idle') return null;
    return (
        <div className="hud-horde">
            <div className="hud-horde-label">HORDA</div>
            <div className="hud-horde-num">{horde.wave > 0 ? horde.wave : '–'}</div>
            {horde.phase === 'fighting' && horde.wave > 0 && (
                <div className="hud-horde-info">
                    <span style={{ color: '#ff5544' }}>{horde.zombiesRemaining}</span>
                    <span style={{ color: '#666' }}>/{horde.zombiesTotal} zumbis</span>
                </div>
            )}
            {horde.phase === 'countdown' && (
                <div className="hud-horde-countdown">
                    <span className="hud-horde-cdlabel">
                        {horde.wave === 0 ? 'INÍCIO EM' : 'PRÓXIMA EM'}
                    </span>
                    <span className="hud-horde-cdnum">{horde.countdown}s</span>
                </div>
            )}
        </div>
    );
}

// ─── Spectator Banner ─────────────────────────────────────────────────────────

function SpectatorBanner({ targetId }: { targetId: string }) {
    return (
        <div className="spectator-banner">
            <span className="spectator-icon">👁</span>
            <span className="spectator-label">ESPECTADOR</span>
            {targetId && <span className="spectator-target">{targetId.slice(0, 12)}</span>}
            <span className="spectator-hint">[Q] ← → [E]</span>
        </div>
    );
}

// ─── HUD ─────────────────────────────────────────────────────────────────────

function HUD({ hp, roomKey, scores, horde, isSpectating, spectateTarget, ammo, ammoMax, reloading }: {
    hp: number; roomKey: string; scores: PlayerScore[];
    horde: HordeState | null; isSpectating: boolean; spectateTarget: string;
    ammo: number; ammoMax: number; reloading: boolean;
}) {
    return (
        <>
            <div className="hud-block hud-topleft">
                <HealthBar hp={hp} />
                <AmmoDisplay ammo={ammo} max={ammoMax} reloading={reloading} />
                {roomKey && <RoomKey roomKey={roomKey} />}
            </div>
            <div className="hud-block hud-topcenter">
                <HordePanel horde={horde} />
            </div>
            {scores.length > 0 && (
                <div className="hud-block hud-topright">
                    <ScorePanel scores={scores} />
                </div>
            )}
            {isSpectating && <SpectatorBanner targetId={spectateTarget} />}
        </>
    );
}

// ─── Vote Button ──────────────────────────────────────────────────────────────

function VoteBtn({ choice, current, onClick, label, icon }: {
    choice: VoteChoice; current: VoteChoice | null;
    onClick: (c: VoteChoice) => void; label: string; icon: string;
}) {
    return (
        <button
            className={`vote-btn ${choice}${current === choice ? ' active' : ''}`}
            onClick={() => onClick(choice)}
            disabled={current !== null}
        >
            <span className="vote-icon">{icon}</span>
            <span>{label}</span>
        </button>
    );
}

// ─── Leaderboard + votação ────────────────────────────────────────────────────

function LeaderboardScreen({ scores, vote, onVote }: {
    scores: PlayerScore[]; vote: VoteState | null; onVote: (c: VoteChoice) => void;
}) {
    const [myVote, setMyVote] = useState<VoteChoice | null>(null);
    const timeLeft      = vote?.timeLeft ?? 30;
    const totalVotes    = vote ? Object.keys(vote.votes).length : 0;
    const totalPlayers  = vote?.totalPlayers ?? 1;
    const timerPct      = timeLeft / 30;
    const circumference = 2 * Math.PI * 18;

    const handleVote = (c: VoteChoice) => { setMyVote(c); onVote(c); };

    return (
        <div className="overlay leaderboard-overlay">
            <h1 className="lb-title">💀 TODOS MORRERAM</h1>
            <div className="lb-table-wrap">
                <table className="lb-table">
                    <thead>
                        <tr>
                            <th>#</th><th>Jogador</th>
                            <th>Pontos</th><th>Kills</th><th>Melhor horda</th>
                        </tr>
                    </thead>
                    <tbody>
                        {scores.map((p, i) => (
                            <tr key={p.id} className={i === 0 ? 'lb-gold' : ''}>
                                <td>{i === 0 ? '🏆' : i + 1}</td>
                                <td className="lb-name">{p.name}</td>
                                <td className="lb-pts">{p.score}</td>
                                <td className="lb-kills">☠ {p.kills}</td>
                                <td className="lb-wave">Horda {p.highestWave}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="vote-area">
                <p className="vote-question">O que deseja fazer?</p>
                <div className="vote-timer-wrap">
                    <svg viewBox="0 0 44 44" className="vote-timer-svg">
                        <circle cx="22" cy="22" r="18" fill="none" stroke="#1e1e2a" strokeWidth="4" />
                        <circle
                            cx="22" cy="22" r="18" fill="none"
                            stroke={timeLeft <= 10 ? '#ff4444' : '#4488ff'}
                            strokeWidth="4" strokeLinecap="round"
                            strokeDasharray={circumference}
                            strokeDashoffset={circumference * (1 - timerPct)}
                            style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s',
                                     transform: 'rotate(-90deg)', transformOrigin: 'center' }}
                        />
                        <text x="22" y="27" textAnchor="middle" fontSize="12"
                              fill={timeLeft <= 10 ? '#ff6666' : '#fff'} fontWeight="bold">
                            {timeLeft}s
                        </text>
                    </svg>
                    <div className="vote-counter">{totalVotes}/{totalPlayers} votaram</div>
                </div>
                <div className="vote-buttons">
                    <VoteBtn choice="restart" current={myVote} onClick={handleVote} label="RECOMEÇAR" icon="🔄" />
                    <VoteBtn choice="leave"   current={myVote} onClick={handleVote} label="SAIR"      icon="🚪" />
                </div>
                {myVote && (
                    <p className="vote-feedback">
                        Voto: {myVote === 'restart' ? '🔄 Recomeçar' : '🚪 Sair'} · aguardando os outros…
                    </p>
                )}
            </div>
        </div>
    );
}

// ─── Menu principal ───────────────────────────────────────────────────────────

function MainMenu() {
    const [playerName, setPlayerName] = useState('');
    const [joinKey,    setJoinKey]    = useState('');
    const [loading,    setLoading]    = useState(false);
    const [error,      setError]      = useState('');

    useEffect(() => {
        const onErr = (d: { reason: string }) => {
            setLoading(false);
            setError(d.reason ?? 'Erro de conexão.');
        };
        EventBus.on('connection-error-ui', onErr);
        return () => { EventBus.removeListener('connection-error-ui', onErr); };
    }, []);

    const name = playerName.trim() || 'Player';

    const host = () => {
        setLoading(true); setError('');
        EventBus.emit('start-game', { isHost: true, name });
    };

    const join = () => {
        const k = joinKey.trim();
        if (!k) { setError('Cole a chave do host antes de entrar.'); return; }
        setLoading(true); setError('');
        EventBus.emit('start-game', { isHost: false, roomId: k, name });
    };

    return (
        <div className="menu">
            <div className="menu-skull">💀</div>
            <h1 className="menu-title">DEAD CITY</h1>
            <p className="menu-sub">Multiplayer · Hordas Infinitas</p>

            {loading ? (
                <>
                    <div className="menu-loading">Conectando…</div>
                    <button
                        className="btn-secondary"
                        style={{ marginTop: 8, width: 160, fontSize: 12 }}
                        onClick={() => { setLoading(false); EventBus.emit('cancel-connect'); }}
                    >
                        Cancelar
                    </button>
                </>
            ) : (
                <>
                    {/* ── Campo de nome ─────────────────────────────────── */}
                    <div style={{ width: 270, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{
                            fontSize: 10, color: '#555', letterSpacing: '1.5px',
                            textTransform: 'uppercase', fontFamily: 'monospace',
                        }}>
                            Seu nome
                        </label>
                        <input
                            className="menu-input"
                            value={playerName}
                            onChange={e => setPlayerName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && host()}
                            placeholder="Player"
                            maxLength={16}
                            spellCheck={false}
                            autoComplete="off"
                            autoFocus
                            style={{ fontFamily: 'inherit', fontSize: 14 }}
                        />
                    </div>

                    {/* ── Criar sala ────────────────────────────────────── */}
                    <button className="btn-primary" onClick={host}>
                        CRIAR SALA (HOST)
                    </button>

                    <div className="menu-or"><span>ou</span></div>

                    {/* ── Entrar na sessão ──────────────────────────────── */}
                    <input
                        className="menu-input"
                        value={joinKey}
                        onChange={e => setJoinKey(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && join()}
                        placeholder="Cole a chave do host aqui"
                        maxLength={64}
                        spellCheck={false}
                        autoComplete="off"
                    />
                    <button className="btn-secondary" onClick={join}>
                        ENTRAR NA SESSÃO
                    </button>

                    {error && <p className="menu-error">⚠ {error}</p>}
                </>
            )}
        </div>
    );
}

// ─── App root ─────────────────────────────────────────────────────────────────

type Screen = 'menu' | 'game' | 'leaderboard';

export default function App() {
    const [screen,       setScreen]  = useState<Screen>('menu');
    const [hp,           setHp]      = useState(100);
    const [roomKey,      setRoomKey] = useState('');
    const [scores,       setScores]  = useState<PlayerScore[]>([]);
    const [horde,        setHorde]   = useState<HordeState | null>(null);
    const [isSpectating, setSpect]   = useState(false);
    const [spectTarget,  setSpectTgt]= useState('');
    const [voteState,    setVote]    = useState<VoteState | null>(null);
    const [ammo,         setAmmo]    = useState(12);
    const [ammoMax,      setAmmoMax] = useState(12);
    const [reloading,    setReload]  = useState(false);

    const goMenu = useCallback(() => {
        setScreen('menu');
        setHp(100); setRoomKey(''); setScores([]);
        setHorde(null); setSpect(false); setVote(null);
        setAmmo(12); setReload(false);
    }, []);

    useEffect(() => {
        const handlers: Record<string, (d?: any) => void> = {
            'room-joined':      (key: string) => { setScreen('game'); setRoomKey(key); },
            'player-stats':     (d: { hp: number }) => setHp(d.hp),
            'player-died':      () => setSpect(true),
            'spectate-start':   (d: { targetId: string }) => setSpectTgt(d.targetId),
            'spectate-target':  (d: { targetId: string }) => setSpectTgt(d.targetId),
            'horde-state':      (s: HordeState) => setHorde({ ...s }),
            'score-update':     (s: PlayerScore[]) => setScores([...s]),
            'ammo-state':       (d: { ammo: number; max: number; reloading: boolean }) => {
                setAmmo(d.ammo); setAmmoMax(d.max); setReload(d.reloading);
            },
            'show-leaderboard': (d: { scores: PlayerScore[]; vote: VoteState }) => {
                setScores([...d.scores]); setVote({ ...d.vote }); setScreen('leaderboard');
            },
            'vote-state':       (s: VoteState) => setVote({ ...s }),
            'vote-resolved':    (d: { staying: string[] }) => {
                if (!d.staying || d.staying.length === 0) goMenu();
            },
            'session-end':      () => goMenu(),
            'game-restarted':   () => {
                setScreen('game'); setHp(100); setSpect(false); setVote(null);
                setAmmo(12); setReload(false);
            },
            // Quando o player revive, sai do modo espectador no React também
            'player-revived':   () => setSpect(false),
        };

        Object.entries(handlers).forEach(([ev, fn]) => EventBus.on(ev, fn));
        return () => { Object.entries(handlers).forEach(([ev, fn]) => EventBus.removeListener(ev, fn)); };
    }, [goMenu]);

    const handleVote = useCallback((c: VoteChoice) => EventBus.emit('cast-vote', c), []);

    return (
        <div id="app">
            <PhaserGame />
            {screen === 'menu'        && <MainMenu />}
            {screen === 'game'        && (
                <HUD hp={hp} roomKey={roomKey} scores={scores}
                     horde={horde} isSpectating={isSpectating} spectateTarget={spectTarget}
                     ammo={ammo} ammoMax={ammoMax} reloading={reloading} />
            )}
            {screen === 'leaderboard' && (
                <LeaderboardScreen scores={scores} vote={voteState} onVote={handleVote} />
            )}
        </div>
    );
}