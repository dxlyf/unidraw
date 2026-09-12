import { Mat4 } from "./mat4.js";
import { equals as numEquals } from "./mmath.js";
import { Vec3, vec3Cross, vec3Dot } from "./vec3.js";
/** 模块级临时量：这些方法常位于每帧的热路径上，避免每次调用都新建向量 */
const _v1 = new Vec3();
const _v2 = new Vec3();
/**
 * Plane —— 平面，由单位法线 `normal` 与常数 `constant` 定义：`normal · p + constant = 0`。
 * 法线单位化时，`constant` 的几何含义是「原点到平面的有符号距离 × -1」。
 *
 * 与 three.js 一致：法线**必须**是单位向量，否则所有距离量（`distanceToPoint` 等）都会被缩放；
 * 通过 `setComponents` 直接构造后请调用 `normalize()`。
 */
export class Plane {
    isPlane = true;
    normal;
    constant;
    constructor(normal = new Vec3(0, 1, 0), constant = 0) {
        this.normal = normal;
        this.constant = constant;
    }
    /** 复制法线（而非持有引用），避免调用方之后修改自己的向量时悄悄改变本平面 */
    set(normal, constant) {
        this.normal.copy(normal);
        this.constant = constant;
        return this;
    }
    setComponents(x, y, z, w) {
        this.normal.set(x, y, z);
        this.constant = w;
        return this;
    }
    setFromNormalAndCoplanarPoint(normal, point) {
        this.normal.copy(normal);
        // 平面过 point 等价于 normal · point + constant = 0
        this.constant = -vec3Dot(point, this.normal);
        return this;
    }
    setFromCoplanarPoints(a, b, c) {
        // 法线 = (c - b) × (a - b)：与 three.js 同序，保证与三角形绕序约定一致
        _v1.copy(c).sub(b);
        _v2.copy(a).sub(b);
        vec3Cross(_v1, _v2, _v1).normalize();
        return this.setFromNormalAndCoplanarPoint(_v1, a);
    }
    clone() {
        return new Plane(this.normal.clone(), this.constant);
    }
    copy(p) {
        this.normal.copy(p.normal);
        this.constant = p.constant;
        return this;
    }
    /** 单位化法线，并按同一比例缩放 constant：两者必须同步，否则平面会平移 */
    normalize() {
        const len = this.normal.length();
        if (len > 1e-12) {
            const inv = 1 / len;
            this.normal.multiplyScalar(inv);
            this.constant *= inv;
        }
        return this;
    }
    /** 翻转法线朝向（constant 同步取反），平面本身不动 */
    negate() {
        this.normal.negate();
        this.constant = -this.constant;
        return this;
    }
    /** 点到平面的有符号距离：>0 在法线一侧，<0 在另一侧，=0 在平面上 */
    distanceToPoint(p) {
        return vec3Dot(this.normal, p) + this.constant;
    }
    /** 球面到平面的最短距离（可为负，表示平面穿过球体） */
    distanceToSphere(s) {
        return this.distanceToPoint(s.center) - s.radius;
    }
    /** 点沿法线在平面上的投影（最近点） */
    projectPoint(p, target) {
        const distance = this.distanceToPoint(p);
        // 先把点拷进临时量，这样即使 target === p 也能得到正确结果
        _v1.copy(p);
        return target.copy(this.normal).multiplyScalar(-distance).add(_v1);
    }
    /** 与 projectPoint 等价（保留 three.js 的历史命名），语义同为「平面上的最近点」 */
    orthoPoint(point, target) {
        return this.projectPoint(point, target);
    }
    /**
     * 线段与平面求交；返回交点，线段与平面无交点时返回 null。
     *
     * 判据：把线段写成 `start + t · (end - start)`（t ∈ [0,1]），代入平面方程解出 t；
     * t 落在 [0,1] 之外说明交点在线段延长线上，视为不相交。
     */
    intersectLine(line, target) {
        const direction = _v1.copy(line.end).sub(line.start);
        const denominator = vec3Dot(this.normal, direction);
        if (Math.abs(denominator) < 1e-12) {
            // 线段平行于平面：共面时三点重合，返回起点；否则无交点
            return numEquals(this.distanceToPoint(line.start), 0) ? target.copy(line.start) : null;
        }
        const t = -(vec3Dot(this.normal, line.start) + this.constant) / denominator;
        if (t < 0 || t > 1)
            return null;
        // 先算到临时量再拷贝，兼容 target 与线段端点共用同一实例的写法
        _v2.copy(direction).multiplyScalar(t).add(line.start);
        return target.copy(_v2);
    }
    /**
     * 线段是否穿过平面。
     *
     * 判据与 three.js 相同：两端点相对平面的符号严格相反才算「穿过」，
     * 因此端点恰好落在平面上时返回 false；需要包含端点请用 `intersectLine(...) !== null`。
     */
    intersectsLine(line) {
        const startSign = this.distanceToPoint(line.start);
        const endSign = this.distanceToPoint(line.end);
        return (startSign < 0 && endSign > 0) || (endSign < 0 && startSign > 0);
    }
    /** 包围盒是否与平面相交（委托给 Box3 的正/负顶点判据） */
    intersectsBox(box) {
        return box.intersectsPlane(this);
    }
    /** 球体是否与平面相交（委托给 Sphere 的球心距判据） */
    intersectsSphere(sphere) {
        return sphere.intersectsPlane(this);
    }
    /** 平面上的一个点：沿法线从原点走到平面，即 -constant · normal */
    coplanarPoint(target) {
        return target.copy(this.normal).multiplyScalar(-this.constant);
    }
    /**
     * 用矩阵变换平面（点用 m、法线用逆转置矩阵）。
     *
     * 为什么法线不能直接用 m 乘：非等比缩放或剪切下，`m · n` 不再垂直于变换后的平面
     * （例如沿 x 放大 2 倍时法线的 x 分量应缩小而非放大），必须使用 (m⁻¹)ᵀ。
     * 这里先对 m 求逆，再按「逆矩阵的转置」形式做乘法；法线矩阵只差一个正标量因子，
     * 之后的 `normalize()` 会把它消掉。可选参数 `optionalNormalMatrix` 允许调用方复用
     * 预先算好的法线矩阵（例如一个场景只求一次）。
     */
    applyMatrix4(m, optionalNormalMatrix) {
        // 参考点要用完整矩阵（含平移）变换，所以必须在修改 normal 之前取出
        const referencePoint = this.coplanarPoint(_v1).applyMat4(m);
        const n = this.normal;
        if (optionalNormalMatrix) {
            // 调用方给出的已是 (m⁻¹)ᵀ，直接作为 3x3 矩阵作用到方向上
            _v2.copy(n).applyMat4Dir(optionalNormalMatrix);
            n.copy(_v2);
        }
        else {
            const inverse = Mat4.inverse(m);
            if (inverse) {
                const e = inverse.elements;
                // result_i = Σ_j inverse[j][i] · n_j（列主序下 inverse[j][i] = e[i*4 + j]）
                _v2.set(e[0] * n.x + e[1] * n.y + e[2] * n.z, e[4] * n.x + e[5] * n.y + e[6] * n.z, e[8] * n.x + e[9] * n.y + e[10] * n.z);
                n.copy(_v2);
            }
            // 不可逆（退化）时保留原法线方向，仅让 constant 跟随参考点走
        }
        n.normalize();
        this.constant = -vec3Dot(referencePoint, n);
        return this;
    }
    /** 平移平面（法线不变，只改 constant） */
    translate(offset) {
        this.constant -= vec3Dot(offset, this.normal);
        return this;
    }
    equals(p, epsilon) {
        return numEquals(this.constant, p.constant, epsilon) && this.normal.equals(p.normal, epsilon);
    }
    toString() {
        return `Plane(normal: ${this.normal.toString()}, constant: ${this.constant.toFixed(3)})`;
    }
}
//# sourceMappingURL=Plane.js.map