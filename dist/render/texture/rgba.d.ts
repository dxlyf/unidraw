import type { Device } from "../../device/Device.js";
import { Texture } from "../../device/resources.js";
import { Color } from "../../math/color.js";
export interface PixelTextureOptions {
    label?: string;
    format?: "rgba8unorm" | "rgba8unorm-srgb";
}
export declare function rgbaTexture(device: Device, width: number, height: number, label: string | undefined, format: "rgba8unorm" | "rgba8unorm-srgb"): Texture;
/** 纯色纹理（2x2，避免采样边界问题）。 */
export declare function createSolidTexture(device: Device, color: Color, label?: string): Texture;
//# sourceMappingURL=rgba.d.ts.map