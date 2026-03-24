import { Scene } from 'phaser';
import { EventBus } from '../EventBus';

export class GameOver extends Scene {
    constructor() { super('GameOver'); }

    create() {
        this.cameras.main.setBackgroundColor(0x1a0000);

        const { width, height } = this.cameras.main;

        this.add.image(width / 2, height / 2, 'background').setAlpha(0.3);

        this.add.text(width / 2, height / 2, 'GAME OVER', {
            fontFamily: 'Arial Black',
            fontSize: 64,
            color: '#ff4444',
            stroke: '#000000',
            strokeThickness: 8,
            align: 'center',
        }).setOrigin(0.5).setDepth(100);

        this.add.text(width / 2, height / 2 + 80, 'Clique para voltar ao menu', {
            fontFamily: 'monospace',
            fontSize: 20,
            color: '#aaaaaa',
        }).setOrigin(0.5).setDepth(100);

        this.input.once('pointerdown', () => {
            EventBus.emit('game-over'); // avisa o React se necessário
            this.scene.start('MainMenu');
        });

        EventBus.emit('current-scene-ready', this);
    }
}