import { assert } from "../util/assert.js";
import { UnidrawError } from "../util/assert.js";
import type { BindGroup, Buffer, RenderPipeline } from "../device/resources.js";
import type { IndexFormat } from "../gpu/types.js";
import type { RenderPassDescriptor } from "../device/descriptors.js";
import { type CommandOp, type ColorAttachmentOp, type DepthStencilAttachmentOp } from "./ops.js";

/**
 * 不可变命令缓冲：记录后可作为整体多次 submit。
 * 内容与后端无关（只持有句柄引用）。
 */
export class CommandBuffer {
  private readonly _ops: readonly CommandOp[];
  readonly label: string | undefined;

  /** 内部构造：请通过 CommandEncoder.finish() 获取。 */
  constructor(ops: readonly CommandOp[], label?: string) {
    this._ops = ops;
    this.label = label;
  }

  get ops(): readonly CommandOp[] {
    return this._ops;
  }

  /** 命令数（可用于粗粒度统计/调试）。 */
  get opCount(): number {
    return this._ops.length;
  }
}

// ---------------------------------------------------------------------------
// Render pass encoder
// ---------------------------------------------------------------------------

/**
 * 渲染通道编码器：只能通过 beginRenderPass 创建，
 * 结束（end）后不可再使用。
 */
export class RenderPassEncoder {
  private _ended = false;
  private readonly _ops: CommandOp[];
  private readonly _onEnd: () => void;
  private _boundPipeline: RenderPipeline | null = null;
  private _hasIndexBuffer = false;
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
    this._ops.push({ k: "setPipeline", pipeline });
    this._boundPipeline = pipeline;
  }

  setBindGroup(index: number, group: BindGroup): void {
    this.assertActive();
    assert(index >= 0 && index < 4, `bind group index ${index} 超出范围`);
    this._ops.push({ k: "setBindGroup", index, group });
  }

  setVertexBuffer(slot: number, buffer: Buffer | null, offset = 0): void {
    this.assertActive();
    this._ops.push({ k: "setVertexBuffer", slot, buffer, offset });
  }

  setIndexBuffer(buffer: Buffer | null, format: IndexFormat, offset = 0): void {
    this.assertActive();
    this._ops.push({ k: "setIndexBuffer", buffer, format, offset });
    this._hasIndexBuffer = buffer !== null;
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

// ---------------------------------------------------------------------------
// Command encoder
// ---------------------------------------------------------------------------

/**
 * 命令编码器：记录一帧内的若干渲染通道。与后端无关。
 */
export class CommandEncoder {
  private _ops: CommandOp[] = [];
  private _activePass: RenderPassEncoder | null = null;
  private _finished = false;
  private _debugDepth = 0;
  readonly label: string | undefined;

  constructor(label?: string) {
    this.label = label;
  }

  get finished(): boolean {
    return this._finished;
  }

  private assertOpen(): void {
    assert(!this._finished, "CommandEncoder 已 finish，禁止继续记录");
    assert(this._activePass === null, "存在未 end 的 RenderPass");
  }

  beginRenderPass(desc: RenderPassDescriptor): RenderPassEncoder {
    this.assertOpen();
    const colorAttachments = desc.colorAttachments.map(
      (att): ColorAttachmentOp | null =>
        att === null
          ? null
          : {
              view: att.view,
              loadOp: att.loadOp ?? "clear",
              storeOp: att.storeOp ?? "store",
              clearValue: att.clearValue,
            },
    );
    const depth = desc.depthStencilAttachment;
    const depthOp: DepthStencilAttachmentOp | null =
      depth === null || depth === undefined
        ? null
        : {
            view: depth.view,
            depthLoadOp: depth.depthLoadOp ?? "clear",
            depthStoreOp: depth.depthStoreOp ?? "store",
            depthClearValue: depth.depthClearValue ?? 1,
          };
    this._ops.push({ k: "beginRenderPass", label: desc.label, colorAttachments, depthStencilAttachment: depthOp });
    const pass = new RenderPassEncoder(this._ops, desc.label, () => {
      this._activePass = null;
    });
    this._activePass = pass;
    return pass;
  }

  pushDebugGroup(label: string): void {
    this.assertOpen();
    this._ops.push({ k: "pushDebugGroup", label });
    this._debugDepth++;
  }

  popDebugGroup(): void {
    this.assertOpen();
    assert(this._debugDepth > 0, "popDebugGroup 与 pushDebugGroup 不匹配");
    this._ops.push({ k: "popDebugGroup" });
    this._debugDepth--;
  }

  /** 完成编码，返回不可变命令缓冲。之后本 encoder 不可再使用。 */
  finish(): CommandBuffer {
    assert(this._activePass === null, "finish 前必须 end 所有 RenderPass");
    assert(!this._finished, "CommandEncoder 已 finish");
    assert(this._debugDepth === 0, "pushDebugGroup/popDebugGroup 不匹配");
    this._finished = true;
    const buffer = new CommandBuffer(this._ops, this.label);
    this._ops = [];
    return buffer;
  }
}
