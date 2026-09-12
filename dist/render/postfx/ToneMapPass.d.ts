/**
 * ToneMapPass —— 色调映射 + 曝光（HDR → LDR）。
 *
 * | mode | 曲线 |
 * | --- | --- |
 * | `none` | 只乘曝光，直接截断 |
 * | `linear` | 曝光后 clamp 到 [0,1] |
 * | `reinhard` | `x / (x + 1)` |
 * | `aces` | ACES 电影级近似（默认） |
 */
import { FullScreenPass, type PostEffectContext } from "./FullScreenPass.js";
import type { Device } from "../../device/Device.js";
import type { TextureFormat } from "../../gpu/types.js";
export type ToneMappingMode = "none" | "linear" | "reinhard" | "aces";
export interface ToneMapOptions {
    mode?: ToneMappingMode;
    exposure?: number;
    targetFormat?: TextureFormat;
}
export declare class ToneMapPass extends FullScreenPass {
    mode: ToneMappingMode;
    exposure: number;
    constructor(device: Device, options?: ToneMapOptions);
    render(ctx: PostEffectContext): void;
}
export declare function modeCode(mode: ToneMappingMode): number;
//# sourceMappingURL=ToneMapPass.d.ts.map