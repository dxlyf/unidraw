import { Texture, TextureView } from "../../../resources.js";
import type { TextureDescriptor, TextureUploadOptions } from "../../../descriptors.js";
import type { GL } from "../glUtils.js";
import { WebGL2Device } from "../WebGL2Device.js";
export declare class GLTexture extends Texture {
    readonly glTexture: WebGLTexture;
    readonly gl: GL;
    readonly id: number;
    /** GL 纹理目标（由 dimension 决定：2D / 3D / 2D_ARRAY / CUBE_MAP） */
    private readonly _target;
    private readonly _device;
    /**
     * 是否被当作渲染附件写过（颜色或深度）。
     *
     * GL 的行序与「页面上下」相反：光栅化把画面顶部写到最后一行，而 `upload()` 的
     * 第 0 行落在内存第 0 行。于是回读时**只有渲染出来的纹理需要翻转 Y**
     * （详见 `WebGL2Device.readTexturePixels` 的说明）。
     */
    usedAsAttachment: boolean;
    constructor(device: WebGL2Device, desc: TextureDescriptor);
    private static isDepthFormatLocal;
    /** 内部绑定用纹理单元 0（layout 分配从 1 开始，永不冲突）。 */
    private bindScratch;
    protected createDefaultView(): TextureView;
    protected createLayerView(baseArrayLayer: number, mipLevel: number): TextureView;
    upload(data: ArrayBufferView, options?: TextureUploadOptions): void;
    generateMipmaps(): void;
    protected destroyNative(): void;
}
//# sourceMappingURL=GLTexture.d.ts.map