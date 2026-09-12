import type { BindGroup, Buffer, RenderPipeline } from "../device/resources.js";
import type { IndexFormat } from "../gpu/types.js";
import type { CommandOp } from "./ops.js";
/**
 * 渲染通道编码器：只能通过 `CommandEncoder.beginRenderPass()` 创建，
 * `end()` 之后不可再使用。
 */
export declare class RenderPassEncoder {
    private _ended;
    private readonly _ops;
    private readonly _onEnd;
    private _boundPipeline;
    private _hasIndexBuffer;
    /** 冗余设置去重：状态未变时不再产生 op（大量 draw 时能省掉 ~60% 的命令对象） */
    private _vertexBuffers;
    private _vertexOffsets;
    private _indexBuffer;
    private _indexFormat;
    private _indexOffset;
    /** 是否启用冗余去重（默认开；关掉可得到「每次调用都记录」的完整命令流） */
    dedupe: boolean;
    readonly label: string | undefined;
    /** 本 pass 附件的采样数（材质据此选择匹配管线；WebGPU 校验要求一致） */
    readonly sampleCount: number;
    constructor(ops: CommandOp[], label: string | undefined, sampleCount: number, onEnd: () => void);
    private assertActive;
    setPipeline(pipeline: RenderPipeline): void;
    /**
     * 绑定 bind group。
     * @param offsets 动态偏移数组：与布局中 `hasDynamicOffset` 的 entry 顺序一一对应
     *                （语义与 WebGPU `setBindGroup(index, group, dynamicOffsets)` 一致）。
     *                最多 `MAX_DYNAMIC_OFFSETS` 个；内部按值内联存储，不会持有/分配数组。
     */
    setBindGroup(index: number, group: BindGroup, offsets?: readonly number[] | null): void;
    setVertexBuffer(slot: number, buffer: Buffer | null, offset?: number): void;
    setIndexBuffer(buffer: Buffer | null, format: IndexFormat, offset?: number): void;
    draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;
    drawIndexed(indexCount: number, instanceCount?: number, firstIndex?: number, baseVertex?: number, firstInstance?: number): void;
    setViewport(x: number, y: number, width: number, height: number, minDepth?: number, maxDepth?: number): void;
    /** 裁剪矩形（左上原点，单位：附件像素） */
    setScissorRect(x: number, y: number, width: number, height: number): void;
    pushDebugGroup(label: string): void;
    popDebugGroup(): void;
    private checkDrawable;
    /** 结束当前渲染通道。 */
    end(): void;
}
//# sourceMappingURL=RenderPassEncoder.d.ts.map