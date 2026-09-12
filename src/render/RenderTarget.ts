/**
 * RenderTarget —— 一等公民的离屏渲染目标。
 *
 * 把「颜色附件 + 深度附件 + （可选）MSAA 解析目标」打包好，并隐藏三后端差异：
 * - 普通模式：一张可采样纹理 + 一张深度纹理；
 * - MSAA（`sampleCount > 1`）：WebGPU 用多采样纹理 + `resolveTarget`，
 *   WebGL2 用多重采样 renderbuffer + `blitFramebuffer`（由 `resolveView()` 驱动）；
 *   `texture` 始终是**解析后**的可采样结果，可直接进后处理链。
 *
 * 用法：
 * ```ts
 * const target = new RenderTarget(device, { width, height, sampleCount: 4 });
 * const pass = encoder.beginRenderPass({
 *   colorAttachments: [target.colorAttachment({ clearValue: { r: 0, g: 0, b: 0, a: 1 } })],
 *   depthStencilAttachment: target.depthAttachment(),
 * });
 * // …绘制…
 * pass.end();
 * const pixels = await target.readPixels();      // 回读（左上原点 RGBA）
 * ```
 */

import type { Device } from "../device/Device.js";
import type { ColorClearValue, LoadOp, StoreOp, TextureFormat } from "../gpu/types.js";
import { TextureUsage } from "../gpu/types.js";
import type { Texture, TextureView } from "../device/resources.js";
import type { ColorAttachmentOp, DepthStencilAttachmentOp } from "../command/ops.js";
import { assert } from "../util/assert.js";

export interface RenderTargetOptions {
  width: number;
  height: number;
  /** 颜色格式，默认 `rgba8unorm` */
  format?: TextureFormat;
  /** 是否带深度附件（默认 true），也可直接给深度格式 */
  depth?: boolean | TextureFormat;
  /** MSAA 采样数（默认 1；超过 `device.limits.maxSamples` 自动降级；分层模式强制 1） */
  sampleCount?: number;
  /** 结果是否可被采样（后处理需要，默认 true） */
  sampleable?: boolean;
  /**
   * 纹理维度（默认 `"2d"`）。
   *
   * `"2d-array"` / `"cube"` 时进入**分层模式**：一张纹理有 `depthOrArrayLayers` 层，
   * 附件按层取（`colorAttachment({ layer })`），用来逐面渲染 cube 阴影、逐层渲染
   * 纹理数组。`texture.view()` 仍是整幅视图（可直接采样）。
   */
  dimension?: "2d" | "2d-array" | "cube";
  /** 层数/面数（默认 1；cube 恒为 6） */
  depthOrArrayLayers?: number;
  label?: string;
}

export interface ColorAttachmentOptions {
  loadOp?: LoadOp;
  storeOp?: StoreOp;
  clearValue?: ColorClearValue;
  /** 渲染到第几层（cube 是面序号，默认 0） */
  layer?: number;
}

export class RenderTarget {
  readonly device: Device;
  readonly format: TextureFormat;
  readonly sampleCount: number;
  /** 纹理维度（`"2d"` / `"2d-array"` / `"cube"`） */
  readonly dimension: "2d" | "2d-array" | "cube";
  /** 层数/面数（cube 恒为 6） */
  readonly depthOrArrayLayers: number;

  width: number;
  height: number;
  /** 解析后的颜色纹理（MSAA 时由 resolve 得到） */
  texture!: Texture;
  /** 深度纹理（未开启深度时为 null） */
  depth: Texture | null = null;

  private readonly _label: string;
  private readonly _sampleable: boolean;
  private readonly _depthFormat: TextureFormat | null;
  private _msaaColor: Texture | null = null;
  private _msaaDepth: Texture | null = null;
  /** 逐层视图缓存（分层模式下每层各有一套颜色/深度/解析视图） */
  private readonly _views = new Map<number, { color: TextureView; depth: TextureView | null; resolve: TextureView | null }>();

  constructor(device: Device, options: RenderTargetOptions) {
    assert(options.width >= 1 && options.height >= 1, "RenderTarget 尺寸必须 >= 1");
    this.device = device;
    this.format = options.format ?? "rgba8unorm";
    this._label = options.label ?? "render-target";
    this._sampleable = options.sampleable !== false;
    this._depthFormat =
      options.depth === false ? null : typeof options.depth === "string" ? options.depth : "depth24plus";
    this.dimension = options.dimension ?? "2d";
    this.depthOrArrayLayers = this.dimension === "cube" ? 6 : Math.max(1, Math.floor(options.depthOrArrayLayers ?? 1));
    const maxSamples = Math.max(1, device.limits.maxSamples ?? 1);
    // 分层 + 多重采样在 WebGL2 上做不到（MSAA 附件是 renderbuffer，只能整层）：
    // 为了两个后端行为一致，分层模式统一降级到 1，而不是让 WebGL2 报错。
    const layered = this.dimension !== "2d" || this.depthOrArrayLayers > 1;
    this.sampleCount = layered ? 1 : Math.min(Math.max(1, Math.floor(options.sampleCount ?? 1)), maxSamples);
    this.width = Math.max(1, Math.floor(options.width));
    this.height = Math.max(1, Math.floor(options.height));
    this._allocate();
  }

