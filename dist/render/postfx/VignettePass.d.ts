/**
 * VignettePass —— 暗角：越靠画面边缘越暗。
 *
 * `strength` 0..1（0 = 关闭），`softness` 越大过渡越平滑。
 */
import { FullScreenPass, type PostEffectContext } from "./FullScreenPass.js";
import type { Device } from "../../device/Device.js";
import type { TextureFormat } from "../../gpu/types.js";
export interface VignetteOptions {
    strength?: number;
    softness?: number;
    targetFormat?: TextureFormat;
}
export declare class VignettePass extends FullScreenPass {
    /** 暗角强度（0 关闭） */
    strength: number;
    /** 软化程度（越大越平滑） */
    softness: number;
    constructor(device: Device, options?: VignetteOptions);
    render(ctx: PostEffectContext): void;
}
//# sourceMappingURL=VignettePass.d.ts.map