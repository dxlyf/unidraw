import { Buffer } from "../../../resources.js";
import type { BufferDescriptor } from "../../../descriptors.js";
import { WebGPUDevice } from "../WebGPUDevice.js";
export declare class WebGPUBuffer extends Buffer {
    readonly gpuBuffer: GPUBuffer;
    private readonly _device;
    constructor(device: WebGPUDevice, desc: BufferDescriptor);
    write(data: ArrayBufferView | ArrayBuffer, offset?: number): void;
    protected destroyNative(): void;
}
//# sourceMappingURL=WebGPUBuffer.d.ts.map