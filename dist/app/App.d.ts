/**
 * App —— 应用门面：把「设备/渲染器/场景/相机/输入/动画/拾取/插件/主循环」装在一起。
 *
 * ```ts
 * const app = await App.create(canvas, { backend: "auto", clear: "#0e0f13" });
 * app.scene.add(mesh);
 * app.use(new OrbitControlsPlugin());
 * app.onRender((pass) => { app.material.draw(pass, mesh); });
 * app.start();
 * ```
 *
 * 设计要点：
 * - **单循环**：`update`（插件 + Mixer + Tween）→ 渲染通道（beforeRender → onRender → afterRender）→ 提交；
 * - **可手动步进**：`app.step(dt)` 不依赖 requestAnimationFrame，便于无头测试与固定步长逻辑；
 * - **stats**：帧数/帧时长/FPS + `SceneRenderer` 的 objects/drawn/culled/triangles；
 * - **插件**：`use(plugin)` 支持异步 setup，生命周期见 `Plugin`。
 */
import { Renderer, type RendererOptions } from "../render/Renderer.js";
import { Camera } from "../render/Camera.js";
import { Scene } from "../scene/Scene.js";
import { SceneRenderer, type RenderStats } from "../scene/SceneRenderer.js";
import { ShadowRenderer } from "../render/shadow/ShadowRenderer.js";
import { InputManager, type InputManagerOptions } from "../interaction/InputManager.js";
import { AnimationMixer } from "../animation/AnimationMixer.js";
import { TweenManager } from "../animation/TweenManager.js";
import { ColorPicker } from "../picking/ColorPicker.js";
import { Raycaster, type Intersection } from "../interaction/Raycaster.js";
import type { Device } from "../device/Device.js";
import type { RenderPassEncoder } from "../command/encoder.js";
import type { Vec2 } from "../math/vec2.js";
import type { Color } from "../math/color.js";
import type { Plugin } from "./Plugin.js";
export interface AppOptions extends RendererOptions {
    /** 场景根（缺省新建） */
    scene?: Scene;
    /** 相机（缺省透视相机：60° / 距离 6） */
    camera?: Camera;
    /** 是否创建 InputManager（缺省 true；无 canvas 时为 false） */
    input?: boolean | InputManagerOptions;
    /** 是否自动随画布尺寸更新相机纵横比（缺省 true） */
    autoResize?: boolean;
    /** 每帧最大像素比（resizeToDisplaySize 参数，默认 2） */
    maxPixelRatio?: number;
    /** 是否用内置 SceneRenderer 绘制场景（缺省 true；false 时完全由 onRender 接管） */
    renderScene?: boolean;
    /** 内置 SceneRenderer 实例（缺省新建；便于外部读取 stats 或自定义剔除/排序） */
    sceneRenderer?: SceneRenderer;
    /**
     * 阴影：`true` = 用默认配置新建 `ShadowRenderer`；也可传入自己的实例
     * （缺省 `undefined` = 不渲染阴影，即使灯上设了 `castShadow`）。
     *
     * 打开后每帧会在主 pass **之前**自动渲染所有 `castShadow` 灯（方向光/聚光）的阴影贴图，
     * 内置受光材质自动接收阴影。
     */
    shadows?: boolean | ShadowRenderer;
    /** 阴影贴图默认边长（`shadows: true` 时生效，默认 1024） */
    shadowMapSize?: number;
}
export interface AppStats extends RenderStats {
    /** 累计帧数 */
    frames: number;
    /** 上一帧耗时（秒） */
    dt: number;
    /** 平滑后的 FPS */
    fps: number;
    /** 累计运行时间（秒） */
    time: number;
    /** 画布像素尺寸 */
    width: number;
    height: number;
}
export type FrameCallback = (pass: RenderPassEncoder, dt: number, time: number) => void;
export declare class App {
    readonly renderer: Renderer;
    readonly device: Device;
    readonly canvas: HTMLCanvasElement | null;
    readonly scene: Scene;
    readonly camera: Camera;
    readonly sceneRenderer: SceneRenderer;
    readonly input: InputManager | null;
    readonly mixer: AnimationMixer;
    readonly tweens: TweenManager;
    readonly raycaster: Raycaster;
    readonly stats: AppStats;
    readonly plugins: Plugin[];
    /** 阴影渲染器（`AppOptions.shadows` 打开时非 null） */
    readonly shadows: ShadowRenderer | null;
    private readonly _options;
    private readonly _ownsShadows;
    private readonly _frameCallbacks;
    private readonly _ctx;
    private _picker;
    private _running;
    private _disposed;
    private _stepping;
    private _rafId;
    private _lastNow;
    private _fpsAccum;
    private _fpsFrames;
    private constructor();
    /** 用 canvas 创建（等价 Renderer.create + App 包装）。 */
    static create(canvas: HTMLCanvasElement, options?: AppOptions): Promise<App>;
    /** 用已有 device 包装（无头测试 / 复用设备）。 */
    static fromDevice(device: Device, canvas: HTMLCanvasElement, options?: AppOptions): App;
    /** 注册插件（异步 setup 会被 await）。 */
    use(plugin: Plugin): this;
    /** 注册插件并等待其 setup 完成。 */
    useAsync(plugin: Plugin): Promise<this>;
    /** 每帧渲染通道回调（在 beforeRender 之后、afterRender 之前）。返回取消函数。 */
    onRender(callback: FrameCallback): () => void;
    /** 懒创建的 GPU 颜色拾取器（尺寸跟随画布）。 */
    get picker(): ColorPicker;
    /** 便捷：NDC → 最近命中（CPU 几何拾取）。 */
    raycast(ndc: Vec2 | {
        x: number;
        y: number;
    }): Intersection | null;
    /** 启动 requestAnimationFrame 循环（无头环境可用 `step()` 手动驱动）。 */
    start(): this;
    stop(): this;
    get running(): boolean;
    /**
     * 推进一帧（不含事件处理）。
     * @param dt 秒；内部会 clamp 到 [0, 0.25] 以避免切页/断点造成的大跳变
     */
    step(dt: number): void;
    private _step;
    /** 便捷：设置清屏色 */
    setClear(color: Color | string): this;
    /**
     * 调整画布后备缓冲尺寸（像素）并通知插件。
     * `autoResize !== false` 时 App 会按 CSS 尺寸自动调用，这里供手动控制。
     */
    resize(width: number, height: number): void;
    dispose(): void;
    private _ensurePicker;
    private _syncAspect;
    private _resizeNotify;
}
//# sourceMappingURL=App.d.ts.map