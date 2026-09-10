import { BindGroup, Buffer, RenderPipeline } from "../../resources.js";
import type { IndexFormat, TextureFormat } from "../../../gpu/types.js";


// ---------------------------------------------------------------------------
// Draw 记录
// ---------------------------------------------------------------------------
export interface MockVertexBufferBinding {
  slot: number;
  buffer: Buffer;
  offset: number;
}

export interface MockIndexBufferBinding {
  buffer: Buffer;
  format: IndexFormat;
  offset: number;
}

export interface MockDrawCall {
  kind: "draw" | "drawIndexed";
  passIndex: number;
  pipeline: RenderPipeline;
  bindGroups: (BindGroup | null)[];
  vertexBuffers: MockVertexBufferBinding[];
  indexBuffer: MockIndexBufferBinding | null;
  draw: {
    vertexCount?: number;
    /** drawIndexed 的索引数 */
    indexCount?: number;
    instanceCount: number;
    firstVertex: number;
    firstIndex: number;
    baseVertex: number;
    firstInstance: number;
  };
  viewport: { x: number; y: number; width: number; height: number };
  scissor: { x: number; y: number; width: number; height: number } | null;
}


// ---------------------------------------------------------------------------
// MockDevice
// ---------------------------------------------------------------------------
export interface PassState {
  colorFormats: (TextureFormat | null)[];
  width: number;
  height: number;
}
