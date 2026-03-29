/**
 * CharacterRenderer — frames humanoides isométricos para 8 direções.
 *
 * REDESIGN baseado na imagem de referência (sprite sheet laranja):
 *  - Corpo mais alto e proporcional (altura total ~36px)
 *  - Cabeça maior e mais redonda
 *  - Animações de caminhada com pernas bem separadas e braços balançando
 *  - Silhueta limpa com outline escuro
 *  - Zumbis: postura curvada, braços para frente, cores esverdeadas/podres
 *
 * Coordenadas: origem (0,0) = pés. Cabeça em Y ≈ -36.
 */

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type Dir8 = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export interface CharFrame {
    gfx: Phaser.GameObjects.Graphics;
}

export interface CharacterFrameSet {
    frames: Record<Dir8, [CharFrame, CharFrame, CharFrame]>;
    hpBar?: Phaser.GameObjects.Rectangle;
    hpBg?: Phaser.GameObjects.Rectangle;
}

// ── Paletas ───────────────────────────────────────────────────────────────────

interface PlayerPalette {
    skin: number; hair: number; top: number; topD: number;
    pants: number; boot: number; gun: number; outline: number; shadow: number;
}

interface ZombiePalette {
    skin: number; skinD: number; cloth: number; clothD: number;
    blood: number; bone: number; eye: number;
}

function playerPalette(isLocal: boolean): PlayerPalette {
    return isLocal
        ? {
            skin: 0xf5c98a, hair: 0x3d2b1f, top: 0xe07b1a, topD: 0xb05e0e,
            pants: 0x2c4a7c, boot: 0x1a1a2e, gun: 0x222222, outline: 0x111111, shadow: 0x000000,
          }
        : {
            skin: 0xf5c98a, hair: 0x1a1a2e, top: 0x27ae60, topD: 0x1a7a42,
            pants: 0x6b2fa0, boot: 0x1a1a2e, gun: 0x222222, outline: 0x111111, shadow: 0x000000,
          };
}

const ZOMBIE_PAL: ZombiePalette = {
    skin: 0x8db86a, skinD: 0x5e8040, cloth: 0x5a4230, clothD: 0x3d2b1a,
    blood: 0xb22222, bone: 0xd4c87a, eye: 0xc8f060,
};

// ── Helper de sombra elíptica ─────────────────────────────────────────────────

function shadow(g: Phaser.GameObjects.Graphics, w = 14, h = 5) {
    g.fillStyle(0x000000, 0.28);
    g.fillEllipse(0, 1, w, h);
}

// ── PLAYER — drawPlayerFrame ──────────────────────────────────────────────────
//
// Baseado na referência: figura alta (~36px), cabeça grande e redonda,
// animação de caminhada bem exagerada para ser legível em pequeno tamanho.

