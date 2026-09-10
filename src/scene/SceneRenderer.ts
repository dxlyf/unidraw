/**
 * SceneRenderer —— 场景渲染器（性能优先）：
 * - 一次自顶向下更新世界矩阵（脏标记，静止子树不重算）；
 * - 视锥剔除（世界包围球，broad phase）；
 * - 排序：renderOrder → 不透明近到远（利于 early-z）→ 半透明远到近；
 * - 复用内部数组/对象，避免逐帧 GC；
 * - 输出 stats（objects/drawn/culled/triangles），便于接入性能面板。
 */

import type { RenderPassEncoder } from "../command/encoder.js";
import type { Camera } from "../render/Camera.js";
import { Mesh } from "../render/Mesh.js";
import { Frustum } from "./Frustum.js";
import type { Node3D } from "./Node3D.js";
import type { MaterialLike } from "./types.js";
import { Vec3 } from "../math/vec3.js";

export interface RenderStats {
  /** 场景中 Mesh 总数 */
  objects: number;
  /** 实际绘制数 */
  drawn: number;
  /** 被视锥剔除数 */
  culled: number;
  /** 提交的三角形数（估算） */
  triangles: number;
  /** 场景图节点数 */
  nodes: number;
}

export interface SceneRenderOptions {
  /** 覆盖构造时的 frustumCulling 开关 */
  frustumCulling?: boolean;
  /** 覆盖构造时的排序开关 */
  sort?: boolean;
  /** 强制材质（例如颜色拾取用的 ID 材质） */
  overrideMaterial?: MaterialLike | null;
  /** 过滤（返回 false 则不绘制） */
  filter?: (mesh: Mesh) => boolean;
}

interface Item {
  mesh: Mesh;
  material: MaterialLike;
  dist: number;
  transparent: number;
  order: number;
}

export class SceneRenderer {
  frustumCulling = true;
  sort = true;
  readonly stats: RenderStats = { objects: 0, drawn: 0, culled: 0, triangles: 0, nodes: 0 };
  readonly frustum = new Frustum();

  private readonly _items: Item[] = [];
  private readonly _sorted: Item[] = [];
  private readonly _eye = new Vec3();

  render(pass: RenderPassEncoder, scene: Node3D, camera: Camera, options: SceneRenderOptions = {}): void {
    const stats = this.stats;
    stats.objects = 0;
    stats.drawn = 0;
    stats.culled = 0;
    stats.triangles = 0;
    stats.nodes = 0;

    // 1) 世界矩阵（脏标记 + 版本传播）
    scene.updateWorldMatrix(true);

    // 2) 视锥
    const useFrustum = options.frustumCulling ?? this.frustumCulling;
    if (useFrustum) this.frustum.setFromProjectionMatrix(camera.viewProjection);
    camera.getEyePosition(this._eye);

    // 3) 收集
    let count = 0;
    const items = this._items;
    const collect = (node: Node3D) => {
      stats.nodes++;
      if (!(node instanceof Mesh)) return;
      stats.objects++;
      node.updateWorldBounds();
      const material = options.overrideMaterial ?? node.material;
      if (!material) return;
      if (options.filter && !options.filter(node)) return;
      if (useFrustum && node.frustumCulled) {
        if (!this.frustum.intersectsSphere(node.worldCenter, node.worldRadius)) {
          stats.culled++;
          return;
        }
      }
      let item = items[count];
      if (!item) {
        item = { mesh: node, material, dist: 0, transparent: 0, order: 0 };
        items[count] = item;
      }
      item.mesh = node;
      item.material = material;
      item.order = node.renderOrder;
      item.transparent = material.isTransparent ? 1 : 0;
      const dx = node.worldCenter.x - this._eye.x;
      const dy = node.worldCenter.y - this._eye.y;
      const dz = node.worldCenter.z - this._eye.z;
      item.dist = dx * dx + dy * dy + dz * dz;
      count++;
    };
    scene.traverseVisible(collect);

    // 4) 排序（复用数组，避免逐帧分配）
    const list = this._sorted;
    list.length = count;
    for (let i = 0; i < count; i++) list[i] = items[i]!;
    if (options.sort ?? this.sort) {
      list.sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        if (a.transparent !== b.transparent) return a.transparent - b.transparent;
        return a.transparent ? b.dist - a.dist : a.dist - b.dist;
      });
    }

    // 5) 绘制
    for (let i = 0; i < list.length; i++) {
      const it = list[i]!;
      it.material.drawGeometry(pass, it.mesh.geometry, it.mesh.worldMatrix);
      stats.drawn++;
      const g = it.mesh.geometry;
      stats.triangles += g.indexCount > 0 ? g.indexCount / 3 : Math.floor(g.vertexCount / 3);
    }
  }
}
