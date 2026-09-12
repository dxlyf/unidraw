import { BindGroup } from "../../../resources.js";
import type { BindGroupDescriptor } from "../../../descriptors.js";
import { WebGPUDevice } from "../WebGPUDevice.js";
export declare class WebGPUBindGroup extends BindGroup {
    readonly gpuBindGroup: GPUBindGroup;
    constructor(device: WebGPUDevice, desc: BindGroupDescriptor);
    protected destroyNative(): void;
}
//# sourceMappingURL=WebGPUBindGroup.d.ts.map