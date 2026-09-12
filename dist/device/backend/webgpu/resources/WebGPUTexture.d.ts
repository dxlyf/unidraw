import { Texture, TextureView } from "../../../resources.js";
import type { TextureDescriptor, TextureUploadOptions } from "../../../descriptors.js";
import { WebGPUDevice } from "../WebGPUDevice.js";
export declare class WebGPUTexture extends Texture {
    readonly gpuTexture: GPUTexture;
    private readonly _device;
    constructor(device: WebGPUDevice, desc: TextureDescriptor);
    protected createDefaultView(): TextureView;
    protected createLayerView(baseArrayLayer: number, mipLevel: number): TextureView;
    upload(data: ArrayBufferView, options?: TextureUploadOptions): void;
    generateMipmaps(): void;
    protected destroyNative(): void;
}
//# sourceMappingURL=WebGPUTexture.d.ts.map