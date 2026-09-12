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
import { TextureUsage } from "../gpu/types.js";
import { assert } from "../util/assert.js";
export class RenderTarget {
    device;
    format;
    sampleCount;
    /** 纹理维度（`"2d"` / `"2d-array"` / `"cube"`） */
    dimension;
    /** 层数/面数（cube 恒为 6） */
    depthOrArrayLayers;
    width;
    height;
    /** 解析后的颜色纹理（MSAA 时由 resolve 得到） */
    texture;
    /** 深度纹理（未开启深度时为 null） */
    depth = null;
    _label;
    _sampleable;
    _depthFormat;
    _msaaColor = null;
    _msaaDepth = null;
    /** 逐层视图缓存（分层模式下每层各有一套颜色/深度/解析视图） */
    _views = new Map();
    constructor(device, options) {
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
    resize(width, height) {
        const w = Math.max(1, Math.floor(width));
        const h = Math.max(1, Math.floor(height));
        if (w === this.width && h === this.height)
            return false;
        this._release();
        this.width = w;
        this.height = h;
        this._allocate();
        return true;
    }
    /** 渲染用颜色附件视图（MSAA 时是多采样纹理；`layer` 为层/面序号） */
    colorView(layer = 0) {
        return this._layerViews(layer).color;
    }
    /** 渲染用深度附件视图（MSAA 时是多采样深度） */
    depthView(layer = 0) {
        return this._layerViews(layer).depth;
    }
    /** MSAA 解析目标视图（非 MSAA 时为 null，直接作为 `resolveTo` 传下去即可） */
    resolveView(layer = 0) {
        return this._layerViews(layer).resolve;
    }
    /** 便捷：颜色附件描述（自动带 `resolveTo` / `sampleCount`） */
    colorAttachment(options = {}) {
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
    depthAttachment(options = {}) {
        const layer = Math.max(0, Math.floor(options.layer ?? 0));
        const view = this.depthView(layer);
        if (!view)
            return null;
        return {
            view,
            depthLoadOp: options.depthLoadOp ?? "clear",
            depthStoreOp: options.depthStoreOp ?? "store",
            depthClearValue: options.depthClearValue ?? 1,
            sampleCount: this.sampleCount,
        };
    }
    /** 回读解析后的颜色结果（左上原点、紧凑 RGBA；`layer` 选择层/面） */
    readPixels(layer = 0) {
        return this.device.readTexturePixels(this.texture, { layer });
    }
    /** 释放附件（可重复调用） */
    dispose() {
        this._release();
    }
    _allocate() {
        const device = this.device;
        this.texture = device.createTexture({
            label: `${this._label}-color`,
            width: this.width,
            height: this.height,
            dimension: this.dimension,
            depthOrArrayLayers: this.depthOrArrayLayers,
            format: this.format,
            usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.COPY_SRC | (this._sampleable ? TextureUsage.TEXTURE_BINDING : 0),
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
    _release() {
        this.texture?.destroy();
        this.depth?.destroy();
        this._msaaColor?.destroy();
        this._msaaDepth?.destroy();
        this._msaaColor = null;
        this._msaaDepth = null;
        this._views.clear();
    }
    /** 某一层的颜色/深度/解析视图（按层缓存；非分层时都退化成整幅视图） */
    _layerViews(layer) {
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
//# sourceMappingURL=RenderTarget.js.map