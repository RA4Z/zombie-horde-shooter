import { Scene } from 'phaser';

export class Boot extends Scene {
    constructor() { super('Boot'); }

    preload() {
        // Carrega apenas o mínimo necessário para exibir progresso no Preloader
        this.load.image('background', 'assets/bg.png');
    }

    create() {
        this.scene.start('Preloader');
    }
}