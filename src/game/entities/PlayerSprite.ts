/**
 * PlayerSprite — desenha um sobrevivente humanoide isométrico usando apenas
 * primitivos Phaser (sem assets externos).
 *
 * Vista de cima / 3/4 (isométrica). O personagem aponta para a direita
 * antes de qualquer rotação. Toda a arte é construída dentro de um Container
 * com sub-containers separados para "corpo" e "arma", permitindo que a arma
 * gire independentemente do corpo se necessário.
 *
 * Paleta base — sobrevivente estilo pós-apocalíptico:
 *   - Pele: #c8956c / #a0714f
 *   - Cabelo: #3a2510
 *   - Roupa (jaqueta): #5a4a32 / #3e3324
 *   - Calça: #2e3a28
 *   - Colete/detalhe: #7a6244
 *   - Botas: #1e1610
 *   - Arma: #222 / #555
 *
 * Escala total do sprite: ~22px de largura × ~32px de altura (antes do
 * achatamento isométrico aplicado pelo container pai em scaleY 0.6).
 */
export function buildPlayerSprite(
    scene: Phaser.Scene,
    isLocal: boolean,
): Phaser.GameObjects.Container {

    // Paleta: local = tons quentes, remoto = tons frios
    const skin  = isLocal ? 0xc8956c : 0x8899bb;
    const hair  = isLocal ? 0x2a1a08 : 0x111a22;
    const coat  = isLocal ? 0x5a4a32 : 0x2a3a52;
    const coatD = isLocal ? 0x3e3324 : 0x1a2638;
    const pants = isLocal ? 0x2e3a28 : 0x1e2a3a;
    const boot  = 0x181210;
    const belt  = 0x6a5230;

    const g = scene.add.graphics();

    // ── Sombra no chão ─────────────────────────────────────────────────────
    g.fillStyle(0x000000, 0.35);
    g.fillEllipse(0, 10, 22, 8);

    // ── Botas ──────────────────────────────────────────────────────────────
    g.fillStyle(boot);
    g.fillRoundedRect(-7, 5, 6, 8, 2);   // pé esquerdo
    g.fillRoundedRect( 1, 5, 6, 8, 2);   // pé direito

    // ── Calça ──────────────────────────────────────────────────────────────
    g.fillStyle(pants);
    g.fillRoundedRect(-8, -2, 7, 9, 2);  // perna esq
    g.fillRoundedRect( 1, -2, 7, 9, 2);  // perna dir

    // ── Detalhe de costura na calça ────────────────────────────────────────
    g.lineStyle(0.5, 0x445533, 0.6);
    g.beginPath(); g.moveTo(-4.5, -2); g.lineTo(-4.5, 6); g.strokePath();
    g.beginPath(); g.moveTo( 4.5, -2); g.lineTo( 4.5, 6); g.strokePath();

    // ── Cinto ──────────────────────────────────────────────────────────────
    g.fillStyle(belt);
    g.fillRect(-8, -4, 16, 3);
    g.fillStyle(0x998844);
    g.fillRect(-1, -4, 2, 3); // fivela

    // ── Jaqueta / tronco ───────────────────────────────────────────────────
    g.fillStyle(coat);
    g.fillRoundedRect(-9, -14, 18, 12, 3);

    // Lapela da jaqueta (forma mais escura no centro)
    g.fillStyle(coatD);
    g.fillTriangle(-2, -14, 2, -14, 0, -8);

    // Bolso lateral
    g.fillStyle(coatD);
    g.fillRoundedRect(-8, -10, 4, 3, 1);
    g.fillRoundedRect( 4, -10, 4, 3, 1);

    // Costura da jaqueta
    g.lineStyle(0.5, 0x7a6244, 0.5);
    g.strokeRoundedRect(-9, -14, 18, 12, 3);

    // ── Ombros / mangas ────────────────────────────────────────────────────
    g.fillStyle(coat);
    g.fillEllipse(-10, -10, 7, 5);   // ombro esq
    g.fillEllipse( 10, -10, 7, 5);   // ombro dir

    // ── Braço esquerdo (dobrado, visível) ──────────────────────────────────
    g.fillStyle(coat);
    g.fillRoundedRect(-14, -12, 5, 10, 2);
    // Punho / luva
    g.fillStyle(skin);
    g.fillEllipse(-12, -2, 5, 4);

    // ── Pescoço ────────────────────────────────────────────────────────────
    g.fillStyle(skin);
    g.fillRoundedRect(-3, -17, 6, 5, 1);

    // ── Cabeça ─────────────────────────────────────────────────────────────
    g.fillStyle(skin);
    g.fillRoundedRect(-8, -30, 16, 15, 4);

    // Mandíbula ligeiramente mais escura
    g.fillStyle(isLocal ? 0xa0714f : 0x6677aa);
    g.fillRoundedRect(-6, -20, 12, 5, 2);

    // Cabelo (topo da cabeça)
    g.fillStyle(hair);
    g.fillRoundedRect(-8, -31, 16, 7, { tl: 4, tr: 4, bl: 0, br: 0 });
    // Mecha caindo para o lado
    g.fillStyle(hair);
    g.fillTriangle(-8, -28, -8, -22, -12, -25);

    // Olho esquerdo
    g.fillStyle(0x111111);
    g.fillEllipse(-3, -25, 3, 2.5);
    g.fillStyle(0xffffff);
    g.fillEllipse(-3.5, -25.2, 1, 1);

    // Olho direito
    g.fillStyle(0x111111);
    g.fillEllipse( 3, -25, 3, 2.5);
    g.fillStyle(0xffffff);
    g.fillEllipse( 2.5, -25.2, 1, 1);

    // Sobrancelha esquerda
    g.lineStyle(1, hair, 0.9);
    g.beginPath(); g.moveTo(-5, -27); g.lineTo(-1, -26.5); g.strokePath();
    // Sobrancelha direita
    g.beginPath(); g.moveTo( 5, -27); g.lineTo( 1, -26.5); g.strokePath();

    // Nariz
    g.fillStyle(isLocal ? 0xa0714f : 0x6677aa);
    g.fillTriangle(0, -23, -1, -21.5, 1, -21.5);

    // Barba / sujeira no rosto
    g.fillStyle(hair, 0.4);
    g.fillEllipse( 0, -19, 8, 3);

    // ── Colar / lenço no pescoço ───────────────────────────────────────────
    g.fillStyle(0x884433, 0.8);
    g.fillRoundedRect(-4, -18, 8, 2, 1);

    // ── Braço direito + Arma ───────────────────────────────────────────────
    // (Braço direito aponta para a direita — será rotacionado pelo container pai)
    g.fillStyle(coat);
    g.fillRoundedRect( 9, -13, 5, 9, 2);
    // Mão
    g.fillStyle(skin);
    g.fillEllipse(12, -4, 5, 4);

    // ── Arma (pistola) ─────────────────────────────────────────────────────
    // Cabo
    g.fillStyle(0x2a2018);
    g.fillRoundedRect(12, -7, 5, 6, 1);
    // Corpo da pistola
    g.fillStyle(0x222222);
    g.fillRoundedRect(11, -10, 14, 5, 1);
    // Cano
    g.fillStyle(0x111111);
    g.fillRect(24, -9, 10, 3);
    // Mira
    g.fillStyle(0x888888);
    g.fillRect(20, -11, 2, 1);
    // Reflexo metálico
    g.fillStyle(0x555555, 0.6);
    g.fillRect(12, -10, 12, 2);
    // Ponto vermelho de mira (local) ou azul (remoto)
    g.fillStyle(isLocal ? 0xff2200 : 0x2244ff, 0.9);
    g.fillCircle(22, -8, 1.5);

    return scene.add.container(0, 0, [g]);
}