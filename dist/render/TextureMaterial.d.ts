import type { Device } from "../device/Device.js";
import type { BindGroup, Texture } from "../device/resources.js";
import type { Color } from "../math/color.js";
import type { MaterialOptions } from "./BaseMaterial.js";
import { BaseMaterial } from "./BaseMaterial.js";
export interface TextureMaterialOptions extends MaterialOptions {
    /** 纹理地址模式等采样参数 */
    sampler?: {
        addressModeU?: "clamp-to-edge" | "repeat" | "mirror-repeat";
        addressModeV?: "clamp-to-edge" | "repeat" | "mirror-repeat";
        magFilter?: "nearest" | "linear";
        minFilter?: "nearest" | "linear";
        mipmapFilter?: "nearest" | "linear";
        /** 启用 mipmap 过滤（需要纹理生成完整 mip 链）；默认 false */
        mips?: boolean;
    };
}
/**
 * 纹理材质：albedo 纹理 * 颜色。
 * 布局：0/1/2 标准块，3 = LightsBlock（基类），4 = u_albedo，5 = u_albedoSampler。
 */
export declare class TextureMaterial extends BaseMaterial {
    private _texture;
    private readonly _sampler;
    private readonly _color;
    constructor(device: Device, color: Color, opts?: TextureMaterialOptions);
    private static createPlaceholderTexture;
    private flushColor;
    get color(): Color;
    setColor(color: Color): this;
    /** 绑定纹理（会重建 BindGroup）。 */
    setTexture(texture: Texture): this;
    get texture(): Texture;
    protected createBindGroup(): BindGroup;
}
//# sourceMappingURL=TextureMaterial.d.ts.map