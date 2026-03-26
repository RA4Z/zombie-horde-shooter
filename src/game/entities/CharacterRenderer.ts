/**
 * CharacterRenderer — renderiza frames humanoides isométricos slim para
 * 8 direções cardeais + diagonais (N, NE, E, SE, S, SW, W, NW).
 *
 * Cada "frame" é um Phaser.GameObjects.Graphics pré-desenhado e cacheado.
 * O sistema de animação troca frames a cada X ms para simular caminhada.
 *
 * Coordenadas: origem (0,0) = centro da hitbox do personagem (altura dos pés).
 * Tudo é desenhado "para cima" (Y negativo = cabeça).
 *
 * PROPORÇÕES SLIM: largura máxima do corpo = 8px, altura total = 28px.
 * O container pai aplica scaleY=0.55 para o achatamento isométrico.
 *
 * DIREÇÕES ISO (vista de câmera 3/4 de cima):
 *   E  = personagem de lado direito, frente visível
 *   SE = personagem virado para câmera direita/baixo
 *   S  = personagem de costas para câmera (frente para baixo)
 *   SW = personagem virado para câmera esquerda/baixo
 *   W  = personagem de lado esquerdo
 *   NW = personagem virado para câmera esquerda/cima
 *   N  = personagem de frente para câmera (indo para o fundo)
 *   NE = personagem virado para câmera direita/cima
 */

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type Dir8 = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export interface CharFrame {
    /** Graphics já desenhado, pronto para exibir/ocultar */
    gfx: Phaser.GameObjects.Graphics;
}

export interface CharacterFrameSet {
    /** dir → [idle_frame, walk_frame_a, walk_frame_b] */
    frames: Record<Dir8, [CharFrame, CharFrame, CharFrame]>;
    /** Referência à barra de HP (só zumbi) */
    hpBar?: Phaser.GameObjects.Rectangle;
    /** Fundo da barra de HP (só zumbi) */
    hpBg?: Phaser.GameObjects.Rectangle;
}

// ── Paletas ───────────────────────────────────────────────────────────────────

interface PlayerPalette {
    skin: number; hair: number; top: number; topD: number;
    pants: number; boot: number; gun: number; outline: number;
}

interface ZombiePalette {
    skin: number; skinD: number; cloth: number; blood: number; bone: number;
}

function playerPalette(isLocal: boolean): PlayerPalette {
    return isLocal
        // Jogador local: verde + roxo (como na referência)
        ? { skin: 0xf4c27f, hair: 0xf4d03f, top: 0x27ae60, topD: 0x1e8449,
            pants: 0x8e44ad, boot: 0x2c3e50, gun: 0x1a1a1a, outline: 0x000000 }
        // Jogador remoto: azul + laranja
        : { skin: 0xf4c27f, hair: 0xe74c3c, top: 0x2980b9, topD: 0x1f618d,
            pants: 0xe67e22, boot: 0x2c3e50, gun: 0x1a1a1a, outline: 0x000000 };
}

const ZOMBIE_PAL: ZombiePalette = {
    skin: 0x7dbb5a, skinD: 0x5a8c3a, cloth: 0x6b4f3a, blood: 0xc0392b, bone: 0xf0e68c,
};

// ── Helpers de desenho ────────────────────────────────────────────────────────

function shadow(g: Phaser.GameObjects.Graphics) {
    g.fillStyle(0x000000, 0.22);
    g.fillEllipse(0, 2, 12, 4);
}

// ── PLAYER frames ─────────────────────────────────────────────────────────────
// Pixelart isométrico 3/4 vista de cima.
// Origem (0,0) = pés do personagem. Cabeça em Y≈-30.
// Largura total: ~14px lateral, ~12px frontal/traseiro.

