import { Mat4 } from "./mat4.js";
import { Vec3 } from "./vec3.js";
import type { Box3 } from "./Box3.js";
import type { Sphere } from "./Sphere.js";
/**
 * PlaneLineLike —— `intersectLine` / `intersectsLine` 只用到线段的两个端点。
 *
 * 为什么用结构化类型而不是 `import { Line3 }`：Line3 自身要用 Plane（线段与平面求交），
 * 互相 import 会形成环；而这里只读 start / end，任何带这两个字段的线段类型都能直接传入。
 */
export interface PlaneLineLike {
    start: Vec3;
    end: Vec3;
}
/**
 * Plane —— 平面，由单位法线 `normal` 与常数 `constant` 定义：`normal · p + constant = 0`。
 * 法线单位化时，`constant` 的几何含义是「原点到平面的有符号距离 × -1」。
 *
 * 与 three.js 一致：法线**必须**是单位向量，否则所有距离量（`distanceToPoint` 等）都会被缩放；
 * 通过 `setComponents` 直接构造后请调用 `normalize()`。
 */
export declare class Plane {
    readonly isPlane = true;
    normal: Vec3;
    constant: number;
    constructor(normal?: Vec3, constant?: number);
    /** 复制法线（而非持有引用），避免调用方之后修改自己的向量时悄悄改变本平面 */
    set(normal: Vec3, constant: number): this;
    setComponents(x: number, y: number, z: number, w: number): this;
    setFromNormalAndCoplanarPoint(normal: Vec3, point: Vec3): this;
    setFromCoplanarPoints(a: Vec3, b: Vec3, c: Vec3): this;
    clone(): Plane;
    copy(p: Plane): this;
    /** 单位化法线，并按同一比例缩放 constant：两者必须同步，否则平面会平移 */
    normalize(): this;
    /** 翻转法线朝向（constant 同步取反），平面本身不动 */
    negate(): this;
    /** 点到平面的有符号距离：>0 在法线一侧，<0 在另一侧，=0 在平面上 */
    distanceToPoint(p: Vec3): number;
    /** 球面到平面的最短距离（可为负，表示平面穿过球体） */
    distanceToSphere(s: Sphere): number;
    /** 点沿法线在平面上的投影（最近点） */
    projectPoint(p: Vec3, target: Vec3): Vec3;
    /** 与 projectPoint 等价（保留 three.js 的历史命名），语义同为「平面上的最近点」 */
    orthoPoint(point: Vec3, target: Vec3): Vec3;
    /**
     * 线段与平面求交；返回交点，线段与平面无交点时返回 null。
     *
     * 判据：把线段写成 `start + t · (end - start)`（t ∈ [0,1]），代入平面方程解出 t；
     * t 落在 [0,1] 之外说明交点在线段延长线上，视为不相交。
     */
    intersectLine(line: PlaneLineLike, target: Vec3): Vec3 | null;
    /**
     * 线段是否穿过平面。
     *
     * 判据与 three.js 相同：两端点相对平面的符号严格相反才算「穿过」，
     * 因此端点恰好落在平面上时返回 false；需要包含端点请用 `intersectLine(...) !== null`。
     */
    intersectsLine(line: PlaneLineLike): boolean;
    /** 包围盒是否与平面相交（委托给 Box3 的正/负顶点判据） */
    intersectsBox(box: Box3): boolean;
    /** 球体是否与平面相交（委托给 Sphere 的球心距判据） */
    intersectsSphere(sphere: Sphere): boolean;
    /** 平面上的一个点：沿法线从原点走到平面，即 -constant · normal */
    coplanarPoint(target: Vec3): Vec3;
    /**
     * 用矩阵变换平面（点用 m、法线用逆转置矩阵）。
     *
     * 为什么法线不能直接用 m 乘：非等比缩放或剪切下，`m · n` 不再垂直于变换后的平面
     * （例如沿 x 放大 2 倍时法线的 x 分量应缩小而非放大），必须使用 (m⁻¹)ᵀ。
     * 这里先对 m 求逆，再按「逆矩阵的转置」形式做乘法；法线矩阵只差一个正标量因子，
     * 之后的 `normalize()` 会把它消掉。可选参数 `optionalNormalMatrix` 允许调用方复用
     * 预先算好的法线矩阵（例如一个场景只求一次）。
     */
    applyMatrix4(m: Mat4, optionalNormalMatrix?: Mat4): this;
    /** 平移平面（法线不变，只改 constant） */
    translate(offset: Vec3): this;
    equals(p: Plane, epsilon?: number): boolean;
    toString(): string;
}
//# sourceMappingURL=Plane.d.ts.map