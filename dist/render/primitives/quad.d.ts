import type { Axis } from "./types.js";
/**
 * 生成一个轴向面（两个三角形）并追加到 positions/normals/uvs。
 *
 * @param axis 面法线所在轴
 * @param sign 面朝向（+1 / -1）
 * @param w 面在「第一个切向轴」上的尺寸
 * @param h 面在「第二个切向轴」上的尺寸
 * @param axisOffset 面沿自身轴向到原点的距离（立方体=半边长；平面=0）
 */
export declare function quadFace(axis: Axis, sign: 1 | -1, w: number, h: number, positions: number[], normals: number[], uvs: number[], axisOffset?: number): number[];
//# sourceMappingURL=quad.d.ts.map