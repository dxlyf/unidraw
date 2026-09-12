/**
 * 简单多边形三角化：凸多边形直接 fan；一般（含凹）多边形用耳切。
 * 输入任意绕序；输出三角形三个顶点在原点数组中的下标（连续三元组）。
 */
import type { Pt2 } from "./matrix.js";
/** 两倍有向面积（shoelace），正负表示绕序 */
export declare function polygonArea2(pts: Pt2[]): number;
/**
 * 三角化简单多边形。返回下标三元组数组；失败返回 null（退化/自交过多）。
 */
export declare function triangulateSimplePolygon(pts: Pt2[]): number[] | null;
//# sourceMappingURL=triangulate.d.ts.map