function drawPlayerFrame(
    g: Phaser.GameObjects.Graphics,
    pal: PlayerPalette,
    dir: Dir8,
    phase: 0 | 1 | 2,
) {
    g.clear();
    shadow(g);

    const toE = dir === 'E' || dir === 'NE' || dir === 'SE';
    const toW = dir === 'W' || dir === 'NW' || dir === 'SW';
    const toN = dir === 'N' || dir === 'NE' || dir === 'NW';
    const toS = dir === 'S' || dir === 'SE' || dir === 'SW';
    const lateral = dir === 'E' || dir === 'W';
    const showFace = !toN;

    // Animação de pernas — passos alternados bem visíveis
    const stepA = phase === 1 ? -4 : phase === 2 ?  3 : 0;
    const stepB = phase === 1 ?  3 : phase === 2 ? -4 : 0;

    if (lateral) {
        // ── Vista lateral pura (E ou W) ─────────────────────────────────
        const flip = dir === 'W' ? -1 : 1;
        const fx = dir === 'W' ? -7 : 0;

        // Bota
        g.fillStyle(pal.boot);
        g.fillRect(fx + (dir === 'W' ? 1 : 0), stepA - 1, 6, 4);

        // Perna
        g.fillStyle(pal.pants);
        g.fillRect(fx + (dir === 'W' ? 2 : 0), stepA - 9, 4, 9);

        // Tronco
        g.fillStyle(pal.top);
        g.fillRect(fx, -21, 7, 12);
        g.fillStyle(pal.topD);
        g.fillRect(fx, -21, 7, 3);

        // Braço (frente)
        g.fillStyle(pal.top);
        g.fillRect(fx + (flip > 0 ? 6 : -3), -20, 3, 9);
        g.fillStyle(pal.skin);
        g.fillRect(fx + (flip > 0 ? 6 : -3), -11, 3, 3);

        // Arma
        g.fillStyle(pal.gun);
        if (flip > 0) {
            g.fillRect(fx + 8, -16, 8, 3);
            g.fillRect(fx + 15, -17, 2, 2);
        } else {
            g.fillRect(fx - 9, -16, 8, 3);
            g.fillRect(fx - 11, -17, 2, 2);
        }

        // Pescoço + cabeça
        g.fillStyle(pal.skin);
        g.fillRect(fx + 2, -24, 3, 4);
        g.fillRect(fx, -33, 7, 10);
        g.fillStyle(pal.hair);
        g.fillRect(fx, -34, 7, 4);
        // Olho
        if (showFace) {
            g.fillStyle(0x222222);
            g.fillRect(fx + (flip > 0 ? 4 : 1), -30, 2, 2);
            g.fillStyle(0xffffff);
            g.fillRect(fx + (flip > 0 ? 5 : 2), -31, 1, 1);
        }

    } else if (toS) {
        // ── Vista frontal (S, SE, SW) ────────────────────────────────────
        const offX = dir === 'SE' ? 1 : dir === 'SW' ? -1 : 0;

        // Botas
        g.fillStyle(pal.boot);
        g.fillRect(-5 + offX, stepA - 1, 4, 4);
        g.fillRect( 2 + offX, stepB - 1, 4, 4);

        // Pernas
        g.fillStyle(pal.pants);
        g.fillRect(-5 + offX, stepA - 10, 4, 10);
        g.fillRect( 2 + offX, stepB - 10, 4, 10);

        // Tronco
        g.fillStyle(pal.top);
        g.fillRect(-6, -22, 13, 12);
        g.fillStyle(pal.topD);
        g.fillRect(-6, -22, 13, 3);
        // Detalhe central
        g.fillStyle(pal.topD);
        g.fillRect(-1, -22, 2, 12);

        // Braços + mãos
        g.fillStyle(pal.top);
        g.fillRect(-10, -21, 4, 9);
        g.fillRect(  7, -21, 4, 9);
        g.fillStyle(pal.skin);
        g.fillRect(-10, -12, 4, 4);
        g.fillRect(  7, -12, 4, 4);

        // Arma (apontada para câmera — cano visível)
        g.fillStyle(pal.gun);
        g.fillRect(7 + offX, -18, 4, 5);
        g.fillStyle(0x444444);
        g.fillRect(8 + offX, -13, 2, 3);

        // Pescoço + cabeça
        g.fillStyle(pal.skin);
        g.fillRect(-2, -25, 4, 4);
        g.fillRect(-5, -35, 11, 11);
        g.fillStyle(pal.hair);
        g.fillRect(-5, -36, 11, 5);
        // Olhos
        g.fillStyle(0x222222);
        g.fillRect(-3, -31, 3, 2);
        g.fillRect( 1, -31, 3, 2);
        g.fillStyle(0xffffff);
        g.fillRect(-2, -32, 1, 1);
        g.fillRect( 2, -32, 1, 1);

    } else {
        // ── Vista traseira (N, NE, NW) ───────────────────────────────────
        const offX = dir === 'NE' ? 1 : dir === 'NW' ? -1 : 0;

        // Botas
        g.fillStyle(pal.boot);
        g.fillRect(-5 + offX, stepA - 1, 4, 4);
        g.fillRect( 2 + offX, stepB - 1, 4, 4);

        // Pernas
        g.fillStyle(pal.pants);
        g.fillRect(-5 + offX, stepA - 10, 4, 10);
        g.fillRect( 2 + offX, stepB - 10, 4, 10);

        // Tronco
        g.fillStyle(pal.top);
        g.fillRect(-6, -22, 13, 12);
        g.fillStyle(pal.topD);
        g.fillRect(-6, -22, 13, 3);

        // Braços
        g.fillStyle(pal.top);
        g.fillRect(-10, -21, 4, 9);
        g.fillRect(  7, -21, 4, 9);
        g.fillStyle(pal.skin);
        g.fillRect(-10, -12, 4, 4);
        g.fillRect(  7, -12, 4, 4);

        // Arma nas costas
        g.fillStyle(pal.gun);
        g.fillRect(3, -24, 3, 6);

        // Pescoço + cabeça (sem rosto)
        g.fillStyle(pal.skin);
        g.fillRect(-2, -25, 4, 4);
        g.fillRect(-5, -35, 11, 11);
        g.fillStyle(pal.hair);
        g.fillRect(-5, -36, 11, 11); // cabelo cobre tudo na vista de costas
    }
}

