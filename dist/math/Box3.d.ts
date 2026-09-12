import { Mat4 } from "./mat4.js";
import { Vec3 } from "./vec3.js";
import type { Plane } from "./Plane.js";
import type { Sphere } from "./Sphere.js";
/**
 * Box3 —— 三维轴对齐包围盒（AABB），与坐标轴对齐因此只需 min / max 两个角点。
 *
 * 空盒约定与 three.js 一致：`min = +∞`、`max = -∞`。
 * 这样 `expandByPoint` 无需任何特判就能「从空开始」逐步扩大，
 * 而 `isEmpty()` 也就等价于「某个轴上 max < min」（+∞ > -∞ 必然成立）。
 */
export declare class Box3 {
    readonly isBox3 = true;
    min: Vec3;
    max: Vec3;
    constructor(min?: Vec3, max?: Vec3);
    /** 复制角点（而非持有引用） */
    set(min: Vec3, max: Vec3): this;
    /** 从扁平的 [x,y,z, x,y,z, ...] 数据构建；非 3 的整数倍尾部会被忽略 */
    setFromArray(array: ArrayLike<number>): this;
    makeEmpty(): this;
    isEmpty(): boolean;
    setFromPoints(points: readonly Vec3[]): this;
    setFromCenterAndSize(center: Vec3, size: Vec3): this;
    clone(): Box3;
    copy(b: Box3): this;
    /** 空盒没有中心，按 three.js 约定返回原点而不是 (±∞ 的 NaN) */
    getCenter(target: Vec3): Vec3;
    /** 空盒没有尺寸，返回零向量 */
    getSize(target: Vec3): Vec3;
    expandByPoint(p: Vec3): this;
    /** 按向量扩张：min 减去 v、max 加上 v（因此负分量会「内缩」该侧） */
    expandByVector(v: Vec3): this;
    /** 各轴两侧同时外扩 s（s 为负则两侧内缩） */
    expandByScalar(s: number): this;
    containsPoint(p: Vec3): boolean;
    containsBox(b: Box3): boolean;
    /** 把盒内点映射到 [0,1]³ 参数空间；某轴退化为平面时该轴取 0（避免 0/0） */
    getParameter(point: Vec3, target: Vec3): Vec3;
    /** 盒内（含表面）距 point 最近的点 */
    clampPoint(point: Vec3, target: Vec3): Vec3;
    /** 点到盒的距离平方：盒内为 0。先比较平方可省一次开方 */
    distanceToPointSquared(point: Vec3): number;
    distanceToPoint(point: Vec3): number;
    intersectsBox(b: Box3): boolean;
    /**
     * 球体是否与包围盒相交。
     *
     * 判据：把球心钳到盒上得到最近点，球心到该点的距离 ≤ 半径即相交
     * （球心在盒内时距离为 0，必然相交）。空盒不含任何点，直接返回 false。
     */
    intersectsSphere(sphere: Sphere): boolean;
    /**
     * 平面是否与包围盒相交（即平面是否「穿过」盒体，含相切）。
     *
     * 判据：正/负顶点法。取沿法线方向最远与最近的角点，分别求其到平面的有符号距离；
     * 若最远的角点仍在平面负侧（<0）或最近的角点仍在正侧（>0），说明盒体整体位于平面一侧，不相交；
     * 否则两侧都有角点（或相切），判为相交。该判据只做两次点积，无需逐角点遍历。
     */
    intersectsPlane(plane: Plane): boolean;
    /** 用能包住整个盒的球填充 target（球心为盒心，半径为半对角线长） */
    getBoundingSphere(target: Sphere): Sphere;
    /** 与另一个盒求交（就地把本盒收窄） */
    intersect(b: Box3): this;
    /** 与另一个盒求并（就地把本盒扩大） */
    union(b: Box3): this;
    /**
     * 用矩阵变换包围盒。
     *
     * 为什么不用 min/max 直接变换：旋转/斜切后 AABB 的角点不再落在变换后的角上，
     * 因此必须把 8 个角点全部变换后重新求包围（结果是新的 AABB，通常比原盒大）。
     * 空盒没有任何角点，变换后仍是空盒，直接返回。
     */
    applyMatrix4(m: Mat4): this;
    translate(offset: Vec3): this;
    equals(b: Box3, epsilon?: number): boolean;
    toString(): string;
}
//# sourceMappingURL=Box3.d.ts.map