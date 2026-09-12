import { Texture, TextureView } from "../../../resources.js";
/**
 * WebGL2 纹理视图。
 *
 * 视图本身只是「纹理 + 层号/mip」的描述，实际的 `framebufferTextureLayer` /
 * `framebufferTexture2D(TEXTURE_CUBE_MAP_POSITIVE_X + layer)` 由 `WebGL2Device`
 * 在挂附件时按纹理维度选择（cube 不能用 `framebufferTextureLayer`）。
 */
export declare class GLTextureView extends TextureView {
    constructor(texture: Texture, baseArrayLayer?: number, layerCount?: number | null, mipLevel?: number);
}
//# sourceMappingURL=GLTextureView.d.ts.map