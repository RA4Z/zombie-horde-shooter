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
    // Audio do Phaser desabilitado — usamos Web Audio API diretamente
    // via AudioManager.ts (sons procedurais sem arquivos externos).
    // Isso evita os erros "Cannot suspend/resume a closed AudioContext"
    // causados pelo gerenciamento interno do Phaser.
    audio: {
        noAudio: true,
    },
    scene: [Boot, Preloader, MainMenu, MainGame, GameOver],
};

const StartGame = (parent: string): Game =>
    new Game({ ...config, parent });

export default StartGame;