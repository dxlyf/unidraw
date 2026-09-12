import { Texture } from "../../../resources.js";
import { assert } from "../../../../util/assert.js";
import { textureFormatInfo } from "../../../../gpu/formats.js";
import { isDepthFormat } from "../../../../gpu/types.js";
import { MockTextureView } from "./MockTextureView.js";
export class MockTexture extends Texture {
    /** 颜色纹理的 CPU 像素；深度/浮点纹理为 null */
    pixels;
    bpp;
    constructor(device, desc) {
        super(desc);
        assert(desc.width >= 1 && desc.height >= 1, "纹理尺寸必须 >=1");
        this.bpp = textureFormatInfo(desc.format).bytesPerTexel;
        this.pixels = isDepthFormat(desc.format) ? null : new Uint8Array(desc.width * desc.height * this.bpp);
        device.register(this);
    }
    createDefaultView() {
        return new MockTextureView(this);
    }
    createLayerView(baseArrayLayer, mipLevel) {
        return new MockTextureView(this, baseArrayLayer, 1, mipLevel);
    }
    upload(data, options = {}) {
        if (!this.pixels)
            return;
        const x = options.x ?? 0;
        const y = options.y ?? 0;
        const width = options.width ?? this.width;
        const height = options.height ?? this.height;
        const bytesPerRow = options.bytesPerRow ?? width * this.bpp;
        assert(width >= 1 && height >= 1 && x >= 0 && y >= 0, "upload 区域非法");
        assert(x + width <= this.width && y + height <= this.height, "upload 区域越界");
        const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        assert((height - 1) * bytesPerRow + width * this.bpp <= src.byteLength, "upload 数据长度不足");
        for (let row = 0; row < height; row++) {
            const srcStart = row * bytesPerRow;
            const dstStart = ((y + row) * this.width + x) * this.bpp;
            for (let b = 0; b < width * this.bpp; b++) {
                this.pixels[dstStart + b] = src[srcStart + b];
            }
        }
    }
    generateMipmaps() { }
    destroyNative() { }
}
//# sourceMappingURL=MockTexture.js.map