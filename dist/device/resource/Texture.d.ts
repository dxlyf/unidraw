import type { TextureFormat, TextureUsageFlags } from "../../gpu/types.js";
import type { TextureDescriptor, TextureUploadOptions } from "../descriptors.js";
import type { TextureDimension } from "../../gpu/types.js";
import { ResourceBase } from "./ResourceBase.js";
import type { TextureView } from "./TextureView.js";
/**
 * 2D 纹理句柄。
 */
export declare abstract class Texture extends ResourceBase {
    readonly width: number;
    readonly height: number;
    readonly format: TextureFormat;
    readonly usage: TextureUsageFlags;
    /** 维度（默认 `"2d"`）；见 `TextureDescriptor.dimension` */
    readonly dimension: TextureDimension;
    /** 3D 深度 / 数组层数 / cube 的面数（cube 恒为 6） */
    readonly depthOrArrayLayers: number;
    /** 采样数（>1 = 多重采样附件；回读要读解析后的单采样纹理，不是它本身） */
    readonly sampleCount: number;
    private _view;
    private readonly _layerViews;
    constructor(desc: TextureDescriptor);
    /** 获取默认视图（整幅：mip 0，采样 cube / 2d-array 时含全部层）。 */
    view(): TextureView;
    /**
     * 取**单层/单面**的视图（cube 纹理里 `layer` 就是面的序号 0..5）。
     *
     * 用于把某一层当作渲染附件（`RenderTarget` 的分层模式）或只采样某一层；
     * 2D 纹理上等价于 `view()`。结果按 `(layer, mipLevel)` 缓存。
     */
    viewLayer(layer?: number, mipLevel?: number): TextureView;
    /** 后端实现：单层视图（`layerCount = 1`） */
    protected abstract createLayerView(baseArrayLayer: number, mipLevel: number): TextureView;
    protected abstract createDefaultView(): TextureView;
    /** 上传像素数据（支持子区域）。 */
    abstract upload(data: ArrayBufferView, options?: TextureUploadOptions): void;
    /** 生成 mipmap（WebGPU 需 COPY_SRC|COPY_DST；WebGL2 需 mipLevelCount>1）。 */
    abstract generateMipmaps(): void;
    destroy(): void;
}
//# sourceMappingURL=Texture.d.ts.map