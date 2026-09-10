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
  | { k: "setBindGroup"; index: number; group: BindGroup; offsets: readonly number[] | null }
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
