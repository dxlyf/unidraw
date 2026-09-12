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
import type { Texture, TextureView } from "../device/resources.js";
import type { ColorAttachmentOp, DepthStencilAttachmentOp } from "../command/ops.js";
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
export declare class RenderTarget {
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
    texture: Texture;
    /** 深度纹理（未开启深度时为 null） */
    depth: Texture | null;
    private readonly _label;
    private readonly _sampleable;
    private readonly _depthFormat;
    private _msaaColor;
    private _msaaDepth;
    /** 逐层视图缓存（分层模式下每层各有一套颜色/深度/解析视图） */
    private readonly _views;
    constructor(device: Device, options: RenderTargetOptions);
    /** 尺寸变化时重建附件（返回是否真的重建了） */
    resize(width: number, height: number): boolean;
    /** 渲染用颜色附件视图（MSAA 时是多采样纹理；`layer` 为层/面序号） */
    colorView(layer?: number): TextureView;
    /** 渲染用深度附件视图（MSAA 时是多采样深度） */
    depthView(layer?: number): TextureView | null;
    /** MSAA 解析目标视图（非 MSAA 时为 null，直接作为 `resolveTo` 传下去即可） */
    resolveView(layer?: number): TextureView | null;
    /** 便捷：颜色附件描述（自动带 `resolveTo` / `sampleCount`） */
    colorAttachment(options?: ColorAttachmentOptions): ColorAttachmentOp;
    /** 便捷：深度附件描述（未开启深度时返回 null） */
    depthAttachment(options?: {
        depthLoadOp?: LoadOp;
        depthStoreOp?: StoreOp;
        depthClearValue?: number;
        layer?: number;
    }): DepthStencilAttachmentOp | null;
    /** 回读解析后的颜色结果（左上原点、紧凑 RGBA；`layer` 选择层/面） */
    readPixels(layer?: number): Promise<Uint8Array>;
    /** 释放附件（可重复调用） */
    dispose(): void;
    private _allocate;
    private _release;
    /** 某一层的颜色/深度/解析视图（按层缓存；非分层时都退化成整幅视图） */
    private _layerViews;
}
//# sourceMappingURL=RenderTarget.d.ts.map