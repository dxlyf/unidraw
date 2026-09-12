import { Device } from "../../Device.js";
import { assert, UnidrawError } from "../../../util/assert.js";
import { bindGroupLayoutCacheKey } from "../../descriptors.js";
import { readDynamicOffsets } from "../../../command/ops.js";
import { TextureUsage } from "../../../gpu/types.js";
import { WEBGPU_INTERNAL_DEPTH_FORMAT } from "./constants.js";
import { WebGPUBindGroup } from "./resources/WebGPUBindGroup.js";
import { WebGPUBindGroupLayout } from "./resources/WebGPUBindGroupLayout.js";
import { WebGPUBuffer } from "./resources/WebGPUBuffer.js";
import { WebGPUProgram } from "./resources/WebGPUProgram.js";
import { WebGPURenderPipeline } from "./resources/WebGPURenderPipeline.js";
import { WebGPUSampler } from "./resources/WebGPUSampler.js";
import { WebGPUTexture } from "./resources/WebGPUTexture.js";
import { adapterName, colorAttachmentState } from "./gpuUtils.js";
import { expandDepthToRgbaFloat, repackRows, resolveReadRect, swizzleBgraToRgbaInPlace } from "../../readback.js";
/** WebGPU `copyTextureToBuffer` 要求 bytesPerRow 为 256 的倍数。 */
function align256(value) {
    return Math.ceil(value / 256) * 256;
}
export class WebGPUDevice extends Device {
    gpu;
    adapter;
    context;
    canvasFormatNative;
    _internalDepth = null;
    _internalDepthW = 0;
    _internalDepthH = 0;
    _configuredW = -1;
    _configuredH = -1;
    _layoutCache = new Map();
    /** 动态偏移读取的复用缓冲（避免每次 setBindGroup 分配数组） */
    _offsetScratch = [];
    _limits = null;
    constructor(adapter, gpu, canvas, canvasFormat) {
        const name = `WebGPU · ${adapterName(adapter)}`;
        super("webgpu", canvas, { kind: "webgpu", name, adapter: adapterName(adapter) });
        this.adapter = adapter;
        this.gpu = gpu;
        this.canvasFormatNative = canvasFormat;
        const ctx = canvas.getContext("webgpu");
        assert(ctx, "无法获取 webgpu canvas context");
        this.context = ctx;
        this.configureContext();
        // WebGPU 校验错误异步上报：始终打印，便于无需开日志即可排查
        gpu.addEventListener("uncapturederror", (e) => {
            const ev = e;
            console.error(`[unidraw] WebGPU validation error: ${ev.error?.message ?? "unknown"}`);
        });
        gpu.lost.then((info) => {
            console.error(`[unidraw] WebGPU device lost: ${info.reason ?? "unknown"}`);
        });
    }
    configureContext() {
        this.context.configure({
            device: this.gpu,
            format: this.canvasFormatNative,
            alphaMode: "opaque",
        });
        this._configuredW = this.canvas?.width ?? -1;
        this._configuredH = this.canvas?.height ?? -1;
    }
    static async create(canvas, options = {}) {
        if (!navigator.gpu)
            throw new UnidrawError("当前环境不支持 WebGPU（无 navigator.gpu）");
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: options.powerPreference ?? "high-performance" });
        if (!adapter)
            throw new UnidrawError("未找到可用的 WebGPU adapter");
        const device = await adapter.requestDevice();
        const format = options.forceCanvasFormat ?? navigator.gpu.getPreferredCanvasFormat();
        return new WebGPUDevice(adapter, device, canvas, format);
    }
    get limits() {
        if (!this._limits) {
            const gpu = this.gpu;
            this._limits = {
                maxVertexAttributes: gpu.limits.maxVertexAttributes,
                maxTextureUnits: 64,
                maxUniformBufferBindings: gpu.limits.maxUniformBuffersPerShaderStage * 4,
                maxTextureSize: gpu.limits.maxTextureDimension2D,
                minUniformBufferOffsetAlignment: gpu.limits.minUniformBufferOffsetAlignment,
                maxSamples: 4,
            };
        }
        return this._limits;
    }
    // ---- 资源创建 -----------------------------------------------------------
    createBuffer(desc) {
        return new WebGPUBuffer(this, desc);
    }
    createTexture(desc) {
        return new WebGPUTexture(this, desc);
    }
    createSampler(desc) {
        return new WebGPUSampler(this, desc);
    }
    createProgramNative(desc) {
        return new WebGPUProgram(this, desc);
    }
    createBindGroupLayout(desc) {
        const key = bindGroupLayoutCacheKey(desc);
        const cached = this._layoutCache.get(key);
        if (cached)
            return cached;
        const layout = new WebGPUBindGroupLayout(this, desc);
        this._layoutCache.set(key, layout);
        return layout;
    }
    createBindGroup(desc) {
        return new WebGPUBindGroup(this, desc);
    }
    createRenderPipelineNative(desc) {
        return new WebGPURenderPipeline(this, desc);
    }
    // ---- 查询 ---------------------------------------------------------------
    async onSubmittedWorkDone() {
        await this.gpu.queue.onSubmittedWorkDone();
    }
    presentSize() {
        const c = this.canvas;
        return { width: c?.width ?? 0, height: c?.height ?? 0 };
    }
    canvasFormat() {
        return this.canvasFormatNative;
    }
    /**
     * 纹理回读：`copyTextureToBuffer` + `mapAsync`。
     * WebGPU 要求每行字节数为 256 的倍数，因此回读缓冲带行间距，之后重排为紧凑 RGBA。
     *
     * 深度/模板格式与多重采样纹理还要求 copy **覆盖整个子资源**（整幅宽高），所以这两类
     * 只能先整幅拷回、再在 CPU 上裁出请求的区域；否则 WebGPU 直接报校验错误、缓冲为 0。
     */
    async readTexturePixels(texture, options = {}) {
        const rect = resolveReadRect(texture, options);
        assert((texture.usage & TextureUsage.COPY_SRC) !== 0, "readTexturePixels 需要纹理带 COPY_SRC 用途");
        const tex = texture;
        const bpt = rect.bytesPerTexel;
        const wholeRequired = rect.depth || tex.sampleCount > 1;
        const copyX = wholeRequired ? 0 : rect.x;
        const copyY = wholeRequired ? 0 : rect.y;
        const copyW = wholeRequired ? texture.width : rect.width;
        const copyH = wholeRequired ? texture.height : rect.height;
        const tight = copyW * bpt;
        const bytesPerRow = align256(tight);
        const buffer = this.gpu.createBuffer({
            label: "unidraw-readback",
            size: bytesPerRow * copyH,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const encoder = this.gpu.createCommandEncoder({ label: "unidraw-readback" });
        encoder.copyTextureToBuffer(
        // 分层回读：origin.z = 层号（cube 的面 / 2D 数组的层）
        { texture: tex.gpuTexture, origin: { x: copyX, y: copyY, z: rect.layer } }, { buffer, bytesPerRow, rowsPerImage: copyH }, { width: copyW, height: copyH, depthOrArrayLayers: 1 });
        this.gpu.queue.submit([encoder.finish()]);
        this.markSubmitted();
        await buffer.mapAsync(GPUMapMode.READ);
        const src = new Uint8Array(buffer.getMappedRange());
        const copied = new Uint8Array(tight * copyH);
        repackRows(src, bytesPerRow, copyW, copyH, copied, bpt);
        buffer.unmap();
        buffer.destroy();
        // 整幅拷回时裁出请求区域（左上原点）
        const tiers = new Uint8Array(rect.width * rect.height * bpt);
        if (copyW === rect.width && copyH === rect.height) {
            tiers.set(copied);
        }
        else {
            const rowBytes = rect.width * bpt;
            for (let row = 0; row < rect.height; row++) {
                const from = ((rect.y + row) * copyW + rect.x) * bpt;
                tiers.set(copied.subarray(from, from + rowBytes), row * rowBytes);
            }
        }
        // 深度：单通道浮点铺成 RGBA 浮点（R = 深度），与 WebGL2 后端保持一致
        if (rect.depth) {
            const rgba = new Float32Array(rect.width * rect.height * 4);
            expandDepthToRgbaFloat(new Float32Array(tiers.buffer, tiers.byteOffset, rect.width * rect.height), rgba);
            return new Uint8Array(rgba.buffer);
        }
        if (rect.bgra)
            swizzleBgraToRgbaInPlace(tiers);
        return tiers;
    }
    // ---- 提交 ---------------------------------------------------------------
    submit(commandBuffers) {
        assert(!this.destroyed, "Device 已销毁，无法 submit");
        if (commandBuffers.length === 0)
            return;
        this.runBeforeSubmitHooks();
        const native = this.gpu.createCommandEncoder();
        for (const buffer of commandBuffers) {
            this.encodeOps(native, buffer.ops);
        }
        this.gpu.queue.submit([native.finish()]);
        this.markSubmitted();
    }
    executeOps(ops) {
        this.runBeforeSubmitHooks();
        const native = this.gpu.createCommandEncoder();
        this.encodeOps(native, ops);
        this.gpu.queue.submit([native.finish()]);
        this.markSubmitted();
    }
    encodeOps(native, ops) {
        let pass = null;
        let canvasTexture = null;
        for (const op of ops) {
            switch (op.k) {
                case "beginRenderPass": {
                    assert(pass === null, "beginRenderPass 嵌套非法");
                    const colors = [];
                    for (const att of op.colorAttachments) {
                        if (att === null)
                            continue;
                        if (att.view === null) {
                            if (!canvasTexture)
                                canvasTexture = this.acquireCanvasTexture();
                            colors.push({ view: canvasTexture.createView(), ...colorAttachmentState(att.loadOp, att.storeOp, att.clearValue) });
                        }
                        else {
                            const view = att.view.gpuView();
                            const resolve = att.resolveTo ? att.resolveTo.gpuView() : undefined;
                            colors.push({
                                view,
                                resolveTarget: resolve,
                                ...colorAttachmentState(att.loadOp, att.storeOp, att.clearValue),
                            });
                        }
                    }
                    const depthState = this.resolveDepthAttachment(op.depthStencilAttachment);
                    pass = native.beginRenderPass({ label: op.label, colorAttachments: colors, depthStencilAttachment: depthState });
                    break;
                }
                case "endRenderPass": {
                    assert(pass, "endRenderPass 无对应 beginRenderPass");
                    pass.end();
                    pass = null;
                    break;
                }
                case "setPipeline": {
                    assert(pass, "setPipeline 必须在 render pass 内");
                    pass.setPipeline(op.pipeline.gpuPipeline);
                    break;
                }
                case "setBindGroup": {
                    assert(pass, "setBindGroup 必须在 render pass 内");
                    const group = op.group?.gpuBindGroup;
                    if (group) {
                        if (op.offsetCount > 0)
                            pass.setBindGroup(op.index, group, readDynamicOffsets(op, this._offsetScratch));
                        else
                            pass.setBindGroup(op.index, group);
                    }
                    break;
                }
                case "setVertexBuffer": {
                    assert(pass, "setVertexBuffer 必须在 render pass 内");
                    if (op.buffer)
                        pass.setVertexBuffer(op.slot, op.buffer.gpuBuffer, op.offset);
                    break;
                }
                case "setIndexBuffer": {
                    assert(pass, "setIndexBuffer 必须在 render pass 内");
                    if (op.buffer)
                        pass.setIndexBuffer(op.buffer.gpuBuffer, op.format, op.offset);
                    break;
                }
                case "setViewport": {
                    assert(pass, "setViewport 必须在 render pass 内");
                    pass.setViewport(op.x, op.y, op.width, op.height, op.minDepth, op.maxDepth);
                    break;
                }
                case "setScissorRect": {
                    assert(pass, "setScissorRect 必须在 render pass 内");
                    pass.setScissorRect(op.x, op.y, op.width, op.height);
                    break;
                }
                case "draw": {
                    assert(pass, "draw 必须在 render pass 内");
                    pass.draw(op.vertexCount, op.instanceCount, op.firstVertex, op.firstInstance);
                    break;
                }
                case "drawIndexed": {
                    assert(pass, "drawIndexed 必须在 render pass 内");
                    pass.drawIndexed(op.indexCount, op.instanceCount, op.firstIndex, op.baseVertex, op.firstInstance);
                    break;
                }
                case "pushDebugGroup":
                    pass?.pushDebugGroup(op.label);
                    break;
                case "popDebugGroup":
                    pass?.popDebugGroup();
                    break;
                default: {
                    const exhaustive = op;
                    throw new UnidrawError(`[unidraw] 未知命令 op：${JSON.stringify(exhaustive)}`);
                }
            }
        }
        assert(pass === null, "submit 前必须 end 所有 RenderPass");
    }
    acquireCanvasTexture() {
        const c = this.canvas;
        if (c) {
            const w = c.width;
            const h = c.height;
            if (w !== this._configuredW || h !== this._configuredH) {
                this.configureContext();
            }
        }
        return this.context.getCurrentTexture();
    }
    /** 解析深度附件：view null 表示设备内部画布深度纹理。 */
    resolveDepthAttachment(att) {
        if (!att)
            return undefined;
        let view;
        if (att.view === null) {
            view = this.internalDepthTexture().createView();
        }
        else {
            view = att.view.gpuView();
        }
        const out = {
            view,
            depthLoadOp: att.depthLoadOp,
            depthStoreOp: att.depthStoreOp,
        };
        if (out.depthLoadOp === "clear")
            out.depthClearValue = att.depthClearValue ?? 1;
        return out;
    }
    /** 懒创建随画布尺寸变化的内部深度纹理。 */
    internalDepthTexture() {
        const c = this.canvas;
        const w = c?.width ?? 0;
        const h = c?.height ?? 0;
        assert(w > 0 && h > 0, "canvas 尺寸为 0，无法创建深度纹理");
        if (this._internalDepth && this._internalDepthW === w && this._internalDepthH === h)
            return this._internalDepth;
        if (this._internalDepth)
            this._internalDepth.destroy();
        this._internalDepth = this.gpu.createTexture({
            label: "unidraw-internal-depth",
            size: { width: w, height: h },
            format: WEBGPU_INTERNAL_DEPTH_FORMAT,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this._internalDepthW = w;
        this._internalDepthH = h;
        return this._internalDepth;
    }
    destroyNative() {
        if (this._internalDepth) {
            this._internalDepth.destroy();
            this._internalDepth = null;
        }
        this.gpu.destroy();
    }
}
// 保持模块公共入口不变（createDevice 等仍可从本文件导入这些符号）
export { WEBGPU_INTERNAL_DEPTH_FORMAT } from "./constants.js";
export { isWebGPUSupported } from "./gpuUtils.js";
//# sourceMappingURL=WebGPUDevice.js.map