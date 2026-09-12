import { equals as numEquals } from "./mmath.js";
export class Vec4 {
    x;
    y;
    z;
    w;
    constructor(x = 0, y = 0, z = 0, w = 1) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }
    static zero() {
        return new Vec4(0, 0, 0, 0);
    }
    set(x, y, z, w) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
        return this;
    }
    copy(v) {
        this.x = v.x;
        this.y = v.y;
        this.z = v.z;
        this.w = v.w;
        return this;
    }
    clone() {
        return new Vec4(this.x, this.y, this.z, this.w);
    }
    add(v) {
        this.x += v.x;
        this.y += v.y;
        this.z += v.z;
        this.w += v.w;
        return this;
    }
    scale(s) {
        this.x *= s;
        this.y *= s;
        this.z *= s;
        this.w *= s;
        return this;
    }
    lengthSq() {
        return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
    }
    length() {
        return Math.sqrt(this.lengthSq());
    }
    equals(v, epsilon) {
        return (numEquals(this.x, v.x, epsilon) &&
            numEquals(this.y, v.y, epsilon) &&
            numEquals(this.z, v.z, epsilon) &&
            numEquals(this.w, v.w, epsilon));
    }
    /** 连续写入 Float32Array（用于 uniform/顶点上传）。 */
    writeTo(out, byteOffset = 0) {
        out[byteOffset / 4] = this.x;
        out[byteOffset / 4 + 1] = this.y;
        out[byteOffset / 4 + 2] = this.z;
        out[byteOffset / 4 + 3] = this.w;
    }
    toString() {
        return `Vec4(${this.x}, ${this.y}, ${this.z}, ${this.w})`;
    }
}
export function vec4Dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}
//# sourceMappingURL=vec4.js.map