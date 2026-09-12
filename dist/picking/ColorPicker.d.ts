/**
 * ColorPicker —— GPU 颜色拾取。
 *
 * 原理：把场景用「ID 材质」离屏渲染到一张 rgba8unorm 纹理（每个物体一种 ID 颜色），
 * 然后回读鼠标处的 1×1 像素，颜色即物体编号。
 *
 * 与射线拾取（Raycaster）相比：
 * - 颜色拾取是**逐像素精确**的（三角形级、含 alpha 裁剪/蒙版逻辑），天然支持任意几何；
 * - 但需要一次额外渲染 + 一次 GPU→CPU 回读（异步，几百微秒~几毫秒），不适合每帧每物体。
 *
 * 推荐用法：hover/click 时拾取（示例 examples/picking），或用 `render()` + 多次
 * `pickPixel()` 复用同一次 ID pass。
 */
import type { Device } from "../device/Device.js";
import type { Camera } from "../render/Camera.js";
import type { Mesh } from "../render/Mesh.js";
import type { Node3D } from "../scene/Node3D.js";
import { SceneRenderer } from "../scene/SceneRenderer.js";
export interface NdcPoint {
    /** -1..1，右为正 */
    x: number;
    /** -1..1，上为正（与 WebGPU NDC 一致） */
    y: number;
}
export interface ColorPickResult {
    /** 命中的 Mesh；未命中为 null */
    mesh: Mesh | null;
    /** 物体编号（0 = 背景） */
    id: number;
    /** 读回的颜色（0..255） */
    color: {
        r: number;
        g: number;
        b: number;
        a: number;
    };
    /** 拾取点（NDC） */
    ndc: NdcPoint;
    /** 拾取点（ID 目标像素，左上原点） */
    pixel: {
        x: number;
        y: number;
    };
}
export interface ColorPickerOptions {
    /** ID 目标宽度（缺省取画布尺寸） */
    width?: number;
    /** ID 目标高度（缺省取画布尺寸） */
    height?: number;
    /** 复用外部 SceneRenderer（默认内部新建） */
    sceneRenderer?: SceneRenderer;
    label?: string;
}
export interface ColorPickOptions {
    /** 过滤参与拾取的对象 */
    filter?: (mesh: Mesh) => boolean;
    /**
     * 是否重绘 ID pass。
     *
     * 缺省 **true**（`pick` / `pickMany` 每次都用当前场景与相机重新渲染 ID pass）——
     * 相机/物体一旦变化，复用旧的 ID 目标会读到「上一帧的对象」，
     * 表现为 hover/点击高亮到错误物体。
     *
     * 只有在「场景与相机在本帧内不会变化」且需要连续查询多个点时，
     * 才应显式传 `refresh: false`（或先手动 `render()` 再 `pickPixel()`）。
     */
    refresh?: boolean;
}
export declare class ColorPicker {
    readonly device: Device;
    readonly sceneRenderer: SceneRenderer;
    private _color;
    private _depth;
    private _material;
    private _width;
    private _height;
    private _idToMesh;
    private _dirty;
    private readonly _label;
    private readonly _eye;
    constructor(device: Device, options?: ColorPickerOptions);
    /** 当前 ID 目标尺寸。 */
    get size(): {
        width: number;
        height: number;
    };
    /** 最近一次 ID pass 中「编号 → Mesh」的映射（索引即编号，0 为背景）。 */
    get idMap(): readonly (Mesh | null)[];
    /** 是否需要重绘 ID pass（例如场景/相机变化后）。 */
    get dirty(): boolean;
    /** 标记 ID pass 失效（下一帧 pick 会重绘）。 */
    invalidate(): void;
    /**
     * 渲染 ID pass：把场景中可见物体用 ID 材质画进离屏目标。
     * 返回参与拾取的物体数。
     */
    render(scene: Node3D, camera: Camera, options?: ColorPickOptions): number;
    /**
     * 用当前场景与相机渲染 ID pass，然后读取指定 NDC 处的物体。
     *
     * 默认每次都会重绘（`options.refresh !== false`）：这是最不容易用错的语义 ——
     * ID 目标一旦过期（相机转动、物体移动/增删），复用它会拾取到错误的物体。
     * 同一帧内查询多个点时请用 `pickMany`（一次重绘 + 一次回读）。
     */
    pick(scene: Node3D, camera: Camera, ndc: NdcPoint, options?: ColorPickOptions): Promise<ColorPickResult>;
    /**
     * 一次回读多个 NDC 点（一次重绘 + 一次 GPU→CPU 往返）。
     * 与 `pick` 相同：默认重绘 ID pass。
     */
    pickMany(scene: Node3D, camera: Camera, points: readonly NdcPoint[], options?: ColorPickOptions): Promise<ColorPickResult[]>;
    /**
     * 只回读像素，**要求最近一次 `render()` / `pick()` 的 ID pass 仍然有效**。
     *
     * 适合：先在静止场景上 `render()`，然后连续查询多个点（或配合 `invalidate()`
     * 手工管理失效）。场景/相机变化后必须 `render()` 或 `invalidate()`，否则会读到旧帧。
     */
    pickPixel(ndc: NdcPoint): Promise<ColorPickResult>;
    /**
     * 回读整个 ID 目标（调试用）：返回左上原点、紧凑 RGBA。
     * 配合 `idMap` 可以排查「ID pass 是否为空 / 编号是否对得上」这类问题。
     */
    readTargetPixels(): Promise<Uint8Array>;
    /** NDC（-1..1，上为正）→ ID 目标像素（左上原点）。 */
    ndcToPixel(ndc: NdcPoint): {
        x: number;
        y: number;
    };
    /** 目标尺寸变化时重建离屏资源（画布 resize 后调用）。 */
    resize(width: number, height: number): void;
    dispose(): void;
    private decode;
    private ensureTargets;
}
//# sourceMappingURL=ColorPicker.d.ts.map