// ── ZOMBIE frames ─────────────────────────────────────────────────────────────
// Mesmas proporções do player. Tom verde-zumbi, roupa rasgada, braços esticados.

function drawZombieFrame(
    g: Phaser.GameObjects.Graphics,
    phase: 0 | 1 | 2,
    dir: Dir8,
) {
    g.clear();
    shadow(g);
    const pal = ZOMBIE_PAL;

    const toE    = dir === 'E'  || dir === 'NE' || dir === 'SE';
    const toW    = dir === 'W'  || dir === 'NW' || dir === 'SW';
    const toN    = dir === 'N'  || dir === 'NE' || dir === 'NW';
    const toS    = dir === 'S'  || dir === 'SE' || dir === 'SW';
    const lateral = dir === 'E' || dir === 'W';
    const facing = !toN;

    // Arrastar de zumbi — deslocamento exagerado
    const stepA = phase === 1 ? -5 : phase === 2 ?  4 : 0;
    const stepB = phase === 1 ?  4 : phase === 2 ? -5 : 0;

    if (lateral) {
        // ── Vista lateral ────────────────────────────────────────────────
        const fx = dir === 'W' ? -7 : 0;
        const flip = dir === 'W' ? -1 : 1;

        // Pé + garra
        g.fillStyle(pal.skinD);
        g.fillRect(fx + (dir === 'W' ? 1 : 0), stepA - 1, 6, 4);
        g.fillStyle(pal.bone);
        g.fillRect(fx + (flip > 0 ? 6 : -2), stepA, 2, 3);

        // Perna rasgada
        g.fillStyle(pal.cloth);
        g.fillRect(fx + (dir === 'W' ? 2 : 0), stepA - 9, 4, 9);
        g.fillStyle(pal.skin); // rasgo
        g.fillRect(fx + (dir === 'W' ? 3 : 1), stepA - 6, 2, 3);

        // Tronco rasgado
        g.fillStyle(pal.cloth);
        g.fillRect(fx, -21, 7, 12);
        g.fillStyle(pal.skin);
        g.fillRect(fx + 2, -18, 2, 6);
        g.fillStyle(pal.blood);
        g.fillRect(fx + 5, -16, 2, 2);

        // Braço esticado (postura zumbi)
        const aY = phase === 1 ? -22 : phase === 2 ? -20 : -21;
        g.fillStyle(pal.skin);
        g.fillRect(fx + (flip > 0 ? 6 : -4), aY, 3, 10);
        g.fillStyle(pal.skinD);
        g.fillRect(fx + (flip > 0 ? 6 : -5), aY + 9, 4, 3);
        g.fillStyle(pal.bone); // garras
        for (let i = 0; i < 3; i++) {
            g.fillRect(fx + (flip > 0 ? 6 : -6) + i * 2, aY + 11, 1, 3);
        }

        // Pescoço + cabeça inclinada
        g.fillStyle(pal.skin);
        g.fillRect(fx + 2, -24, 3, 4);
        const hOff = flip > 0 ? 1 : -1;
        g.fillRect(fx + hOff, -33, 7, 10);
        // Cabelo esparso
        g.fillStyle(0x2a2210);
        g.fillRect(fx + hOff, -34, 7, 3);
        g.fillStyle(pal.skin); g.fillRect(fx + 2 + hOff, -34, 2, 1);
        // Ferida
        g.fillStyle(pal.blood); g.fillRect(fx + 5 + hOff, -30, 2, 2);
        // Olho morto
        if (facing) {
            g.fillStyle(0xd4eea0);
            g.fillRect(fx + (flip > 0 ? 4 : 1) + hOff, -30, 2, 2);
            g.fillStyle(pal.blood);
            g.fillRect(fx + (flip > 0 ? 5 : 2) + hOff, -30, 1, 1);
            // Boca
            g.fillStyle(0x111111);
            g.fillRect(fx + 2 + hOff, -26, 4, 2);
            g.fillStyle(pal.bone);
            g.fillRect(fx + 2 + hOff, -26, 1, 2);
            g.fillRect(fx + 4 + hOff, -26, 1, 2);
        }

    } else if (toS) {
        // ── Vista frontal (S, SE, SW) ────────────────────────────────────
        const offX = dir === 'SE' ? 1 : dir === 'SW' ? -1 : 0;

        // Pés com garras
        g.fillStyle(pal.skinD);
        g.fillRect(-5 + offX, stepA - 1, 4, 4);
        g.fillRect( 2 + offX, stepB - 1, 4, 4);
        g.fillStyle(pal.bone);
        g.fillRect(-7 + offX, stepA, 2, 3);
        g.fillRect(  5 + offX, stepB, 2, 3);

        // Pernas rasgadas
        g.fillStyle(pal.cloth);
        g.fillRect(-5 + offX, stepA - 10, 4, 10);
        g.fillRect( 2 + offX, stepB - 10, 4, 10);
        g.fillStyle(pal.skin);
        g.fillRect(-4 + offX, stepA - 7, 2, 3);
        g.fillRect( 3 + offX, stepB - 6, 2, 3);
        g.fillStyle(pal.blood);
        g.fillRect(-5 + offX, stepA - 5, 2, 2);

        // Tronco rasgado
        g.fillStyle(pal.cloth);
        g.fillRect(-6, -22, 13, 12);
        g.fillStyle(pal.skin); // rasgos
        g.fillRect(-2, -20, 2, 6);
        g.fillRect( 2, -19, 2, 5);
        g.fillStyle(pal.blood);
        g.fillRect(-4, -16, 3, 3);
        g.fillRect( 3, -14, 3, 3);

        // Braços esticados para frente
        const aY = phase === 0 ? -21 : phase === 1 ? -23 : -19;
        g.fillStyle(pal.skin);
        g.fillRect(-10, aY, 4, 11);
        g.fillRect(  7, aY, 4, 11);
        g.fillStyle(pal.skinD);
        g.fillRect(-11, aY + 10, 5, 3);
        g.fillRect(  7, aY + 10, 5, 3);
        g.fillStyle(pal.bone); // garras
        for (let i = 0; i < 3; i++) {
            g.fillRect(-11 + i * 2, aY + 12, 1, 3);
            g.fillRect(  8 + i * 2, aY + 12, 1, 3);
        }

        // Pescoço + cabeça
        g.fillStyle(pal.skin);
        g.fillRect(-2, -25, 4, 4);
        g.fillRect(-5, -35, 11, 11);
        g.fillStyle(0x2a2210); g.fillRect(-5, -36, 11, 5);
        g.fillStyle(pal.skin); g.fillRect(-2, -36, 2, 1); g.fillRect( 3, -36, 2, 1);
        g.fillStyle(pal.blood); g.fillRect( 3, -31, 3, 2);
        // Olhos mortos
        g.fillStyle(0xd4eea0);
        g.fillRect(-3, -31, 3, 2);
        g.fillRect( 1, -31, 3, 2);
        g.fillStyle(pal.blood);
        g.fillRect(-2, -31, 1, 1);
        g.fillRect( 2, -31, 1, 1);
        // Boca
        g.fillStyle(0x111111);
        g.fillRect(-3, -27, 7, 3);
        g.fillStyle(pal.bone);
        for (let i = 0; i < 3; i++) g.fillRect(-2 + i * 2, -27, 1, 2);
        g.fillStyle(pal.blood); g.fillRect(-3, -25, 7, 1);

    } else {
        // ── Vista traseira (N, NE, NW) ───────────────────────────────────
        const offX = dir === 'NE' ? 1 : dir === 'NW' ? -1 : 0;

        // Pés
        g.fillStyle(pal.skinD);
        g.fillRect(-5 + offX, stepA - 1, 4, 4);
        g.fillRect( 2 + offX, stepB - 1, 4, 4);

        // Pernas
        g.fillStyle(pal.cloth);
        g.fillRect(-5 + offX, stepA - 10, 4, 10);
        g.fillRect( 2 + offX, stepB - 10, 4, 10);
        g.fillStyle(pal.skin);
        g.fillRect(-4 + offX, stepA - 7, 2, 3);
        g.fillRect( 3 + offX, stepB - 6, 2, 3);

        // Tronco
        g.fillStyle(pal.cloth);
        g.fillRect(-6, -22, 13, 12);
        g.fillStyle(pal.blood); g.fillRect(2, -16, 3, 3);

        // Braços estendidos para trás/cima
        const aY = phase === 0 ? -24 : phase === 1 ? -26 : -22;
        g.fillStyle(pal.skin);
        g.fillRect(-10, aY, 4, 11);
        g.fillRect(  7, aY, 4, 11);
        g.fillStyle(pal.bone);
        for (let i = 0; i < 3; i++) {
            g.fillRect(-11 + i * 2, aY, 1, 3);
            g.fillRect(  8 + i * 2, aY, 1, 3);
        }

        // Pescoço + cabeça (costas)
        g.fillStyle(pal.skin);
        g.fillRect(-2, -25, 4, 4);
        g.fillRect(-5, -35, 11, 11);
        // Cabelo cobre a cabeça toda
        g.fillStyle(0x2a2210);
        g.fillRect(-5, -36, 11, 12);
        // Ferida na nuca
        g.fillStyle(pal.blood);
        g.fillRect(1, -30, 3, 2);
    }
}

