import type { Device } from "../../device/Device.js";
import { Texture } from "../../device/resources.js";
import { Color } from "../../math/color.js";
export interface CheckerTextureOptions {
    label?: string;
    /** 单格像素数 */
    cell?: number;
    /** 长宽（像素） */
    width?: number;
    height?: number;
    colorA?: Color;
    colorB?: Color;
    format?: "rgba8unorm" | "rgba8unorm-srgb";
}
/** 棋盘格纹理（用于纹理示例）。 */
export declare function createCheckerTexture(device: Device, options?: CheckerTextureOptions): Texture;
//# sourceMappingURL=checker.d.ts.map