function drawPlayerFrame(
    g: Phaser.GameObjects.Graphics,
    pal: PlayerPalette,
    dir: Dir8,
    phase: 0 | 1 | 2,
) {
    g.clear();
    shadow(g, 16, 6);

    const lateral = dir === 'E' || dir === 'W';
    const toN = dir === 'N' || dir === 'NE' || dir === 'NW';
    const toS = dir === 'S' || dir === 'SE' || dir === 'SW';

    // Passos de caminhada — bem exagerados para ser visível
    const stepL = phase === 1 ? -6 : phase === 2 ?  5 : 0;
    const stepR = phase === 1 ?  5 : phase === 2 ? -6 : 0;
    // Balanço de braços — oposto às pernas
    const armSwL = phase === 1 ?  4 : phase === 2 ? -5 : 0;
    const armSwR = phase === 1 ? -5 : phase === 2 ?  4 : 0;

    if (lateral) {
        // ── Vista lateral ────────────────────────────────────────────────
        const flip  = dir === 'W' ? -1 : 1;
        const ox    = dir === 'W' ? -5 : -5;

        // Perna traseira (mais escura)
        g.fillStyle(pal.pants);
        g.fillRect(ox + 1, stepR - 14, 5, 14);
        g.fillStyle(pal.boot);
        g.fillRect(ox, stepR - 2, 7, 5);

        // Tronco + colete
        g.fillStyle(pal.top);
        g.fillRect(ox - 1, -27, 12, 14);
        g.fillStyle(pal.topD);
        g.fillRect(ox - 1, -27, 12, 3);   // ombro escuro
        g.fillRect(ox + 4, -27, 2, 14);   // linha central

        // Braço traseiro
        const baxT = ox + (flip > 0 ? -1 : 8);
        g.fillStyle(pal.top);
        g.fillRect(baxT, -25 + armSwR, 4, 10);
        g.fillStyle(pal.skin);
        g.fillRect(baxT, -16 + armSwR, 4, 4);

        // Perna frontal
        g.fillStyle(pal.pants);
        g.fillRect(ox + 1, stepL - 14, 5, 14);
        g.fillStyle(pal.boot);
        g.fillRect(ox, stepL - 2, 7, 5);

        // Braço frontal + arma
        const baxF = ox + (flip > 0 ? 10 : -5);
        g.fillStyle(pal.top);
        g.fillRect(baxF, -25 + armSwL, 4, 10);
        g.fillStyle(pal.skin);
        g.fillRect(baxF, -16 + armSwL, 4, 4);

        // Arma
        g.fillStyle(pal.gun);
        if (flip > 0) {
            g.fillRect(ox + 12, -22, 10, 4);
            g.fillRect(ox + 21, -24, 2, 3);
        } else {
            g.fillRect(ox - 11, -22, 10, 4);
            g.fillRect(ox - 13, -24, 2, 3);
        }

        // Pescoço
        g.fillStyle(pal.skin);
        g.fillRect(ox + 3, -29, 4, 3);

        // Cabeça (oval maior)
        g.fillStyle(pal.skin);
        g.fillRect(ox + 1, -39, 9, 11);
        g.fillStyle(pal.hair);
        g.fillRect(ox + 1, -40, 9, 5);
        g.fillRect(ox + 1, -39, 2, 3); // sideburn

        // Rosto
        g.fillStyle(0x222222);
        const eyeX = flip > 0 ? ox + 7 : ox + 2;
        g.fillRect(eyeX, -36, 2, 2);
        g.fillStyle(0xffffff);
        g.fillRect(eyeX + (flip > 0 ? 1 : 0), -37, 1, 1);

        // Outline simples
        g.lineStyle(1, pal.outline, 0.6);
        g.strokeRect(ox - 1, -27, 12, 14);

    } else if (toS) {
        // ── Vista frontal ────────────────────────────────────────────────
        const offX = dir === 'SE' ? 2 : dir === 'SW' ? -2 : 0;

        // Perna esquerda
        g.fillStyle(pal.pants);
        g.fillRect(-7 + offX, stepL - 14, 6, 14);
        g.fillStyle(pal.boot);
        g.fillRect(-8 + offX, stepL - 3, 8, 5);

        // Perna direita
        g.fillStyle(pal.pants);
        g.fillRect( 2 + offX, stepR - 14, 6, 14);
        g.fillStyle(pal.boot);
        g.fillRect( 1 + offX, stepR - 3, 8, 5);

        // Tronco
        g.fillStyle(pal.top);
        g.fillRect(-8, -28, 17, 14);
        g.fillStyle(pal.topD);
        g.fillRect(-8, -28, 17, 3);
        g.fillRect(-1, -28, 3, 14);   // linha central

        // Braço esquerdo
        g.fillStyle(pal.top);
        g.fillRect(-13, -27 + armSwL, 5, 10);
        g.fillStyle(pal.skin);
        g.fillRect(-13, -18 + armSwL, 5, 5);

        // Braço direito + arma
        g.fillStyle(pal.top);
        g.fillRect(  9, -27 + armSwR, 5, 10);
        g.fillStyle(pal.skin);
        g.fillRect(  9, -18 + armSwR, 5, 5);
        g.fillStyle(pal.gun);
        g.fillRect(  9 + offX, -24, 5, 6);
        g.fillStyle(0x444444);
        g.fillRect( 10 + offX, -18, 3, 4);

        // Pescoço
        g.fillStyle(pal.skin);
        g.fillRect(-3, -31, 7, 4);

        // Cabeça
        g.fillStyle(pal.skin);
        g.fillRect(-6, -43, 13, 13);
        g.fillStyle(pal.hair);
        g.fillRect(-6, -44, 13, 6);

        // Olhos
        g.fillStyle(0x222222);
        g.fillRect(-4, -37, 3, 3);
        g.fillRect( 2, -37, 3, 3);
        g.fillStyle(0xffffff);
        g.fillRect(-3, -38, 1, 1);
        g.fillRect( 3, -38, 1, 1);

        // Nariz / boca
        g.fillStyle(pal.skin);
        g.fillRect(-1, -34, 3, 2);
        g.fillStyle(0x333333);
        g.fillRect(-2, -32, 5, 1);

    } else {
        // ── Vista traseira ───────────────────────────────────────────────
        const offX = dir === 'NE' ? 2 : dir === 'NW' ? -2 : 0;

        // Pernas
        g.fillStyle(pal.pants);
        g.fillRect(-7 + offX, stepL - 14, 6, 14);
        g.fillRect( 2 + offX, stepR - 14, 6, 14);
        g.fillStyle(pal.boot);
        g.fillRect(-8 + offX, stepL - 3, 8, 5);
        g.fillRect( 1 + offX, stepR - 3, 8, 5);

        // Tronco (costas)
        g.fillStyle(pal.top);
        g.fillRect(-8, -28, 17, 14);
        g.fillStyle(pal.topD);
        g.fillRect(-8, -28, 17, 3);

        // Braços
        g.fillStyle(pal.top);
        g.fillRect(-13, -27 + armSwL, 5, 10);
        g.fillRect(  9, -27 + armSwR, 5, 10);
        g.fillStyle(pal.skin);
        g.fillRect(-13, -18 + armSwL, 5, 5);
        g.fillRect(  9, -18 + armSwR, 5, 5);

        // Arma (costas, parcialmente visível)
        g.fillStyle(pal.gun);
        g.fillRect( 9 + offX, -22, 4, 5);

        // Pescoço
        g.fillStyle(pal.skin);
        g.fillRect(-3, -31, 7, 4);

        // Cabeça (costas — cabelo cobre quase tudo)
        g.fillStyle(pal.hair);
        g.fillRect(-6, -44, 13, 14);
        g.fillStyle(pal.skin);
        g.fillRect(-5, -31, 11, 2); // nuca
    }
}

