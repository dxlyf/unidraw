/**
 * Renderer —— 面向 canvas 的极简渲染会话门面：
 * 封装 设备创建 / 逐帧 render pass（画布 + 深度）/ 提交 / 自适应尺寸。
 */

import { createDevice, type CreateDeviceOptions } from "../device/createDevice.js";
import type { Device } from "../device/Device.js";
import { Color } from "../math/color.js";
import { Mat4 } from "../math/mat4.js";
import type { RenderPassEncoder } from "../command/encoder.js";
import type { CommandEncoder } from "../command/encoder.js";
import { assert } from "../util/assert.js";
import { clamp } from "../math/mmath.js";
import { setLogLevel, LogLevel } from "../util/logger.js";

export interface RendererOptions extends CreateDeviceOptions {
  /** 背景色（hex 或 Color），默认 #0e0f13 */
  background?: string | Color;
  /** 每帧是否附带深度附件（默认 true） */
  depth?: boolean;
  /** ?debug=1 时输出日志 */
  debug?: boolean;
}

export class Renderer {
  readonly device: Device;
  readonly canvas: HTMLCanvasElement;
  readonly depthEnabled: boolean;
  private _background: Color;
  private _encoder: CommandEncoder | null = null;
  private _pass: RenderPassEncoder | null = null;

  private constructor(device: Device, canvas: HTMLCanvasElement, options: RendererOptions) {
    this.device = device;
    this.canvas = canvas;
    this.depthEnabled = options.depth !== false;
    const bg = typeof options.background === "string" ? new Color().setHex(options.background) : (options.background ?? new Color(0.055, 0.06, 0.075, 1));
    this._background = bg.clone();
    if (options.debug || typeof location !== "undefined" && /[?&]debug=1/.test(location.search)) {
      setLogLevel(LogLevel.Debug);
    }
  }

  static async create(canvas: HTMLCanvasElement, options: RendererOptions = {}): Promise<Renderer> {
    const device = await createDevice({ canvas, backend: options.backend, webgl2: options.webgl2, webgpu: options.webgpu });
    return new Renderer(device, canvas, options);
  }

  /** 使用已创建的 device 包装（如 mock）。 */
  static fromDevice(device: Device, canvas: HTMLCanvasElement, options: Omit<RendererOptions, "canvas"> = {}): Renderer {
    return new Renderer(device, canvas, { ...options, backend: device.kind });
  }

  get background(): Color {
    return this._background;
  }

  setBackground(color: Color | string): this {
    if (typeof color === "string") this._background.setHex(color);
    else this._background.copy(color);
    return this;
  }

  /** 按 CSS 尺寸 × devicePixelRatio 设置 drawing buffer。返回是否变化。 */
  resizeToDisplaySize(maxPixelRatio = 2): boolean {
    const ratio = clamp(typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1, 1, maxPixelRatio);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * ratio));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * ratio));
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  /**
   * 开始一帧：创建 command encoder + 画布 render pass。
   * 完成后必须调用 endFrame()。
   */
  beginFrame(clear?: Color | string): RenderPassEncoder {
    assert(!this._pass, "上一帧尚未 endFrame");
    if (clear) this.setBackground(clear);
    this._encoder = this.device.createCommandEncoder("frame");
    this._pass = this._encoder.beginRenderPass({
      label: "canvas",
      colorAttachments: [
        {
          view: null,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: this._background.r, g: this._background.g, b: this._background.b, a: this._background.a },
        },
      ],
      depthStencilAttachment: this.depthEnabled
        ? { view: null, depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1 }
        : null,
    });
    return this._pass;
  }

  /** 结束本帧并提交。 */
  endFrame(): void {
    assert(this._pass && this._encoder, "beginFrame 未调用");
    this._pass.end();
    const buffer = this._encoder.finish();
    this.device.submit([buffer]);
    this._pass = null;
    this._encoder = null;
  }

  /** 便捷：单次帧回调。 */
  renderFrame(callback: (pass: RenderPassEncoder) => void): void {
    const pass = this.beginFrame();
    callback(pass);
    this.endFrame();
  }

  /** 便捷：单次帧回调 + 相机矩阵（等价 beginFrame + 手动 beginFrame(material)）。 */
  render(callback: (pass: RenderPassEncoder, time: number, dt: number) => void): void {
    const now = performance.now();
    const pass = this.beginFrame();
    callback(pass, now, now - (this._lastTime ?? now));
    this._lastTime = now;
    this.endFrame();
  }

  private _lastTime: number | undefined;

  destroy(): void {
    this.device.destroy();
  }
}

export { Mat4 };
