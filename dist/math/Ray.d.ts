/**
 * Ray —— 三维射线，提供包围球/AABB/三角形求交（用于 CPU 几何拾取）。
 */
import { Vec3 } from "./vec3.js";
export declare class Ray {
    readonly origin: Vec3;
    readonly direction: Vec3;
    set(origin: Vec3, direction: Vec3): this;
    at(t: number, out?: Vec3): Vec3;
    /** 与球求交，返回最近的正向 t；未命中返回 null */
    intersectSphere(center: Vec3, radius: number): number | null;
    /** 与 AABB 求交（slab 法），返回进入 t（原点在盒内返回 0）；未命中 null */
    intersectAABB(min: Vec3, max: Vec3): number | null;
    /**
     * Möller–Trumbore 三角形求交（默认双面）。
     * 注意：direction 可以不归一化（用于把射线变换到物体空间后保持世界参数 t 一致）。
     */
    intersectTriangle(a: Vec3, b: Vec3, c: Vec3, backfaceCulling?: boolean): number | null;
}
//# sourceMappingURL=Ray.d.ts.map