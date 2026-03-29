import { Scene } from 'phaser';
import { EventBus } from '../EventBus';

/**
 * MainMenu — cena Phaser do menu principal.
 *
 * FIX INPUT DE TEXTO:
 * O Phaser registra listeners globais de teclado via `input.keyboard`, o que
 * intercepta TODOS os eventos de tecla — incluindo os de campos <input> do React.
 * A solução é desabilitar o gerenciador de teclado do Phaser enquanto o
 * foco estiver em qualquer elemento de input/textarea, e reativá-lo ao sair.
 *
 * Como aplicar:
 *   1. Substitua este MainMenu.ts.
 *   2. No seu componente React do menu, adicione ao campo de nome:
 *        onFocus={() => EventBus.emit('disable-phaser-keyboard')}
 *        onBlur={()  => EventBus.emit('enable-phaser-keyboard')}
 *
 *   3. No Game.ts, dentro de create(), adicione:
 *        EventBus.on('disable-phaser-keyboard', () => {
 *            if (this.input.keyboard) this.input.keyboard.enabled = false;
 *        });
 *        EventBus.on('enable-phaser-keyboard', () => {
 *            if (this.input.keyboard) this.input.keyboard.enabled = true;
 *        });
 *
 *   OU use a abordagem automática abaixo: o MainMenu escuta os eventos de
 *   focus/blur do DOM e emite para a cena Game pausar/retomar o teclado.
 */
export class MainMenu extends Scene {
    private focusHandler!: EventListener;
    private blurHandler!: EventListener;

    constructor() { super('MainMenu'); }

    create() {
        this.cameras.main.setBackgroundColor('#1a1a2e');

        // Desabilita o teclado do Phaser ao focar em qualquer input/textarea do DOM.
        // Isso resolve o bug onde teclas não funcionam no campo de nome na versão publicada.
        this.focusHandler = (e: Event) => {
            const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea') {
                EventBus.emit('disable-phaser-keyboard');
            }
        };
        this.blurHandler = (e: Event) => {
            const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea') {
                EventBus.emit('enable-phaser-keyboard');
            }
        };

        // capture: true garante que capturamos ANTES do Phaser
        document.addEventListener('focusin',  this.focusHandler, true);
        document.addEventListener('focusout', this.blurHandler,  true);

        EventBus.emit('current-scene-ready', this);
    }

    shutdown() {
        document.removeEventListener('focusin',  this.focusHandler, true);
        document.removeEventListener('focusout', this.blurHandler,  true);
    }

    /**
     * Chamado pelo componente React quando o jogador clica em "Jogar".
     */
    startGame(isHost: boolean, roomId?: string, name?: string) {
        // Reativa o teclado do Phaser antes de ir para o jogo
        EventBus.emit('enable-phaser-keyboard');
        EventBus.emit('start-game', { isHost, roomId, name: name ?? 'Player' });
        this.scene.start('Game');
    }
}