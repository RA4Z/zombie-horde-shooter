import { cartesianToIso } from '../utils/IsoMath';

/**
 * CityWorld — cidade pós-apocalíptica renderizada com Graphics Phaser.
 *
 * Tudo é pseudo-3D isométrico: base flat + faces laterais + topo.
 * Sem assets externos — 100% procedural usando primitivos.
 *
 * Perspectiva: isométrica "side-on" (inclinação 2:1 padrão de jogos como
 * Age of Empires / Diablo). A câmera olha levemente de cima e de lado.
 *
 * Layout:
 *   - Grid de tiles 64×64 unidades de mundo
 *   - Ruas com 2 tiles de largura a cada 4 tiles de quarteirão
 *   - Quarteirões: prédios, estacionamentos ou escombros (aleatório por seed)
 *   - Postes, carros, destroços e poças preenchem os espaços
 */
export class CityWorld {
    private g!: Phaser.GameObjects.Graphics;
    private static readonly T = 64;   // tile size (world units)

    constructor(private scene: Phaser.Scene) {}

    build() {
        this.g = this.scene.add.graphics();
        this.g.setDepth(-500);

        this.drawGround();
        this.drawRoads();
        this.placeBlocks();
        this.drawAtmosphere();
    }

    // =========================================================================
    // Chão base
    // =========================================================================

    private drawGround() {
        const T = CityWorld.T;
        const HALF = 22;
        for (let gx = -HALF; gx < HALF; gx++) {
            for (let gy = -HALF; gy < HALF; gy++) {
                const wx = gx * T, wy = gy * T;
                // Variação sutil de cor baseada em posição
                const n  = Math.sin(wx * 0.004 + wy * 0.007) * 5;
                const c  = 26 + Math.round(n);
                this.isoTile(wx, wy, T, T, Phaser.Display.Color.GetColor(c, c, c - 1));
            }
        }
    }

    // =========================================================================
    // Ruas
    // =========================================================================

    private drawRoads() {
        const T     = CityWorld.T;
        const BLOCK = 4;   // tiles de quarteirão
        const ROAD  = 2;   // tiles de rua
        const STEP  = BLOCK + ROAD;
        const RANGE = 20;

        for (let gx = -RANGE; gx <= RANGE; gx++) {
            const rx = ((gx % STEP) + STEP) % STEP;
            const isRX = rx >= BLOCK;
            for (let gy = -RANGE; gy <= RANGE; gy++) {
                const ry = ((gy % STEP) + STEP) % STEP;
                const isRY = ry >= BLOCK;
                if (!isRX && !isRY) continue;

                const wx = gx * T, wy = gy * T;
                const isInt = isRX && isRY;

                this.isoTile(wx, wy, T, T, isInt ? 0x1c1c1c : 0x191919);

                if (!isInt) {
                    // Faixa tracejada
                    const steps = 6;
                    for (let s = 0; s < steps; s++) {
                        const t = (s / steps + 0.1);
                        const t2 = t + 0.06;
                        if (isRX) {
                            const { isoX: ax, isoY: ay } = cartesianToIso(wx + t * T, wy + T / 2);
                            const { isoX: bx, isoY: by } = cartesianToIso(wx + t2 * T, wy + T / 2);
                            this.g.lineStyle(1, 0x3a3a28, 0.6);
                            this.g.beginPath(); this.g.moveTo(ax, ay); this.g.lineTo(bx, by); this.g.strokePath();
                        } else {
                            const { isoX: ax, isoY: ay } = cartesianToIso(wx + T / 2, wy + t * T);
                            const { isoX: bx, isoY: by } = cartesianToIso(wx + T / 2, wy + t2 * T);
                            this.g.lineStyle(1, 0x3a3a28, 0.6);
                            this.g.beginPath(); this.g.moveTo(ax, ay); this.g.lineTo(bx, by); this.g.strokePath();
                        }
                    }

                    // Calçadas nas bordas
                    const SW = 5;
                    if (isRX) {
                        this.isoTile(wx, wy,          T, SW, 0x303030);
                        this.isoTile(wx, wy + T - SW, T, SW, 0x303030);
                    } else {
                        this.isoTile(wx,         wy, SW, T, 0x303030);
                        this.isoTile(wx + T - SW, wy, SW, T, 0x303030);
                    }
                }
            }
        }
    }

    // =========================================================================
    // Quarteirões
    // =========================================================================

