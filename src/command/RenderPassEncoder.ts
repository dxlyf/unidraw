import { assert, UnidrawError } from "../util/assert.js";
import type { BindGroup, Buffer, RenderPipeline } from "../device/resources.js";
import type { IndexFormat } from "../gpu/types.js";
import type { CommandOp } from "./ops.js";

/**
 * 渲染通道编码器：只能通过 `CommandEncoder.beginRenderPass()` 创建，
 * `end()` 之后不可再使用。
 */
export class RenderPassEncoder {
  private _ended = false;
  private readonly _ops: CommandOp[];
  private readonly _onEnd: () => void;
  private _boundPipeline: RenderPipeline | null = null;
  private _hasIndexBuffer = false;
  /** 冗余设置去重：状态未变时不再产生 op（大量 draw 时能省掉 ~60% 的命令对象） */
  private _vertexBuffers: (Buffer | null)[] = [];
  private _vertexOffsets: number[] = [];
  private _indexBuffer: Buffer | null = null;
  private _indexFormat: IndexFormat | null = null;
  private _indexOffset = 0;
  /** 是否启用冗余去重（默认开；关掉可得到「每次调用都记录」的完整命令流） */
  dedupe = true;
  readonly label: string | undefined;

  constructor(ops: CommandOp[], label: string | undefined, onEnd: () => void) {
    this._ops = ops;
    this.label = label;
    this._onEnd = onEnd;
  }

  private assertActive(): void {
    assert(!this._ended, "RenderPassEncoder 已 end，禁止继续记录");
  }

  setPipeline(pipeline: RenderPipeline): void {
    this.assertActive();
    if (this.dedupe && this._boundPipeline === pipeline) return;
    this._ops.push({ k: "setPipeline", pipeline });
    this._boundPipeline = pipeline;
  }

  /**
   * 绑定 bind group。
   * @param offsets 动态偏移数组：与布局中 `hasDynamicOffset` 的 entry 顺序一一对应
   *                （语义与 WebGPU `setBindGroup(index, group, dynamicOffsets)` 一致）。
   */
  setBindGroup(index: number, group: BindGroup, offsets?: readonly number[] | null): void {
    this.assertActive();
    assert(index >= 0 && index < 4, `bind group index ${index} 超出范围`);
    this._ops.push({ k: "setBindGroup", index, group, offsets: offsets && offsets.length > 0 ? offsets : null });
  }

  setVertexBuffer(slot: number, buffer: Buffer | null, offset = 0): void {
    this.assertActive();
    if (this.dedupe && this._vertexBuffers[slot] === buffer && this._vertexOffsets[slot] === offset) return;
    this._vertexBuffers[slot] = buffer;
    this._vertexOffsets[slot] = offset;
    this._ops.push({ k: "setVertexBuffer", slot, buffer, offset });
  }

  setIndexBuffer(buffer: Buffer | null, format: IndexFormat, offset = 0): void {
    this.assertActive();
    this._hasIndexBuffer = buffer !== null;
    if (this.dedupe && this._indexBuffer === buffer && this._indexFormat === format && this._indexOffset === offset) return;
    this._indexBuffer = buffer;
    this._indexFormat = format;
    this._indexOffset = offset;
    this._ops.push({ k: "setIndexBuffer", buffer, format, offset });
  }

  draw(vertexCount: number, instanceCount = 1, firstVertex = 0, firstInstance = 0): void {
    this.assertActive();
    this.checkDrawable("draw");
    this._ops.push({ k: "draw", vertexCount, instanceCount, firstVertex, firstInstance });
  }

  drawIndexed(indexCount: number, instanceCount = 1, firstIndex = 0, baseVertex = 0, firstInstance = 0): void {
    this.assertActive();
    this.checkDrawable("drawIndexed");
    assert(this._hasIndexBuffer, "drawIndexed 前必须 setIndexBuffer");
    this._ops.push({ k: "drawIndexed", indexCount, instanceCount, firstIndex, baseVertex, firstInstance });
  }

  setViewport(x: number, y: number, width: number, height: number, minDepth = 0, maxDepth = 1): void {
    this.assertActive();
    this._ops.push({ k: "setViewport", x, y, width, height, minDepth, maxDepth });
  }

  /** 裁剪矩形（左上原点，单位：附件像素） */
  setScissorRect(x: number, y: number, width: number, height: number): void {
    this.assertActive();
    this._ops.push({ k: "setScissorRect", x, y, width, height });
  }

  pushDebugGroup(label: string): void {
    this.assertActive();
    this._ops.push({ k: "pushDebugGroup", label });
  }

  popDebugGroup(): void {
    this.assertActive();
    this._ops.push({ k: "popDebugGroup" });
  }

  private checkDrawable(method: string): void {
    if (!this._boundPipeline) {
      throw new UnidrawError(`[unidraw] ${method} 之前必须 setPipeline`);
    }
  }

  /** 结束当前渲染通道。 */
  end(): void {
    this.assertActive();
    this._ops.push({ k: "endRenderPass" });
    this._ended = true;
    this._onEnd();
  }
}
