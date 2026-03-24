import { Events } from 'phaser';

// Canal de comunicação entre React e cenas Phaser
export const EventBus = new Events.EventEmitter();