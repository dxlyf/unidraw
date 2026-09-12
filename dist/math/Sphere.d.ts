import { Mat4 } from "./mat4.js";
import { Vec3 } from "./vec3.js";
import type { Box3 } from "./Box3.js";
import type { Plane } from "./Plane.js";
/**
 * Sphere —— 包围球，由球心 `center` 与半径 `radius` 定义。
 *
 * 空球约定与 three.js 一致：`radius < 0`（`makeEmpty()` 会把半径置为 -1），
 * 这样 `union` 才有「尚未初始化」的状态可用，而不必再引入一个额外的布尔标志。
 */
export declare class Sphere {
    readonly isSphere = true;
    center: Vec3;
    radius: number;
    constructor(center?: Vec3, radius?: number);
    /** 复制球心（而非持有引用） */
    set(center: Vec3, radius: number): this;
    /**
     * 由点集求最小包围球（近似：球心取包围盒中心，半径为最远点距离）。
     *
     * 为什么默认球心用包围盒中心而不是平均值：包围盒中心对离群点更稳健，
     * 且与 `Box3.getBoundingSphere` 的结果一致；需要别的球心时传入 `optionalCenter`。
     */
    setFromPoints(points: readonly Vec3[], optionalCenter?: Vec3): this;
    clone(): Sphere;
    copy(s: Sphere): this;
    isEmpty(): boolean;
    makeEmpty(): this;
    /** 点是否在球内（含表面）。空球不包含任何点 */
    containsPoint(p: Vec3): boolean;
    /** 点到球面的距离（球内为负，球心处为 -radius） */
    distanceToPoint(p: Vec3): number;
    /** 两球是否相交/包含（球心距 ≤ 半径之和） */
    intersectsSphere(s: Sphere): boolean;
    /** 球体是否与平面相交（含相切）：球心到平面的距离 ≤ 半径 */
    intersectsPlane(plane: Plane): boolean;
    /**
     * 球体是否与包围盒相交。
     *
     * 判据：把球心钳到盒上得到最近点，球心到该点的距离 ≤ 半径即相交
     * （球心在盒内时距离为 0，必然相交）。空盒不含任何点，直接返回 false。
     */
    intersectsBox(box: Box3): boolean;
    /** 用轴对齐包围盒填充 target（球取包围盒的最紧凑 AABB，而非最小体积盒） */
    getBoundingBox(target: Box3): Box3;
    /**
     * 用矩阵变换球体。
     *
     * 为什么半径乘「最长基向量」而不是逐轴缩放：非等比缩放会把球压成椭球，
     * 椭球无法用球表示，只能按最大轴保守放大，保证结果仍然包容原几何体。
     */
    applyMatrix4(m: Mat4): this;
    translate(offset: Vec3): this;
    /**
     * 合并两个球，结果仍是能包住两者的球（通常不是最小包围球）。
     * 合并球心落在两球心连线上，半径取 (r1 + r2 + d) / 2。
     */
    union(s: Sphere): this;
    /** 把点钳到球面上：球内点保持不变，球外点沿球心方向拉回表面；target === point 也安全 */
    clampPoint(point: Vec3, target: Vec3): Vec3;
    equals(s: Sphere, epsilon?: number): boolean;
    toString(): string;
}
//# sourceMappingURL=Sphere.d.ts.map