// ── ZOMBIE — drawZombieFrame ──────────────────────────────────────────────────
//
// Postura curvada para frente, braços estendidos, passo arrastado.
// Cores esverdeadas/podres com manchas de sangue.

function drawZombieFrame(
    g: Phaser.GameObjects.Graphics,
    phase: 0 | 1 | 2,
    dir: Dir8,
) {
    g.clear();
    shadow(g, 18, 6);

    const pal = ZOMBIE_PAL;
    const lateral = dir === 'E' || dir === 'W';
    const toN = dir === 'N' || dir === 'NE' || dir === 'NW';
    const toS = dir === 'S' || dir === 'SE' || dir === 'SW';

    // Passo arrastado — movimento menor e mais irregular
    const stepL = phase === 1 ? -4 : phase === 2 ?  3 : 0;
    const stepR = phase === 1 ?  3 : phase === 2 ? -4 : 0;

    if (lateral) {
        // ── Vista lateral ────────────────────────────────────────────────
        const flip = dir === 'W' ? -1 : 1;
        const ox   = -5;

        // Perna traseira (arrastada)
        g.fillStyle(pal.cloth);
        g.fillRect(ox + 1, stepR - 14, 5, 14);
        g.fillStyle(pal.skinD);
        g.fillRect(ox,     stepR -  2, 8,  5);
        // Garra do pé
        g.fillStyle(pal.bone);
        g.fillRect(ox + (flip > 0 ? 6 : -2), stepR - 1, 3, 2);

        // Tronco curvado para frente
        g.fillStyle(pal.cloth);
        g.fillRect(ox, -26, 11, 13);
        g.fillStyle(pal.clothD);
        g.fillRect(ox, -26, 11,  3);
        // Rasgo de carne
        g.fillStyle(pal.skin);
        g.fillRect(ox + 2, -22, 3, 4);
        g.fillStyle(pal.blood);
        g.fillRect(ox + 2, -19, 3, 2);

        // Braço esticado para frente
        const aOff = phase === 1 ? 2 : phase === 2 ? -2 : 0;
        const bax  = ox + (flip > 0 ? 10 : -5);
        g.fillStyle(pal.skin);
        g.fillRect(bax, -26 + aOff, 4, 12);
        g.fillStyle(pal.skinD);
        g.fillRect(bax, -15 + aOff, 5,  3);
        // Garras
        g.fillStyle(pal.bone);
        for (let i = 0; i < 3; i++) {
            g.fillRect(bax + (flip > 0 ? 4 : -2) + i, -13 + aOff, 1, 4);
        }

        // Perna frontal
        g.fillStyle(pal.cloth);
        g.fillRect(ox + 1, stepL - 14, 5, 14);
        g.fillStyle(pal.skinD);
        g.fillRect(ox,     stepL -  2, 8,  5);
        g.fillStyle(pal.bone);
        g.fillRect(ox + (flip > 0 ? 6 : -2), stepL - 1, 3, 2);

        // Pescoço (inclinado)
        g.fillStyle(pal.skin);
        g.fillRect(ox + 2, -28, 4, 3);

        // Cabeça inclinada para frente
        const hOff = flip > 0 ? 2 : -2;
        g.fillStyle(pal.skin);
        g.fillRect(ox + 1 + hOff, -39, 9, 12);
        g.fillStyle(0x1e1a0a);  // cabelo escuro/podre
        g.fillRect(ox + 1 + hOff, -40, 9, 6);
        // Olho morto
        g.fillStyle(pal.eye);
        const eyeX = flip > 0 ? ox + 7 + hOff : ox + 2 + hOff;
        g.fillRect(eyeX, -36, 3, 3);
        g.fillStyle(pal.blood);
        g.fillRect(eyeX + 1, -35, 1, 1);
        // Boca aberta
        g.fillStyle(0x111111);
        g.fillRect(ox + 2 + hOff, -32, 5, 3);
        g.fillStyle(pal.bone);
        g.fillRect(ox + 2 + hOff, -32, 1, 2);
        g.fillRect(ox + 4 + hOff, -32, 1, 2);
        // Ferida
        g.fillStyle(pal.blood);
        g.fillRect(ox + 6 + hOff, -37, 2, 3);

    } else if (toS) {
        // ── Vista frontal ────────────────────────────────────────────────
        const offX = dir === 'SE' ? 2 : dir === 'SW' ? -2 : 0;

        // Pernas arrastadas
        g.fillStyle(pal.cloth);
        g.fillRect(-7 + offX, stepL - 14, 6, 14);
        g.fillRect( 2 + offX, stepR - 14, 6, 14);
        g.fillStyle(pal.skinD);
        g.fillRect(-8 + offX, stepL - 3, 8, 5);
        g.fillRect( 1 + offX, stepR - 3, 8, 5);
        // Garras dos pés
        g.fillStyle(pal.bone);
        g.fillRect(-9 + offX, stepL - 1, 2, 3);
        g.fillRect( 8 + offX, stepR - 1, 2, 3);
        // Pele aparecendo (roupa rasgada)
        g.fillStyle(pal.skin);
        g.fillRect(-5 + offX, stepL - 9, 2, 4);
        g.fillRect( 4 + offX, stepR - 8, 2, 4);

        // Tronco rasgado
        g.fillStyle(pal.cloth);
        g.fillRect(-8, -28, 17, 14);
        g.fillStyle(pal.clothD);
        g.fillRect(-8, -28, 17,  3);
        // Rasgos
        g.fillStyle(pal.skin);
        g.fillRect(-3, -24, 3, 6);
        g.fillRect( 2, -23, 3, 5);
        g.fillStyle(pal.blood);
        g.fillRect(-4, -20, 4, 3);
        g.fillRect( 3, -18, 3, 3);

        // Braços esticados para frente/câmera
        const aY = phase === 0 ? -27 : phase === 1 ? -29 : -25;
        g.fillStyle(pal.skin);
        g.fillRect(-13, aY, 5, 13);
        g.fillRect(  9, aY, 5, 13);
        g.fillStyle(pal.skinD);
        g.fillRect(-14, aY + 12, 6,  4);
        g.fillRect(  8, aY + 12, 6,  4);
        // Garras
        g.fillStyle(pal.bone);
        for (let i = 0; i < 3; i++) {
            g.fillRect(-13 + i * 2, aY + 15, 1, 4);
            g.fillRect(  9 + i * 2, aY + 15, 1, 4);
        }

        // Pescoço
        g.fillStyle(pal.skin);
        g.fillRect(-3, -31, 7, 4);

        // Cabeça
        g.fillStyle(pal.skin);
        g.fillRect(-6, -43, 13, 13);
        g.fillStyle(0x1e1a0a);
        g.fillRect(-6, -44, 13, 6);
        g.fillStyle(pal.skin);
        g.fillRect(-3, -44, 2, 1); g.fillRect( 3, -44, 2, 1);

        // Olhos mortos
        g.fillStyle(pal.eye);
        g.fillRect(-4, -38, 4, 3);
        g.fillRect( 2, -38, 4, 3);
        g.fillStyle(pal.blood);
        g.fillRect(-3, -37, 2, 1);
        g.fillRect( 3, -37, 2, 1);

        // Boca aberta
        g.fillStyle(0x111111);
        g.fillRect(-4, -33, 9, 4);
        g.fillStyle(pal.bone);
        for (let i = 0; i < 4; i++) g.fillRect(-3 + i * 2, -33, 1, 3);
        g.fillStyle(pal.blood);
        g.fillRect(-4, -30, 9, 1);

        // Feridas
        g.fillStyle(pal.blood);
        g.fillRect( 3, -40, 3, 3);

    } else {
        // ── Vista traseira ───────────────────────────────────────────────
        const offX = dir === 'NE' ? 2 : dir === 'NW' ? -2 : 0;

        // Pernas
        g.fillStyle(pal.cloth);
        g.fillRect(-7 + offX, stepL - 14, 6, 14);
        g.fillRect( 2 + offX, stepR - 14, 6, 14);
        g.fillStyle(pal.skinD);
        g.fillRect(-8 + offX, stepL - 3, 8, 5);
        g.fillRect( 1 + offX, stepR - 3, 8, 5);

        // Tronco (costas)
        g.fillStyle(pal.cloth);
        g.fillRect(-8, -28, 17, 14);
        g.fillStyle(pal.blood);
        g.fillRect(1, -22, 4, 4);

        // Braços estendidos para cima/frente
        const aY = phase === 0 ? -30 : phase === 1 ? -32 : -28;
        g.fillStyle(pal.skin);
        g.fillRect(-13, aY, 5, 12);
        g.fillRect(  9, aY, 5, 12);
        g.fillStyle(pal.bone);
        for (let i = 0; i < 3; i++) {
            g.fillRect(-12 + i, aY - 2, 1, 3);
            g.fillRect( 10 + i, aY - 2, 1, 3);
        }

        // Pescoço
        g.fillStyle(pal.skin);
        g.fillRect(-3, -31, 7, 4);

        // Cabeça (costas — quase toda coberta de cabelo)
        g.fillStyle(0x1e1a0a);
        g.fillRect(-6, -44, 13, 14);
        g.fillStyle(pal.skin);
        g.fillRect(-5, -31, 11, 2);
        // Ferida na nuca
        g.fillStyle(pal.blood);
        g.fillRect(1, -37, 4, 3);
    }
}

// ── Fábrica pública ───────────────────────────────────────────────────────────

const ALL_DIRS: Dir8[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

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

    // HP bar
    const hpBg  = scene.add.rectangle(0, -50, 22, 3, 0x550000).setOrigin(0.5, 0.5);
    const hpBar = scene.add.rectangle(-11, -50, 22, 3, 0x44ff44).setOrigin(0, 0.5);

    return { frames, hpBar, hpBg };
}

// ── Utilitários de direção ────────────────────────────────────────────────────

export function angleToDir8(angleDeg: number): Dir8 {
    let a = ((angleDeg % 360) + 360) % 360;
    const sector = Math.round(a / 45) % 8;
    const dirs: Dir8[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
    return dirs[sector];
}

export function radToDeg(r: number): number { return r * 180 / Math.PI; }