import type { Euler } from "./Euler.js";
import type { Mat4 } from "./mat4.js";
import type { Vec3 } from "./vec3.js";
/**
 * 单位四元数 (x, y, z, w)：x/y/z 是虚部，w 是实部。
 *
 * 为什么旋转用它而不是欧拉角：欧拉角存在万向节锁（两个转轴共线时自由度退化），
 * 插值也不能直接对三个角做线性插值，否则角速度一会儿快一会儿慢；3x3 矩阵虽然
 * 无奇点，却要用 9 个数存储，且线性插值后不再正交。四元数只用 4 个数、无奇点，
 * 并且能用 `slerp` 做等角速度插值——这是动画与轨道相机控制的刚需。
 *
 * 约定：
 * - 表示旋转的四元数必须是单位长度（`normalize()` / `setFromAxisAngle` 等已保证），
 *   否则 `multiply`、`slerp` 得到的姿态会被缩放；
 * - `q` 与 `-q` 表示同一个旋转（`angleTo` 用取点积绝对值的方式消除该二义性）；
 * - 乘法顺序：`a.multiply(b)` 表示先作用 b、再作用 a（与矩阵 `A * B` 一致）；
 * - 实例方法就地修改并返回 this，便于链式调用（与 Vec3/Mat4 一致）。
 *
 * 公式与 three.js 的 `Quaternion` 对齐（含 `setFromRotationMatrix` 的四分支取
 * 最大分量写法、`slerp` 的最短弧选择），便于直接消费 three 生态的数据。
 */
