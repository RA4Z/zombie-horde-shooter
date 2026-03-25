import { cartesianToIso } from '../utils/IsoMath';

/**
 * CityWorld — cidade pós-apocalíptica renderizada com Graphics Phaser.
 *
 * FIX: Sistema de layers/depth corrigido.
 *
 * Problema anterior: todo o cenário era um único Graphics com depth -500,
 * então players e zumbis (depth = isoY, sempre positivo) ficavam sempre
 * na frente de tudo, inclusive de prédios altos.
 *
 * Solução: separamos o mundo em 3 camadas de Graphics:
 *   gGround  (depth -500)  — chão, ruas, calçadas
 *   gWorld   (depth  0  )  — base dos prédios / decorações ao nível do chão
 *   gRoof    (depth varia) — fachadas e telhados dos prédios
 *
 * Cada prédio recebe um Rectangle invisível (depthMarker) cujo depth é
 * calculado como isoY_base + altura_visual, de forma que um objeto que
 * passa "atrás" do prédio (isoY menor) fique com depth menor → desenhado
 * antes → coberto pela fachada do prédio.
 *
 * O gRoof é desenhado em múltiplos Graphics, um por prédio, cada um com
 * seu depth correto. Isso usa mais draw calls, mas é a única forma de
 * intercalar o depth de objetos dinâmicos com o dos prédios numa cena
 * Phaser que não suporta painters-sort automático entre Graphics e outros
 * GameObjects.
 */
export class CityWorld {
    // Camadas estáticas
    private gGround!: Phaser.GameObjects.Graphics; // chão e ruas
    private gBase!:   Phaser.GameObjects.Graphics; // objetos ao nível do chão

    // Lista de Graphics de prédios (um por prédio, com depth correto)
    private buildingGraphics: Phaser.GameObjects.Graphics[] = [];

    private static readonly T = 64;

    constructor(private scene: Phaser.Scene) {}

