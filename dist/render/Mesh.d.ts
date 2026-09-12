import { Node3D } from "../scene/Node3D.js";
import type { MaterialLike } from "../scene/types.js";
import type { Geometry } from "./Geometry.js";
import type { Color } from "../math/color.js";
import { Vec3 } from "../math/vec3.js";
/**
 * Mesh —— 可渲染对象（场景图节点）。
 *
 * 兼容旧用法：`const mesh = new Mesh(geometry); mesh.model.translate(...)`
 * （`model` 是局部矩阵的别名）。新用法可挂到父节点下，配合 `SceneRenderer`
 * 使用世界矩阵渲染 + 视锥剔除。
 */
export declare class Mesh extends Node3D {
    readonly geometry: Geometry;
    material: MaterialLike | null;
    /** 是否参与视锥剔除 */
    frustumCulled: boolean;
    /** 绘制排序键（越小越先画） */
    renderOrder: number;
    /** 可选的整体颜色（由材质/自定义渲染器解释） */
    color: Color | null;
    /** 世界包围球缓存（SceneRenderer.updateWorldBounds 时更新） */
    readonly worldCenter: Vec3;
    worldRadius: number;
    constructor(geometry: Geometry, material?: MaterialLike | null);
    /** 由几何体局部包围球 + 世界矩阵计算世界包围球 */
    updateWorldBounds(force?: boolean): void;
    /**
     * 用「局部空间包围球」更新世界包围球（子类覆盖 `updateWorldBounds` 时复用）。
     *
     * @internal 供 `InstancedMesh` 等需要自定义包围球的子类使用
     */
    protected applyBoundsFromLocalSphere(center: Vec3, radius: number): void;
    /** 包围球缓存对应的世界矩阵版本（子类可读写，用于自己的缓存判定） */
    protected _boundsVersion: number;
}
//# sourceMappingURL=Mesh.d.ts.map