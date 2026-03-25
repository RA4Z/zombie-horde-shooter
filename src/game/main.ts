import { AUTO, Game, Scale } from 'phaser';
import { Boot }             from './scenes/Boot';
import { Preloader }        from './scenes/Preloader';
import { MainMenu }         from './scenes/MainMenu';
import { Game as MainGame } from './scenes/Game';
import { GameOver }         from './scenes/GameOver';

const config: Phaser.Types.Core.GameConfig = {
    type: AUTO,
    parent: 'game-container',
    backgroundColor: '#0d0d14',
    scale: {
        mode:       Scale.RESIZE,
        autoCenter: Scale.CENTER_BOTH,
    },
    fps: {
        target: 60,
        forceSetTimeOut: true,
        smoothStep: false,
        min: 20,
    },
    physics: {
        default: 'arcade',
        arcade: {
            debug: false,
            fps: 60,
        },
    },
    // FIX: desabilita Web Audio completamente.
    // O jogo não usa sons, então o AudioContext do Phaser não é necessário.
    // Sem isso, o Phaser tenta suspender/resumir o AudioContext nos eventos
    // blur/focus — mas como removemos esses listeners em Game.ts para evitar
    // pausas ao trocar de aba, o contexto fica em estado inválido e lança:
    // "Cannot suspend a closed AudioContext" / "Cannot resume a closed AudioContext"
    audio: {
        noAudio: true,
    },
    scene: [Boot, Preloader, MainMenu, MainGame, GameOver],
};

const StartGame = (parent: string): Game =>
    new Game({ ...config, parent });

export default StartGame;