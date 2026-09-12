/**
 * GrayscalePass —— 灰度（Rec.709 亮度权重），`amount` 控制混合量。
 */
import { FullScreenPass, type PostEffectContext } from "./FullScreenPass.js";
import type { Device } from "../../device/Device.js";
import type { TextureFormat } from "../../gpu/types.js";
export interface GrayscaleOptions {
    amount?: number;
    targetFormat?: TextureFormat;
}
export declare class GrayscalePass extends FullScreenPass {
    /** 混合量 0..1 */
    amount: number;
    constructor(device: Device, options?: GrayscaleOptions);
    render(ctx: PostEffectContext): void;
}
//# sourceMappingURL=GrayscalePass.d.ts.map