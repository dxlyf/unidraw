import { Device } from "../../Device.js";
import { assert } from "../../../util/assert.js";
import { UnidrawError } from "../../../util/assert.js";
import { readDynamicOffsets } from "../../../command/ops.js";
import { vertexFormatInfo } from "../../../gpu/formats.js";
import { MOCK_CANVAS_FORMAT } from "./constants.js";
import { MockBindGroup } from "./resources/MockBindGroup.js";
import { MockBindGroupLayout } from "./resources/MockBindGroupLayout.js";
import { MockBuffer } from "./resources/MockBuffer.js";
import { MockProgram } from "./resources/MockProgram.js";
import { MockRenderPipeline } from "./resources/MockRenderPipeline.js";
import { MockSampler } from "./resources/MockSampler.js";
import { MockTexture } from "./resources/MockTexture.js";
import { clampByte } from "./gpuUtils.js";
import { resolveReadRect, swizzleBgraToRgbaInPlace } from "../../readback.js";
export class MockDevice extends Device {
    _drawCalls = [];
    _passCount = 0;
    constructor() {
        super("mock", null, { kind: "mock", name: "MockDevice (headless)" });
    }
    get limits() {
        return {
            maxVertexAttributes: 16,
            maxTextureUnits: 16,
            maxUniformBufferBindings: 16,
            maxTextureSize: 4096,
            minUniformBufferOffsetAlignment: 256,
            maxSamples: 4,
        };
    }
    // ---- 资源创建 -----------------------------------------------------------
    createBuffer(desc) {
        return new MockBuffer(this, desc);
    }
    createTexture(desc) {
        return new MockTexture(this, desc);
    }
    createSampler(desc) {
        return new MockSampler(this, desc);
    }
    createProgramNative(desc) {
        return new MockProgram(this, desc);
    }
    createBindGroupLayout(desc) {
        return new MockBindGroupLayout(this, desc);
    }
    createBindGroup(desc) {
        return new MockBindGroup(this, desc);
    }
    createRenderPipelineNative(desc) {
        return new MockRenderPipeline(this, desc);
    }
    // ---- 查询 ---------------------------------------------------------------
    async onSubmittedWorkDone() { }
    presentSize() {
        return { width: 0, height: 0 };
    }
    canvasFormat() {
        return MOCK_CANVAS_FORMAT;
    }
    /** 测试断言：已记录的 draw 调用（累积，可用 clearDrawCalls 清空）。 */
    get drawCalls() {
        return this._drawCalls;
    }
    get passCount() {
        return this._passCount;
    }
    clearDrawCalls() {
        this._drawCalls = [];
        this._passCount = 0;
    }
    /** 读取颜色纹理的 CPU 像素（0..255）。 */
    readPixels(texture) {
        const mock = texture;
        if (!mock.pixels)
            return null;
        return new Uint8Array(mock.pixels);
    }
    /** 统一回读接口：返回左上原点、紧凑 8bit RGBA 的子区域。 */
    async readTexturePixels(texture, options = {}) {
        const mock = texture;
        assert(mock.pixels, "Mock 纹理没有 CPU 像素（深度/浮点格式不可回读）");
        const rect = resolveReadRect(texture, options);
        const out = new Uint8Array(rect.width * rect.height * 4);
        for (let row = 0; row < rect.height; row++) {
            const src = ((rect.y + row) * texture.width + rect.x) * 4;
            out.set(mock.pixels.subarray(src, src + rect.width * 4), row * rect.width * 4);
        }
        if (rect.bgra)
            swizzleBgraToRgbaInPlace(out);
        return out;
    }
    // ---- 命令执行 -----------------------------------------------------------
    executeOps(ops) {
        let pass = null;
        let boundPipeline = null;
        const bindGroups = [null, null, null, null];
        const bindGroupOffsets = [null, null, null, null];
        const vertexBuffers = new Map();
        let indexBuffer = null;
        let viewport = { x: 0, y: 0, width: 0, height: 0 };
        let scissor = null;
        const resetPassState = () => {
            boundPipeline = null;
            bindGroups.fill(null);
            bindGroupOffsets.fill(null);
            vertexBuffers.clear();
            indexBuffer = null;
            viewport = { x: 0, y: 0, width: 0, height: 0 };
            scissor = null;
        };
        for (const op of ops) {
            switch (op.k) {
                case "beginRenderPass": {
                    const first = op.colorAttachments.find((a) => a !== null);
                    const tex = first?.view?.texture;
                    pass = {
                        colorFormats: op.colorAttachments.map((a) => (a === null ? null : (a.view?.texture.format ?? MOCK_CANVAS_FORMAT))),
                        width: tex?.width ?? 0,
                        height: tex?.height ?? 0,
                    };
                    resetPassState();
                    viewport = { x: 0, y: 0, width: pass.width, height: pass.height };
                    this._passCount++;
                    for (const att of op.colorAttachments) {
                        if (att && att.loadOp === "clear" && att.view?.texture && att.clearValue) {
                            this.clearAttachment(att.view.texture, att.clearValue);
                        }
                    }
                    if (op.depthStencilAttachment?.depthLoadOp === "clear") {
                        this.clearDepth(op.depthStencilAttachment.view?.texture ?? null, op.depthStencilAttachment.depthClearValue ?? 1);
                    }
                    break;
                }
                case "endRenderPass":
                    pass = null;
                    resetPassState();
                    break;
                case "setPipeline": {
                    assert(pass, "setPipeline 必须在 render pass 内");
                    const pipeline = op.pipeline;
                    for (const [i, target] of pipeline.descriptor.targets.entries()) {
                        const actual = pass.colorFormats[i];
                        assert(actual === null || actual === target.format, `pipeline color target[${i}] 格式 ${target.format} 与附件 ${actual ?? "canvas"} 不一致`);
                    }
                    boundPipeline = pipeline;
                    break;
                }
                case "setBindGroup":
                    assert(pass, "setBindGroup 必须在 render pass 内");
                    bindGroups[op.index] = op.group;
                    bindGroupOffsets[op.index] = op.offsetCount > 0 ? readDynamicOffsets(op) : null;
                    break;
                case "setVertexBuffer": {
                    assert(pass, "setVertexBuffer 必须在 render pass 内");
                    if (op.buffer)
                        vertexBuffers.set(op.slot, { slot: op.slot, buffer: op.buffer, offset: op.offset });
                    else
                        vertexBuffers.delete(op.slot);
                    break;
                }
                case "setIndexBuffer": {
                    assert(pass, "setIndexBuffer 必须在 render pass 内");
                    indexBuffer = op.buffer ? { buffer: op.buffer, format: op.format, offset: op.offset } : null;
                    break;
                }
                case "setViewport":
                    viewport = { x: op.x, y: op.y, width: op.width, height: op.height };
                    break;
                case "setScissorRect":
                    scissor = { x: op.x, y: op.y, width: op.width, height: op.height };
                    break;
                case "draw":
                case "drawIndexed": {
                    assert(pass, "draw 必须在 render pass 内");
                    assert(boundPipeline, "draw 前必须 setPipeline");
                    if (op.k === "drawIndexed")
                        assert(indexBuffer, "drawIndexed 前必须 setIndexBuffer");
                    this.validateVertexBindings(boundPipeline, vertexBuffers, op.k);
                    this._drawCalls.push({
                        kind: op.k,
                        passIndex: this._passCount,
                        pipeline: boundPipeline,
                        bindGroups: [...bindGroups],
                        bindGroupOffsets: bindGroupOffsets.map((o) => (o ? [...o] : null)),
                        vertexBuffers: [...vertexBuffers.values()],
                        indexBuffer,
                        draw: {
                            vertexCount: op.k === "draw" ? op.vertexCount : undefined,
                            indexCount: op.k === "drawIndexed" ? op.indexCount : undefined,
                            instanceCount: op.instanceCount,
                            firstVertex: op.k === "draw" ? op.firstVertex : 0,
                            firstIndex: op.k === "drawIndexed" ? op.firstIndex : 0,
                            baseVertex: op.k === "drawIndexed" ? op.baseVertex : 0,
                            firstInstance: op.firstInstance,
                        },
                        viewport: { ...viewport },
                        scissor: scissor ? { ...scissor } : null,
                    });
                    break;
                }
                case "pushDebugGroup":
                case "popDebugGroup":
                    break;
                default: {
                    const exhaustive = op;
                    throw new UnidrawError(`[unidraw] 未知命令 op: ${JSON.stringify(exhaustive)}`);
                }
            }
        }
    }
    validateVertexBindings(pipeline, bound, kind) {
        const { buffers } = pipeline.descriptor.vertex;
        for (let slot = 0; slot < buffers.length; slot++) {
            const layout = buffers[slot];
            if (!layout)
                continue;
            const binding = bound.get(slot);
            assert(binding, `vertex buffer slot ${slot} 未绑定`);
            if (kind === "drawIndexed" && layout.attributes.length === 0)
                continue;
            const maxAttrEnd = Math.max(0, ...layout.attributes.map((a) => a.offset + vertexFormatInfo(a.format).size));
            const needed = layout.arrayStride > 0 ? layout.arrayStride : maxAttrEnd;
            assert(binding.offset + needed <= binding.buffer.size, `vertex buffer slot ${slot} 尺寸不足（需要 >= ${needed} 字节）`);
        }
    }
    clearAttachment(texture, color) {
        const mock = texture;
        if (!mock.pixels)
            return;
        const bpp = mock.bpp;
        for (let i = 0; i < texture.width * texture.height; i++) {
            mock.pixels[i * bpp] = clampByte(color.r);
            mock.pixels[i * bpp + 1] = clampByte(color.g);
            mock.pixels[i * bpp + 2] = clampByte(color.b);
            mock.pixels[i * bpp + 3] = clampByte(color.a);
        }
    }
    clearDepth(texture, _value) {
        void texture;
        // Mock 不维护深度缓冲内容
    }
    destroyNative() { }
}
// 保持模块公共入口不变（测试等仍可从本文件导入这些符号）
export { MOCK_CANVAS_FORMAT } from "./constants.js";
//# sourceMappingURL=MockDevice.js.map