import { Scene } from 'phaser';
import { EventBus } from '../EventBus';

/**
 * Cena MainMenu do Phaser — mantida por compatibilidade,
 * mas o menu visual real é renderizado pelo React (MainMenuUI em App.tsx).
 */
export class MainMenu extends Scene {
    constructor() { super('MainMenu'); }

    create() {
        this.cameras.main.setBackgroundColor('#1a1a2e');
        EventBus.emit('current-scene-ready', this);
    }

    startGame() {
        this.scene.start('Game');
    }
}