import { assert, UnidrawError } from "../util/assert.js";
import { MAX_DYNAMIC_OFFSETS } from "./ops.js";
/**
 * 渲染通道编码器：只能通过 `CommandEncoder.beginRenderPass()` 创建，
 * `end()` 之后不可再使用。
 */
export class RenderPassEncoder {
    _ended = false;
    _ops;
    _onEnd;
    _boundPipeline = null;
    _hasIndexBuffer = false;
    /** 冗余设置去重：状态未变时不再产生 op（大量 draw 时能省掉 ~60% 的命令对象） */
    _vertexBuffers = [];
    _vertexOffsets = [];
    _indexBuffer = null;
    _indexFormat = null;
    _indexOffset = 0;
    /** 是否启用冗余去重（默认开；关掉可得到「每次调用都记录」的完整命令流） */
    dedupe = true;
    label;
    /** 本 pass 附件的采样数（材质据此选择匹配管线；WebGPU 校验要求一致） */
    sampleCount;
    constructor(ops, label, sampleCount, onEnd) {
        this._ops = ops;
        this.label = label;
        this.sampleCount = sampleCount;
        this._onEnd = onEnd;
    }
    assertActive() {
        assert(!this._ended, "RenderPassEncoder 已 end，禁止继续记录");
    }
    setPipeline(pipeline) {
        this.assertActive();
        if (this.dedupe && this._boundPipeline === pipeline)
            return;
        this._ops.push({ k: "setPipeline", pipeline });
        this._boundPipeline = pipeline;
    }
    /**
     * 绑定 bind group。
     * @param offsets 动态偏移数组：与布局中 `hasDynamicOffset` 的 entry 顺序一一对应
     *                （语义与 WebGPU `setBindGroup(index, group, dynamicOffsets)` 一致）。
     *                最多 `MAX_DYNAMIC_OFFSETS` 个；内部按值内联存储，不会持有/分配数组。
     */
    setBindGroup(index, group, offsets) {
        this.assertActive();
        assert(index >= 0 && index < 4, `bind group index ${index} 超出范围`);
        const count = offsets?.length ?? 0;
        assert(count <= MAX_DYNAMIC_OFFSETS, `动态偏移最多 ${MAX_DYNAMIC_OFFSETS} 个，收到 ${count}`);
        this._ops.push({
            k: "setBindGroup",
            index,
            group,
            offset0: count > 0 ? (offsets[0] ?? 0) : 0,
            offset1: count > 1 ? (offsets[1] ?? 0) : 0,
            offsetCount: count,
        });
    }
    setVertexBuffer(slot, buffer, offset = 0) {
        this.assertActive();
        if (this.dedupe && this._vertexBuffers[slot] === buffer && this._vertexOffsets[slot] === offset)
            return;
        this._vertexBuffers[slot] = buffer;
        this._vertexOffsets[slot] = offset;
        this._ops.push({ k: "setVertexBuffer", slot, buffer, offset });
    }
    setIndexBuffer(buffer, format, offset = 0) {
        this.assertActive();
        this._hasIndexBuffer = buffer !== null;
        if (this.dedupe && this._indexBuffer === buffer && this._indexFormat === format && this._indexOffset === offset)
            return;
        this._indexBuffer = buffer;
        this._indexFormat = format;
        this._indexOffset = offset;
        this._ops.push({ k: "setIndexBuffer", buffer, format, offset });
    }
    draw(vertexCount, instanceCount = 1, firstVertex = 0, firstInstance = 0) {
        this.assertActive();
        this.checkDrawable("draw");
        this._ops.push({ k: "draw", vertexCount, instanceCount, firstVertex, firstInstance });
    }
    drawIndexed(indexCount, instanceCount = 1, firstIndex = 0, baseVertex = 0, firstInstance = 0) {
        this.assertActive();
        this.checkDrawable("drawIndexed");
        assert(this._hasIndexBuffer, "drawIndexed 前必须 setIndexBuffer");
        this._ops.push({ k: "drawIndexed", indexCount, instanceCount, firstIndex, baseVertex, firstInstance });
    }
    setViewport(x, y, width, height, minDepth = 0, maxDepth = 1) {
        this.assertActive();
        this._ops.push({ k: "setViewport", x, y, width, height, minDepth, maxDepth });
    }
    /** 裁剪矩形（左上原点，单位：附件像素） */
    setScissorRect(x, y, width, height) {
        this.assertActive();
        this._ops.push({ k: "setScissorRect", x, y, width, height });
    }
    pushDebugGroup(label) {
        this.assertActive();
        this._ops.push({ k: "pushDebugGroup", label });
    }
    popDebugGroup() {
        this.assertActive();
        this._ops.push({ k: "popDebugGroup" });
    }
    checkDrawable(method) {
        if (!this._boundPipeline) {
            throw new UnidrawError(`[unidraw] ${method} 之前必须 setPipeline`);
        }
    }
    /** 结束当前渲染通道。 */
    end() {
        this.assertActive();
        this._ops.push({ k: "endRenderPass" });
        this._ended = true;
        this._onEnd();
    }
}
//# sourceMappingURL=RenderPassEncoder.js.map