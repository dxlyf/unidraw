import { equals as numEquals } from "./mmath.js";
import { Quaternion } from "./Quaternion.js";
/** applyEuler 用的模块级临时量（避免每次调用都分配） */
const scratchQuaternion = new Quaternion();
export class Vec3 {
    x;
    y;
    z;
    constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
    static zero() {
        return new Vec3(0, 0, 0);
    }
    static one() {
        return new Vec3(1, 1, 1);
    }
    set(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }
    copy(v) {
        this.x = v.x;
        this.y = v.y;
        this.z = v.z;
        return this;
    }
    clone() {
        return new Vec3(this.x, this.y, this.z);
    }
    add(v) {
        this.x += v.x;
        this.y += v.y;
        this.z += v.z;
        return this;
    }
    sub(v) {
        this.x -= v.x;
        this.y -= v.y;
        this.z -= v.z;
        return this;
    }
    multiplyScalar(s) {
        this.x *= s;
        this.y *= s;
        this.z *= s;
        return this;
    }
    lengthSq() {
        return this.x * this.x + this.y * this.y + this.z * this.z;
    }
    length() {
        return Math.sqrt(this.lengthSq());
    }
    distanceTo(v) {
        return Math.sqrt(this.distanceToSq(v));
    }
    distanceToSq(v) {
        const dx = this.x - v.x;
        const dy = this.y - v.y;
        const dz = this.z - v.z;
        return dx * dx + dy * dy + dz * dz;
    }
    normalize() {
        const len = this.length();
        if (len > 1e-12) {
            const inv = 1 / len;
            this.x *= inv;
            this.y *= inv;
            this.z *= inv;
        }
        return this;
    }
    negate() {
        this.x = -this.x;
        this.y = -this.y;
        this.z = -this.z;
        return this;
    }
    /**
     * 将点（w=1）变换到 Mat4 坐标系（列主序）。
     */
    applyMat4(m) {
        const e = m.elements;
        const x = this.x;
        const y = this.y;
        const z = this.z;
        const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
        this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
        this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
        this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
        return this;
    }
    /**
     * 将方向（w=0）变换到 Mat4 坐标系（忽略平移）。
     */
    applyMat4Dir(m) {
        const e = m.elements;
        const x = this.x;
        const y = this.y;
        const z = this.z;
        this.x = e[0] * x + e[4] * y + e[8] * z;
        this.y = e[1] * x + e[5] * y + e[9] * z;
        this.z = e[2] * x + e[6] * y + e[10] * z;
        return this;
    }
    equals(v, epsilon) {
        return numEquals(this.x, v.x, epsilon) && numEquals(this.y, v.y, epsilon) && numEquals(this.z, v.z, epsilon);
    }
    /** 分量级夹取 */
    clamp(min, max) {
        this.x = Math.min(Math.max(this.x, min.x), max.x);
        this.y = Math.min(Math.max(this.y, min.y), max.y);
        this.z = Math.min(Math.max(this.z, min.z), max.z);
        return this;
    }
    dot(v) {
        return this.x * v.x + this.y * v.y + this.z * v.z;
    }
    /** 叉积（结果写回 this；用 crossVectors 可避免别名问题） */
    cross(v) {
        return this.crossVectors(this, v);
    }
    crossVectors(a, b) {
        const ax = a.x, ay = a.y, az = a.z;
        const bx = b.x, by = b.y, bz = b.z;
        this.x = ay * bz - az * by;
        this.y = az * bx - ax * bz;
        this.z = ax * by - ay * bx;
        return this;
    }
    addScaledVector(v, s) {
        this.x += v.x * s;
        this.y += v.y * s;
        this.z += v.z * s;
        return this;
    }
    lerp(v, t) {
        this.x += (v.x - this.x) * t;
        this.y += (v.y - this.y) * t;
        this.z += (v.z - this.z) * t;
        return this;
    }
    /**
     * 用 4×4 矩阵变换（**列主序**：`m[row][col] = elements[col*4 + row]`）。
     * 与 three.js 的 `Vector3.applyMatrix4` 同款：w ≠ 1 时做透视除法。
     */
    applyMatrix4(m) {
        const e = m.elements;
        const x = this.x, y = this.y, z = this.z;
        const w = e[3] * x + e[7] * y + e[11] * z + e[15];
        const inv = w !== 0 && w !== 1 ? 1 / w : 1;
        this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * inv;
        this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * inv;
        this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * inv;
        return this;
    }
    /** 只取 3×3 部分变换方向再归一化（法线/朝向；不要用于位置） */
    transformDirection(m) {
        const e = m.elements;
        const x = this.x, y = this.y, z = this.z;
        this.x = e[0] * x + e[4] * y + e[8] * z;
        this.y = e[1] * x + e[5] * y + e[9] * z;
        this.z = e[2] * x + e[6] * y + e[10] * z;
        return this.normalize();
    }
    /** 绕四元数旋转（three.js 的等价实现，无矩阵分配） */
    applyQuaternion(q) {
        const x = this.x, y = this.y, z = this.z;
        const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
        const ix = qw * x + qy * z - qz * y;
        const iy = qw * y + qz * x - qx * z;
        const iz = qw * z + qx * y - qy * x;
        const iw = -qx * x - qy * y - qz * z;
        this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
        this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
        this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
        return this;
    }
    /** 绕欧拉角旋转（内部转四元数，顺序由 `e.order` 决定） */
    applyEuler(e) {
        return this.applyQuaternion(scratchQuaternion.setFromEuler(e));
    }
    setFromSpherical(s) {
        return this.setFromSphericalCoords(s.radius, s.phi, s.theta);
    }
    setFromSphericalCoords(radius, phi, theta) {
        const sinPhi = Math.sin(phi);
        this.x = radius * sinPhi * Math.sin(theta);
        this.y = radius * Math.cos(phi);
        this.z = radius * sinPhi * Math.cos(theta);
        return this;
    }
    setFromCylindrical(c) {
        return this.setFromCylindricalCoords(c.radius, c.theta, c.y);
    }
    setFromCylindricalCoords(radius, theta, y) {
        this.x = radius * Math.sin(theta);
        this.y = y;
        this.z = radius * Math.cos(theta);
        return this;
    }
    toString() {
        return `Vec3(${this.x.toFixed(3)}, ${this.y.toFixed(3)}, ${this.z.toFixed(3)})`;
    }
}
export function vec3Dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function vec3Cross(a, b, out = new Vec3()) {
    const ax = a.x;
    const ay = a.y;
    const az = a.z;
    const bx = b.x;
    const by = b.y;
    const bz = b.z;
    out.x = ay * bz - az * by;
    out.y = az * bx - ax * bz;
    out.z = ax * by - ay * bx;
    return out;
}
export function vec3Lerp(a, b, t, out = new Vec3()) {
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    return out;
}
//# sourceMappingURL=vec3.js.map