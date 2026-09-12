import { Vec3 } from "./vec3.js";
/**
 * 球坐标（Spherical）：用「半径 + 极角 + 方位角」描述空间点，
 * 与 three.js 的 Spherical 约定逐位一致，便于直接消费 three 生态的轨道/相机参数。
 *
 * 坐标约定（右手系，+Y 向上）：
 *   x = radius * sin(phi) * sin(theta)
 *   y = radius * cos(phi)
 *   z = radius * sin(phi) * cos(theta)
 *
 * 角度范围：
 *   phi   —— 从 **+Y 轴** 量起的极角，取 [0, π]：0 = 正上方 +Y，π/2 = XZ 赤道面，π = 正下方 -Y；
 *            cos(phi) 决定高度分量 y，因此 phi 越接近 0/π，越靠近极点。
 *   theta —— 在 XZ 平面内绕 +Y 轴的方位角，取 [0, 2π)：0 指向 **+Z**，向 +X 方向增大。
 *
 * 注意 x 用 sin(theta)、z 用 cos(theta)（与常见的「x=cos, z=sin」相反），这是
 * 为了对齐 three.js：一旦写反，所有与 three 数据互导的逻辑都会沿 XZ 平面镜像错位。
 * radius 理论上非负，但这里不夹紧，允许调用方用负值表示「反向」。
 *
 * 实例方法就地修改并返回 this，便于链式调用；需要保留原值请先 clone()。
 */
export declare class Spherical {
    radius: number;
    phi: number;
    theta: number;
    readonly isSpherical = true;
    constructor(radius?: number, phi?: number, theta?: number);
    set(radius: number, phi: number, theta: number): this;
    /** 复制另一个球坐标的分量（不是替换引用），返回 this。 */
    copy(other: Spherical): this;
    clone(): Spherical;
    /**
     * 把极角 phi 夹到 [EPSILON, π − EPSILON]，避开极点处的数值退化。
     *
     * 为什么只夹 phi：phi 恰为 0 或 π 时点落在 Y 轴上，sin(phi) = 0 会让 theta
     * 完全失去意义，任何由 (phi, theta) 张成的切向量（如 ∂P/∂theta）都退化成零向量，
     * 之后对法线/切线做归一化就会得到 NaN。向内收一个 EPSILON 可保证 sin(phi) > 0。
     *
     * theta 不在此夹紧：方位角在整个 [0, 2π) 上都有定义，极点退化只由 phi 引起，
     * 强行把它推离 0 反而会挪走合法值（theta = 0 就是 +Z 方向），three.js 也如此。
     */
    makeSafe(): this;
    /**
     * 由直角坐标填充：phi = acos(y / radius)，theta = atan2(x, z)。
     *
     * 两个退化处理都是为了「返回确定值而不是 NaN」：
     *  - radius = 0（原点）时两个角都无定义，约定归零；
     *  - clamp 防止浮点误差让 y / radius 略微越出 [-1, 1]，那会让 acos 变成 NaN。
     */
    setFromCartesianCoords(x: number, y: number, z: number): this;
    setFromVector3(v: Vec3): this;
    /**
     * 反算回直角坐标（上面坐标约定的逆变换）。
     * target 省略时新建 Vec3；在热路径上传入可复用的实例以避免每帧分配。
     */
    toVector3(target?: Vec3): Vec3;
    equals(other: Spherical, epsilon?: number): boolean;
    toString(): string;
}
//# sourceMappingURL=Spherical.d.ts.map