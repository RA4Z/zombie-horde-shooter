import { forwardRef, useEffect, useLayoutEffect, useRef } from 'react';
import StartGame from './game/main';
import { EventBus } from './game/EventBus';

export interface IRefPhaserGame {
    game: Phaser.Game | null;
    scene: Phaser.Scene | null;
}

interface IProps {
    currentActiveScene?: (scene: Phaser.Scene) => void;
}

export const PhaserGame = forwardRef<IRefPhaserGame, IProps>(
    function PhaserGame({ currentActiveScene }, ref) {
        const gameRef = useRef<Phaser.Game | null>(null);

        useLayoutEffect(() => {
            if (gameRef.current) return;

            gameRef.current = StartGame('game-container');

            if (typeof ref === 'function') {
                ref({ game: gameRef.current, scene: null });
            } else if (ref) {
                ref.current = { game: gameRef.current, scene: null };
            }

            return () => {
                gameRef.current?.destroy(true);
                gameRef.current = null;
            };
        }, [ref]);

        useEffect(() => {
            const handler = (scene: Phaser.Scene) => {
                currentActiveScene?.(scene);

                if (typeof ref === 'function') {
                    ref({ game: gameRef.current, scene });
                } else if (ref) {
                    ref.current = { game: gameRef.current, scene };
                }
            };

            EventBus.on('current-scene-ready', handler);
            return () => { EventBus.removeListener('current-scene-ready', handler); };
        }, [currentActiveScene, ref]);

        return <div id="game-container" style={{ width: '100%', height: '100%' }} />;
    },
);