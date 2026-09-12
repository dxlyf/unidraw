/**
 * Raycaster —— CPU 几何拾取：屏幕 NDC → 世界射线 → 逐个 Mesh 命中三角形。
 *
 * 两级加速：
 * 1) 世界包围球（先在物体空间用局部包围球快速排除）；
 * 2) 三角形 Möller–Trumbore 精确求交（可只取最近命中）。
 *
 * 命中结果按世界距离升序返回。
 */
import { Vec3 } from "./vec3.js";
import { Ray } from "./Ray.js";
import { Mesh } from "../render/Mesh.js";
import type { Camera } from "../render/Camera.js";
import type { Node3D } from "../scene/Node3D.js";
export interface Intersection {
    object: Mesh;
    /** 世界空间距离 */
    distance: number;
    point: Vec3;
    /** 世界空间几何法线（已归一化） */
    normal: Vec3;
    /** 命中的三角形序号（geometry.indices 的第 faceIndex 个三角形） */
    faceIndex: number;
}
export interface RaycasterOptions {
    near?: number;
    far?: number;
    /** 背面剔除（默认 false，双面命中） */
    backfaceCulling?: boolean;
    /** 每个物体只取最近命中（默认 true） */
    firstHitOnly?: boolean;
}
export declare class Raycaster {
    readonly ray: Ray;
    near: number;
    far: number;
    backfaceCulling: boolean;
    firstHitOnly: boolean;
    private readonly _invWorld;
    private readonly _localOrigin;
    private readonly _localDir;
    private readonly _localRay;
    private readonly _dir;
    private readonly _near;
    private readonly _farPt;
    private readonly _v0;
    private readonly _v1;
    private readonly _v2;
    private readonly _w0;
    private readonly _w1;
    private readonly _w2;
    private readonly _normal;
    private _hits;
    constructor(options?: RaycasterOptions);
    /** 由相机 + NDC 坐标（-1..1）构建射线 */
    setFromCamera(camera: Camera, ndcX: number, ndcY: number): this;
    /** 对单个 Mesh（及其可见子树）做拾取，结果按距离升序写入 out */
    intersectObject(mesh: Mesh, recursive?: boolean, out?: Intersection[]): Intersection[];
    /** 对整个场景/节点树拾取（按距离升序） */
    intersectObjects(root: Node3D, out?: Intersection[]): Intersection[];
    /** 便捷：拾取最近的物体 */
    intersectFirst(root: Node3D): Intersection | null;
    private _intersectMesh;
}
//# sourceMappingURL=Raycaster.d.ts.map