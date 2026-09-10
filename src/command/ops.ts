/**
 * 统一命令定义：一次渲染的所有命令被记录为不可变 op 列表，
 * 后端（WebGL2/WebGPU/Mock）在 submit 时各自翻译执行。
 *
 * 每个 op 只引用“句柄”对象（Buffer/Texture/RenderPipeline/BindGroup），
 * 因此命令缓冲本身与后端无关 —— 这正是“一套统一绘制命令”的载体。
 */

import type { IndexFormat, LoadOp, StoreOp } from "../gpu/types.js";
import type { ColorClearValue } from "../gpu/types.js";
import type { BindGroup, Buffer, RenderPipeline, TextureView } from "../device/resources.js";

export interface ColorAttachmentOp {
  view: TextureView | null;
  loadOp: LoadOp;
  storeOp: StoreOp;
  clearValue?: ColorClearValue;
  /**
   * MSAA 解析目标：`view` 是多采样附件时把结果解析到这张（可采样的）视图。
   * WebGPU 映射到 `resolveTarget`；WebGL2 在 pass 结束时 `blitFramebuffer` 解析。
   */
  resolveTo?: TextureView | null;
  /** 附件采样数（1 = 不 MSAA）。WebGL2 会用多重采样 renderbuffer 实现。 */
  sampleCount?: number;
}

export interface DepthStencilAttachmentOp {
  view: TextureView | null;
  depthLoadOp: LoadOp;
  depthStoreOp: StoreOp;
  depthClearValue?: number;
  /** 深度附件采样数（MSAA 时必须与颜色附件一致） */
  sampleCount?: number;
}

export type CommandOp =
  | {
      k: "beginRenderPass";
      label?: string;
      colorAttachments: (ColorAttachmentOp | null)[];
      depthStencilAttachment: DepthStencilAttachmentOp | null;
    }
  | { k: "endRenderPass" }
  | { k: "setPipeline"; pipeline: RenderPipeline }
  /**
   * 绑定 bind group。动态偏移**内联存两个整数**（不分配数组）：
   * 逐 draw 换槽的高频路径（例如共享材质的模型矩阵 + ID 槽）每次绘制都会调用它，
   * 若在这里存 `number[]` 引用，一帧几万次绘制就是几万个短命数组。
   * 偏移非负整数、布局里最多 `MAX_DYNAMIC_OFFSETS` 个动态 entry。
   */
  | { k: "setBindGroup"; index: number; group: BindGroup; offset0: number; offset1: number; offsetCount: number }
  | { k: "setVertexBuffer"; slot: number; buffer: Buffer | null; offset: number }
  | { k: "setIndexBuffer"; buffer: Buffer | null; format: IndexFormat; offset: number }
  | { k: "draw"; vertexCount: number; instanceCount: number; firstVertex: number; firstInstance: number }
  | { k: "drawIndexed"; indexCount: number; instanceCount: number; firstIndex: number; baseVertex: number; firstInstance: number }
  | { k: "setViewport"; x: number; y: number; width: number; height: number; minDepth: number; maxDepth: number }
  | { k: "setScissorRect"; x: number; y: number; width: number; height: number }
  | { k: "pushDebugGroup"; label: string }
  | { k: "popDebugGroup" };

export interface DrawOp {
  kind: "draw" | "drawIndexed";
  vertexCount: number;
  instanceCount: number;
  firstVertex: number;
  firstIndex: number;
  baseVertex: number;
  firstInstance: number;
}

/**
 * 一次 `setBindGroup` 最多支持的动态偏移个数。
 *
 * 内置布局最多用到 2 个：模型矩阵环（binding 1）+ 材质自己的动态块（如 ID 槽 binding 4）。
 * 需要更多时请扩展这个常量与 `RenderPassEncoder.setBindGroup` 的内联字段。
 */
export const MAX_DYNAMIC_OFFSETS = 2;

/** 从 op 里读出动态偏移（长度 = `offsetCount`；`out` 可复用以避免分配） */
export function readDynamicOffsets(
  op: { offset0: number; offset1: number; offsetCount: number },
  out: number[] = [],
): number[] {
  out.length = op.offsetCount;
  if (op.offsetCount > 0) out[0] = op.offset0;
  if (op.offsetCount > 1) out[1] = op.offset1;
  return out;
}