    build() {
        // Camada do chão — sempre atrás de tudo
        this.gGround = this.scene.add.graphics().setDepth(-500);
        // Camada de base (estacionamentos, escombros, postes) — ao nível do chão
        this.gBase   = this.scene.add.graphics().setDepth(-1);

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
                const n  = Math.sin(wx * 0.004 + wy * 0.007) * 5;
                const c  = 26 + Math.round(n);
                this.isoTile(this.gGround, wx, wy, T, T, Phaser.Display.Color.GetColor(c, c, c - 1));
            }
        }
    }

    // =========================================================================
    // Ruas
    // =========================================================================

    private drawRoads() {
        const T     = CityWorld.T;
        const BLOCK = 4;
        const ROAD  = 2;
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

                this.isoTile(this.gGround, wx, wy, T, T, isInt ? 0x1c1c1c : 0x191919);

                if (!isInt) {
                    const steps = 6;
                    for (let s = 0; s < steps; s++) {
                        const t = (s / steps + 0.1);
                        const t2 = t + 0.06;
                        if (isRX) {
                            const { isoX: ax, isoY: ay } = cartesianToIso(wx + t * T, wy + T / 2);
                            const { isoX: bx, isoY: by } = cartesianToIso(wx + t2 * T, wy + T / 2);
                            this.gGround.lineStyle(1, 0x3a3a28, 0.6);
                            this.gGround.beginPath(); this.gGround.moveTo(ax, ay); this.gGround.lineTo(bx, by); this.gGround.strokePath();
                        } else {
                            const { isoX: ax, isoY: ay } = cartesianToIso(wx + T / 2, wy + t * T);
                            const { isoX: bx, isoY: by } = cartesianToIso(wx + T / 2, wy + t2 * T);
                            this.gGround.lineStyle(1, 0x3a3a28, 0.6);
                            this.gGround.beginPath(); this.gGround.moveTo(ax, ay); this.gGround.lineTo(bx, by); this.gGround.strokePath();
                        }
                    }

                    const SW = 5;
                    if (isRX) {
                        this.isoTile(this.gGround, wx, wy,          T, SW, 0x303030);
                        this.isoTile(this.gGround, wx, wy + T - SW, T, SW, 0x303030);
                    } else {
                        this.isoTile(this.gGround, wx,         wy, SW, T, 0x303030);
                        this.isoTile(this.gGround, wx + T - SW, wy, SW, T, 0x303030);
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

                // Postes — desenhados no gBase (decoração ao nível do chão)
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

    /**
     * FIX: Cada prédio cria seu próprio Graphics com depth = isoY_frente + altura.
     * Isso garante que um player que passa por trás do prédio (isoY menor) fique
     * com depth menor que o prédio → é desenhado atrás da fachada.
     */
    private building(wx: number, wy: number, bw: number, bd: number, bh: number, destroyed: boolean, rng: () => number) {
        const palettes = [
            { side: 0x252530, dark: 0x1a1a20, top: 0x2e2e3a },
            { side: 0x221e1a, dark: 0x181410, top: 0x2c2622 },
            { side: 0x1a2020, dark: 0x141818, top: 0x222a2a },
            { side: 0x28201a, dark: 0x1c1610, top: 0x342a20 },
        ];
        const pal = this.pick(palettes, rng);

        // FIX: calcula o depth do prédio a partir da borda da frente (isoY mais alto)
        // A frente do prédio em isométrico é o vértice (wx, wy+bd) e (wx+bw, wy+bd)
        // → depth = isoY dessa borda. Objetos que passam "atrás" terão isoY menor.
        const frontIsoY = cartesianToIso(wx + bw / 2, wy + bd).isoY;
        // Adicionar a altura visual: quanto mais alto o prédio, mais ele cobre objetos
        // que estão "atrás" dele mesmo estando em isoY próximos.
        const buildingDepth = frontIsoY + bh * 0.5;

        // Cria um Graphics dedicado para este prédio com o depth correto
        const g = this.scene.add.graphics().setDepth(buildingDepth);
        this.buildingGraphics.push(g);

        this.isoBoxG(g, wx, wy, bw, bd, bh, pal.side, pal.dark, pal.top);

        if (!destroyed) {
            this.buildingWindowsG(g, wx, wy, bw, bd, bh, rng);
        } else {
            this.debrisG(g, wx, wy, bw, bd, rng);
            const { isoX, isoY } = cartesianToIso(wx + bw / 2, wy + bd / 2);
            g.fillStyle(0x050505, 0.35);
            g.fillEllipse(isoX, isoY, bw * 1.2, bd * 0.5);
        }
    }

    private buildingWindowsG(g: Phaser.GameObjects.Graphics, wx: number, wy: number, bw: number, bd: number, bh: number, rng: () => number) {
        const cols = Math.max(1, Math.floor(bw / 20));
        const rows = Math.max(1, Math.floor(bh / 22));
        const wW = 10, wH = 14;
        const padX = (bw - cols * wW) / (cols + 1);
        const padY = 10;

        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                const local_wx = wx + padX + c * (wW + padX);
                const local_wy = wy + bd;
                const wTop     = bh - padY - r * (wH + 8);
                if (wTop < wH) continue;

                const lit    = rng() < 0.12;
                const broken = rng() < 0.22;
                const wCol   = broken ? 0x0c0c0c : lit ? 0xcc9922 : 0x0a0a12;

                const { isoX: px, isoY: py } = cartesianToIso(local_wx, local_wy);
                g.fillStyle(wCol, 0.85);
                const fx = px + c * 0.1;
                g.fillRect(fx, py - wTop, wW * 0.55, wH * 0.55);

                if (lit) {
                    g.fillStyle(0xcc9922, 0.07);
                    g.fillCircle(fx + wW * 0.25, py - wTop, 16);
                }
            }
        }
    }

    // ── Estacionamento ────────────────────────────────────────────────────────

    private blockParking(ox: number, oy: number, T: number, size: number, rng: () => number) {
        const total = size * T;
        this.isoTile(this.gBase, ox, oy, total, total, 0x202020);

        const lanes = Math.floor(rng() * 2) + 2;
        for (let lane = 0; lane < lanes; lane++) {
            const lx = ox + (lane / lanes) * total;
            const spots = Math.floor(rng() * 3) + 2;
            for (let s = 0; s < spots; s++) {
                const sy = oy + (s / spots) * total;
                const sw = T * 0.7, sd = T * 0.9;
                this.gBase.lineStyle(1, 0x3a3a28, 0.5);
                const pts = [
                    cartesianToIso(lx,      sy),
                    cartesianToIso(lx + sw, sy),
                    cartesianToIso(lx + sw, sy + sd),
                    cartesianToIso(lx,      sy + sd),
                ];
                this.gBase.strokePoints(pts.map(p => ({ x: p.isoX, y: p.isoY })), true);

                if (rng() < 0.65) this.carG(this.gBase, lx + sw * 0.05, sy + sd * 0.05, sw * 0.9, sd * 0.9, rng);
            }
        }

        // Mureta de contenção — precisa de depth para ficar acima do chão
        const muretaFrontY = cartesianToIso(ox + (size * T) / 2, oy + size * T).isoY;
        const gMureta = this.scene.add.graphics().setDepth(muretaFrontY + 4);
        this.buildingGraphics.push(gMureta);
        this.isoBoxG(gMureta, ox, oy, total, 5, 8, 0x3a3a3a, 0x282828, 0x484848);
        this.isoBoxG(gMureta, ox, oy + total - 5, total, 5, 8, 0x3a3a3a, 0x282828, 0x484848);
    }

    // ── Escombros ─────────────────────────────────────────────────────────────

    private blockRubble(ox: number, oy: number, T: number, size: number, rng: () => number) {
        const total = size * T;
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const v = Math.floor(rng() * 8);
                this.isoTile(this.gBase, ox + i * T, oy + j * T, T, T,
                    Phaser.Display.Color.GetColor(18 + v, 15 + v, 12 + v));
            }
        }

        const piles = Math.floor(rng() * 8) + 4;
        for (let i = 0; i < piles; i++) {
            const rx = ox + rng() * total;
            const ry = oy + rng() * total;
            const pw = rng() * T * 0.7 + T * 0.15;
            const ph = rng() * 30 + 6;
            // Cada pilha de escombro com seu depth
            const pileFrontY = cartesianToIso(rx + pw / 2, ry + pw * 0.65).isoY;
            const gPile = this.scene.add.graphics().setDepth(pileFrontY + ph * 0.5);
            this.buildingGraphics.push(gPile);
            this.debrisPileG(gPile, rx, ry, pw, pw * 0.65, ph, rng);
        }

        if (rng() < 0.5) {
            const { isoX, isoY } = cartesianToIso(ox + rng() * total, oy + rng() * total);
            const r2 = rng() * 28 + 12;
            this.gBase.fillStyle(0x08080f, 0.65);
            this.gBase.fillEllipse(isoX, isoY, r2 * 2, r2 * 0.55);
            this.gBase.fillStyle(0x1a2233, 0.12);
            this.gBase.fillEllipse(isoX + 4, isoY - 3, r2 * 0.6, r2 * 0.2);
        }

        if (rng() < 0.4) {
            const rw = rng() * T + T * 0.5;
            const rd = T * 0.3;
            const rh = rng() * 50 + 20;
            const rx = ox + rng() * (total - rw);
            const ry = oy + rng() * (total - rd);
            const strFrontY = cartesianToIso(rx + rw / 2, ry + rd).isoY;
            const gStr = this.scene.add.graphics().setDepth(strFrontY + rh * 0.5);
            this.buildingGraphics.push(gStr);
            this.isoBoxG(gStr, rx, ry, rw, rd, rh, 0x1e1c18, 0x141210, 0x2a2820);
        }
    }

    // ── Carro ─────────────────────────────────────────────────────────────────

    private carG(g: Phaser.GameObjects.Graphics, wx: number, wy: number, cw: number, cd: number, rng: () => number) {
        const bodyPal = [0x14141e, 0x1e1010, 0x101e10, 0x201a08, 0x0e0e0e];
        const bCol = this.pick(bodyPal, rng);
        const tCol = Phaser.Display.Color.ValueToColor(bCol).lighten(10).color;
        const bH = cw * 0.55;

        this.isoBoxG(g, wx, wy, cw, cd, bH, bCol, bCol, tCol);
        const cabW = cw * 0.65, cabD = cd * 0.5;
        this.isoBoxG(g, wx + (cw - cabW) / 2, wy + (cd - cabD) / 2,
            cabW, cabD, bH * 1.45,
            tCol,
            Phaser.Display.Color.ValueToColor(tCol).darken(10).color,
            Phaser.Display.Color.ValueToColor(tCol).lighten(8).color,
        );
        const wW = cw * 0.15, wD = cd * 0.18, wH = bH * 0.22;
        for (const [ox2, oy2] of [[0, 0], [cw - wW, 0], [0, cd - wD], [cw - wW, cd - wD]]) {
            this.isoBoxG(g, wx + ox2, wy + oy2, wW, wD, wH, 0x080808, 0x050505, 0x111111);
        }
        const { isoX: hx, isoY: hy } = cartesianToIso(wx + cw, wy + cd * 0.25);
        g.fillStyle(rng() < 0.3 ? 0x333322 : 0x111108, 0.8);
        g.fillRect(hx - 3, hy - bH * 0.3, 5, 4);
    }

    // ── Poste ─────────────────────────────────────────────────────────────────

    private streetlight(wx: number, wy: number, on: boolean) {
        const { isoX, isoY } = cartesianToIso(wx, wy);
        const pH = 85;
        // Poste tem depth baseado em sua posição
        const g = this.scene.add.graphics().setDepth(isoY + pH);
        this.buildingGraphics.push(g);

        g.lineStyle(2, 0x2a3028, 1);
        g.beginPath();
        g.moveTo(isoX, isoY);
        g.lineTo(isoX, isoY - pH);
        g.strokePath();

        g.lineStyle(2, 0x2a3028, 1);
        g.beginPath();
        g.moveTo(isoX, isoY - pH);
        g.lineTo(isoX + 16, isoY - pH + 8);
        g.strokePath();

        const lx = isoX + 16, ly = isoY - pH + 8;

        if (on) {
            g.fillStyle(0xffeebb, 1);
            g.fillEllipse(lx, ly, 8, 5);
            g.fillStyle(0xffee88, 0.035);
            g.fillTriangle(lx - 4, ly + 2, lx + 4, ly + 2, lx, ly + 90);
            g.fillStyle(0xffdd66, 0.06);
            g.fillCircle(lx, ly, 28);
        } else {
            g.fillStyle(0x222218, 1);
            g.fillEllipse(lx, ly, 7, 4);
        }
    }

    // ── Destroços ─────────────────────────────────────────────────────────────

    private debrisG(g: Phaser.GameObjects.Graphics, wx: number, wy: number, bw: number, bd: number, rng: () => number) {
        const pcs = Math.floor(rng() * 7) + 3;
        for (let i = 0; i < pcs; i++) {
            const dx = wx + (rng() - 0.3) * bw * 1.6;
            const dy = wy + (rng() - 0.3) * bd * 1.6;
            const dw = rng() * 22 + 5;
            const dd = rng() * 18 + 4;
            const dh = rng() * 16 + 2;
            const c  = [0x2e2416, 0x262626, 0x1c1c1e, 0x301e10];
            const ci = Math.floor(rng() * c.length) % c.length;
            this.isoBoxG(g, dx, dy, dw, dd, dh, c[ci], c[(ci + 1) % c.length],
                Phaser.Display.Color.ValueToColor(c[ci]).lighten(6).color);
        }
    }

    private debrisPileG(g: Phaser.GameObjects.Graphics, wx: number, wy: number, pw: number, pd: number, ph: number, rng: () => number) {
        const c = 0x241e14;
        this.isoBoxG(g, wx, wy, pw, pd, ph, c, 0x181410, Phaser.Display.Color.ValueToColor(c).lighten(10).color);
        for (let i = 0; i < 3; i++) {
            this.isoBoxG(g,
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
        for (let i = 0; i < 80; i++) {
            const cx = (Math.random() - 0.5) * 3200;
            const cy = (Math.random() - 0.5) * 3200;
            this.crack(cx, cy);
        }
        for (let i = 0; i < 40; i++) {
            const cx = (Math.random() - 0.5) * 3200;
            const cy = (Math.random() - 0.5) * 3200;
            const { isoX, isoY } = cartesianToIso(cx, cy);
            const r = 20 + Math.random() * 50;
            this.gGround.fillStyle(0x050505, 0.3 + Math.random() * 0.35);
            this.gGround.fillEllipse(isoX, isoY, r * 2, r * 0.55);
        }
        for (let i = 0; i < 200; i++) {
            const cx = (Math.random() - 0.5) * 3000;
            const cy = (Math.random() - 0.5) * 3000;
            const { isoX, isoY } = cartesianToIso(cx, cy);
            const lixoCols = [0x2a2418, 0x1e1c14, 0x241e18];
            this.gGround.fillStyle(lixoCols[Math.floor(Math.random() * lixoCols.length) % lixoCols.length], 0.8);
            this.gGround.fillRect(isoX, isoY, Math.random() * 4 + 1, Math.random() * 3 + 1);
        }
    }

    private crack(cx: number, cy: number) {
        const segs = Math.floor(Math.random() * 5) + 2;
        let x = cx, y = cy;
        this.gGround.lineStyle(1, 0x0e0e0e, 0.55);
        this.gGround.beginPath();
        const start = cartesianToIso(x, y);
        this.gGround.moveTo(start.isoX, start.isoY);
        for (let i = 0; i < segs; i++) {
            x += (Math.random() - 0.5) * 45;
            y += (Math.random() - 0.5) * 45;
            const { isoX, isoY } = cartesianToIso(x, y);
            this.gGround.lineTo(isoX, isoY);
        }
        this.gGround.strokePath();
    }

    // =========================================================================
    // Primitivos de baixo nível
    // =========================================================================

    /** Tile flat num Graphics específico */
    private isoTile(g: Phaser.GameObjects.Graphics, wx: number, wy: number, w: number, d: number, color: number) {
        const p = [
            cartesianToIso(wx,     wy),
            cartesianToIso(wx + w, wy),
            cartesianToIso(wx + w, wy + d),
            cartesianToIso(wx,     wy + d),
        ];
        g.fillStyle(color, 1);
        g.beginPath();
        g.moveTo(p[0].isoX, p[0].isoY);
        p.slice(1).forEach(v => g.lineTo(v.isoX, v.isoY));
        g.closePath();
        g.fillPath();
    }

    /** Caixa isométrica pseudo-3D num Graphics específico */
    private isoBoxG(
        g: Phaser.GameObjects.Graphics,
        wx: number, wy: number,
        bw: number, bd: number, bh: number,
        leftFace: number, rightFace: number, topFace: number,
    ) {
        if (bh <= 0) return;

        const tl = cartesianToIso(wx,      wy);
        const tr = cartesianToIso(wx + bw, wy);
        const br = cartesianToIso(wx + bw, wy + bd);
        const bl = cartesianToIso(wx,      wy + bd);

        // Topo
        g.fillStyle(topFace, 1);
        g.beginPath();
        g.moveTo(tl.isoX, tl.isoY - bh);
        g.lineTo(tr.isoX, tr.isoY - bh);
        g.lineTo(br.isoX, br.isoY - bh);
        g.lineTo(bl.isoX, bl.isoY - bh);
        g.closePath();
        g.fillPath();

        // Face esquerda
        g.fillStyle(leftFace, 1);
        g.beginPath();
        g.moveTo(bl.isoX, bl.isoY - bh);
        g.lineTo(br.isoX, br.isoY - bh);
        g.lineTo(br.isoX, br.isoY);
        g.lineTo(bl.isoX, bl.isoY);
        g.closePath();
        g.fillPath();

        // Face direita
        g.fillStyle(rightFace, 1);
        g.beginPath();
        g.moveTo(tr.isoX, tr.isoY - bh);
        g.lineTo(br.isoX, br.isoY - bh);
        g.lineTo(br.isoX, br.isoY);
        g.lineTo(tr.isoX, tr.isoY);
        g.closePath();
        g.fillPath();

        // Aresta de silhueta
        g.lineStyle(0.5, 0x000000, 0.25);
        g.strokePoints([
            { x: tl.isoX, y: tl.isoY - bh },
            { x: tr.isoX, y: tr.isoY - bh },
            { x: br.isoX, y: br.isoY - bh },
            { x: bl.isoX, y: bl.isoY - bh },
        ], true);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private pick<T>(arr: T[], rng: () => number): T {
        return arr[Math.floor(rng() * arr.length) % arr.length];
    }

    private makeRng(seed: number) {
        let s = (seed ^ 0xdeadbeef) >>> 0 || 1;
        return () => {
            s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
            s = s >>> 0;
            return s / 4294967296;
        };
    }
}