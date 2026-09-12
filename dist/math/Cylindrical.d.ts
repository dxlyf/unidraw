import { Vec3 } from "./vec3.js";
/**
 * 柱坐标（Cylindrical）：用「到 +Y 轴的距离 + 绕 +Y 的方位角 + 高度」描述空间点，
 * 与 three.js 的 Cylindrical 约定一致，适合环形排布、螺旋线、极坐标式布局。
 *
 * 坐标约定（右手系，+Y 向上）：
 *   x = radius * sin(theta)
 *   y = y
 *   z = radius * cos(theta)
 * 其中 radius ≥ 0 为到 Y 轴的距离；theta 为绕 +Y 轴的方位角，0 指向 +Z，
 * 向 +X 方向增大；y 为沿 Y 轴的坐标。
 *
 * 这里刻意不做 theta 归一化：任意实数都能被 sin/cos 正确解释，
 * 强行取模会破坏「累加角度」这类用法（如 theta += 速度 * dt）的连续性。
 *
 * 实例方法就地修改并返回 this，便于链式调用；需要保留原值请先 clone()。
 */
export declare class Cylindrical {
    radius: number;
    theta: number;
    y: number;
    readonly isCylindrical = true;
    constructor(radius?: number, theta?: number, y?: number);
    set(radius: number, theta: number, y: number): this;
    /** 复制另一个柱坐标的分量（不是替换引用），返回 this。 */
    copy(other: Cylindrical): this;
    clone(): Cylindrical;
    /**
     * 由直角坐标填充。
     *
     * 为什么用 atan2(x, z)：它在 x = z = 0（点落在 Y 轴上、方位角本无定义）时
     * 仍返回确定的 0，而 asin/acos 形式会得到 NaN 并污染后续计算。
     */
    setFromCartesianCoords(x: number, y: number, z: number): this;
    setFromVector3(v: Vec3): this;
    /**
     * 反算回直角坐标。
     * target 省略时新建 Vec3；在热路径上传入可复用的实例以避免每帧分配。
     */
    toVector3(target?: Vec3): Vec3;
    equals(other: Cylindrical, epsilon?: number): boolean;
    toString(): string;
}
//# sourceMappingURL=Cylindrical.d.ts.map