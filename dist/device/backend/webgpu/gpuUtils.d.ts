import type { ColorTargetDescriptor } from "../../descriptors.js";
import type { ColorClearValue } from "../../../gpu/types.js";
import type { VertexBufferLayoutDescriptor } from "../../descriptors.js";
export declare function mapUsage(usage: number): GPUTextureUsageFlags;
export declare function mapBufferUsage(usage: number): GPUBufferUsageFlags;
export declare function mapVisibility(flags: number): number;
export declare function align4(n: number): number;
export declare function toGPUVertexBufferLayout(layout: VertexBufferLayoutDescriptor): GPUVertexBufferLayout;
export declare function toGPUColorTarget(t: ColorTargetDescriptor): GPUColorTargetState;
export declare function colorAttachmentState(loadOp: "clear" | "load", storeOp: "store" | "discard", clearValue: ColorClearValue | undefined): {
    loadOp: GPULoadOp;
    storeOp: GPUStoreOp;
    clearValue?: GPUColor;
};
export declare function adapterName(adapter: GPUAdapter): string;
export declare function isWebGPUSupported(): boolean;
//# sourceMappingURL=gpuUtils.d.ts.map