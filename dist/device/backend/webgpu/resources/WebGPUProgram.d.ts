import { Program } from "../../../resources.js";
import type { ProgramDescriptor } from "../../../descriptors.js";
import { WebGPUDevice } from "../WebGPUDevice.js";
export declare class WebGPUProgram extends Program {
    readonly gpuModule: GPUShaderModule;
    readonly vertexEntryPoint: string;
    readonly fragmentEntryPoint: string;
    constructor(device: WebGPUDevice, desc: ProgramDescriptor);
    protected destroyNative(): void;
}
//# sourceMappingURL=WebGPUProgram.d.ts.map