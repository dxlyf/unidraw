import { RenderPipeline } from "../../../resources.js";
import type { RenderPipelineDescriptor } from "../../../descriptors.js";
import { WebGPUDevice } from "../WebGPUDevice.js";
export declare class WebGPURenderPipeline extends RenderPipeline {
    readonly gpuPipeline: GPURenderPipeline;
    constructor(device: WebGPUDevice, desc: RenderPipelineDescriptor);
    protected destroyNative(): void;
}
//# sourceMappingURL=WebGPURenderPipeline.d.ts.map