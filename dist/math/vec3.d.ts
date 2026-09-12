import type { Mat4 } from "./mat4.js";
import { Quaternion } from "./Quaternion.js";
import type { Euler } from "./Euler.js";
import type { Cylindrical } from "./Cylindrical.js";
import type { Spherical } from "./Spherical.js";
export declare class Vec3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
    static zero(): Vec3;
    static one(): Vec3;
    set(x: number, y: number, z: number): this;
    copy(v: Vec3): this;
    clone(): Vec3;
    add(v: Vec3): this;
    sub(v: Vec3): this;
    multiplyScalar(s: number): this;
    lengthSq(): number;
    length(): number;
    distanceTo(v: Vec3): number;
    distanceToSq(v: Vec3): number;
    normalize(): this;
    negate(): this;
    /**
     * 将点（w=1）变换到 Mat4 坐标系（列主序）。
     */
    applyMat4(m: Mat4): this;
    /**
     * 将方向（w=0）变换到 Mat4 坐标系（忽略平移）。
     */
    applyMat4Dir(m: Mat4): this;
    equals(v: Vec3, epsilon?: number): boolean;
    /** 分量级夹取 */
    clamp(min: Vec3, max: Vec3): this;
    dot(v: Vec3): number;
    /** 叉积（结果写回 this；用 crossVectors 可避免别名问题） */
    cross(v: Vec3): this;
    crossVectors(a: Vec3, b: Vec3): this;
    addScaledVector(v: Vec3, s: number): this;
    lerp(v: Vec3, t: number): this;
    /**
     * 用 4×4 矩阵变换（**列主序**：`m[row][col] = elements[col*4 + row]`）。
     * 与 three.js 的 `Vector3.applyMatrix4` 同款：w ≠ 1 时做透视除法。
     */
    applyMatrix4(m: Mat4): this;
    /** 只取 3×3 部分变换方向再归一化（法线/朝向；不要用于位置） */
    transformDirection(m: Mat4): this;
    /** 绕四元数旋转（three.js 的等价实现，无矩阵分配） */
    applyQuaternion(q: Quaternion): this;
    /** 绕欧拉角旋转（内部转四元数，顺序由 `e.order` 决定） */
    applyEuler(e: Euler): this;
    setFromSpherical(s: Spherical): this;
    setFromSphericalCoords(radius: number, phi: number, theta: number): this;
    setFromCylindrical(c: Cylindrical): this;
    setFromCylindricalCoords(radius: number, theta: number, y: number): this;
    toString(): string;
}
export declare function vec3Dot(a: Vec3, b: Vec3): number;
export declare function vec3Cross(a: Vec3, b: Vec3, out?: Vec3): Vec3;
export declare function vec3Lerp(a: Vec3, b: Vec3, t: number, out?: Vec3): Vec3;
//# sourceMappingURL=vec3.d.ts.map