    private placeBlocks() {
        const T     = CityWorld.T;
        const BLOCK = 4;
        const STEP  = BLOCK + 2;
        const RANGE = 4;

        for (let bx = -RANGE; bx <= RANGE; bx++) {
            for (let by = -RANGE; by <= RANGE; by++) {
                const ox = bx * STEP * T;
                const oy = by * STEP * T;
                const seed = bx * 137 + by * 1009;
                const rng  = this.makeRng(seed);
                const type = rng();

                if (type < 0.5) {
                    this.blockBuildings(ox, oy, T, BLOCK, rng);
                } else if (type < 0.75) {
                    this.blockParking(ox, oy, T, BLOCK, rng);
                } else {
                    this.blockRubble(ox, oy, T, BLOCK, rng);
                }

                // Postes nos cantos do bloco
                this.streetlight(ox - T * 0.4,            oy - T * 0.4,            rng() < 0.65);
                this.streetlight(ox + (BLOCK + 0.4) * T,  oy + (BLOCK + 0.4) * T,  rng() < 0.65);
                this.streetlight(ox + (BLOCK + 0.4) * T,  oy - T * 0.4,            rng() < 0.5);
                this.streetlight(ox - T * 0.4,            oy + (BLOCK + 0.4) * T,  rng() < 0.5);
            }
        }
    }

    // ── Prédios ───────────────────────────────────────────────────────────────

    private blockBuildings(ox: number, oy: number, T: number, size: number, rng: () => number) {
        const total = size * T;
        let cx = ox;
        while (cx < ox + total - T * 0.5) {
            const bw = (Math.floor(rng() * 2) + 1) * T;
            const bd = (Math.floor(rng() * 2) + 1) * T;
            if (cx + bw > ox + total + T * 0.3) break;

            const destroyed = rng() < 0.28;
            const rawH = 45 + rng() * 90;
            const bh   = destroyed ? rawH * (0.25 + rng() * 0.4) : rawH;

            this.building(cx, oy, bw, bd, bh, destroyed, rng);
            cx += bw + (rng() < 0.25 ? T * 0.4 : 0);
        }
    }

    private building(wx: number, wy: number, bw: number, bd: number, bh: number, destroyed: boolean, rng: () => number) {
        const palettes = [
            { side: 0x252530, dark: 0x1a1a20, top: 0x2e2e3a },
            { side: 0x221e1a, dark: 0x181410, top: 0x2c2622 },
            { side: 0x1a2020, dark: 0x141818, top: 0x222a2a },
            { side: 0x28201a, dark: 0x1c1610, top: 0x342a20 },
        ];
        const pal = palettes[Math.floor(rng() * palettes.length)];

        this.isoBox(wx, wy, bw, bd, bh, pal.side, pal.dark, pal.top);

        if (!destroyed) {
            this.buildingWindows(wx, wy, bw, bd, bh, rng);
        } else {
            this.debris(wx, wy, bw, bd, rng);
            // Sombra de fumaça ao redor
            const { isoX, isoY } = cartesianToIso(wx + bw / 2, wy + bd / 2);
            this.g.fillStyle(0x050505, 0.35);
            this.g.fillEllipse(isoX, isoY, bw * 1.2, bd * 0.5);
        }
    }

