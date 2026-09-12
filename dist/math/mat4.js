import { assertFinite } from "../util/assert.js";
import { clamp } from "./mmath.js";
/** decompose 用的模块级临时量（惰性创建：类声明前不能 new Mat4，否则 TDZ） */
let _decomposeScratch = null;
export class Mat4 {
    elements;
    constructor() {
        this.elements = new Float32Array(16);
        this.setIdentity();
    }
    static identity() {
        return new Mat4();
    }
    setIdentity() {
        this.elements.fill(0);
        const e = this.elements;
        e[0] = 1;
        e[5] = 1;
        e[10] = 1;
        e[15] = 1;
        return this;
    }
    copy(m) {
        this.elements.set(m.elements);
        return this;
    }
    clone() {
        return new Mat4().copy(this);
    }
    /** this = this * rhs */
    multiply(rhs) {
        Mat4.multiply(this, rhs, this);
        return this;
    }
    /** this = lhs * this */
    premultiply(lhs) {
        Mat4.multiply(lhs, this, this);
        return this;
    }
    /** out = a * b；a 或 b 可与 out 相同。 */
    static multiply(a, b, out = new Mat4()) {
        const ae = a.elements;
        const be = b.elements;
        const te = out.elements;
        for (let c = 0; c < 4; c++) {
            for (let r = 0; r < 4; r++) {
                let sum = 0;
                for (let k = 0; k < 4; k++) {
                    sum += ae[k * 4 + r] * be[c * 4 + k];
                }
                te[c * 4 + r] = sum;
            }
        }
        return out;
    }
    /** this = this * T(x,y,z) */
    translate(x, y, z) {
        const e = this.elements;
        e[12] += e[0] * x + e[4] * y + e[8] * z;
        e[13] += e[1] * x + e[5] * y + e[9] * z;
        e[14] += e[2] * x + e[6] * y + e[10] * z;
        e[15] += e[3] * x + e[7] * y + e[11] * z;
        return this;
    }
    rotateX(rad) {
        return this.rotateAxis(1, 0, 0, rad);
    }
    rotateY(rad) {
        return this.rotateAxis(0, 1, 0, rad);
    }
    rotateZ(rad) {
        return this.rotateAxis(0, 0, 1, rad);
    }
    /** this = this * R(axis, rad)，axis 无需单位化。 */
    rotateAxis(axisX, axisY, axisZ, rad) {
        const len = Math.hypot(axisX, axisY, axisZ);
        if (len < 1e-12)
            return this;
        const x = axisX / len;
        const y = axisY / len;
        const z = axisZ / len;
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        const t = 1 - c;
        const m = new Float32Array(16);
        m[0] = t * x * x + c;
        m[1] = t * x * y + s * z;
        m[2] = t * x * z - s * y;
        m[4] = t * x * y - s * z;
        m[5] = t * y * y + c;
        m[6] = t * y * z + s * x;
        m[8] = t * x * z + s * y;
        m[9] = t * y * z - s * x;
        m[10] = t * z * z + c;
        m[15] = 1;
        const e = this.elements;
        const tmp = new Float32Array(16);
        for (let c0 = 0; c0 < 4; c0++) {
            for (let r = 0; r < 4; r++) {
                let sum = 0;
                for (let k = 0; k < 4; k++) {
                    sum += e[k * 4 + r] * m[c0 * 4 + k];
                }
                tmp[c0 * 4 + r] = sum;
            }
        }
        e.set(tmp);
        return this;
    }
    /** 欧拉旋转（弧度，外旋 Z→Y→X，等价于矩阵 Rz * Ry * Rx）。 */
    rotateEuler(xRad, yRad, zRad) {
        const cx = Math.cos(xRad);
        const sx = Math.sin(xRad);
        const cy = Math.cos(yRad);
        const sy = Math.sin(yRad);
        const cz = Math.cos(zRad);
        const sz = Math.sin(zRad);
        const m = new Float32Array(16);
        m[0] = cy * cz;
        m[1] = cy * sz;
        m[2] = -sy;
        m[4] = sx * sy * cz - cx * sz;
        m[5] = sx * sy * sz + cx * cz;
        m[6] = sx * cy;
        m[8] = cx * sy * cz + sx * sz;
        m[9] = cx * sy * sz - sx * cz;
        m[10] = cx * cy;
        m[15] = 1;
        const e = this.elements;
        const tmp = new Float32Array(16);
        for (let c = 0; c < 4; c++) {
            for (let r = 0; r < 4; r++) {
                let sum = 0;
                for (let k = 0; k < 4; k++) {
                    sum += e[k * 4 + r] * m[c * 4 + k];
                }
                tmp[c * 4 + r] = sum;
            }
        }
        e.set(tmp);
        return this;
    }
    scale(x, y, z) {
        const e = this.elements;
        e[0] *= x;
        e[1] *= x;
        e[2] *= x;
        e[3] *= x;
        e[4] *= y;
        e[5] *= y;
        e[6] *= y;
        e[7] *= y;
        e[8] *= z;
        e[9] *= z;
        e[10] *= z;
        e[11] *= z;
        return this;
    }
    /** 由平移/旋转/缩放组合出 TRS 矩阵（R 为 3x3 旋转矩阵，按列主序传入 9 个数）。 */
    static fromTRS(tx, ty, tz, rx3x3, sx, sy, sz) {
        const out = new Mat4();
        const e = out.elements;
        // 列0~2 = R 的列乘以各自缩放
        for (let c = 0; c < 3; c++) {
            const s = c === 0 ? sx : c === 1 ? sy : sz;
            e[c * 4] = rx3x3[c * 3] * s;
            e[c * 4 + 1] = rx3x3[c * 3 + 1] * s;
            e[c * 4 + 2] = rx3x3[c * 3 + 2] * s;
        }
        e[3] = 0;
        e[7] = 0;
        e[11] = 0;
        e[12] = tx;
        e[13] = ty;
        e[14] = tz;
        e[15] = 1;
        return out;
    }
    /**
     * 右手系透视投影，NDC 深度约定 **z ∈ [0, 1]**（WebGPU/D3D 风格，Zero-to-One）。
     *
     * 为什么用 ZO：WebGPU 只接受 z∈[0,1]，而 WebGL2 接受 z∈[-1,1]（[0,1] 是其子集），
     * 因此同一矩阵在两种后端都正确；GL 风格（z∈[-1,1]）在 WebGPU 上会把近平面到
     * 中段的深度裁掉。需要 GL 约定时用 `perspectiveGL`。
     */
    static perspective(fovYRad, aspect, near, far) {
        assertFinite(fovYRad, "fovY");
        assertFinite(aspect, "aspect");
        const out = new Mat4();
        const e = out.elements;
        const f = 1 / Math.tan(clamp(fovYRad, 1e-4, Math.PI - 1e-4) / 2);
        e.fill(0);
        e[0] = f / aspect;
        e[5] = f;
        e[10] = far / (near - far);
        e[11] = -1;
        e[14] = (far * near) / (near - far);
        return out;
    }
    /** OpenGL 风格透视（NDC 深度 z ∈ [-1, 1]）；仅在与自定义 GL 管线对接时使用 */
    static perspectiveGL(fovYRad, aspect, near, far) {
        const out = new Mat4();
        const e = out.elements;
        const f = 1 / Math.tan(clamp(fovYRad, 1e-4, Math.PI - 1e-4) / 2);
        e.fill(0);
        e[0] = f / aspect;
        e[5] = f;
        e[10] = (far + near) / (near - far);
        e[11] = -1;
        e[14] = (2 * far * near) / (near - far);
        return out;
    }
    /**
     * 正交投影。与 `perspective()` 一样使用 **ZO 约定**（NDC z ∈ [0,1]，
     * near 平面 → 0，far 平面 → 1），因此两个后端的裁剪与深度测试行为一致；
     * 需要 GL 的 `[-1,1]` 时可自行缩放（见 `perspectiveGL` 的说明）。
     */
    static ortho(left, right, bottom, top, near, far) {
        const out = new Mat4();
        const e = out.elements;
        const lr = 1 / (right - left);
        const bt = 1 / (top - bottom);
        const nf = 1 / (near - far);
        e.fill(0);
        e[0] = 2 * lr;
        e[5] = 2 * bt;
        e[10] = nf;
        e[12] = -(right + left) * lr;
        e[13] = -(top + bottom) * bt;
        e[14] = near * nf;
        e[15] = 1;
        return out;
    }
    /** 观察矩阵（右手系，摄像机看向 -Z）。 */
    static lookAt(eyeX, eyeY, eyeZ, centerX, centerY, centerZ, upX = 0, upY = 1, upZ = 0) {
        let zx = eyeX - centerX;
        let zy = eyeY - centerY;
        let zz = eyeZ - centerZ;
        let zl = Math.hypot(zx, zy, zz);
        if (zl < 1e-12) {
            zx = 0;
            zy = 0;
            zz = 1;
            zl = 1;
        }
        zx /= zl;
        zy /= zl;
        zz /= zl;
        let xx = upY * zz - upZ * zy;
        let xy = upZ * zx - upX * zz;
        let xz = upX * zy - upY * zx;
        let xl = Math.hypot(xx, xy, xz);
        if (xl < 1e-12) {
            xx = 1;
            xy = 0;
            xz = 0;
            xl = 1;
        }
        xx /= xl;
        xy /= xl;
        xz /= xl;
        const yx = zy * xz - zz * xy;
        const yy = zz * xx - zx * xz;
        const yz = zx * xy - zy * xx;
        const out = new Mat4();
        const e = out.elements;
        e[0] = xx;
        e[1] = yx;
        e[2] = zx;
        e[3] = 0;
        e[4] = xy;
        e[5] = yy;
        e[6] = zy;
        e[7] = 0;
        e[8] = xz;
        e[9] = yz;
        e[10] = zz;
        e[11] = 0;
        e[12] = -(xx * eyeX + xy * eyeY + xz * eyeZ);
        e[13] = -(yx * eyeX + yy * eyeY + yz * eyeZ);
        e[14] = -(zx * eyeX + zy * eyeY + zz * eyeZ);
        e[15] = 1;
        return out;
    }
    /** 行列式（高斯消元，带部分主元）。 */
    determinant() {
        const a = new Float64Array(this.elements);
        let det = 1;
        for (let col = 0; col < 4; col++) {
            // 部分主元
            let pivot = col;
            for (let r = col + 1; r < 4; r++) {
                if (Math.abs(a[r * 4 + col]) > Math.abs(a[pivot * 4 + col]))
                    pivot = r;
            }
            if (Math.abs(a[pivot * 4 + col]) < 1e-18)
                return 0;
            if (pivot !== col) {
                for (let c = col; c < 4; c++) {
                    const tmp = a[col * 4 + c];
                    a[col * 4 + c] = a[pivot * 4 + c];
                    a[pivot * 4 + c] = tmp;
                }
                det = -det;
            }
            const p = a[col * 4 + col];
            det *= p;
            for (let r = col + 1; r < 4; r++) {
                const f = a[r * 4 + col] / p;
                if (f === 0)
                    continue;
                for (let c = col; c < 4; c++) {
                    a[r * 4 + c] = a[r * 4 + c] - f * a[col * 4 + c];
                }
            }
        }
        return det;
    }
    /** 原地求逆（高斯-约当）；不可逆时保持原样并返回 false。 */
    invert() {
        const m = this.elements;
        const a = new Float64Array(m);
        const inv = new Float64Array(16);
        for (let i = 0; i < 4; i++)
            inv[i * 4 + i] = 1;
        for (let col = 0; col < 4; col++) {
            let pivot = col;
            for (let r = col + 1; r < 4; r++) {
                if (Math.abs(a[r * 4 + col]) > Math.abs(a[pivot * 4 + col]))
                    pivot = r;
            }
            if (Math.abs(a[pivot * 4 + col]) < 1e-18)
                return false;
            if (pivot !== col) {
                for (let c = 0; c < 4; c++) {
                    const t = a[col * 4 + c];
                    a[col * 4 + c] = a[pivot * 4 + c];
                    a[pivot * 4 + c] = t;
                    const u = inv[col * 4 + c];
                    inv[col * 4 + c] = inv[pivot * 4 + c];
                    inv[pivot * 4 + c] = u;
                }
            }
            const p = a[col * 4 + col];
            for (let c = 0; c < 4; c++) {
                a[col * 4 + c] = a[col * 4 + c] / p;
                inv[col * 4 + c] = inv[col * 4 + c] / p;
            }
            for (let r = 0; r < 4; r++) {
                if (r === col)
                    continue;
                const f = a[r * 4 + col];
                if (f === 0)
                    continue;
                for (let c = 0; c < 4; c++) {
                    a[r * 4 + c] = a[r * 4 + c] - f * a[col * 4 + c];
                    inv[r * 4 + c] = inv[r * 4 + c] - f * inv[col * 4 + c];
                }
            }
        }
        m.set(inv);
        return true;
    }
    static inverse(a, out = new Mat4()) {
        out.copy(a);
        return out.invert() ? out : null;
    }
    /** 连续写入目标 Float32Array（byteOffset 必须 4 字节对齐）。 */
    writeTo(out, byteOffset = 0) {
        out.set(this.elements, byteOffset / 4);
    }
    /**
     * 由四元数**构造**旋转矩阵（覆盖平移/缩放；元素按列主序写入，
     * 即 `m[row][col] = elements[col*4 + row]`）。
     */
    makeRotationFromQuaternion(q) {
        const e = this.elements;
        const x = q.x, y = q.y, z = q.z, w = q.w;
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, xy = x * y2, xz = x * z2;
        const yy = y * y2, yz = y * z2, zz = z * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;
        e[0] = 1 - (yy + zz);
        e[4] = xy - wz;
        e[8] = xz + wy;
        e[1] = xy + wz;
        e[5] = 1 - (xx + zz);
        e[9] = yz - wx;
        e[2] = xz - wy;
        e[6] = yz + wx;
        e[10] = 1 - (xx + yy);
        e[3] = 0;
        e[7] = 0;
        e[11] = 0;
        e[12] = 0;
        e[13] = 0;
        e[14] = 0;
        e[15] = 1;
        return this;
    }
    /** 位置 + 旋转 + 缩放 → TRS 矩阵（与 `decompose` 互为逆运算） */
    compose(position, quaternion, scale) {
        this.makeRotationFromQuaternion(quaternion);
        const e = this.elements;
        const sx = scale.x, sy = scale.y, sz = scale.z;
        e[0] *= sx;
        e[1] *= sx;
        e[2] *= sx;
        e[4] *= sy;
        e[5] *= sy;
        e[6] *= sy;
        e[8] *= sz;
        e[9] *= sz;
        e[10] *= sz;
        e[12] = position.x;
        e[13] = position.y;
        e[14] = position.z;
        return this;
    }
    /**
     * 分解 TRS。缩放取三列长度（行列式为负说明含镜像，X 取负），
     * 再把 3×3 归一化后交给四元数求解 —— 与 three.js 同款做法。
     */
    decompose(position, quaternion, scale) {
        const e = this.elements;
        let sx = Math.hypot(e[0], e[1], e[2]);
        const sy = Math.hypot(e[4], e[5], e[6]);
        const sz = Math.hypot(e[8], e[9], e[10]);
        if (this.determinant() < 0)
            sx = -sx;
        position.set(e[12], e[13], e[14]);
        const scratch = (_decomposeScratch ??= new Mat4());
        scratch.copy(this);
        const invSX = sx !== 0 ? 1 / sx : 0;
        const invSY = sy !== 0 ? 1 / sy : 0;
        const invSZ = sz !== 0 ? 1 / sz : 0;
        const me = scratch.elements;
        me[0] *= invSX;
        me[1] *= invSX;
        me[2] *= invSX;
        me[4] *= invSY;
        me[5] *= invSY;
        me[6] *= invSY;
        me[8] *= invSZ;
        me[9] *= invSZ;
        me[10] *= invSZ;
        me[12] = 0;
        me[13] = 0;
        me[14] = 0;
        quaternion.setFromRotationMatrix(scratch);
        scale.set(sx, sy, sz);
        return this;
    }
    /** 直接写平移分量（列主序：第 12/13/14 个元素） */
    setPosition(x, y, z) {
        const e = this.elements;
        e[12] = x;
        e[13] = y;
        e[14] = z;
        return this;
    }
    /** 转置（原地） */
    transpose() {
        const e = this.elements;
        let tmp = e[1];
        e[1] = e[4];
        e[4] = tmp;
        tmp = e[2];
        e[2] = e[8];
        e[8] = tmp;
        tmp = e[6];
        e[6] = e[9];
        e[9] = tmp;
        tmp = e[3];
        e[3] = e[12];
        e[12] = tmp;
        tmp = e[7];
        e[7] = e[13];
        e[13] = tmp;
        tmp = e[11];
        e[11] = e[14];
        e[14] = tmp;
        return this;
    }
    /** 只保留 `m` 的旋转部分（各列归一化，去掉缩放） */
    extractRotation(m) {
        const me = m.elements;
        const e = this.elements;
        let inv = 1 / (Math.hypot(me[0], me[1], me[2]) || 1);
        e[0] = me[0] * inv;
        e[1] = me[1] * inv;
        e[2] = me[2] * inv;
        inv = 1 / (Math.hypot(me[4], me[5], me[6]) || 1);
        e[4] = me[4] * inv;
        e[5] = me[5] * inv;
        e[6] = me[6] * inv;
        inv = 1 / (Math.hypot(me[8], me[9], me[10]) || 1);
        e[8] = me[8] * inv;
        e[9] = me[9] * inv;
        e[10] = me[10] * inv;
        e[3] = 0;
        e[7] = 0;
        e[11] = 0;
        e[12] = 0;
        e[13] = 0;
        e[14] = 0;
        e[15] = 1;
        return this;
    }
    equals(other, epsilon = 1e-6) {
        const a = this.elements;
        const b = other.elements;
        for (let i = 0; i < 16; i++) {
            if (Math.abs(a[i] - b[i]) > epsilon)
                return false;
        }
        return true;
    }
    toString() {
        const e = this.elements;
        const row = (r) => [e[r], e[4 + r], e[8 + r], e[12 + r]].map((v) => v.toFixed(3)).join(", ");
        return `Mat4(\n  [${row(0)}]\n  [${row(1)}]\n  [${row(2)}]\n  [${row(3)}]\n)`;
    }
}
//# sourceMappingURL=mat4.js.map