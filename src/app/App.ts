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
import { degToRad } from "../math/mmath.js";
import { assert } from "../util/assert.js";
import type { Plugin, PluginContext } from "./Plugin.js";

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

export class App {
  readonly renderer: Renderer;
  readonly device: Device;
  readonly canvas: HTMLCanvasElement | null;
  readonly scene: Scene;
  readonly camera: Camera;
  readonly sceneRenderer: SceneRenderer;
  readonly input: InputManager | null;
  readonly mixer: AnimationMixer;
  readonly tweens = new TweenManager();
  readonly raycaster = new Raycaster();
  readonly stats: AppStats;
  readonly plugins: Plugin[] = [];
  /** 阴影渲染器（`AppOptions.shadows` 打开时非 null） */
  readonly shadows: ShadowRenderer | null;

  private readonly _options: AppOptions;
  private readonly _ownsShadows: boolean;
  private readonly _frameCallbacks = new Set<FrameCallback>();
  private readonly _ctx: PluginContext;
  private _picker: ColorPicker | null = null;
  private _running = false;
  private _disposed = false;
  private _stepping = false;
  private _rafId = 0;
  private _lastNow = 0;
  private _fpsAccum = 0;
  private _fpsFrames = 0;

  private constructor(renderer: Renderer, options: AppOptions) {
    this.renderer = renderer;
    this.device = renderer.device;
    this.canvas = renderer.canvas;
    this._options = options;
    this.scene = options.scene ?? new Scene();
    this.sceneRenderer = options.sceneRenderer ?? new SceneRenderer();
    this.camera =
      options.camera ??
      (() => {
        const cam = new Camera();
        cam.setPerspective(degToRad(60), 1, 0.1, 500);
        cam.distance = 6;
        cam.update();
        return cam;
      })();

    const wantsInput = options.input ?? true;
    this.input =
      wantsInput && renderer.canvas
        ? new InputManager(renderer.canvas, typeof options.input === "object" ? options.input : {})
        : null;
    this.mixer = new AnimationMixer(this.scene);

    // 阴影：true = 默认实例，ShadowRenderer = 复用外部实例，缺省不渲染
    if (options.shadows instanceof ShadowRenderer) {
      this.shadows = options.shadows;
      this._ownsShadows = false;
    } else if (options.shadows) {
      this.shadows = new ShadowRenderer(this.device, { label: "app-shadows", mapSize: options.shadowMapSize ?? 1024 });
      this._ownsShadows = true;
    } else {
      this.shadows = null;
      this._ownsShadows = false;
    }

    const size = this.device.presentSize();
    this.stats = {
      frames: 0,
      dt: 0,
      fps: 0,
      time: 0,
      width: size.width,
      height: size.height,
      objects: 0,
      drawn: 0,
      culled: 0,
      triangles: 0,
      nodes: 0,
    };

    this._syncAspect();
    const self = this;
    this._ctx = {
      device: this.device,
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      sceneRenderer: this.sceneRenderer,
      input: this.input,
      mixer: this.mixer,
      tweens: this.tweens,
      get picker() {
        return self._ensurePicker();
      },
      get width() {
        return self.stats.width;
      },
      get height() {
        return self.stats.height;
      },
    };
  }

  // -------------------------------------------------------------------------
  // 创建
  // -------------------------------------------------------------------------

  /** 用 canvas 创建（等价 Renderer.create + App 包装）。 */
  static async create(canvas: HTMLCanvasElement, options: AppOptions = {}): Promise<App> {
    const renderer = await Renderer.create(canvas, options);
    return new App(renderer, options);
  }

  /** 用已有 device 包装（无头测试 / 复用设备）。 */
  static fromDevice(device: Device, canvas: HTMLCanvasElement, options: AppOptions = {}): App {
    const renderer = Renderer.fromDevice(device, canvas, options);
    return new App(renderer, options);
  }

  // -------------------------------------------------------------------------
  // 扩展：插件 / 帧回调
  // -------------------------------------------------------------------------

  /** 注册插件（异步 setup 会被 await）。 */
  use(plugin: Plugin): this {
    assert(!this._disposed, "App 已销毁");
    this.plugins.push(plugin);
    const result = plugin.setup?.(this._ctx);
    if (result && typeof (result as Promise<void>).then === "function") {
      // 允许异步 setup：调用方可用 `await app.useAsync(plugin)`
      void (result as Promise<void>);
    }
    return this;
  }

  /** 注册插件并等待其 setup 完成。 */
  async useAsync(plugin: Plugin): Promise<this> {
    assert(!this._disposed, "App 已销毁");
    this.plugins.push(plugin);
    await plugin.setup?.(this._ctx);
    return this;
  }

  /** 每帧渲染通道回调（在 beforeRender 之后、afterRender 之前）。返回取消函数。 */
  onRender(callback: FrameCallback): () => void {
    this._frameCallbacks.add(callback);
    return () => this._frameCallbacks.delete(callback);
  }

  /** 懒创建的 GPU 颜色拾取器（尺寸跟随画布）。 */
  get picker(): ColorPicker {
    return this._ensurePicker();
  }

  /** 便捷：NDC → 最近命中（CPU 几何拾取）。 */
  raycast(ndc: Vec2 | { x: number; y: number }): Intersection | null {
    this.scene.updateWorldMatrix(true);
    this.raycaster.setFromCamera(this.camera, ndc.x, ndc.y);
    return this.raycaster.intersectFirst(this.scene);
  }

