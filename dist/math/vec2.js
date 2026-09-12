import { equals as numEquals } from "./mmath.js";
export class Vec2 {
    x;
    y;
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }
    static zero() {
        return new Vec2(0, 0);
    }
    static one() {
        return new Vec2(1, 1);
    }
    set(x, y) {
        this.x = x;
        this.y = y;
        return this;
    }
    copy(v) {
        this.x = v.x;
        this.y = v.y;
        return this;
    }
    clone() {
        return new Vec2(this.x, this.y);
    }
    add(v) {
        this.x += v.x;
        this.y += v.y;
        return this;
    }
    sub(v) {
        this.x -= v.x;
        this.y -= v.y;
        return this;
    }
    scale(s) {
        this.x *= s;
        this.y *= s;
        return this;
    }
    lengthSq() {
        return this.x * this.x + this.y * this.y;
    }
    length() {
        return Math.sqrt(this.lengthSq());
    }
    normalize() {
        const len = this.length();
        if (len > 1e-12) {
            this.x /= len;
            this.y /= len;
        }
        return this;
    }
    equals(v, epsilon) {
        return numEquals(this.x, v.x, epsilon) && numEquals(this.y, v.y, epsilon);
    }
    toString() {
        return `Vec2(${this.x}, ${this.y})`;
    }
}
export function vec2Dot(a, b) {
    return a.x * b.x + a.y * b.y;
}
export function vec2Lerp(a, b, t, out = new Vec2()) {
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    return out;
}
//# sourceMappingURL=vec2.js.map