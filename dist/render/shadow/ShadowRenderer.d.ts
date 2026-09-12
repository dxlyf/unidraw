/**
 * ShadowRenderer —— 阴影贴图渲染（方向光 + 聚光）。
 *
 * 每帧流程（**必须在主场景绘制之前调用**）：
 * 1. 用主相机做一次可见性收集，得到场景包围球（方向光自动拟合用）；
 *    包围球会按 `shadow.stabilize` **平滑 + 纹素对齐**，避免相机/物体微动时采样网格
 *    逐纹素跳动（这是阴影"闪"的主要原因）；
 * 2. 按 `collectLights()` 的顺序遍历可见灯，把 `castShadow` 的方向光/聚光
 *    依次分到贴图池里（最多 `MAX_SHADOW_MAPS` 张），计算光源视投影矩阵；
 * 3. 每个光源一趟「只写深度」的 pass（`colorAttachments: []`），
 *    用光源视锥剔除 + `ShadowDepthMaterial`（默认渲染背面，抗自阴影）绘制；
 * 4. 把光源矩阵/偏移参数打包进共享的 `ShadowBlock`。
 *
 * 参数换算（关键，早期版本在这里踩过坑）：
 * - `shadow.bias` 是**世界单位** → 打包前除以阴影相机的深度范围（`far - near`），
 *   变成与场景尺度无关的归一化深度偏移；
 * - `shadow.normalBias = 0`（默认）时按**纹素世界尺寸**自动取 `1.5 × 纹素`；
 * - `shadow.side` 决定渲染背面/正面/双面（薄片、单面平面需要 `"front"`/`"double"`）。
 *
 * ```ts
 * const shadows = new ShadowRenderer(device);
 * sun.castShadow = true;
 * shadows.renderAndSubmit(scene, camera, sceneRenderer, dt);   // 每帧
 * ```
 *
 * 用 `App` 时不需要手动调用：`AppOptions.shadows = true` 会自动完成。
 */
