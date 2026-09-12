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
import { Mat4 } from "../math/mat4.js";
import { Frustum } from "./Frustum.js";
import type { Node3D } from "./Node3D.js";
import type { MaterialLike } from "./types.js";
import { LightsState } from "../render/lights/LightsState.js";
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
    /**
     * 覆盖灯光数据（缺省从场景图收集；传 `null` 表示不使用灯光——
     * 此时材质退化为默认光，等价于「场景里没有任何灯」）。
     */
    lights?: LightsState | null;
    /**
     * 用这个视投影矩阵做视锥剔除（缺省用 `camera.viewProjection`）。
     *
     * 光源视角的 pass（阴影贴图）用它把剔除换成「光源视锥」，
     * 从而复用同一套世界矩阵更新/收集逻辑。
     */
    viewProjection?: Mat4;
}
export declare class SceneRenderer {
    frustumCulling: boolean;
    sort: boolean;
    readonly stats: RenderStats;
    readonly frustum: Frustum;
    private readonly _items;
    private readonly _sorted;
    private readonly _visible;
    private readonly _usedMaterials;
    private readonly _eye;
    /** 本帧灯光打包缓冲（复用） */
    private readonly lights;
    /** 退化实例绘制的临时矩阵（复用） */
    private readonly _instanceMatrix;
    /**
     * 收集「可见（已剔除、已排序）」的 Mesh。
     *
     * 供自定义 pass 复用同一套 世界矩阵更新 / 视锥剔除 / 排序 结果，
     * 例如 GPU 颜色拾取（每个物体换一个 ID 材质绘制）与阴影贴图。
     * 返回的数组是内部复用缓冲，下一次调用即失效。
     */
    collectVisible(scene: Node3D, camera: Camera, options?: SceneRenderOptions): readonly Mesh[];
    render(pass: RenderPassEncoder, scene: Node3D, camera: Camera, options?: SceneRenderOptions): void;
    /**
     * 收集灯光（`collectLights()` 的包装）：结果复用内部 `LightsState`，
     * 供自定义 pass 也拿到同一份灯光数据。
     */
    collectLightsForRender(scene: Node3D, lights?: LightsState | null): LightsState;
    /** 本帧收集到的灯光数量（不含默认光）；供 HUD/自检使用 */
    lightCount: number;
    /** 本帧是否使用了默认光（场景里没有灯） */
    usedDefaultLights: boolean;
}
//# sourceMappingURL=SceneRenderer.d.ts.map