  /** 尺寸变化时重建附件（返回是否真的重建了） */
  resize(width: number, height: number): boolean {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height) return false;
    this._release();
    this.width = w;
    this.height = h;
    this._allocate();
    return true;
  }

  /** 渲染用颜色附件视图（MSAA 时是多采样纹理；`layer` 为层/面序号） */
  colorView(layer = 0): TextureView {
    return this._layerViews(layer).color;
  }

  /** 渲染用深度附件视图（MSAA 时是多采样深度） */
  depthView(layer = 0): TextureView | null {
    return this._layerViews(layer).depth;
  }

  /** MSAA 解析目标视图（非 MSAA 时为 null，直接作为 `resolveTo` 传下去即可） */
  resolveView(layer = 0): TextureView | null {
    return this._layerViews(layer).resolve;
  }

  /** 便捷：颜色附件描述（自动带 `resolveTo` / `sampleCount`） */
  colorAttachment(options: ColorAttachmentOptions = {}): ColorAttachmentOp {
    const layer = Math.max(0, Math.floor(options.layer ?? 0));
    return {
      view: this.colorView(layer),
      loadOp: options.loadOp ?? "clear",
      storeOp: options.storeOp ?? "store",
      clearValue: options.clearValue ?? { r: 0, g: 0, b: 0, a: 1 },
      resolveTo: this.resolveView(layer),
      sampleCount: this.sampleCount,
    };
  }

  /** 便捷：深度附件描述（未开启深度时返回 null） */
  depthAttachment(
    options: { depthLoadOp?: LoadOp; depthStoreOp?: StoreOp; depthClearValue?: number; layer?: number } = {},
  ): DepthStencilAttachmentOp | null {
    const layer = Math.max(0, Math.floor(options.layer ?? 0));
    const view = this.depthView(layer);
    if (!view) return null;
    return {
      view,
      depthLoadOp: options.depthLoadOp ?? "clear",
      depthStoreOp: options.depthStoreOp ?? "store",
      depthClearValue: options.depthClearValue ?? 1,
      sampleCount: this.sampleCount,
    };
  }

  /** 回读解析后的颜色结果（左上原点、紧凑 RGBA；`layer` 选择层/面） */
  readPixels(layer = 0): Promise<Uint8Array> {
    return this.device.readTexturePixels(this.texture, { layer });
  }

  /** 释放附件（可重复调用） */
  dispose(): void {
    this._release();
  }

  private _allocate(): void {
    const device = this.device;
    this.texture = device.createTexture({
      label: `${this._label}-color`,
      width: this.width,
      height: this.height,
      dimension: this.dimension,
      depthOrArrayLayers: this.depthOrArrayLayers,
      format: this.format,
      usage:
        TextureUsage.RENDER_ATTACHMENT | TextureUsage.COPY_SRC | (this._sampleable ? TextureUsage.TEXTURE_BINDING : 0),
    });
    this.depth = this._depthFormat
      ? device.createTexture({
          label: `${this._label}-depth`,
          width: this.width,
          height: this.height,
          // 深度附件跟着分层：cube 颜色目标用 2D 数组深度（WebGPU 不允许 cube 深度纹理）
          dimension: this.dimension === "2d" ? "2d" : "2d-array",
          depthOrArrayLayers: this.depthOrArrayLayers,
          format: this._depthFormat,
          // COPY_SRC：深度回读 / 可视化需要（WebGPU 的 copyTextureToBuffer 要求它）；
          // TEXTURE_BINDING：WebGL2 的深度回读要先可视化（采样深度纹理）才能读出浮点值
          usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.COPY_SRC | TextureUsage.TEXTURE_BINDING,
        })
      : null;
    if (this.sampleCount > 1) {
      this._msaaColor = device.createTexture({
        label: `${this._label}-msaa`,
        width: this.width,
        height: this.height,
        format: this.format,
        usage: TextureUsage.RENDER_ATTACHMENT,
        sampleCount: this.sampleCount,
      });
      if (this._depthFormat) {
        this._msaaDepth = device.createTexture({
          label: `${this._label}-msaa-depth`,
          width: this.width,
          height: this.height,
          format: this._depthFormat,
          usage: TextureUsage.RENDER_ATTACHMENT,
          sampleCount: this.sampleCount,
        });
      }
    }
  }

  private _release(): void {
    this.texture?.destroy();
    this.depth?.destroy();
    this._msaaColor?.destroy();
    this._msaaDepth?.destroy();
    this._msaaColor = null;
    this._msaaDepth = null;
    this._views.clear();
  }

  /** 某一层的颜色/深度/解析视图（按层缓存；非分层时都退化成整幅视图） */
  private _layerViews(layer: number): { color: TextureView; depth: TextureView | null; resolve: TextureView | null } {
    assert(layer >= 0 && layer < this.depthOrArrayLayers, `RenderTarget 层号越界：${layer} >= ${this.depthOrArrayLayers}`);
    let v = this._views.get(layer);
    if (!v) {
      v = {
        color: (this._msaaColor ?? this.texture).viewLayer(layer),
        depth: (this._msaaDepth ?? this.depth)?.viewLayer(layer) ?? null,
        resolve: this._msaaColor ? this.texture.viewLayer(layer) : null,
      };
      this._views.set(layer, v);
    }
    return v;
  }
}
