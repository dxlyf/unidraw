/** 通用数学工具 */
export const EPSILON = 1e-6;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
}
export function lerp(a, b, t) {
    return a + (b - a) * t;
}
export function degToRad(deg) {
    return deg * DEG2RAD;
}
export function radToDeg(rad) {
    return rad * RAD2DEG;
}
export function equals(a, b, epsilon = EPSILON) {
    return Math.abs(a - b) <= epsilon;
}
export function isPowerOfTwo(value) {
    return value > 0 && (value & (value - 1)) === 0;
}
export function nextPowerOfTwo(value) {
    let n = value;
    if (n <= 0)
        return 1;
    n -= 1;
    n |= n >>> 1;
    n |= n >>> 2;
    n |= n >>> 4;
    n |= n >>> 8;
    n |= n >>> 16;
    return n + 1;
}
/** [min, max) 随机数 */
export function randRange(min, max) {
    return min + Math.random() * (max - min);
}
//# sourceMappingURL=mmath.js.map