import { BindGroup, Buffer, RenderPipeline } from "../../resources.js";
import type { IndexFormat, TextureFormat } from "../../../gpu/types.js";
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
    /** 每个 bind group 的动态偏移快照（无动态偏移为 null） */
    bindGroupOffsets: (number[] | null)[];
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
    viewport: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    scissor: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
}
export interface PassState {
    colorFormats: (TextureFormat | null)[];
    width: number;
    height: number;
}
//# sourceMappingURL=types.d.ts.map