// ── Fábrica pública ───────────────────────────────────────────────────────────

const ALL_DIRS: Dir8[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * Cria todos os frames do player (24 Graphics = 8 dirs × 3 frames cada).
 * Todos ficam invisíveis; o CharacterAnimator controla qual mostrar.
 */
export function createPlayerFrames(
    scene: Phaser.Scene,
    isLocal: boolean,
): CharacterFrameSet {
    const pal = playerPalette(isLocal);
    const frames = {} as Record<Dir8, [CharFrame, CharFrame, CharFrame]>;

    for (const dir of ALL_DIRS) {
        const triple: [CharFrame, CharFrame, CharFrame] = [
            { gfx: scene.add.graphics().setVisible(false) },
            { gfx: scene.add.graphics().setVisible(false) },
            { gfx: scene.add.graphics().setVisible(false) },
        ];
        drawPlayerFrame(triple[0].gfx, pal, dir, 0);
        drawPlayerFrame(triple[1].gfx, pal, dir, 1);
        drawPlayerFrame(triple[2].gfx, pal, dir, 2);
        frames[dir] = triple;
    }

    return { frames };
}

/**
 * Cria todos os frames do zumbi (24 Graphics + barra de HP).
 */
export function createZombieFrames(
    scene: Phaser.Scene,
): CharacterFrameSet {
    const frames = {} as Record<Dir8, [CharFrame, CharFrame, CharFrame]>;

    for (const dir of ALL_DIRS) {
        const triple: [CharFrame, CharFrame, CharFrame] = [
            { gfx: scene.add.graphics().setVisible(false) },
            { gfx: scene.add.graphics().setVisible(false) },
            { gfx: scene.add.graphics().setVisible(false) },
        ];
        drawZombieFrame(triple[0].gfx, 0, dir);
        drawZombieFrame(triple[1].gfx, 1, dir);
        drawZombieFrame(triple[2].gfx, 2, dir);
        frames[dir] = triple;
    }

    // HP bar — fica separada dos frames para não piscar
    const hpBg  = scene.add.rectangle(0, -35, 22, 3, 0x550000).setOrigin(0.5, 0.5);
    const hpBar = scene.add.rectangle(-11, -35, 22, 3, 0x44ff44).setOrigin(0, 0.5);

    return { frames, hpBar, hpBg };
}

// ── Utilitário de direção ─────────────────────────────────────────────────────

/**
 * Converte um ângulo em radianos (espaço ISO de tela) em Dir8.
 * O ângulo 0 = direita (leste ISO = E), PI/2 = baixo (sul ISO = S).
 */
export function angleToDir8(angleDeg: number): Dir8 {
    // Normaliza para [0, 360)
    let a = ((angleDeg % 360) + 360) % 360;
    // 8 setores de 45°, centrados: 0=E, 45=SE, 90=S, 135=SW, 180=W, 225=NW, 270=N, 315=NE
    const sector = Math.round(a / 45) % 8;
    const dirs: Dir8[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
    return dirs[sector];
}

/** Converte radianos para graus */
export function radToDeg(r: number): number { return r * 180 / Math.PI; }