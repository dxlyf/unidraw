/** 通用数学工具 */
export declare const EPSILON = 0.000001;
export declare const DEG2RAD: number;
export declare const RAD2DEG: number;
export declare function clamp(value: number, min: number, max: number): number;
export declare function lerp(a: number, b: number, t: number): number;
export declare function degToRad(deg: number): number;
export declare function radToDeg(rad: number): number;
export declare function equals(a: number, b: number, epsilon?: number): boolean;
export declare function isPowerOfTwo(value: number): boolean;
export declare function nextPowerOfTwo(value: number): number;
/** [min, max) 随机数 */
export declare function randRange(min: number, max: number): number;
//# sourceMappingURL=mmath.d.ts.map