import { ensureOutwardWinding, lathe } from "./lathe.js";
// ---------------------------------------------------------------------------
// 胶囊（沿 Y：柱段 middle + 两端半径 radius 的半球）
// ---------------------------------------------------------------------------
export function capsule(radius = 0.4, middle = 0.6, radialSegments = 24, capSegments = 8) {
    const ws = Math.max(3, radialSegments);
    const cs = Math.max(1, capSegments);
    const half = middle / 2;
    // 从上到下：上顶(φ=π/2)→肩(0)、柱段、肩→下底(φ=-π/2)
    const rows = [];
    for (let k = 0; k <= cs; k++) {
        const phi = (Math.PI / 2) * (1 - k / cs);
        rows.push({ y: half + radius * Math.sin(phi), r: radius * Math.cos(phi), ny: Math.sin(phi) });
    }
    const midRows = Math.max(1, cs);
    for (let k = 1; k < midRows; k++) {
        const t = k / midRows;
        rows.push({ y: half - middle * t, r: radius, ny: 0 });
    }
    for (let k = 1; k <= cs; k++) {
        const phi = (Math.PI / 2) * (k / cs);
        rows.push({ y: -half - radius * Math.sin(phi), r: radius * Math.cos(phi), ny: -Math.sin(phi) });
    }
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    lathe(rows, ws, positions, normals, uvs, indices);
    const data = { positions, normals, uvs, indices };
    ensureOutwardWinding(data);
    return data;
}
//# sourceMappingURL=capsule.js.map