import type { Device } from "../../device/Device.js";
import type { CommandEncoder } from "../../command/encoder.js";
import type { Camera } from "../Camera.js";
import type { SceneRenderer } from "../../scene/SceneRenderer.js";
import type { Node3D } from "../../scene/Node3D.js";
import { Vec3 } from "../../math/vec3.js";
import { ShadowDepthMaterial } from "./ShadowDepthMaterial.js";
import { type ShadowResources } from "./ShadowResources.js";
import { type ShadowSide } from "./ShadowSettings.js";
export interface ShadowRenderStats {
    /** 本帧渲染的阴影贴图数量 */
    maps: number;
    /** 本帧阴影 pass 里绘制的物体数（累计） */
    drawn: number;
    /** 因超出 `MAX_SHADOW_MAPS` 被跳过的投影灯数量 */
    skipped: number;
    /** 方向光拟合半径（平滑/对齐后的实际值） */
    fitRadius: number;
    /** 每个阴影纹素覆盖的世界尺寸（越小越清晰；调试/调参用） */
    texelWorld: number;
    /** 实际使用的归一化深度偏移（= bias 世界单位 / 深度范围；调试用） */
    biasDepth: number;
}
export interface ShadowRendererOptions {
    /** 默认贴图边长（像素，默认 1024；每盏灯可用 `light.shadow.mapSize` 覆盖） */
    mapSize?: number;
    /** 深度材质（缺省按需为每张贴图/每个 `side` 各建一个） */
    material?: ShadowDepthMaterial;
    label?: string;
    /**
     * 拟合平滑时间常数（秒，默认 0.3）：越大越稳但跟随越慢。
     * 只在 `shadow.stabilize !== false` 时生效。
     */
    stabilizeTau?: number;
}
export declare class ShadowRenderer {
    readonly device: Device;
    readonly resources: ShadowResources;
    readonly stats: ShadowRenderStats;
    /** 是否启用（false 时 `render()` 直接返回，不产生任何 pass） */
    enabled: boolean;
    /** 每盏灯的默认贴图边长 */
    mapSize: number;
    /** 拟合平滑时间常数（秒） */
    stabilizeTau: number;
    private readonly _camera;
    private readonly _lights;
    private readonly _center;
    private readonly _targetCenter;
    private readonly _fitCenter;
    private readonly _worldPos;
    private _radius;
    private _fitRadius;
    private _hasFit;
    private readonly _label;
    /**
     * 深度材质缓存（key = `${贴图序号}:${side}`）。
     *
     * 为什么不共用一个：深度材质的**光源矩阵写在相机 UBO 里，而 UBO 是立即写入**的，
     * 若多张贴图共用材质，同一个 submit 内后一张的矩阵会覆盖前一张 —— 表现为
     * 「第一张阴影贴图里装的是最后一张的内容」（阴影完全错位/消失）。
     */
    private readonly _materials;
    constructor(device: Device, options?: ShadowRendererOptions);
    /** 第 0 张贴图用的深度材质（自定义剔除方式时可读取；`side` 用 `materialFor`） */
    get material(): ShadowDepthMaterial;
    /** 第 `index` 张贴图、指定面选项的深度材质 */
    materialFor(index: number, side?: ShadowSide): ShadowDepthMaterial;
    /** 兼容旧名：第 `index` 张贴图的材质（默认 `side: "back"`） */
    materialAt(index: number): ShadowDepthMaterial;
    /**
     * 渲染所有投影灯的阴影贴图。
     *
     * @param encoder 目标命令编码器（阴影 pass 会排在后面记录的画布 pass 之前执行）
     * @param scene 场景根节点
     * @param camera 主相机（用于可见性收集；阴影 pass 内部用光源视锥剔除）
     * @param sceneRenderer 复用其 `collectVisible()`
     * @param dt 帧间隔（秒，用于平滑拟合；缺省 1/60）
     */
    render(encoder: CommandEncoder, scene: Node3D, camera: Camera, sceneRenderer: SceneRenderer, dt?: number): number;
    /**
     * 便捷版本：自己创建 encoder 并提交。
     *
     * **推荐用法**：WebGPU 不允许「同一 submit 内既写又读同一张纹理」，
     * 所以阴影 pass 必须与「采样阴影贴图的主 pass」分两次提交；
     * 本方法自动满足这个约束。用 `App` 时不需要手动调用（`AppOptions.shadows`）。
     */
    renderAndSubmit(scene: Node3D, camera: Camera, sceneRenderer: SceneRenderer, dt?: number): number;
    /**
     * 把阴影数据清空（本帧无阴影）。
     *
     * 用于「对比开/关阴影」这类调试：清空后着色器立即退回完全受光，
     * 不需要改动任何材质或灯光状态。
     */
    clear(): void;
    /**
     * 清掉平滑拟合的状态：下一帧的包围球会**立刻**按当前可见物体重算（不做平滑）。
     *
     * 用途：相机瞬移、切换场景、自检里换测量目标 —— 这些情况下不需要平滑过渡。
     */
    resetFit(): void;
    /** 释放阴影资源（贴图池 + 深度材质）。设备销毁时可选调用。 */
    dispose(): void;
    /**
     * 计算主相机可见物体构成的包围球（中心 + 半径），并做稳定化：
     *
     * 1. **平滑**：半径变大立刻跟随（不漏阴影）、变小按时间常数收敛；
     * 2. **量化半径**：把「纹素世界尺寸」量化到 1-2-5 阶梯（例如 0.02 / 0.05 / 0.1），
     *    于是纹素大小（= 采样网格密度）在绝大部分时间保持不变 —— 否则半径每帧微调，
     *    阴影贴图的采样网格就每帧漂移，表现为「影子一直闪」；
     * 3. **量化中心**：把拟合中心对齐到 1/16 半径的网格（配合 `fitDirectional` 里的
     *    光源位置纹素对齐，采样网格在轻推相机时纹丝不动）。
     */
    private _collectBounds;
    /** 把目标包围球转成「稳定」的拟合参数（平滑 + 纹素尺寸量化 + 中心量化） */
    private _applyFit;
    /** 当前方向光阴影拟合中心的只读快照（调试/自检用） */
    get boundsCenter(): Readonly<Vec3>;
    /** 当前方向光阴影拟合半径（量化后的实际值；调试/自检用） */
    get boundsRadius(): number;
    /** 最近一次收集到的灯节点数量（含不投影的；调试/自检用） */
    get lightCount(): number;
}
//# sourceMappingURL=ShadowRenderer.d.ts.map