import { cartesianToIso } from '../utils/IsoMath';

/**
 * CityWorld — cidade pós-apocalíptica isométrica.
 *
 * REDESIGN COMPLETO:
 *
 * 1. COLISÃO CONFIÁVEL — CityWorld agora é a única fonte de verdade sobre
 *    quais células são sólidas. Game.ts não recria o layout; ele pede a lista
 *    via getWallRects(). Isso elimina o dessincronismo entre visual e hitbox.
 *
 * 2. GRID DETERMINÍSTICO — quarteirões de tamanho fixo em grade regular.
 *    Cada célula do grid é ou ROAD ou BLOCK. Blocks têm tipo (building /
 *    parking / rubble). Spawn points são gerados nas células ROAD.
 *
 * 3. ANTI-SPAWN-INSIDE — getSpawnPoints() retorna coordenadas cartesianas
 *    garantidamente em células de rua, longe do player.
 *
 * 4. ESTILO — ruas com calçadas claras, prédios mais variados e coloridos,
 *    janelas maiores, postes funcionando.
 */
export class CityWorld {
    // ── Constantes de layout ──────────────────────────────────────────────────
    /** Tamanho de um tile cartesiano em px */
    static readonly T        = 64;
    /** Tiles por quarteirão (lado) */
    static readonly BLOCK_SZ = 4;
    /** Tiles de rua entre quarteirões */
    static readonly ROAD_SZ  = 2;
    /** Tamanho de uma célula do supergrid (quarteirão + rua) */
    static readonly CELL_SZ  = CityWorld.BLOCK_SZ + CityWorld.ROAD_SZ; // 6
    /** Quantas células do supergrid em cada direção */
    static readonly GRID_R   = 4; // −4 a +4 → 9×9 células = ~576×576 tiles

    // ── Graphics layers ───────────────────────────────────────────────────────
    private gGround!: Phaser.GameObjects.Graphics;
    private gDeco!:   Phaser.GameObjects.Graphics;
    private buildingGfx: Phaser.GameObjects.Graphics[] = [];

    // ── Dados de colisão ──────────────────────────────────────────────────────
    /**
     * Lista de retângulos sólidos em coordenadas CARTESIANAS.
     * Cada entrada representa um quarteirão (ou sub-bloco) sólido.
     * Game.ts usa isso para criar StaticBodies com a posição exata.
     */
    private wallRects: Array<{ x: number; y: number; w: number; h: number }> = [];

    /**
     * Células que são estrada (em coordenadas de supergrid).
     * Usadas para gerar spawn points seguros.
     */
    private roadCells: Array<{ cx: number; cy: number }> = [];

    constructor(private scene: Phaser.Scene) {}

    // =========================================================================
    // API pública
    // =========================================================================

    build() {
        this.gGround = this.scene.add.graphics().setDepth(-500);
        this.gDeco   = this.scene.add.graphics().setDepth(-1);

        this.buildLayout();
        this.drawAtmosphere();
    }

    /**
     * Retorna os retângulos sólidos (cartesianos) para o Game criar hitboxes.
     * DEVE ser chamado APÓS build().
     */
    getWallRects(): Array<{ x: number; y: number; w: number; h: number }> {
        return this.wallRects;
    }

    /**
     * Retorna coordenadas cartesianas de spawn seguras (em ruas),
     * filtrando pontos perto do player.
     */
    getSpawnPoints(playerX: number, playerY: number, minDist = 300, count = 8):
        Array<{ x: number; y: number }> {
        const T = CityWorld.T;
        const SZ = CityWorld.ROAD_SZ * T;

        const candidates: Array<{ x: number; y: number; dist: number }> = [];

        for (const { cx, cy } of this.roadCells) {
            // Centro da célula de rua (em cartesiano)
            const wx = cx * CityWorld.CELL_SZ * T + T;
            const wy = cy * CityWorld.CELL_SZ * T + T;
            const dist = Math.hypot(wx - playerX, wy - playerY);
            if (dist >= minDist) {
                candidates.push({ x: wx, y: wy, dist });
            }
        }

        // Ordena por distância e pega os mais próximos (mas não perto demais)
        candidates.sort((a, b) => a.dist - b.dist);
        return candidates.slice(0, count).map(c => ({ x: c.x, y: c.y }));
    }

