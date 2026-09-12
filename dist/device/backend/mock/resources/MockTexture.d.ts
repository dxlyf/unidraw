import { Texture, TextureView } from "../../../resources.js";
import type { TextureDescriptor, TextureUploadOptions } from "../../../descriptors.js";
import { MockDevice } from "../MockDevice.js";
export declare class MockTexture extends Texture {
    /** 颜色纹理的 CPU 像素；深度/浮点纹理为 null */
    readonly pixels: Uint8Array | null;
    readonly bpp: number;
    constructor(device: MockDevice, desc: TextureDescriptor);
    protected createDefaultView(): TextureView;
    protected createLayerView(baseArrayLayer: number, mipLevel: number): TextureView;
    upload(data: ArrayBufferView, options?: TextureUploadOptions): void;
    generateMipmaps(): void;
    protected destroyNative(): void;
}
//# sourceMappingURL=MockTexture.d.ts.map