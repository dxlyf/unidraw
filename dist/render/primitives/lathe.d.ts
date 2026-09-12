import type { GeometryData } from "../Geometry.js";
export declare function ensureOutwardWinding(data: GeometryData): void;
/**
 * 相邻环带网格（供旋转体/管状体复用）。
 *
 * 极点处理：某个环的半径 ≈ 0 时（球/胶囊/圆锥的顶点），该环所有顶点重合于极点，
 * 相邻四边形会退化成零面积三角形，且极点附近实际上没有面 —— 这里改为
 * 「极点 + 相邻环两点」的扇形三角形（与 sphere 的极点处理一致）。
 */
export declare function lathe(rows: {
    y: number;
    r: number;
    ny: number;
}[], ws: number, positions: number[], normals: number[], uvs: number[], indices: number[]): void;
//# sourceMappingURL=lathe.d.ts.map