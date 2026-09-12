import type { GeometryData } from "../Geometry.js";
/**
 * 球体（UV 球）。
 *
 * 极点处理：第 0 行与第 hs 行的 ws+1 个顶点**位置相同**（都在极点），
 * 因此极点与相邻环之间必须用「极点 + 环上相邻两点」的扇形三角形连接；
 * 若照搬中间环带的四边形，极点那一侧会出现两个重合顶点 → 零面积三角形 →
 * 盖上没有三角形 → 上下各留一个洞。
 */
export declare function sphere(radius?: number, widthSegments?: number, heightSegments?: number): GeometryData;
//# sourceMappingURL=sphere.d.ts.map