    // =========================================================================
    // Layout principal
    // =========================================================================

    private buildLayout() {
        const T    = CityWorld.T;
        const BS   = CityWorld.BLOCK_SZ;
        const RS   = CityWorld.ROAD_SZ;
        const CS   = CityWorld.CELL_SZ;
        const R    = CityWorld.GRID_R;

        // Chão base — um único tile grande
        const worldHalf = R * CS * T + BS * T;
        this.drawGroundBase(worldHalf);

        for (let gx = -R; gx <= R; gx++) {
            for (let gy = -R; gy <= R; gy++) {
                // Origem cartesiana do supergrid (inclui rua)
                const ox = gx * CS * T;
                const oy = gy * CS * T;

                // Rua horizontal (Y fixo, X varia)
                this.drawRoad(ox, oy, BS * T, RS * T, true);
                // Rua vertical (X fixo, Y varia)
                this.drawRoad(ox, oy, RS * T, BS * T, false);
                // Registro como road cell
                this.roadCells.push({ cx: gx, cy: gy });

                // Quarteirão (deslocado pela rua)
                const bx = ox + RS * T;
                const by = oy + RS * T;
                this.buildBlock(bx, by, BS * T, gx, gy);
            }
        }
    }

    // ── Chão ─────────────────────────────────────────────────────────────────

    private drawGroundBase(half: number) {
        const T  = CityWorld.T;
        const sq = Math.ceil(half / T) + 2;

        for (let gx = -sq; gx <= sq; gx++) {
            for (let gy = -sq; gy <= sq; gy++) {
                const wx = gx * T, wy = gy * T;
                const n  = Math.sin(wx * 0.005 + wy * 0.009) * 6;
                const c  = 20 + Math.round(Math.abs(n));
                this.isoTile(this.gGround, wx, wy, T, T,
                    Phaser.Display.Color.GetColor(c, c, c - 2));
            }
        }
    }

    // ── Ruas ──────────────────────────────────────────────────────────────────

    private drawRoad(ox: number, oy: number, rw: number, rd: number, horizontal: boolean) {
        const T   = CityWorld.T;
        const CW  = 4; // largura da calçada

        // Asfalto
        this.isoTile(this.gGround, ox, oy, rw, rd, 0x1a1a1a);

        // Calçadas nas bordas
        if (horizontal) {
            this.isoTile(this.gGround, ox, oy,        rw, CW, 0x343430);
            this.isoTile(this.gGround, ox, oy + rd - CW, rw, CW, 0x343430);
            // Linha central tracejada
            this.drawDashes(ox, oy + rd / 2, rw, rd, true);
        } else {
            this.isoTile(this.gGround, ox,        oy, CW, rd, 0x343430);
            this.isoTile(this.gGround, ox + rw - CW, oy, CW, rd, 0x343430);
            this.drawDashes(ox + rw / 2, oy, rw, rd, false);
        }
    }

    private drawDashes(cx: number, cy: number, rw: number, rd: number, horizontal: boolean) {
        const steps = 10;
        const len   = (horizontal ? rw : rd);
        const dashL = len / steps * 0.45;
        const gap   = len / steps * 0.55;

        this.gGround.lineStyle(1, 0x3a3a28, 0.55);
        for (let i = 0; i < steps; i++) {
            const t  = i / steps * len;
            const t2 = t + dashL;
            if (horizontal) {
                const a = cartesianToIso(cx + t  - rw / 2, cy);
                const b = cartesianToIso(cx + t2 - rw / 2, cy);
                this.gGround.beginPath();
                this.gGround.moveTo(a.isoX, a.isoY);
                this.gGround.lineTo(b.isoX, b.isoY);
                this.gGround.strokePath();
            } else {
                const a = cartesianToIso(cx, cy + t  - rd / 2);
                const b = cartesianToIso(cx, cy + t2 - rd / 2);
                this.gGround.beginPath();
                this.gGround.moveTo(a.isoX, a.isoY);
                this.gGround.lineTo(b.isoX, b.isoY);
                this.gGround.strokePath();
            }
        }
    }

    // ── Quarteirões ───────────────────────────────────────────────────────────

