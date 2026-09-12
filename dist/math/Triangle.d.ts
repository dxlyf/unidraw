import { Vec3 } from "./vec3.js";
import type { Plane } from "./Plane.js";
/**
 * Triangle —— 由三个顶点定义的空间三角形（顶点顺序决定法线朝向）。
 *
 * 约定与 three.js 一致：`getNormal` 用 `(c - b) × (a - b)`，右手系下逆时针绕序得到朝外的法线。
 */
export declare class Triangle {
    readonly isTriangle = true;
    a: Vec3;
    b: Vec3;
    c: Vec3;
    constructor(a?: Vec3, b?: Vec3, c?: Vec3);
    /** 复制顶点（而非持有引用） */
    set(a: Vec3, b: Vec3, c: Vec3): this;
    /** 从顶点数组 + 索引构建（顶点数据被复制，之后修改数组不影响本三角形） */
    setFromPointsAndIndices(points: readonly Vec3[], i0: number, i1: number, i2: number): this;
    clone(): Triangle;
    copy(t: Triangle): this;
    /** 单位法线；三角形退化（面积为零）时返回零向量，而不是 NaN */
    getNormal(target: Vec3): Vec3;
    /** 三角形所在平面（法线已单位化，因此 Plane.constant 可直接当距离用） */
    getPlane(target: Plane): Plane;
    /**
     * 点在三角形上的重心坐标 (x, y, z)，分别对应顶点 a、b、c，三者之和为 1。
     *
     * 退化三角形（三点共线或重合）没有良定义的重心坐标，约定返回 (NaN, NaN, NaN)：
     * 与 three.js 的返回约定一致，同时让 `containsPoint` 因 NaN 比较恒假而自然返回 false。
     * 判据用相对量：`dot00 * dot11 - dot01² = |v0|²|v1|²sin²θ`，与两者乘积之比即 sin²θ，
     * 因此不受三角形尺度影响（小三角形不会被误判为退化）。
     */
    getBarycoord(point: Vec3, target: Vec3): Vec3;
    /** 点是否落在三角形内（含边与顶点）；退化三角形返回 false */
    containsPoint(point: Vec3): boolean;
    /**
     * 点到三角形的最近点。
     *
     * 判据：把三角形划分为 3 个顶点区、3 条边区与 1 个面内区，
     * 先用各边与 ap 的点积判断点落在哪个区，再在该区内解析求最近点；
     * 只有面内区需要一次三角形面积归一化。
     */
    closestPointToPoint(point: Vec3, target: Vec3): Vec3;
    equals(t: Triangle, epsilon?: number): boolean;
    toString(): string;
}
//# sourceMappingURL=Triangle.d.ts.map