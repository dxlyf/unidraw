import { BindGroupLayout } from "../../../resources.js";
import type { BindGroupLayoutDescriptor } from "../../../descriptors.js";
import { WebGPUDevice } from "../WebGPUDevice.js";
export declare class WebGPUBindGroupLayout extends BindGroupLayout {
    readonly gpuLayout: GPUBindGroupLayout;
    constructor(device: WebGPUDevice, desc: BindGroupLayoutDescriptor);
    protected destroyNative(): void;
}
//# sourceMappingURL=WebGPUBindGroupLayout.d.ts.map