    private buildBlock(ox: number, oy: number, size: number, gx: number, gy: number) {
        const seed = gx * 137 + gy * 1009 + 42;
        const rng  = this.makeRng(seed);
        const type = rng();

        if (type < 0.55) {
            this.blockBuildings(ox, oy, size, rng);
        } else if (type < 0.78) {
            this.blockParking(ox, oy, size, rng);
        } else {
            this.blockRubble(ox, oy, size, rng);
        }

        // Postes nos cantos das ruas
        const T = CityWorld.T;
        const RS = CityWorld.ROAD_SZ * T;
        const pOff = 12;
        this.streetlight(ox - RS + pOff, oy - RS + pOff, rng() < 0.7);
        this.streetlight(ox + size - pOff, oy - RS + pOff, rng() < 0.6);
        this.streetlight(ox - RS + pOff, oy + size - pOff, rng() < 0.6);
    }

    // ── Prédios ───────────────────────────────────────────────────────────────

    private blockBuildings(ox: number, oy: number, size: number, rng: () => number) {
        const T  = CityWorld.T;

        // Divide o quarteirão em 1-4 prédios lado a lado
        const cols = Math.floor(rng() * 2) + 1; // 1 ou 2 colunas
        const colW = size / cols;

        for (let c = 0; c < cols; c++) {
            const bx = ox + c * colW;
            const bw = colW - (c < cols - 1 ? 4 : 0); // pequena separação
            const bd = size - (rng() < 0.4 ? T * 0.5 : 0);
            const destroyed = rng() < 0.2;
            const rawH = 50 + rng() * 100;
            const bh   = destroyed ? rawH * (0.2 + rng() * 0.35) : rawH;

            this.building(bx, oy, bw, bd, bh, destroyed, rng);

            // Registra colisão: bloco inteiro do prédio (cartesiano)
            this.wallRects.push({ x: bx, y: oy, w: bw, h: bd });
        }
    }

    private building(
        wx: number, wy: number,
        bw: number, bd: number, bh: number,
        destroyed: boolean,
        rng: () => number,
    ) {
        const palettes = [
            { side: 0x2e3040, dark: 0x1e2030, top: 0x383a50 }, // azul escuro
            { side: 0x302820, dark: 0x201a12, top: 0x3c3028 }, // marrom
            { side: 0x203028, dark: 0x14201a, top: 0x283c30 }, // verde musgo
            { side: 0x383030, dark: 0x241e1e, top: 0x443a3a }, // cinza rosado
            { side: 0x282030, dark: 0x181420, top: 0x322838 }, // roxo escuro
        ];
        const pal = this.pick(palettes, rng);

        const frontIsoY  = cartesianToIso(wx + bw / 2, wy + bd).isoY;
        const buildDepth = frontIsoY + bh * 0.6;

        const g = this.scene.add.graphics().setDepth(buildDepth);
        this.buildingGfx.push(g);

        this.isoBoxG(g, wx, wy, bw, bd, bh, pal.side, pal.dark, pal.top);

        if (!destroyed) {
            this.buildingWindowsG(g, wx, wy, bw, bd, bh, rng);
        } else {
            this.debrisG(g, wx, wy, bw, bd, rng);
        }
    }

