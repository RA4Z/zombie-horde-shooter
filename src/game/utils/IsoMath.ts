/** Converte coordenadas cartesianas (mundo) para isométricas (tela) */
export const cartesianToIso = (x: number, y: number) => ({
    isoX: x - y,
    isoY: (x + y) / 2,
});

/** Converte coordenadas isométricas (tela) de volta para cartesianas (mundo) */
export const isoToCartesian = (isoX: number, isoY: number) => ({
    x: (2 * isoY + isoX) / 2,
    y: (2 * isoY - isoX) / 2,
});