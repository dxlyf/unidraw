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
export class Mesh extends Node3D {
  readonly geometry: Geometry;
  material: MaterialLike | null;
  /** 是否参与视锥剔除 */
  frustumCulled = true;
  /** 绘制排序键（越小越先画） */
  renderOrder = 0;
  /** 可选的整体颜色（由材质/自定义渲染器解释） */
  color: Color | null = null;

  /** 世界包围球缓存（SceneRenderer.updateWorldBounds 时更新） */
  readonly worldCenter = new Vec3();
  worldRadius = 0;

  constructor(geometry: Geometry, material: MaterialLike | null = null) {
    super();
    this.geometry = geometry;
    this.material = material;
    this.name = "Mesh";
  }

  /** 由几何体局部包围球 + 世界矩阵计算世界包围球 */
  updateWorldBounds(force = false): void {
    if (!force && this._boundsVersion === this.worldVersion) return;
    this._boundsVersion = this.worldVersion;
    const g = this.geometry;
    const e = this.worldMatrix.elements;
    const c = g.boundingSphereCenter;
    // 世界中心
    const w = 1 / (e[3]! * c.x + e[7]! * c.y + e[11]! * c.z + e[15]!);
    this.worldCenter.set(
      (e[0]! * c.x + e[4]! * c.y + e[8]! * c.z + e[12]!) * w,
      (e[1]! * c.x + e[5]! * c.y + e[9]! * c.z + e[13]!) * w,
      (e[2]! * c.x + e[6]! * c.y + e[10]! * c.z + e[14]!) * w,
    );
    this.worldRadius = g.boundingSphereRadius * this.getMaxWorldScale();
  }

  private _boundsVersion = -1;
}
