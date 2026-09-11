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
import { setLogLevel, LogLevel, logger } from "../util/logger.js";
import { RenderTarget } from "./RenderTarget.js";
import { CopyPass } from "./postfx/CopyPass.js";

export interface RendererOptions extends CreateDeviceOptions {
  /** 背景色（hex 或 Color），默认 #0e0f13 */
  background?: string | Color;
  /** 每帧是否附带深度附件（默认 true） */
  depth?: boolean;
  /** ?debug=1 时输出日志 */
  debug?: boolean;
  /**
   * MSAA 采样数（默认 4；`1` = 关闭，超过 `device.limits.maxSamples` 自动降级）。
   *
   * 为什么默认开：几何边缘的抗锯齿在**两种后端上必须显式开启**才一致 ——
   * WebGL2 的 canvas 上下文默认 `antialias: true`（隐式 MSAA），WebGPU 的 canvas 则
   * 完全没有 MSAA。CPU 三角化出来的 2D 路径/斜线/圆弧在 WebGPU 上因此是硬锯齿，
   * 与原生 Canvas2D（永远抗锯齿）差距很大。这里统一渲染到一张 4x MSAA 离屏目标、
   * 解析后再呈现到画布，两端得到**相同**的采样数。
   */
  msaa?: number;
}

export class Renderer {
  readonly device: Device;
  readonly canvas: HTMLCanvasElement;
  readonly depthEnabled: boolean;
  /** 实际生效的 MSAA 采样数（1 = 关闭） */
  readonly sampleCount: number;
  private _background: Color;
  private _encoder: CommandEncoder | null = null;
  private _pass: RenderPassEncoder | null = null;
  private _msaaTarget: RenderTarget | null = null;
  private _presentPass: CopyPass | null = null;

  private constructor(device: Device, canvas: HTMLCanvasElement, options: RendererOptions) {
    this.device = device;
    this.canvas = canvas;
    this.depthEnabled = options.depth !== false;
    const requested = Math.max(1, Math.floor(options.msaa ?? 4));
    this.sampleCount = Math.min(requested, Math.max(1, device.limits.maxSamples ?? 1));
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

  /**
   * 按 CSS 尺寸 × devicePixelRatio 设置 drawing buffer。返回是否变化。
   *
   * 注意：canvas **必须有 CSS 尺寸**（例如 `width:100vw;height:100vh`）。
   * 若没有 CSS 尺寸，canvas 的显示尺寸就等于 drawing buffer 尺寸，
   * 此时再乘 devicePixelRatio 会让 buffer 每帧翻倍（无限增长、画面被推到视口外）；
   * 这种情况会跳过放大并给出一次性警告。
   */
  resizeToDisplaySize(maxPixelRatio = 2): boolean {
    const canvas = this.canvas;
    const ratio = clamp(typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1, 1, maxPixelRatio);
    const cssWidth = canvas.clientWidth || canvas.width;
    const cssHeight = canvas.clientHeight || canvas.height;
    const w = Math.max(1, Math.floor(cssWidth * ratio));
    const h = Math.max(1, Math.floor(cssHeight * ratio));
    if (canvas.width === w && canvas.height === h) return false;
    if (ratio > 1 && cssWidth === canvas.width && cssHeight === canvas.height) {
      // 反馈回路特征：CSS 尺寸等于当前 buffer 尺寸 → 说明没设置 CSS 尺寸
      if (!this._warnedMissingCssSize) {
        this._warnedMissingCssSize = true;
        logger.warn(
          "canvas 没有 CSS 尺寸：显示尺寸由 width/height 属性决定，已跳过 devicePixelRatio 放大（否则每帧翻倍）。请给 canvas 设置 CSS 宽高，例如 width:100vw;height:100vh。",
        );
      }
      return false;
    }
    canvas.width = w;
    canvas.height = h;
    return true;
  }

  /**
   * 开始一帧：创建 command encoder +（MSAA 时）离屏目标 pass，否则直接是画布 pass。
   * 完成后必须调用 endFrame()。
   */
  beginFrame(clear?: Color | string): RenderPassEncoder {
    assert(!this._pass, "上一帧尚未 endFrame");
    if (clear) this.setBackground(clear);
    this._encoder = this.device.createCommandEncoder("frame");
    const bg = { r: this._background.r, g: this._background.g, b: this._background.b, a: this._background.a };

    if (this.sampleCount > 1) {
      const target = this._ensureMsaaTarget();
      this._pass = this._encoder.beginRenderPass({
        label: "canvas(msaa)",
        colorAttachments: [target.colorAttachment({ clearValue: bg })],
        depthStencilAttachment: target.depthAttachment(),
      });
      return this._pass;
    }

    this._pass = this._encoder.beginRenderPass({
      label: "canvas",
      colorAttachments: [{ view: null, loadOp: "clear", storeOp: "store", clearValue: bg }],
      depthStencilAttachment: this.depthEnabled
        ? { view: null, depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1 }
        : null,
    });
    return this._pass;
  }

  /** 结束本帧并提交（MSAA 时先把解析结果呈现到画布）。 */
  endFrame(): void {
    assert(this._pass && this._encoder, "beginFrame 未调用");
    this._pass.end();
    const encoder = this._encoder;

    if (this.sampleCount > 1 && this._msaaTarget) {
      const present = this._presentPassFor();
      const pass = encoder.beginRenderPass({
        label: "canvas-present",
        colorAttachments: [{ view: null, loadOp: "clear", storeOp: "store" }],
        depthStencilAttachment: null,
      });
      present.draw(pass, this._msaaTarget.texture, this._msaaTarget.width, this._msaaTarget.height);
      pass.end();
    }

    const buffer = encoder.finish();
    this.device.submit([buffer]);
    this._pass = null;
    this._encoder = null;
  }

  private _ensureMsaaTarget(): RenderTarget {
    const w = Math.max(1, this.canvas.width);
    const h = Math.max(1, this.canvas.height);
    if (this._msaaTarget) {
      this._msaaTarget.resize(w, h);
      return this._msaaTarget;
    }
    this._msaaTarget = new RenderTarget(this.device, {
      label: "canvas-msaa",
      width: w,
      height: h,
      // 必须与材质管线的目标格式一致（材质用 device.canvasFormat() 建管线），
      // 否则 WebGPU 会因为「管线目标格式 ≠ 附件格式」直接校验失败。
      format: this.device.canvasFormat() ?? "rgba8unorm",
      depth: this.depthEnabled,
      sampleCount: this.sampleCount,
    });
    return this._msaaTarget;
  }

  private _presentPassFor(): CopyPass {
    const format = this.device.canvasFormat() ?? "rgba8unorm";
    // 把 MSAA 解析结果（几何渲染产物）呈现到画布：WebGPU 的纹理行序与 NDC 方向
    // 相反，必须翻转 V，否则整幅画面上下颠倒（WebGL2 不需要）。
    const flipY = this.device.kind === "webgpu";
    if (this._presentPass && this._presentFormat === format && this._presentFlipY === flipY) return this._presentPass;
    this._presentPass?.dispose();
    this._presentPass = new CopyPass(this.device, format, { flipY });
    this._presentFormat = format;
    this._presentFlipY = flipY;
    return this._presentPass;
  }

  private _presentFormat: string | null = null;
  private _presentFlipY: boolean | null = null;

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
  private _warnedMissingCssSize = false;

  destroy(): void {
    this._presentPass?.dispose();
    this._presentPass = null;
    this._msaaTarget?.dispose();
    this._msaaTarget = null;
    this.device.destroy();
  }
}

export { Mat4 };
