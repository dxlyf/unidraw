/**
 * HighlightPlugin —— 悬停/选中高亮插件（GPU 颜色拾取 + 材质接管）。
 *
 * 用法：
 * ```ts
 * app.use(new HighlightPlugin({
 *   highlight: new UnlitColorMaterial(device, new Color().setHex("#ffe066")),
 *   skipWhileDragging: () => orbit.dragging,   // 拖动相机时不拾取
 *   onHover: (mesh) => console.log(mesh?.name),
 *   onSelect: (mesh) => { ... },
 * }));
 * ```
 *
 * 语义：
 * - **选中（selected）与悬停（hovered）可以同时高亮**：插件用一张 Map 记住每个被
 *   接管材质对象的原材质，离开高亮集合时精确恢复，不会互相踩掉；
 * - 每次拾取都用当前场景/相机重绘 ID pass（`autoInvalidate=true`，默认），
 *   避免读到过期 ID 目标导致「高亮到错误物体」；若要省一次 pass，可设
 *   `autoInvalidate: false` 并在场景/相机变化后自己调用 `invalidate()`；
 * - 拾取是异步的（一次 GPU→CPU 回读）：鼠标快速移动时高亮会略微滞后于光标；
 *   需要「零延迟、与光标严格一致」的悬停反馈时，建议用同步的 `Raycaster`
 *   （见 examples/picking）。
 */
import { BasePlugin, type PluginContext } from "../Plugin.js";
import type { MaterialLike } from "../../scene/types.js";
import type { Mesh } from "../../render/Mesh.js";
import type { Camera } from "../../render/Camera.js";
import type { Node3D } from "../../scene/Node3D.js";
import type { ColorPickOptions, ColorPickResult } from "../../picking/ColorPicker.js";
/** 可替换的拾取来源（默认用 `ctx.picker`，即 GPU 颜色拾取） */
export interface PickSource {
    pick(scene: Node3D, camera: Camera, ndc: {
        x: number;
        y: number;
    }, options?: ColorPickOptions): Promise<ColorPickResult>;
}
export interface HighlightPluginOptions {
    /** 高亮材质（必填） */
    highlight: MaterialLike;
    /** 是否响应悬停（默认 true） */
    hover?: boolean;
    /** 是否响应点击选中（默认 true） */
    select?: boolean;
    /**
     * 悬停拾取前是否重绘 ID pass（默认 true）。
     * 设为 false 可省一次 ID pass，但场景/相机变化后必须自行 `invalidate()`。
     */
    autoInvalidate?: boolean;
    /** 拾取范围过滤 */
    filter?: (mesh: Mesh) => boolean;
    /** 自定义拾取来源（默认 `ctx.picker`；也可换成射线拾取的适配器） */
    picker?: PickSource;
    onHover?(mesh: Mesh | null): void;
    onSelect?(mesh: Mesh | null): void;
    /** 返回 true 时跳过拾取（例如正在拖动相机） */
    skipWhileDragging?: () => boolean;
}
export declare class HighlightPlugin extends BasePlugin {
    private readonly _options;
    private readonly _off;
    private readonly _taken;
    private _hovered;
    private _selected;
    private _pending;
    private _picker;
    private _picking;
    private _ctx;
    constructor(options: HighlightPluginOptions);
    get hovered(): Mesh | null;
    get selected(): Mesh | null;
    /** 当前被高亮接管的对象数（选中 + 悬停，去重） */
    get highlightedCount(): number;
    /** 标记「ID 目标已过期」（`autoInvalidate: false` 时场景/相机变化后调用） */
    invalidate(): void;
    setup(ctx: PluginContext): void;
    update(ctx: PluginContext, dt: number): void;
    /** 清空选中（保留悬停状态） */
    clearSelection(): void;
    /**
     * 以给定 NDC **立即**拾取并更新悬停状态（供程序化调用：触摸、外部射线拾取、测试）。
     * 返回命中的 Mesh。
     */
    hoverAt(ndc: {
        x: number;
        y: number;
    }): Promise<Mesh | null>;
    /** 以给定 NDC **立即**拾取并更新选中状态。返回命中的 Mesh。 */
    selectAt(ndc: {
        x: number;
        y: number;
    }): Promise<Mesh | null>;
    dispose(): void;
    private _requireCtx;
    private _pick;
    private _applyHover;
    private _applySelect;
    /** 让「选中 ∪ 悬停」都处于高亮：接管缺失的，恢复多余的 */
    private _refresh;
}
//# sourceMappingURL=HighlightPlugin.d.ts.map