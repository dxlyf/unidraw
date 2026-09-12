import { Node3D } from "../scene/Node3D.js";
import { Vec3 } from "../math/vec3.js";
/**
 * Mesh —— 可渲染对象（场景图节点）。
 *
 * 兼容旧用法：`const mesh = new Mesh(geometry); mesh.model.translate(...)`
 * （`model` 是局部矩阵的别名）。新用法可挂到父节点下，配合 `SceneRenderer`
 * 使用世界矩阵渲染 + 视锥剔除。
 */
export class Mesh extends Node3D {
    geometry;
    material;
    /** 是否参与视锥剔除 */
    frustumCulled = true;
    /** 绘制排序键（越小越先画） */
    renderOrder = 0;
    /** 可选的整体颜色（由材质/自定义渲染器解释） */
    color = null;
    /** 世界包围球缓存（SceneRenderer.updateWorldBounds 时更新） */
    worldCenter = new Vec3();
    worldRadius = 0;
    constructor(geometry, material = null) {
        super();
        this.geometry = geometry;
        this.material = material;
        this.name = "Mesh";
    }
    /** 由几何体局部包围球 + 世界矩阵计算世界包围球 */
    updateWorldBounds(force = false) {
        if (!force && this._boundsVersion === this.worldVersion)
            return;
        this._boundsVersion = this.worldVersion;
        this.applyBoundsFromLocalSphere(this.geometry.boundingSphereCenter, this.geometry.boundingSphereRadius);
    }
    /**
     * 用「局部空间包围球」更新世界包围球（子类覆盖 `updateWorldBounds` 时复用）。
     *
     * @internal 供 `InstancedMesh` 等需要自定义包围球的子类使用
     */
    applyBoundsFromLocalSphere(center, radius) {
        const e = this.worldMatrix.elements;
        // 世界中心
        const w = 1 / (e[3] * center.x + e[7] * center.y + e[11] * center.z + e[15]);
        this.worldCenter.set((e[0] * center.x + e[4] * center.y + e[8] * center.z + e[12]) * w, (e[1] * center.x + e[5] * center.y + e[9] * center.z + e[13]) * w, (e[2] * center.x + e[6] * center.y + e[10] * center.z + e[14]) * w);
        this.worldRadius = radius * this.getMaxWorldScale();
    }
    /** 包围球缓存对应的世界矩阵版本（子类可读写，用于自己的缓存判定） */
    _boundsVersion = -1;
}
//# sourceMappingURL=Mesh.js.map