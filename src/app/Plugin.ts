/**
 * Plugin —— App 的扩展点。
 *
 * 生命周期（按注册顺序依次调用，dispose 逆序）：
 *   setup → (update → beforeRender → afterRender)* → resize / dispose
 *
 * - `setup`：App 已就绪（device/renderer/scene/camera/input 都能用）；
 *   需要异步资源时返回 Promise（`App` 会 await `use()`）；
 * - `update`：每帧、在渲染之前（动画/逻辑）；
 * - `beforeRender` / `afterRender`：进入/离开渲染通道时（可叠加描边、UI、后处理）；
 * - `resize`：画布像素尺寸变化时；
 * - `dispose`：App 销毁时（释放纹理/监听等）。
 */

import type { RenderPassEncoder } from "../command/encoder.js";
import type { Device } from "../device/Device.js";
import type { Camera } from "../render/Camera.js";
import type { Renderer } from "../render/Renderer.js";
import type { Scene } from "../scene/Scene.js";
import type { SceneRenderer } from "../scene/SceneRenderer.js";
import type { InputManager } from "../interaction/InputManager.js";
import type { AnimationMixer } from "../animation/AnimationMixer.js";
import type { TweenManager } from "../animation/TweenManager.js";
import type { ColorPicker } from "../picking/ColorPicker.js";

/** 插件可用的上下文（由 App 创建，生命周期与 App 一致） */
export interface PluginContext {
  readonly device: Device;
  readonly renderer: Renderer;
  readonly scene: Scene;
  readonly camera: Camera;
  readonly sceneRenderer: SceneRenderer;
  readonly input: InputManager | null;
  readonly mixer: AnimationMixer;
  readonly tweens: TweenManager;
  /** 懒创建的 GPU 颜色拾取器（首次访问时创建） */
  readonly picker: ColorPicker;
  /** 当前画布像素尺寸 */
  readonly width: number;
  readonly height: number;
}

export interface Plugin {
  /** 插件名（调试/HUD 用） */
  readonly name?: string;
  setup?(ctx: PluginContext): void | Promise<void>;
  update?(ctx: PluginContext, dt: number, time: number): void;
  beforeRender?(ctx: PluginContext, pass: RenderPassEncoder): void;
  afterRender?(ctx: PluginContext, pass: RenderPassEncoder): void;
  resize?(ctx: PluginContext, width: number, height: number): void;
  dispose?(ctx: PluginContext): void;
}

/** 类型辅助：让插件对象字面量获得完整类型检查 */
export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}

/** 插件集合的辅助基类（可选继承，省去手写 name） */
export abstract class BasePlugin implements Plugin {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
}
