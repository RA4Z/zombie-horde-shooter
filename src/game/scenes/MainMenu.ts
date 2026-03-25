import { Scene } from 'phaser';
import { EventBus } from '../EventBus';

/**
 * Cena MainMenu do Phaser.
 *
 * FIX: Expõe startGame(isHost, roomId, name) para o componente React
 * poder passar o nome definido no menu. O nome é repassado pelo EventBus
 * junto com start-game, e o Game.ts o lê em onStartGame().
 */
export class MainMenu extends Scene {
    constructor() { super('MainMenu'); }

    create() {
        this.cameras.main.setBackgroundColor('#1a1a2e');
        EventBus.emit('current-scene-ready', this);
    }

    /**
     * Chamado pelo componente React quando o jogador clica em "Jogar".
     * @param isHost  true = criar sala, false = entrar numa sala
     * @param roomId  chave da sala (só para !isHost)
     * @param name    nome do jogador definido no campo de texto do menu
     */
    startGame(isHost: boolean, roomId?: string, name?: string) {
        EventBus.emit('start-game', { isHost, roomId, name: name ?? 'Player' });
        this.scene.start('Game');
    }
}