export declare class Quaternion {
    x: number;
    y: number;
    z: number;
    w: number;
    readonly isQuaternion: boolean;
    constructor(x?: number, y?: number, z?: number, w?: number);
    /** 恒等旋转；与 `Vec3.zero()/one()` 一样提供静态构造，便于书写常量。 */
    static identity(): Quaternion;
    set(x: number, y: number, z: number, w: number): this;
    copy(q: Quaternion): this;
    clone(): Quaternion;
    /** 就地置为恒等旋转（无旋转）。 */
    identity(): this;
    lengthSq(): number;
    length(): number;
    /**
     * 就地单位化。
     *
     * 为什么要有 1e-12 的下限：对零四元数取 1/0 会得到 NaN，而 NaN 会顺着
     * multiply/slerp 污染整条姿态链，事后极难定位。这里与 `Vec3.normalize`
     * 保持同款兜底：长度退化时不动它（调用方本就不该拿零四元数当旋转用）。
     */
    normalize(): this;
    /** 四元数点积（4 维内积）：等于两旋转夹角一半的余弦（可能相差符号）。 */
    dot(q: Quaternion): number;
    /**
     * 逐分量比较（epsilon 缺省用 mmath 的 EPSILON，与 Vec3 保持一致）。
     *
     * 注意：`q` 与 `-q` 是同一个旋转，但这里按数值比较，所以二者不相等；
     * 要按「是否同一姿态」判断请用 `angleTo(q) < eps`。
     */
    equals(q: Quaternion, epsilon?: number): boolean;
    /**
     * 由欧拉角（弧度）构造四元数。
     *
     * 六种 order 各是一组「三个半角正余弦交叉相乘」的固定组合（把三次绕轴旋转的
     * 四元数按 order 乘开后合并同类项得到，例如 XYZ 即 R = Rx·Ry·Rz）。没有任何
     * 一个公式能靠换符号覆盖全部顺序，所以六种必须逐一写全，否则 order 会失效。
     *
     * @param update 与 three.js 签名对齐：three.js 用它触发 `_onChangeCallback`。
     *   本库的数学类没有观察者机制（Vec3/Mat4 也都没有），因此它不改变结果；
     *   这里显式读一次，既说明「有意忽略」，也避免触发 noUnusedParameters。
     */
    setFromEuler(e: Euler, update?: boolean): this;
    /**
     * 由「绕 axis 旋转 angle 弧度」构造四元数。
     *
     * 为什么这里自己做了单位化：three.js 的同名方法要求调用方保证 axis 已单位化
     * （传非单位向量会得到非单位四元数，后续 multiply 出的旋转会被缩放），而本库
     * 其它地方（`Mat4.rotateAxis`）都是自己兜底的风格，所以这里统一兜底；
     * 注意不会修改传入的 axis。
     */
    setFromAxisAngle(axis: Vec3, angle: number): this;
    /**
     * 由 Mat4 左上 3x3 的**纯旋转**部分构造四元数。
     *
     * 为什么按 trace 分四支而不是统一用 `w = sqrt(1 + m11 + m22 + m33) / 2`：
     * 后者在 w 接近 0（旋转接近 180°）时被开方数会被浮点误差压成负数 → NaN。
     * 于是先看迹，为正时用同一个 s 一次算出四个分量；否则取 m11/m22/m33 中最大
     * 的分量作主元，使分母 `2*sqrt(1 + 主元 - 另两个)` 远离 0（three.js 同款写法）。
     *
     * 输入矩阵必须正交且行列式为 +1（含缩放或镜像时结果无意义，请先用
     * `Mat4.decompose` 剥离缩放）。
     */
    setFromRotationMatrix(m: Mat4): this;
    /**
     * 构造「把方向 vFrom 转到 vTo」的最短旋转（两者都必须是单位向量）。
     *
     * 兜底：vFrom 与 vTo 反向共线时叉积为零向量、旋转轴不唯一（绕任意垂直轴转 π
     * 都行），此时手工挑一条与 vFrom 垂直的轴。两种构造 (-y, x, 0) 与 (0, -z, y)
     * 都与 vFrom 正交，按 |x| 与 |z| 的大小择一，是为了避免选到零向量——
     * 例如 vFrom = (0, 0, 1) 时 (-y, x, 0) 就是 (0, 0, 0)。
     *
     * 点积在这里直接展开而不用 `vec3Dot`：vec3.ts 会在模块级 `new Quaternion()`
     * 造临时量，若本文件再 import vec3，就形成「vec3 ⇄ Quaternion」运行时循环，
     * 当 Quaternion 先被求值时那条循环会因 TDZ 抛 ReferenceError。
     */
    setFromUnitVectors(vFrom: Vec3, vTo: Vec3): this;
    /** this = this * q（先施加 q 的旋转，再施加 this 的旋转）。 */
    multiply(q: Quaternion): this;
    /** this = q * this（外旋：让 q 在 this 之后作用于向量）。 */
    premultiply(q: Quaternion): this;
    /**
     * this = a * b；三个实例可以是同一个对象。
     *
     * 先把 a、b 的分量读进局部变量再写 this，所以 `multiply`/`premultiply` 直接
     * 把 this 传进来也安全（若边读边写，后几行就会用到已被覆盖的分量）。
     */
    multiplyQuaternions(a: Quaternion, b: Quaternion): this;
    /** 共轭 q* = (-x, -y, -z, w)；单位四元数下它同时是逆旋转。 */
    conjugate(): this;
    /**
     * 逆：q⁻¹ = q* / |q|²，满足 q · q⁻¹ = (0, 0, 0, 1)。
     *
     * three.js 的 `invert()` 就等于 `conjugate()`（它假定调用方始终维持单位长度），
     * 但非单位四元数直接用共轭当逆会让组合旋转越算越偏。这里补上 |q|² 补偿，
     * 且只在明显偏离单位长度时才做——单位四元数的 |q|² 本来就只在 1 附近抖动
     * ~1e-16，对它做无谓的乘除只会额外引入舍入误差、偏离 three.js 的逐位结果。
     */
    invert(): this;
    /**
     * 与本四元数所代表旋转的夹角（弧度，恒落在 [0, π]）。
     *
     * 取点积的绝对值：q 与 -q 表示同一旋转，不加绝对值会把「零度」算成 2π；
     * clamp 到 [-1, 1] 是因为点积经舍入后可能略大于 1，acos 会直接返回 NaN。
     */
    angleTo(q: Quaternion): number;
    /** 球面插值：this = slerp(this, qb, t)。 */
    slerp(qb: Quaternion, t: number): this;
    /**
     * 把 qa、qb 之间的球面插值就地写入 qm 并返回它。
     *
     * 为什么不直接线性插值再单位化：线性插值的角速度不均匀（t 两端快、中间慢），
     * 表现为动画「起步和收尾突然变快」。slerp 沿大圆用 sin 权重插值，角速度恒定。
     *
     * 两个必须处理的细节：
     * - cosHalfTheta < 0 说明 qb 落在与 qa 相反的半球，先把 qb 取反走「短弧」，
     *   否则会绕远路转 360°（取反不改变 qb 表示的旋转）；
     * - cosHalfTheta 接近 1 时 sinHalfTheta → 0，sin 权重变成 0/0；此时两旋转几乎
     *   重合，退化成线性插值再单位化，数值等价且稳定。
     *
     * 与 three.js 的差异：three.js 在 t === 0 时直接返回 qm（不写入 qa），这会让
     * 「传了独立 out 参数」的调用方拿到未初始化的结果；这里补上 copy(qa)，
     * 使 qm 在 t ∈ [0,1] 的两个端点上都正确。
     */
    static slerp(qa: Quaternion, qb: Quaternion, qm: Quaternion, t: number): Quaternion;
    /**
     * 朝 q 转动，单次最多 step 弧度（不足则正好转到 q），用于每帧限速转向。
     *
     * 用 min(1, step / angle) 折算成 slerp 的比例：step 超过剩余夹角时按 1 处理，
     * 避免 t > 1 造成过冲——转向是有限步长的，不该越过目标再弹回来。
     */
    rotateTowards(q: Quaternion, step: number): this;
    /** 依次写入 [x, y, z, w]；缺省追加进一个新数组。 */
    toArray(array?: number[], offset?: number): number[];
    /** 从 [x, y, z, w] 读取；接受 Float32Array 等类数组（如 uniform 回读）。 */
    fromArray(array: ArrayLike<number>, offset?: number): this;
    /** 连续写入目标 Float32Array（byteOffset 必须 4 字节对齐），与 Vec4.writeTo 同款。 */
    writeTo(out: Float32Array, byteOffset?: number): void;
    toString(): string;
}
//# sourceMappingURL=Quaternion.d.ts.map