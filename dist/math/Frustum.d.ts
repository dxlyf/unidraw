/**
 * Frustum —— 由投影·视图矩阵提取 6 个裁剪平面，用于视锥剔除。
 *
 * 支持两种 NDC 深度约定：
 * - `zZeroToOne = true`（默认，WebGPU/D3D 风格，near=0 far=1）
 * - `zZeroToOne = false`（OpenGL 风格，near=-1 far=1）
 */
import { Mat4 } from "./mat4.js";
import { Vec3 } from "./vec3.js";
import { Vec4 } from "./vec4.js";
import type { Box3 } from "./Box3.js";
import type { Sphere } from "./Sphere.js";
export declare class Frustum {
    /** left, right, bottom, top, near, far */
    readonly planes: Vec4[];
    setFromProjectionMatrix(m: Mat4, zZeroToOne?: boolean): this;
    /** 包围球是否与视锥相交/包含 */
    /**
     * 球是否与视锥相交。
     *
     * 两种调用形式都支持（后者与 three.js 一致）：
     * - `intersectsSphere(center, radius)`（本仓库原有形式，保持兼容）
     * - `intersectsSphere(sphere)`
     */
    intersectsSphere(center: Vec3, radius: number): boolean;
    intersectsSphere(sphere: Sphere): boolean;
    /** 点是否在视锥内（6 个平面都要判：少判一个会把视锥外侧当成"可见"） */
    containsPoint(point: Vec3): boolean;
    /** AABB（`Box3`）是否与视锥相交 */
    intersectsBox(box: Box3): boolean;
    clone(): Frustum;
    /** AABB 是否与视锥相交（保守：正/负顶点法） */
    intersectsAABB(min: Vec3, max: Vec3): boolean;
}
//# sourceMappingURL=Frustum.d.ts.map