/**
 * BloomPass —— 泛光：亮部提取 → 可分离高斯模糊（横/纵）→ 叠加回原图。
 *
 * 自带 `RenderTarget`（默认半分辨率）并通过 `ctx.encoder` 自己开 pass，
 * 所以它是「多趟效果」，但不依赖 composer 的特殊照顾（不会嵌套 pass）。
 */
import { type PostEffect, type PostEffectContext } from "./FullScreenPass.js";
import type { Device } from "../../device/Device.js";
import type { TextureFormat } from "../../gpu/types.js";
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
//# sourceMappingURL=BloomPass.d.ts.map