    private buildingWindows(wx: number, wy: number, bw: number, bd: number, bh: number, rng: () => number) {
        // Janelas na face esquerda (visível)
        const cols = Math.max(1, Math.floor(bw / 20));
        const rows = Math.max(1, Math.floor(bh / 22));
        const wW = 10, wH = 14;
        const padX = (bw - cols * wW) / (cols + 1);
        const padY = 10;

        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                const local_wx = wx + padX + c * (wW + padX);
                const local_wy = wy + bd; // projetar na face esquerda
                const wTop     = bh - padY - r * (wH + 8);
                if (wTop < wH) continue;

                const lit    = rng() < 0.12;
                const broken = rng() < 0.22;
                const wCol   = broken ? 0x0c0c0c : lit ? 0xcc9922 : 0x0a0a12;

                // A janela aparece na face lateral esquerda do box
                const { isoX: px, isoY: py } = cartesianToIso(local_wx, local_wy);
                this.g.fillStyle(wCol, 0.85);
                // Face esquerda: inclinação isoY
                const fx = px + c * 0.1;
                this.g.fillRect(fx, py - wTop, wW * 0.55, wH * 0.55);

                if (lit) {
                    this.g.fillStyle(0xcc9922, 0.07);
                    this.g.fillCircle(fx + wW * 0.25, py - wTop, 16);
                }
            }
        }
    }

    // ── Estacionamento ────────────────────────────────────────────────────────

    private blockParking(ox: number, oy: number, T: number, size: number, rng: () => number) {
        const total = size * T;
        this.isoTile(ox, oy, total, total, 0x202020);

        // Linhas de vagas
        const lanes = Math.floor(rng() * 2) + 2;
        for (let lane = 0; lane < lanes; lane++) {
            const lx = ox + (lane / lanes) * total;
            const spots = Math.floor(rng() * 3) + 2;
            for (let s = 0; s < spots; s++) {
                const sy = oy + (s / spots) * total;
                const sw = T * 0.7, sd = T * 0.9;
                // Linha de vaga
                this.g.lineStyle(1, 0x3a3a28, 0.5);
                const pts = [
                    cartesianToIso(lx,      sy),
                    cartesianToIso(lx + sw, sy),
                    cartesianToIso(lx + sw, sy + sd),
                    cartesianToIso(lx,      sy + sd),
                ];
                this.g.strokePoints(pts.map(p => ({ x: p.isoX, y: p.isoY })), true);

                if (rng() < 0.65) this.car(lx + sw * 0.05, sy + sd * 0.05, sw * 0.9, sd * 0.9, rng);
            }
        }

        // Mureta de contenção
        this.isoBox(ox, oy, total, 5, 8, 0x3a3a3a, 0x282828, 0x484848);
        this.isoBox(ox, oy + total - 5, total, 5, 8, 0x3a3a3a, 0x282828, 0x484848);
    }

    // ── Escombros ─────────────────────────────────────────────────────────────

    private blockRubble(ox: number, oy: number, T: number, size: number, rng: () => number) {
        const total = size * T;
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const v = Math.floor(rng() * 8);
                this.isoTile(ox + i * T, oy + j * T, T, T,
                    Phaser.Display.Color.GetColor(18 + v, 15 + v, 12 + v));
            }
        }

        const piles = Math.floor(rng() * 8) + 4;
        for (let i = 0; i < piles; i++) {
            const rx = ox + rng() * total;
            const ry = oy + rng() * total;
            const pw = rng() * T * 0.7 + T * 0.15;
            const ph = rng() * 30 + 6;
            this.debrisPile(rx, ry, pw, pw * 0.65, ph, rng);
        }

        // Poça
        if (rng() < 0.5) {
            const { isoX, isoY } = cartesianToIso(ox + rng() * total, oy + rng() * total);
            const r2 = rng() * 28 + 12;
            this.g.fillStyle(0x08080f, 0.65);
            this.g.fillEllipse(isoX, isoY, r2 * 2, r2 * 0.55);
            this.g.fillStyle(0x1a2233, 0.12);
            this.g.fillEllipse(isoX + 4, isoY - 3, r2 * 0.6, r2 * 0.2);
        }

        // Estrutura parcialmente em pé
        if (rng() < 0.4) {
            const rw = rng() * T + T * 0.5;
            const rd = T * 0.3;
            const rh = rng() * 50 + 20;
            this.isoBox(ox + rng() * (total - rw), oy + rng() * (total - rd),
                rw, rd, rh, 0x1e1c18, 0x141210, 0x2a2820);
        }
    }

    // ── Carro ─────────────────────────────────────────────────────────────────

    private car(wx: number, wy: number, cw: number, cd: number, rng: () => number) {
        const bodyPal = [0x14141e, 0x1e1010, 0x101e10, 0x201a08, 0x0e0e0e];
        const bCol = bodyPal[Math.floor(rng() * bodyPal.length)];
        const tCol = Phaser.Display.Color.ValueToColor(bCol).lighten(10).color;
        const bH = cw * 0.55;

        // Carroceria
        this.isoBox(wx, wy, cw, cd, bH, bCol, bCol, tCol);
        // Cabine
        const cabW = cw * 0.65, cabD = cd * 0.5;
        this.isoBox(wx + (cw - cabW) / 2, wy + (cd - cabD) / 2,
            cabW, cabD, bH * 1.45,
            tCol,
            Phaser.Display.Color.ValueToColor(tCol).darken(10).color,
            Phaser.Display.Color.ValueToColor(tCol).lighten(8).color,
        );
        // Rodas
        const wW = cw * 0.15, wD = cd * 0.18, wH = bH * 0.22;
        for (const [ox2, oy2] of [[0, 0], [cw - wW, 0], [0, cd - wD], [cw - wW, cd - wD]]) {
            this.isoBox(wx + ox2, wy + oy2, wW, wD, wH, 0x080808, 0x050505, 0x111111);
        }
        // Faróis apagados / quebrados
        const { isoX: hx, isoY: hy } = cartesianToIso(wx + cw, wy + cd * 0.25);
        this.g.fillStyle(rng() < 0.3 ? 0x333322 : 0x111108, 0.8);
        this.g.fillRect(hx - 3, hy - bH * 0.3, 5, 4);
    }

    // ── Poste ─────────────────────────────────────────────────────────────────

    private streetlight(wx: number, wy: number, on: boolean) {
        const { isoX, isoY } = cartesianToIso(wx, wy);
        const pH = 85;

        this.g.lineStyle(2, 0x2a3028, 1);
        this.g.beginPath();
        this.g.moveTo(isoX, isoY);
        this.g.lineTo(isoX, isoY - pH);
        this.g.strokePath();

        // Braço
        this.g.lineStyle(2, 0x2a3028, 1);
        this.g.beginPath();
        this.g.moveTo(isoX, isoY - pH);
        this.g.lineTo(isoX + 16, isoY - pH + 8);
        this.g.strokePath();

        const lx = isoX + 16, ly = isoY - pH + 8;

        if (on) {
            // Cápsula da lâmpada
            this.g.fillStyle(0xffeebb, 1);
            this.g.fillEllipse(lx, ly, 8, 5);
            // Cone de luz — triângulo semitransparente
            this.g.fillStyle(0xffee88, 0.035);
            this.g.fillTriangle(lx - 4, ly + 2, lx + 4, ly + 2, lx, ly + 90);
            // Halo
            this.g.fillStyle(0xffdd66, 0.06);
            this.g.fillCircle(lx, ly, 28);
        } else {
            this.g.fillStyle(0x222218, 1);
            this.g.fillEllipse(lx, ly, 7, 4);
        }
    }

    // ── Destroços ─────────────────────────────────────────────────────────────

    private debris(wx: number, wy: number, bw: number, bd: number, rng: () => number) {
        const pcs = Math.floor(rng() * 7) + 3;
        for (let i = 0; i < pcs; i++) {
            const dx = wx + (rng() - 0.3) * bw * 1.6;
            const dy = wy + (rng() - 0.3) * bd * 1.6;
            const dw = rng() * 22 + 5;
            const dd = rng() * 18 + 4;
            const dh = rng() * 16 + 2;
            const c  = [0x2e2416, 0x262626, 0x1c1c1e, 0x301e10];
            const ci = Math.floor(rng() * c.length);
            this.isoBox(dx, dy, dw, dd, dh, c[ci], c[(ci + 1) % c.length],
                Phaser.Display.Color.ValueToColor(c[ci]).lighten(6).color);
        }
    }

    private debrisPile(wx: number, wy: number, pw: number, pd: number, ph: number, rng: () => number) {
        const c = 0x241e14;
        this.isoBox(wx, wy, pw, pd, ph, c, 0x181410, Phaser.Display.Color.ValueToColor(c).lighten(10).color);
        for (let i = 0; i < 3; i++) {
            this.isoBox(
                wx + (rng() - 0.5) * pw * 1.4,
                wy + (rng() - 0.5) * pd * 1.4,
                pw * 0.28, pd * 0.28, ph * 0.28 + 2,
                0x1c1a12, 0x121008, 0x242016,
            );
        }
    }

    // =========================================================================
    // Atmosfera
    // =========================================================================

    private drawAtmosphere() {
        // Rachaduras no asfalto
        for (let i = 0; i < 80; i++) {
            const cx = (Math.random() - 0.5) * 3200;
            const cy = (Math.random() - 0.5) * 3200;
            this.crack(cx, cy);
        }
        // Manchas de queimado / óleo
        for (let i = 0; i < 40; i++) {
            const cx = (Math.random() - 0.5) * 3200;
            const cy = (Math.random() - 0.5) * 3200;
            const { isoX, isoY } = cartesianToIso(cx, cy);
            const r = 20 + Math.random() * 50;
            this.g.fillStyle(0x050505, 0.3 + Math.random() * 0.35);
            this.g.fillEllipse(isoX, isoY, r * 2, r * 0.55);
        }
        // Lixo espalhado (pontinhos)
        for (let i = 0; i < 200; i++) {
            const cx = (Math.random() - 0.5) * 3000;
            const cy = (Math.random() - 0.5) * 3000;
            const { isoX, isoY } = cartesianToIso(cx, cy);
            this.g.fillStyle([0x2a2418, 0x1e1c14, 0x241e18][Math.floor(Math.random() * 3)], 0.8);
            this.g.fillRect(isoX, isoY, Math.random() * 4 + 1, Math.random() * 3 + 1);
        }
    }

    private crack(cx: number, cy: number) {
        const segs = Math.floor(Math.random() * 5) + 2;
        let x = cx, y = cy;
        this.g.lineStyle(1, 0x0e0e0e, 0.55);
        this.g.beginPath();
        const start = cartesianToIso(x, y);
        this.g.moveTo(start.isoX, start.isoY);
        for (let i = 0; i < segs; i++) {
            x += (Math.random() - 0.5) * 45;
            y += (Math.random() - 0.5) * 45;
            const { isoX, isoY } = cartesianToIso(x, y);
            this.g.lineTo(isoX, isoY);
        }
        this.g.strokePath();
    }

    // =========================================================================
    // Primitivos de baixo nível
    // =========================================================================

    /** Tile flat (paralelogramo isométrico) */
    private isoTile(wx: number, wy: number, w: number, d: number, color: number) {
        const p = [
            cartesianToIso(wx,     wy),
            cartesianToIso(wx + w, wy),
            cartesianToIso(wx + w, wy + d),
            cartesianToIso(wx,     wy + d),
        ];
        this.g.fillStyle(color, 1);
        this.g.beginPath();
        this.g.moveTo(p[0].isoX, p[0].isoY);
        p.slice(1).forEach(v => this.g.lineTo(v.isoX, v.isoY));
        this.g.closePath();
        this.g.fillPath();
    }

    /**
     * Caixa isométrica pseudo-3D.
     * Renderiza: topo + face esquerda (mais clara) + face direita (mais escura).
     * A ilusão de profundidade vem da diferença de luminosidade entre as faces.
     */
    private isoBox(
        wx: number, wy: number,
        bw: number, bd: number, bh: number,
        leftFace: number, rightFace: number, topFace: number,
    ) {
        if (bh <= 0) return;

        // Vértices da base
        const tl = cartesianToIso(wx,      wy);
        const tr = cartesianToIso(wx + bw, wy);
        const br = cartesianToIso(wx + bw, wy + bd);
        const bl = cartesianToIso(wx,      wy + bd);

        // ── Topo ──
        this.g.fillStyle(topFace, 1);
        this.g.beginPath();
        this.g.moveTo(tl.isoX, tl.isoY - bh);
        this.g.lineTo(tr.isoX, tr.isoY - bh);
        this.g.lineTo(br.isoX, br.isoY - bh);
        this.g.lineTo(bl.isoX, bl.isoY - bh);
        this.g.closePath();
        this.g.fillPath();

        // ── Face esquerda (W→S, mais exposta) ──
        this.g.fillStyle(leftFace, 1);
        this.g.beginPath();
        this.g.moveTo(bl.isoX, bl.isoY - bh);
        this.g.lineTo(br.isoX, br.isoY - bh);
        this.g.lineTo(br.isoX, br.isoY);
        this.g.lineTo(bl.isoX, bl.isoY);
        this.g.closePath();
        this.g.fillPath();

        // ── Face direita (N→E, em sombra) ──
        this.g.fillStyle(rightFace, 1);
        this.g.beginPath();
        this.g.moveTo(tr.isoX, tr.isoY - bh);
        this.g.lineTo(br.isoX, br.isoY - bh);
        this.g.lineTo(br.isoX, br.isoY);
        this.g.lineTo(tr.isoX, tr.isoY);
        this.g.closePath();
        this.g.fillPath();

        // ── Aresta de silhueta (contorno fino do topo) ──
        this.g.lineStyle(0.5, 0x000000, 0.25);
        this.g.strokePoints([
            { x: tl.isoX, y: tl.isoY - bh },
            { x: tr.isoX, y: tr.isoY - bh },
            { x: br.isoX, y: br.isoY - bh },
            { x: bl.isoX, y: bl.isoY - bh },
        ], true);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private makeRng(seed: number) {
        let s = seed + 1;
        return () => {
            s = (s * 16807) % 2147483647;
            return (s - 1) / 2147483646;
        };
    }
}