    private buildingWindowsG(
        g: Phaser.GameObjects.Graphics,
        wx: number, wy: number,
        bw: number, bd: number, bh: number,
        rng: () => number,
    ) {
        const cols = Math.max(1, Math.floor(bw / 18));
        const rows = Math.max(1, Math.floor(bh / 20));
        const wW   = 12, wH = 16;
        const padX = (bw - cols * wW) / (cols + 1);

        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                const lwx  = wx + padX + c * (wW + padX);
                const lwy  = wy + bd; // frente do prédio
                const wTop = bh - 12 - r * (wH + 6);
                if (wTop < wH) continue;

                const lit    = rng() < 0.15;
                const broken = rng() < 0.18;
                const wCol   = broken ? 0x0c0c0c : lit ? 0xd4a030 : 0x080a14;

                const { isoX: px, isoY: py } = cartesianToIso(lwx, lwy);
                // Janela na face frontal
                g.fillStyle(wCol, lit ? 0.9 : 0.75);
                g.fillRect(px + c * 0.5, py - wTop, wW * 0.6, wH * 0.6);

                if (lit) {
                    g.fillStyle(0xd4a030, 0.08);
                    g.fillCircle(px + c * 0.5 + wW * 0.3, py - wTop + wH * 0.3, 14);
                }

                // Mesma janela na face lateral (wx, wy)
                const { isoX: px2, isoY: py2 } = cartesianToIso(wx, lwy - wW * c * 0.3);
                g.fillStyle(wCol, lit ? 0.7 : 0.5);
                g.fillRect(px2, py2 - wTop + r * 0.5, wW * 0.35, wH * 0.5);
            }
        }
    }

    // ── Estacionamento ────────────────────────────────────────────────────────

    private blockParking(ox: number, oy: number, size: number, rng: () => number) {
        const T = CityWorld.T;
        this.isoTile(this.gDeco, ox, oy, size, size, 0x1e1e1e);

        // Linhas de vagas
        const spots = Math.floor(rng() * 3) + 2;
        for (let s = 0; s < spots; s++) {
            const sy = oy + (s / spots) * size;
            const sh = size / spots - 4;
            this.gDeco.lineStyle(1, 0x404030, 0.5);
            const pts = [
                cartesianToIso(ox,        sy),
                cartesianToIso(ox + size, sy),
                cartesianToIso(ox + size, sy + sh),
                cartesianToIso(ox,        sy + sh),
            ].map(p => ({ x: p.isoX, y: p.isoY }));
            this.gDeco.strokePoints(pts, true);

            if (rng() < 0.6) {
                const cx = ox + rng() * (size - T * 0.8);
                this.carG(this.gDeco, cx, sy + 4, T * 0.75, sh - 8, rng);
            }
        }

        // Mureta baixa — também registra colisão
        const wallH = 10;
        const frontIsoY = cartesianToIso(ox + size / 2, oy + size).isoY;
        const gM = this.scene.add.graphics().setDepth(frontIsoY + wallH * 0.6);
        this.buildingGfx.push(gM);
        this.isoBoxG(gM, ox, oy,           size, 6, wallH, 0x3a3a3a, 0x282828, 0x484848);
        this.isoBoxG(gM, ox, oy + size - 6, size, 6, wallH, 0x3a3a3a, 0x282828, 0x484848);

        // Estacionamentos NÃO bloqueiam o movimento (player pode passar)
    }

    // ── Escombros ─────────────────────────────────────────────────────────────

    private blockRubble(ox: number, oy: number, size: number, rng: () => number) {
        const T = CityWorld.T;
        // Chão escuro variegado
        for (let i = 0; i < CityWorld.BLOCK_SZ; i++) {
            for (let j = 0; j < CityWorld.BLOCK_SZ; j++) {
                const v = Math.floor(rng() * 10);
                this.isoTile(this.gDeco, ox + i * T, oy + j * T, T, T,
                    Phaser.Display.Color.GetColor(16 + v, 14 + v, 10 + v));
            }
        }

        // Pilhas de escombros (sem colisão — player pode passar por elas)
        const piles = Math.floor(rng() * 6) + 3;
        for (let i = 0; i < piles; i++) {
            const rx  = ox + rng() * (size - T * 0.4);
            const ry  = oy + rng() * (size - T * 0.4);
            const pw  = rng() * T * 0.6 + T * 0.2;
            const ph  = rng() * 22 + 5;
            const ffy = cartesianToIso(rx + pw / 2, ry + pw * 0.6).isoY;
            const gP  = this.scene.add.graphics().setDepth(ffy + ph * 0.5);
            this.buildingGfx.push(gP);
            this.debrisPileG(gP, rx, ry, pw, pw * 0.6, ph, rng);
        }

        // Parede caída ocasional — registra colisão
        if (rng() < 0.35) {
            const rw = rng() * T + T * 0.6;
            const rd = T * 0.25;
            const rh = rng() * 40 + 15;
            const rx = ox + rng() * (size - rw);
            const ry = oy + rng() * (size - rd * 2);
            const fY = cartesianToIso(rx + rw / 2, ry + rd).isoY;
            const gS = this.scene.add.graphics().setDepth(fY + rh * 0.5);
            this.buildingGfx.push(gS);
            this.isoBoxG(gS, rx, ry, rw, rd, rh, 0x28241c, 0x1c1a14, 0x34302a);
            this.wallRects.push({ x: rx, y: ry, w: rw, h: rd });
        }
    }

    // ── Poste ─────────────────────────────────────────────────────────────────

    private streetlight(wx: number, wy: number, on: boolean) {
        const { isoX, isoY } = cartesianToIso(wx, wy);
        const pH = 80;

        const g = this.scene.add.graphics().setDepth(isoY + pH);
        this.buildingGfx.push(g);

        // Haste
        g.lineStyle(2, 0x2a2a28, 1);
        g.beginPath();
        g.moveTo(isoX, isoY);
        g.lineTo(isoX, isoY - pH);
        g.strokePath();

        // Braço
        g.beginPath();
        g.moveTo(isoX, isoY - pH);
        g.lineTo(isoX + 18, isoY - pH + 9);
        g.strokePath();

        const lx = isoX + 18, ly = isoY - pH + 9;

        if (on) {
            g.fillStyle(0xffe8a0, 1);
            g.fillEllipse(lx, ly, 10, 6);
            // Cone de luz
            g.fillStyle(0xffd060, 0.04);
            g.fillTriangle(lx - 6, ly + 2, lx + 6, ly + 2, lx, ly + 100);
            g.fillStyle(0xffd060, 0.08);
            g.fillCircle(lx, ly, 32);
        } else {
            g.fillStyle(0x1e1e18, 1);
            g.fillEllipse(lx, ly, 9, 5);
        }
    }

    // ── Atmosfera ─────────────────────────────────────────────────────────────

    private drawAtmosphere() {
        // Manchas escuras no chão
        for (let i = 0; i < 50; i++) {
            const cx = (Math.random() - 0.5) * 3000;
            const cy = (Math.random() - 0.5) * 3000;
            const { isoX, isoY } = cartesianToIso(cx, cy);
            const r = 15 + Math.random() * 40;
            this.gGround.fillStyle(0x050505, 0.2 + Math.random() * 0.3);
            this.gGround.fillEllipse(isoX, isoY, r * 2, r * 0.5);
        }

        // Rachaduras no asfalto
        for (let i = 0; i < 60; i++) {
            this.crack(
                (Math.random() - 0.5) * 2800,
                (Math.random() - 0.5) * 2800,
            );
        }

        // Detritos pequenos
        for (let i = 0; i < 150; i++) {
            const cx = (Math.random() - 0.5) * 2800;
            const cy = (Math.random() - 0.5) * 2800;
            const { isoX, isoY } = cartesianToIso(cx, cy);
            const cols = [0x2a2018, 0x1e1c10, 0x241e14];
            this.gGround.fillStyle(cols[Math.floor(Math.random() * cols.length)], 0.75);
            this.gGround.fillRect(isoX, isoY, Math.random() * 4 + 1, Math.random() * 3 + 1);
        }
    }

    private crack(cx: number, cy: number) {
        let x = cx, y = cy;
        const segs = Math.floor(Math.random() * 5) + 2;
        this.gGround.lineStyle(1, 0x0d0d0d, 0.5);
        this.gGround.beginPath();
        const s = cartesianToIso(x, y);
        this.gGround.moveTo(s.isoX, s.isoY);
        for (let i = 0; i < segs; i++) {
            x += (Math.random() - 0.5) * 50;
            y += (Math.random() - 0.5) * 50;
            const { isoX, isoY } = cartesianToIso(x, y);
            this.gGround.lineTo(isoX, isoY);
        }
        this.gGround.strokePath();
    }

    // =========================================================================
    // Primitivos
    // =========================================================================

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

        // Face esquerda (frente-esquerda)
        g.fillStyle(leftFace, 1);
        g.beginPath();
        g.moveTo(bl.isoX, bl.isoY - bh);
        g.lineTo(br.isoX, br.isoY - bh);
        g.lineTo(br.isoX, br.isoY);
        g.lineTo(bl.isoX, bl.isoY);
        g.closePath();
        g.fillPath();

        // Face direita (frente-direita)
        g.fillStyle(rightFace, 1);
        g.beginPath();
        g.moveTo(tr.isoX, tr.isoY - bh);
        g.lineTo(br.isoX, br.isoY - bh);
        g.lineTo(br.isoX, br.isoY);
        g.lineTo(tr.isoX, tr.isoY);
        g.closePath();
        g.fillPath();

        // Arestas
        g.lineStyle(0.5, 0x000000, 0.3);
        g.strokePoints([
            { x: tl.isoX, y: tl.isoY - bh },
            { x: tr.isoX, y: tr.isoY - bh },
            { x: br.isoX, y: br.isoY - bh },
            { x: bl.isoX, y: bl.isoY - bh },
        ], true);
    }

    // ── Debris / pilha ────────────────────────────────────────────────────────

    private debrisG(g: Phaser.GameObjects.Graphics, wx: number, wy: number, bw: number, bd: number, rng: () => number) {
        const pcs = Math.floor(rng() * 8) + 4;
        for (let i = 0; i < pcs; i++) {
            const dx = wx + (rng() - 0.25) * bw * 1.5;
            const dy = wy + (rng() - 0.25) * bd * 1.5;
            const dw = rng() * 20 + 6;
            const dd = rng() * 16 + 4;
            const dh = rng() * 14 + 3;
            const c  = [0x2e2416, 0x262626, 0x1c1c1e, 0x301e10];
            const ci = Math.floor(rng() * c.length) % c.length;
            this.isoBoxG(g, dx, dy, dw, dd, dh,
                c[ci],
                c[(ci + 1) % c.length],
                Phaser.Display.Color.ValueToColor(c[ci]).lighten(8).color,
            );
        }
    }

    private debrisPileG(
        g: Phaser.GameObjects.Graphics,
        wx: number, wy: number,
        pw: number, pd: number, ph: number,
        rng: () => number,
    ) {
        const c = 0x241e14;
        this.isoBoxG(g, wx, wy, pw, pd, ph, c, 0x181410,
            Phaser.Display.Color.ValueToColor(c).lighten(12).color);
        for (let i = 0; i < 3; i++) {
            this.isoBoxG(g,
                wx + (rng() - 0.5) * pw * 1.2,
                wy + (rng() - 0.5) * pd * 1.2,
                pw * 0.3, pd * 0.3, ph * 0.3 + 2,
                0x1c1a12, 0x121008, 0x262214,
            );
        }
    }

    // ── Carro ─────────────────────────────────────────────────────────────────

    private carG(
        g: Phaser.GameObjects.Graphics,
        wx: number, wy: number,
        cw: number, cd: number,
        rng: () => number,
    ) {
        const bodyPal = [0x14141e, 0x1e0e0e, 0x0e1a0e, 0x201808, 0x0e0e0e, 0x1a0e20];
        const bCol = this.pick(bodyPal, rng);
        const tCol = Phaser.Display.Color.ValueToColor(bCol).lighten(12).color;
        const bH   = cw * 0.5;

        this.isoBoxG(g, wx, wy, cw, cd, bH, bCol, bCol, tCol);
        const cabW = cw * 0.62, cabD = cd * 0.5;
        this.isoBoxG(g,
            wx + (cw - cabW) / 2, wy + (cd - cabD) / 2,
            cabW, cabD, bH * 1.4,
            tCol,
            Phaser.Display.Color.ValueToColor(tCol).darken(12).color,
            Phaser.Display.Color.ValueToColor(tCol).lighten(10).color,
        );
        // Rodas
        const wW = cw * 0.14, wD = cd * 0.16, wH = bH * 0.2;
        for (const [ox2, oy2] of [[0, 0], [cw - wW, 0], [0, cd - wD], [cw - wW, cd - wD]]) {
            this.isoBoxG(g, wx + ox2, wy + oy2, wW, wD, wH, 0x080808, 0x050505, 0x111111);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private pick<T>(arr: T[], rng: () => number): T {
        return arr[Math.floor(rng() * arr.length) % arr.length];
    }

    private makeRng(seed: number) {
        let s = (seed ^ 0xdeadbeef) >>> 0 || 1;
        return () => {
            s ^= s << 13;
            s ^= s >>> 17;
            s ^= s << 5;
            s = s >>> 0;
            return s / 4294967296;
        };
    }
}