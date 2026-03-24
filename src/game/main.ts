import { AUTO, Game } from 'phaser';
import { Boot }      from './scenes/Boot';
import { Preloader } from './scenes/Preloader';
import { MainMenu }  from './scenes/MainMenu';
import { Game as MainGame } from './scenes/Game';
import { GameOver }  from './scenes/GameOver';

const config: Phaser.Types.Core.GameConfig = {
    type: AUTO,
    width: 1024,
    height: 768,
    parent: 'game-container',
    backgroundColor: '#2d2d2d',
    fps: {
        target: 60,
        forceSetTimeOut: true,
        smoothStep: false,
        min: 30,
    },
    physics: {
        default: 'arcade',
        arcade: {
            debug: false, // altere para true apenas em desenvolvimento
            fps: 60,
        },
    },
    scene: [Boot, Preloader, MainMenu, MainGame, GameOver],
};

/** Inicializa e retorna a instância do jogo Phaser */
const StartGame = (parent: string): Game =>
    new Game({ ...config, parent });

export default StartGame;