import { clamp, equals as numEquals } from "./mmath.js";
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
export class Quaternion {
    x;
    y;
    z;
    w;
    isQuaternion = true;
    constructor(x = 0, y = 0, z = 0, w = 1) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }
    /** 恒等旋转；与 `Vec3.zero()/one()` 一样提供静态构造，便于书写常量。 */
    static identity() {
        return new Quaternion(0, 0, 0, 1);
    }
    set(x, y, z, w) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
        return this;
    }
    copy(q) {
        this.x = q.x;
        this.y = q.y;
        this.z = q.z;
        this.w = q.w;
        return this;
    }
    clone() {
        return new Quaternion(this.x, this.y, this.z, this.w);
    }
    /** 就地置为恒等旋转（无旋转）。 */
    identity() {
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this.w = 1;
        return this;
    }
    lengthSq() {
        return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
    }
    length() {
        return Math.sqrt(this.lengthSq());
    }
    /**
     * 就地单位化。
     *
     * 为什么要有 1e-12 的下限：对零四元数取 1/0 会得到 NaN，而 NaN 会顺着
     * multiply/slerp 污染整条姿态链，事后极难定位。这里与 `Vec3.normalize`
     * 保持同款兜底：长度退化时不动它（调用方本就不该拿零四元数当旋转用）。
     */
    normalize() {
        const len = this.length();
        if (len > 1e-12) {
            const inv = 1 / len;
            this.x *= inv;
            this.y *= inv;
            this.z *= inv;
            this.w *= inv;
        }
        return this;
    }
    /** 四元数点积（4 维内积）：等于两旋转夹角一半的余弦（可能相差符号）。 */
    dot(q) {
        return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
    }
    /**
     * 逐分量比较（epsilon 缺省用 mmath 的 EPSILON，与 Vec3 保持一致）。
     *
     * 注意：`q` 与 `-q` 是同一个旋转，但这里按数值比较，所以二者不相等；
     * 要按「是否同一姿态」判断请用 `angleTo(q) < eps`。
     */
    equals(q, epsilon) {
        return (numEquals(this.x, q.x, epsilon) &&
            numEquals(this.y, q.y, epsilon) &&
            numEquals(this.z, q.z, epsilon) &&
            numEquals(this.w, q.w, epsilon));
    }
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
    setFromEuler(e, update = true) {
        const halfX = e.x / 2;
        const halfY = e.y / 2;
        const halfZ = e.z / 2;
        const c1 = Math.cos(halfX);
        const c2 = Math.cos(halfY);
        const c3 = Math.cos(halfZ);
        const s1 = Math.sin(halfX);
        const s2 = Math.sin(halfY);
        const s3 = Math.sin(halfZ);
        switch (e.order) {
            case "XYZ":
                this.x = s1 * c2 * c3 + c1 * s2 * s3;
                this.y = c1 * s2 * c3 - s1 * c2 * s3;
                this.z = c1 * c2 * s3 + s1 * s2 * c3;
                this.w = c1 * c2 * c3 - s1 * s2 * s3;
                break;
            case "YXZ":
                this.x = s1 * c2 * c3 + c1 * s2 * s3;
                this.y = c1 * s2 * c3 - s1 * c2 * s3;
                this.z = c1 * c2 * s3 - s1 * s2 * c3;
                this.w = c1 * c2 * c3 + s1 * s2 * s3;
                break;
            case "ZXY":
                this.x = s1 * c2 * c3 - c1 * s2 * s3;
                this.y = c1 * s2 * c3 + s1 * c2 * s3;
                this.z = c1 * c2 * s3 + s1 * s2 * c3;
                this.w = c1 * c2 * c3 - s1 * s2 * s3;
                break;
            case "ZYX":
                this.x = s1 * c2 * c3 - c1 * s2 * s3;
                this.y = c1 * s2 * c3 + s1 * c2 * s3;
                this.z = c1 * c2 * s3 - s1 * s2 * c3;
                this.w = c1 * c2 * c3 + s1 * s2 * s3;
                break;
            case "YZX":
                this.x = s1 * c2 * c3 + c1 * s2 * s3;
                this.y = c1 * s2 * c3 + s1 * c2 * s3;
                this.z = c1 * c2 * s3 - s1 * s2 * c3;
                this.w = c1 * c2 * c3 - s1 * s2 * s3;
                break;
            case "XZY":
                this.x = s1 * c2 * c3 - c1 * s2 * s3;
                this.y = c1 * s2 * c3 - s1 * c2 * s3;
                this.z = c1 * c2 * s3 + s1 * s2 * c3;
                this.w = c1 * c2 * c3 + s1 * s2 * s3;
                break;
        }
        void update;
        return this;
    }
    /**
     * 由「绕 axis 旋转 angle 弧度」构造四元数。
     *
     * 为什么这里自己做了单位化：three.js 的同名方法要求调用方保证 axis 已单位化
     * （传非单位向量会得到非单位四元数，后续 multiply 出的旋转会被缩放），而本库
     * 其它地方（`Mat4.rotateAxis`）都是自己兜底的风格，所以这里统一兜底；
     * 注意不会修改传入的 axis。
     */
    setFromAxisAngle(axis, angle) {
        const len = Math.hypot(axis.x, axis.y, axis.z);
        if (len < 1e-12) {
            // 零向量给不出旋转轴；保持恒等旋转，而不是产出 NaN 四元数。
            return this.identity();
        }
        const half = angle / 2;
        // 把 1/len 并进 sin 因子，省一次逐分量除法。
        const s = Math.sin(half) / len;
        this.x = axis.x * s;
        this.y = axis.y * s;
        this.z = axis.z * s;
        this.w = Math.cos(half);
        return this;
    }
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
    setFromRotationMatrix(m) {
        // Mat4 是列主序：elements[col * 4 + row]，所以数学上的 m_ij（第 i 行第 j 列）
        // 落在 elements[(j-1) * 4 + (i-1)]。
        const e = m.elements;
        const m11 = e[0];
        const m12 = e[4];
        const m13 = e[8];
        const m21 = e[1];
        const m22 = e[5];
        const m23 = e[9];
        const m31 = e[2];
        const m32 = e[6];
        const m33 = e[10];
        const trace = m11 + m22 + m33;
        if (trace > 0) {
            const s = 0.5 / Math.sqrt(trace + 1);
            this.w = 0.25 / s;
            this.x = (m32 - m23) * s;
            this.y = (m13 - m31) * s;
            this.z = (m21 - m12) * s;
        }
        else if (m11 > m22 && m11 > m33) {
            const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
            this.w = (m32 - m23) / s;
            this.x = 0.25 * s;
            this.y = (m12 + m21) / s;
            this.z = (m13 + m31) / s;
        }
        else if (m22 > m33) {
            const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
            this.w = (m13 - m31) / s;
            this.x = (m12 + m21) / s;
            this.y = 0.25 * s;
            this.z = (m23 + m32) / s;
        }
        else {
            const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
            this.w = (m21 - m12) / s;
            this.x = (m13 + m31) / s;
            this.y = (m23 + m32) / s;
            this.z = 0.25 * s;
        }
        // Mat4 的元素是 Float32Array（~1e-7 精度），加上浮点误差会让结果偏离单位长度；
        // 单位化一次，保证后续 multiply/slerp 的输入满足本类的约定。
        return this.normalize();
    }
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
    setFromUnitVectors(vFrom, vTo) {
        let r = vFrom.x * vTo.x + vFrom.y * vTo.y + vFrom.z * vTo.z + 1;
        if (r < Number.EPSILON) {
            r = 0;
            if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) {
                this.x = -vFrom.y;
                this.y = vFrom.x;
                this.z = 0;
            }
            else {
                this.x = 0;
                this.y = -vFrom.z;
                this.z = vFrom.y;
            }
            this.w = r;
        }
        else {
            this.x = vFrom.y * vTo.z - vFrom.z * vTo.y;
            this.y = vFrom.z * vTo.x - vFrom.x * vTo.z;
            this.z = vFrom.x * vTo.y - vFrom.y * vTo.x;
            this.w = r;
        }
        return this.normalize();
    }
    /** this = this * q（先施加 q 的旋转，再施加 this 的旋转）。 */
    multiply(q) {
        return this.multiplyQuaternions(this, q);
    }
    /** this = q * this（外旋：让 q 在 this 之后作用于向量）。 */
    premultiply(q) {
        return this.multiplyQuaternions(q, this);
    }
    /**
     * this = a * b；三个实例可以是同一个对象。
     *
     * 先把 a、b 的分量读进局部变量再写 this，所以 `multiply`/`premultiply` 直接
     * 把 this 传进来也安全（若边读边写，后几行就会用到已被覆盖的分量）。
     */
    multiplyQuaternions(a, b) {
        const qax = a.x;
        const qay = a.y;
        const qaz = a.z;
        const qaw = a.w;
        const qbx = b.x;
        const qby = b.y;
        const qbz = b.z;
        const qbw = b.w;
        this.x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
        this.y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
        this.z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
        this.w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;
        return this;
    }
    /** 共轭 q* = (-x, -y, -z, w)；单位四元数下它同时是逆旋转。 */
    conjugate() {
        // NaN 取负仍是 NaN，这里不需要额外判断。
        this.x = -this.x;
        this.y = -this.y;
        this.z = -this.z;
        return this;
    }
    /**
     * 逆：q⁻¹ = q* / |q|²，满足 q · q⁻¹ = (0, 0, 0, 1)。
     *
     * three.js 的 `invert()` 就等于 `conjugate()`（它假定调用方始终维持单位长度），
     * 但非单位四元数直接用共轭当逆会让组合旋转越算越偏。这里补上 |q|² 补偿，
     * 且只在明显偏离单位长度时才做——单位四元数的 |q|² 本来就只在 1 附近抖动
     * ~1e-16，对它做无谓的乘除只会额外引入舍入误差、偏离 three.js 的逐位结果。
     */
    invert() {
        this.conjugate();
        const lsq = this.lengthSq();
        if (lsq > 1e-24 && Math.abs(lsq - 1) > 1e-9) {
            const inv = 1 / lsq;
            this.x *= inv;
            this.y *= inv;
            this.z *= inv;
            this.w *= inv;
        }
        return this;
    }
    /**
     * 与本四元数所代表旋转的夹角（弧度，恒落在 [0, π]）。
     *
     * 取点积的绝对值：q 与 -q 表示同一旋转，不加绝对值会把「零度」算成 2π；
     * clamp 到 [-1, 1] 是因为点积经舍入后可能略大于 1，acos 会直接返回 NaN。
     */
    angleTo(q) {
        return 2 * Math.acos(Math.abs(clamp(this.dot(q), -1, 1)));
    }
    /** 球面插值：this = slerp(this, qb, t)。 */
    slerp(qb, t) {
        // 交给静态版本就地写入 this，再返回 this：静态版本声明的是 `Quaternion`，
        // 直接 return 会丢成基类类型，不满足本方法声明的多态 `this`。
        Quaternion.slerp(this, qb, this, t);
        return this;
    }
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
    static slerp(qa, qb, qm, t) {
        if (t === 0)
            return qm.copy(qa);
        if (t === 1)
            return qm.copy(qb);
        const x = qa.x;
        const y = qa.y;
        const z = qa.z;
        const w = qa.w;
        let cosHalfTheta = w * qb.w + x * qb.x + y * qb.y + z * qb.z;
        if (cosHalfTheta < 0) {
            qm.x = -qb.x;
            qm.y = -qb.y;
            qm.z = -qb.z;
            qm.w = -qb.w;
            cosHalfTheta = -cosHalfTheta;
        }
        else {
            qm.copy(qb);
        }
        if (cosHalfTheta >= 1) {
            // 两个旋转完全一致（含取反后的情形），插值结果就是 qa。
            qm.x = x;
            qm.y = y;
            qm.z = z;
            qm.w = w;
            return qm;
        }
        const sqrSinHalfTheta = 1 - cosHalfTheta * cosHalfTheta;
        if (sqrSinHalfTheta <= Number.EPSILON) {
            // 接近共线：sinHalfTheta ≈ 0，此时短弧近似为直线，改用线性插值。
            const s = 1 - t;
            qm.x = s * x + t * qm.x;
            qm.y = s * y + t * qm.y;
            qm.z = s * z + t * qm.z;
            qm.w = s * w + t * qm.w;
            return qm.normalize();
        }
        const sinHalfTheta = Math.sqrt(sqrSinHalfTheta);
        const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);
        const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
        const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
        qm.x = x * ratioA + qm.x * ratioB;
        qm.y = y * ratioA + qm.y * ratioB;
        qm.z = z * ratioA + qm.z * ratioB;
        qm.w = w * ratioA + qm.w * ratioB;
        return qm;
    }
    /**
     * 朝 q 转动，单次最多 step 弧度（不足则正好转到 q），用于每帧限速转向。
     *
     * 用 min(1, step / angle) 折算成 slerp 的比例：step 超过剩余夹角时按 1 处理，
     * 避免 t > 1 造成过冲——转向是有限步长的，不该越过目标再弹回来。
     */
    rotateTowards(q, step) {
        const angle = this.angleTo(q);
        if (angle === 0)
            return this;
        const t = Math.min(1, step / angle);
        return this.slerp(q, t);
    }
    /** 依次写入 [x, y, z, w]；缺省追加进一个新数组。 */
    toArray(array = [], offset = 0) {
        array[offset] = this.x;
        array[offset + 1] = this.y;
        array[offset + 2] = this.z;
        array[offset + 3] = this.w;
        return array;
    }
    /** 从 [x, y, z, w] 读取；接受 Float32Array 等类数组（如 uniform 回读）。 */
    fromArray(array, offset = 0) {
        this.x = array[offset];
        this.y = array[offset + 1];
        this.z = array[offset + 2];
        this.w = array[offset + 3];
        return this;
    }
    /** 连续写入目标 Float32Array（byteOffset 必须 4 字节对齐），与 Vec4.writeTo 同款。 */
    writeTo(out, byteOffset = 0) {
        out[byteOffset / 4] = this.x;
        out[byteOffset / 4 + 1] = this.y;
        out[byteOffset / 4 + 2] = this.z;
        out[byteOffset / 4 + 3] = this.w;
    }
    toString() {
        return `Quaternion(${this.x}, ${this.y}, ${this.z}, ${this.w})`;
    }
}
//# sourceMappingURL=Quaternion.js.map