  // -------------------------------------------------------------------------
  // 主循环
  // -------------------------------------------------------------------------

  /** 启动 requestAnimationFrame 循环（无头环境可用 `step()` 手动驱动）。 */
  start(): this {
    if (this._running) return this;
    this._running = true;
    if (typeof requestAnimationFrame !== "function") return this;
    const loop = (now: number): void => {
      if (!this._running) return;
      if (this._lastNow === 0) this._lastNow = now;
      const dt = (now - this._lastNow) / 1000;
      this._lastNow = now;
      this.step(dt);
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
    return this;
  }

  stop(): this {
    this._running = false;
    this._lastNow = 0;
    if (typeof cancelAnimationFrame === "function" && this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    return this;
  }

  get running(): boolean {
    return this._running;
  }

  /**
   * 推进一帧（不含事件处理）。
   * @param dt 秒；内部会 clamp 到 [0, 0.25] 以避免切页/断点造成的大跳变
   */
  step(dt: number): void {
    assert(!this._disposed, "App 已销毁");
    assert(!this._stepping, "App.step() 不可重入：不要在 onRender / 插件钩子内再次调用 step()（可延后到下一帧）");
    this._stepping = true;
    try {
      this._step(dt);
    } finally {
      this._stepping = false;
    }
  }

  private _step(dt: number): void {
    const step = Math.max(0, Math.min(dt, 0.25));

    // 1) 尺寸/纵横比
    if (this._options.autoResize !== false && this.renderer.resizeToDisplaySize(this._options.maxPixelRatio ?? 2)) {
      this._syncAspect();
      this._resizeNotify();
    }
    if (this.canvas) {
      this.stats.width = this.canvas.width;
      this.stats.height = this.canvas.height;
    }

    // 2) 逻辑更新（插件 → 动画 → 补间）
    this.stats.time += step;
    this.stats.dt = step;
    for (let i = 0; i < this.plugins.length; i++) this.plugins[i]!.update?.(this._ctx, step, this.stats.time);
    this.mixer.update(step);
    this.tweens.update(step);

    // 3) 渲染通道
    //    阴影贴图必须在主 pass 之前提交（WebGPU 禁止同一 submit 内既写又读同一张纹理）
    if (this.shadows) this.shadows.renderAndSubmit(this.scene, this.camera, this.sceneRenderer, step);
    const pass = this.renderer.beginFrame();
    try {
      for (let i = 0; i < this.plugins.length; i++) this.plugins[i]!.beforeRender?.(this._ctx, pass);
      if (this._options.renderScene !== false) {
        this.sceneRenderer.render(pass, this.scene, this.camera);
        this.stats.objects = this.sceneRenderer.stats.objects;
        this.stats.drawn = this.sceneRenderer.stats.drawn;
        this.stats.culled = this.sceneRenderer.stats.culled;
        this.stats.triangles = this.sceneRenderer.stats.triangles;
        this.stats.nodes = this.sceneRenderer.stats.nodes;
      }
      for (const cb of this._frameCallbacks) cb(pass, step, this.stats.time);
      for (let i = 0; i < this.plugins.length; i++) this.plugins[i]!.afterRender?.(this._ctx, pass);
    } finally {
      this.renderer.endFrame();
    }

    // 4) stats
    this.stats.frames++;
    this._fpsAccum += step;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.25) {
      this.stats.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }
    if (this.canvas && this._picker) this._picker.resize(this.canvas.width, this.canvas.height);
  }

  /** 便捷：设置清屏色 */
  setClear(color: Color | string): this {
    this.renderer.setBackground(color);
    return this;
  }

  /**
   * 调整画布后备缓冲尺寸（像素）并通知插件。
   * `autoResize !== false` 时 App 会按 CSS 尺寸自动调用，这里供手动控制。
   */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (this.canvas) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.stats.width = w;
    this.stats.height = h;
    this._syncAspect();
    this._resizeNotify();
    this._picker?.resize(w, h);
  }

  // -------------------------------------------------------------------------
  // 销毁
  // -------------------------------------------------------------------------

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.stop();
    // 插件逆序销毁
    for (let i = this.plugins.length - 1; i >= 0; i--) this.plugins[i]!.dispose?.(this._ctx);
    this.plugins.length = 0;
    this._frameCallbacks.clear();
    this.mixer.dispose();
    this.tweens.stopAll();
    if (this._ownsShadows) this.shadows?.dispose();
    this._picker?.dispose();
    this._picker = null;
    this.input?.dispose();
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  private _ensurePicker(): ColorPicker {
    if (!this._picker) {
      const size = this.canvas ? { width: this.canvas.width, height: this.canvas.height } : this.device.presentSize();
      this._picker = new ColorPicker(this.device, { label: "app-picker", width: Math.max(1, size.width), height: Math.max(1, size.height) });
    }
    return this._picker;
  }

  private _syncAspect(): void {
    if (!this.canvas) return;
    this.camera.aspect = this.canvas.width / Math.max(1, this.canvas.height);
    this.camera.update();
  }

  private _resizeNotify(): void {
    for (let i = 0; i < this.plugins.length; i++) this.plugins[i]!.resize?.(this._ctx, this.stats.width, this.stats.height);
  }
}
