// Converte coordenadas 2D normais para Isométricas
export const cartesianToIso = (x: number, y: number) => {
    return {
        isoX: x - y,
        isoY: (x + y) / 2
    };
};