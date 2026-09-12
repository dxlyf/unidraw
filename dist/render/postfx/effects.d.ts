/**
 * 内置后处理效果。
 *
 * | 效果 | 作用 | 关键参数 |
 * | --- | --- | --- |
 * | `CopyPass` | 直通拷贝（也用于「无效果时输出」） | — |
 * | `ToneMapPass` | 色调映射 + 曝光（none/linear/reinhard/aces） | `mode`、`exposure` |
 * | `VignettePass` | 暗角 | `strength`、`softness` |
 * | `GrayscalePass` | 灰度（含配方权重） | `amount` |
 * | `BloomPass` | 亮部提取 + 可分离高斯模糊 + 叠加（自带中间目标） | `threshold`、`strength`、`radius`、`scale` |
 * | `ShaderPass` | 自定义 fragment（GLSL + WGSL 成对给出） | 自定义 |
 *
 * 多趟效果（Bloom）自带 `RenderTarget`，通过 `ctx.encoder` 自己开 pass，
 * 因此可以任意嵌套/组合，不需要 composer 特殊照顾。
 */
import { FullScreenPass, type PostEffect, type PostEffectContext } from "./FullScreenPass.js";
import type { Device } from "../../device/Device.js";
import type { TextureFormat } from "../../gpu/types.js";
/** 直通拷贝（可用于「把某张纹理输出到画布/目标」） */
export declare class CopyPass extends FullScreenPass {
    constructor(device: Device, targetFormat?: TextureFormat);
}
export type ToneMappingMode = "none" | "linear" | "reinhard" | "aces";
export interface ToneMapOptions {
    mode?: ToneMappingMode;
    exposure?: number;
    targetFormat?: TextureFormat;
}
/** 色调映射：HDR → LDR（默认 ACES 电影级曲线） */
export declare class ToneMapPass extends FullScreenPass {
    mode: ToneMappingMode;
    exposure: number;
    constructor(device: Device, options?: ToneMapOptions);
    render(ctx: PostEffectContext): void;
}
export declare class VignettePass extends FullScreenPass {
    /** 暗角强度（0 关闭） */
    strength: number;
    /** 软化程度（越大越平滑） */
    softness: number;
    constructor(device: Device, options?: {
        strength?: number;
        softness?: number;
        targetFormat?: TextureFormat;
    });
    render(ctx: PostEffectContext): void;
}
export declare class GrayscalePass extends FullScreenPass {
    /** 混合量 0..1 */
    amount: number;
    constructor(device: Device, options?: {
        amount?: number;
        targetFormat?: TextureFormat;
    });
    render(ctx: PostEffectContext): void;
}
/** 自定义单趟效果 */
export declare class ShaderPass extends FullScreenPass {
    constructor(device: Device, options: {
        name?: string;
        fragment: {
            glsl: string;
            wgsl: string;
        };
        targetFormat?: TextureFormat;
        extraTextureCount?: number;
    });
}
export interface BloomOptions {
    /** 亮度阈值（只有超过它的像素才泛光） */
    threshold?: number;
    /** 泛光强度（叠加系数） */
    strength?: number;
    /** 模糊半径（像素） */
    radius?: number;
    /** 中间层分辨率比例（默认 0.5；越小越快越糊） */
    scale?: number;
    targetFormat?: TextureFormat;
}
export declare class BloomPass implements PostEffect {
    readonly name = "bloom";
    threshold: number;
    strength: number;
    radius: number;
    private readonly _device;
    private readonly _bright;
    private readonly _blur;
    private readonly _composite;
    private readonly _scale;
    private readonly _format;
    private _half;
    private _tmp;
    private _width;
    private _height;
    constructor(device: Device, options?: BloomOptions);
    resize(width: number, height: number): void;
    render(ctx: PostEffectContext): void;
    dispose(): void;
    private _renderTo;
}
//# sourceMappingURL=effects.d.ts.map