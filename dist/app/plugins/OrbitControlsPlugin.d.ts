/**
 * OrbitControlsPlugin —— 轨道相机插件（拖拽旋转 / 滚轮缩放）。
 *
 * 与 examples/common 的演示版不同：这里完全基于 `InputManager`（NDC + 生命周期都在框架内），
 * 注册到 `App` 后自动随 App 销毁；`dragging` / `draggedDistance` 供拾取逻辑判断
 * “这次 pointerup 是拖拽而不是点击”。
 */
import { BasePlugin, type PluginContext } from "../Plugin.js";
export interface OrbitControlsOptions {
    /** 旋转灵敏度（弧度/像素），默认 0.005 */
    rotateSpeed?: number;
    /** 缩放灵敏度，默认 0.002 */
    zoomSpeed?: number;
    /** 最近距离，默认 0.5 */
    minDistance?: number;
    /** 最远距离，默认 500 */
    maxDistance?: number;
    /** 俯仰角下限（弧度），默认 -89° */
    minPitch?: number;
    /** 俯仰角上限（弧度），默认 89° */
    maxPitch?: number;
    /** 是否允许拖拽旋转（默认 true） */
    enableRotate?: boolean;
    /** 是否允许滚轮缩放（默认 true） */
    enableZoom?: boolean;
    /** 拖拽超过该像素数（CSS px）视为“拖动”而不是“点击”，默认 4 */
    dragThreshold?: number;
}
export declare class OrbitControlsPlugin extends BasePlugin {
    rotateSpeed: number;
    zoomSpeed: number;
    minDistance: number;
    maxDistance: number;
    minPitch: number;
    maxPitch: number;
    enableRotate: boolean;
    enableZoom: boolean;
    dragThreshold: number;
    /** 当前是否正在拖拽 */
    dragging: boolean;
    /** 本次拖拽累计位移（CSS 像素） */
    draggedDistance: number;
    private _lastX;
    private _lastY;
    private readonly _off;
    constructor(options?: OrbitControlsOptions);
    /** 本次交互是否应当被当作「点击」（供拾取插件使用） */
    get isClick(): boolean;
    setup(ctx: PluginContext): void;
    dispose(): void;
}
//# sourceMappingURL=OrbitControlsPlugin.d.ts.map