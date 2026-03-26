/**
 * ZombieSprite — desenha um zumbi humanoide isométrico usando apenas
 * primitivos Phaser (sem assets externos).
 *
 * Inspirado em zumbi clássico: postura curvada, pele podre esverdeada,
 * roupa rasgada, feridas visíveis, sangue, olhos brancos sem pupila.
 *
 * Paleta:
 *   - Pele: #4a5c2a (verde podre escuro) / #3a4c1e
 *   - Roupa rasgada: #3a3028 / #2a2018
 *   - Sangue: #8b0000 / #cc1111
 *   - Osso/dente: #d4c89a
 *   - Olho branco morto: #dde8cc
 *
 * A postura é levemente curvada: cabeça inclinada, braços abertos.
 */
export function buildZombieSprite(scene: Phaser.Scene, hp: number = 1): {
    container: Phaser.GameObjects.Container;
    hpBarRef: Phaser.GameObjects.Rectangle;
    bodyRef: Phaser.GameObjects.Graphics;
} {
    const skinBase  = 0x4a5c2a;
    const skinDark  = 0x3a4c1e;
    const cloth     = 0x3a3028;
    const clothRip  = 0x2a2018;
    const blood     = 0x8b1010;
    const bone      = 0xd4c89a;
    const eyeColor  = 0xdde8cc;

    const g = scene.add.graphics();

    // ── Sombra ─────────────────────────────────────────────────────────────
    g.fillStyle(0x000000, 0.3);
    g.fillEllipse(0, 10, 24, 9);

    // ── Pés (descalços, deformados) ────────────────────────────────────────
    g.fillStyle(skinDark);
    g.fillRoundedRect(-8, 5, 7, 7, 1);  // pé esq
    g.fillRoundedRect( 1, 5, 7, 7, 1);  // pé dir
    // Garras nos pés
    g.fillStyle(bone, 0.9);
    for (let i = 0; i < 3; i++) {
        g.fillRect(-9 + i * 2.5, 11, 2, 3);
        g.fillRect( 1 + i * 2.5, 11, 2, 3);
    }

    // ── Pernas (calça rasgada) ─────────────────────────────────────────────
    g.fillStyle(cloth);
    g.fillRoundedRect(-9, -2, 7, 9, 2);
    g.fillRoundedRect( 2, -2, 7, 9, 2);

    // Rasgões na calça
    g.fillStyle(skinBase, 0.7);
    g.fillRect(-6, 1, 2, 4);
    g.fillRect( 4, 2, 2, 3);
    g.fillRect(-7, 4, 1, 3);

    // Manchas de sangue na calça
    g.fillStyle(blood, 0.7);
    g.fillEllipse(-5, 0, 5, 3);
    g.fillEllipse( 5, 3, 3, 2);

    // ── Torso (camisa rasgada) ─────────────────────────────────────────────
    g.fillStyle(cloth);
    g.fillRoundedRect(-10, -14, 20, 13, 3);

    // Rasgões no torso (expondo pele esverdeada)
    g.fillStyle(skinBase, 0.8);
    g.fillRect(-3, -13, 5, 8);       // rasgo central
    g.fillRect(-9, -11, 3, 5);       // rasgo esquerdo
    g.fillRect( 6, -10, 3, 4);       // rasgo direito

    // Costelas visíveis no rasgo central
    g.lineStyle(0.8, bone, 0.6);
    for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.moveTo(-2, -12 + i * 2.5);
        g.lineTo( 2, -12 + i * 2.5);
        g.strokePath();
    }

    // Ferida / mordida no torso
    g.fillStyle(blood);
    g.fillEllipse( 4, -8, 6, 4);
    g.fillStyle(0xcc2222, 0.7);
    g.fillEllipse( 4, -8, 3, 2);

    // Manchas de sangue espalhadas
    g.fillStyle(blood, 0.6);
    g.fillEllipse(-6, -12, 4, 2);
    g.fillEllipse( 3, -5,  3, 2);

    // ── Braço esquerdo (estendido, dobrado para baixo) ─────────────────────
    g.fillStyle(skinBase);
    g.fillRoundedRect(-17, -13, 6, 12, 2);
    // Mão esq com garras
    g.fillStyle(skinDark);
    g.fillEllipse(-14, 0, 7, 5);
    g.fillStyle(bone, 0.9);
    g.fillRect(-17, 1, 2, 4);
    g.fillRect(-15, 0, 2, 4);
    g.fillRect(-13, 1, 2, 3);
    // Mancha de sangue no braço
    g.fillStyle(blood, 0.5);
    g.fillEllipse(-15, -7, 4, 3);

    // ── Braço direito (estendido para frente) ──────────────────────────────
    g.fillStyle(skinBase);
    g.fillRoundedRect( 11, -13, 6, 11, 2);
    // Mão dir com garras
    g.fillStyle(skinDark);
    g.fillEllipse( 14, -1, 7, 5);
    g.fillStyle(bone, 0.9);
    g.fillRect(11, 0, 2, 4);
    g.fillRect(13, 0, 2, 4);
    g.fillRect(15, 1, 2, 3);

    // ── Pescoço (torcido) ──────────────────────────────────────────────────
    g.fillStyle(skinBase);
    g.fillRoundedRect(-4, -18, 8, 6, 1);
    // Ferida no pescoço
    g.fillStyle(blood);
    g.fillEllipse(-1, -15, 5, 3);

    // ── Cabeça (inclinada) ─────────────────────────────────────────────────
    g.fillStyle(skinBase);
    g.fillRoundedRect(-9, -32, 17, 15, 3);

    // Sujeira / podridão na pele
    g.fillStyle(skinDark, 0.6);
    g.fillEllipse(-4, -27, 5, 4);
    g.fillEllipse( 5, -29, 4, 3);

    // ── Cabelo escasso / podre ─────────────────────────────────────────────
    g.fillStyle(0x2a2210);
    // Tufos de cabelo irregulares
    g.fillRoundedRect(-9, -33, 6, 5, { tl: 3, tr: 1, bl: 0, br: 0 });
    g.fillRoundedRect(-2, -34, 5, 4, { tl: 2, tr: 2, bl: 0, br: 0 });
    g.fillRoundedRect( 4, -33, 4, 4, { tl: 1, tr: 3, bl: 0, br: 0 });
    // Tufo caindo (mechas para o lado)
    g.fillTriangle(-9, -30, -9, -26, -13, -28);
    g.fillTriangle( 8, -31, 8, -27,  12, -29);

    // ── Olho esquerdo — BRANCO (zumbi) ────────────────────────────────────
    g.fillStyle(eyeColor);
    g.fillEllipse(-3.5, -26, 5, 4);
    // Íris morta (quase invisível)
    g.fillStyle(0xaabb99, 0.4);
    g.fillCircle(-3.5, -26, 1.5);
    // Veia vermelha
    g.lineStyle(0.7, 0xcc1111, 0.6);
    g.beginPath(); g.moveTo(-5.5, -26); g.lineTo(-2, -26); g.strokePath();

    // ── Olho direito — BRANCO (zumbi) ─────────────────────────────────────
    g.fillStyle(eyeColor);
    g.fillEllipse( 3.5, -26, 5, 4);
    g.fillStyle(0xaabb99, 0.4);
    g.fillCircle( 3.5, -26, 1.5);
    g.lineStyle(0.7, 0xcc1111, 0.6);
    g.beginPath(); g.moveTo(2, -26); g.lineTo(5.5, -26); g.strokePath();

    // ── Osso da testa exposto ──────────────────────────────────────────────
    g.fillStyle(bone, 0.7);
    g.fillRoundedRect(-2, -33, 5, 2, 1);

    // ── Nariz (deformado) ─────────────────────────────────────────────────
    g.fillStyle(skinDark);
    g.fillTriangle(0, -23, -2, -21, 2, -21);
    // Cavidade nasal
    g.fillStyle(0x0a0a0a, 0.8);
    g.fillEllipse(-0.8, -22, 1.5, 1.5);
    g.fillEllipse( 0.8, -22, 1.5, 1.5);

    // ── Boca (aberta, dentes expostos) ────────────────────────────────────
    g.fillStyle(0x0a0a08);
    g.fillRoundedRect(-5, -20, 10, 5, 2);
    // Dentes
    g.fillStyle(bone);
    for (let i = 0; i < 4; i++) {
        g.fillRect(-4 + i * 2.2, -20, 1.8, 2.5);  // topo
        g.fillRect(-3.5 + i * 2.2, -17, 1.8, 2);   // baixo
    }
    // Sangue na boca
    g.fillStyle(blood, 0.8);
    g.fillEllipse(0, -17, 6, 2);

    // ── Ferida na cabeça ──────────────────────────────────────────────────
    g.fillStyle(blood);
    g.fillEllipse( 7, -28, 5, 3);
    g.fillStyle(bone, 0.5);
    g.fillEllipse( 7, -28, 2, 1.5);

    // ── HP Bar ─────────────────────────────────────────────────────────────
    const hpBg  = scene.add.rectangle(0, -36, 22, 3, 0x550000).setOrigin(0.5, 0.5);
    const hpBar = scene.add.rectangle(-11, -36, 22, 3, 0x44ff44).setOrigin(0, 0.5);

    const container = scene.add.container(0, 0, [g, hpBg, hpBar]);

    return { container, hpBarRef: hpBar, bodyRef: g };
}