import { Sampler } from "../../../resources.js";
import type { SamplerDescriptor } from "../../../descriptors.js";
import { WebGPUDevice } from "../WebGPUDevice.js";
export declare class WebGPUSampler extends Sampler {
    readonly gpuSampler: GPUSampler;
    constructor(device: WebGPUDevice, desc: SamplerDescriptor);
    protected destroyNative(): void;
}
//# sourceMappingURL=WebGPUSampler.d.ts.map